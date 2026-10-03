import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addDays } from "@/core/dates";
import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";

/**
 * Ajuste calórico por tendencia contra base de datos real.
 *
 * Invariantes vigiladas: leer no escribe nada; aceptar deja decisión +
 * recomendación + objetivo nuevo en la misma transacción y enlazados; "ahora
 * no" no toca el objetivo y silencia la sugerencia; una sugerencia caducada no
 * se aplica.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const body = await import("@/server/services/body.service");
const adjustment =
  await import("@/server/services/nutrition-adjustment.service");

const HOY = "2026-09-01";
const AHORA = new Date(`${HOY}T10:00:00Z`);

const BASE = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  waistCm: 94,
  trainingYears: 3,
  daysPerWeek: 4,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
  strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
  weeklyRatePct: -0.5,
  targetWeightKg: 78,
  dailySteps: 8500,
  workActivity: "SEDENTARY",
  balancedProgram: true,
  priorityMuscles: [],
  contraindications: [],
  excludedExerciseNames: [],
} as const;

/**
 * Perfil con el onboarding hecho hace 70 días: 4 semanas bajando al ritmo y
 * después estancado, con un pesaje diario y algo de ruido.
 */
async function perfilEstancado(username: string): Promise<string> {
  const userId = await createTestUser(prisma, username);
  const inicio = addDays(HOY, -69);
  const { profileId } = await completeOnboarding(
    userId,
    onboardingSchema.parse(BASE),
    new Date(`${inicio}T10:00:00Z`),
  );
  let w = 84;
  for (let i = 0; i < 70; i++) {
    if (i > 0 && i < 28) w -= 0.42 / 7;
    const ruido = 0.35 * Math.sin(i * 1.7) + 0.15 * Math.cos(i * 0.9);
    await body.saveWeight(
      profileId,
      {
        localDate: addDays(inicio, i),
        weightKg: Math.round((w + ruido) * 10) / 10,
      },
      AHORA,
    );
  }
  return profileId;
}

beforeAll(async () => {
  await runSeed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("ajuste calórico", () => {
  it("leer la sugerencia no escribe nada", async () => {
    const profileId = await perfilEstancado("lector");
    const antes = await prisma.recommendation.count({ where: { profileId } });

    const r = await adjustment.getCalorieAdjustment(profileId, AHORA);

    expect(r?.reasonCode).toBe("STALLED_CONFIRMED");
    expect(r?.proposal?.deltaKcal).toBe(-100);
    expect(await prisma.recommendation.count({ where: { profileId } })).toBe(
      antes,
    );
  });

  it("aceptar crea el objetivo nuevo enlazado a su decisión", async () => {
    const profileId = await perfilEstancado("acepta");
    const r = await adjustment.getCalorieAdjustment(profileId, AHORA);
    const previo = await prisma.nutritionTarget.findFirstOrThrow({
      where: { profileId },
    });

    await adjustment.resolveCalorieAdjustment(
      profileId,
      { accept: true, expectedKcal: r!.proposal!.kcal },
      AHORA,
    );

    const vigente = await prisma.nutritionTarget.findFirstOrThrow({
      where: { profileId },
      orderBy: { effectiveFrom: "desc" },
      include: { recommendation: { include: { decision: true } } },
    });
    expect(vigente.effectiveFrom).toBe(HOY);
    expect(vigente.kcal).toBe(previo.kcal - 100);
    expect(vigente.proteinG).toBe(previo.proteinG);
    expect(vigente.fatG).toBe(previo.fatG);
    expect(vigente.source).toBe("ALGORITHM");
    expect(vigente.recommendation?.status).toBe("ACCEPTED");
    expect(vigente.recommendation?.decision.ruleId).toBe("R7b");
    expect(vigente.recommendation?.decision.engine).toBe("nutrition");

    // Recién cambiado: el motor ya no propone nada (enfriamiento).
    const despues = await adjustment.getCalorieAdjustment(profileId, AHORA);
    expect(despues?.reasonCode).toBe("COOLDOWN");
  });

  it("'ahora no' no toca el objetivo y silencia la sugerencia una semana", async () => {
    const profileId = await perfilEstancado("rechaza");
    const r = await adjustment.getCalorieAdjustment(profileId, AHORA);

    await adjustment.resolveCalorieAdjustment(
      profileId,
      { accept: false, expectedKcal: r!.proposal!.kcal },
      AHORA,
    );

    expect(await prisma.nutritionTarget.count({ where: { profileId } })).toBe(
      1,
    );
    const rec = await prisma.recommendation.findFirstOrThrow({
      where: { profileId, type: "ADJUST_CALORIES" },
    });
    expect(rec.status).toBe("REJECTED");
    const despues = await adjustment.getCalorieAdjustment(profileId, AHORA);
    expect(despues?.reasonCode).toBe("SNOOZED");
  });

  it("una sugerencia caducada no se aplica", async () => {
    const profileId = await perfilEstancado("caducada");
    await expect(
      adjustment.resolveCalorieAdjustment(
        profileId,
        { accept: true, expectedKcal: 1234 },
        AHORA,
      ),
    ).rejects.toBeInstanceOf(adjustment.StaleAdjustmentError);
    expect(await prisma.nutritionTarget.count({ where: { profileId } })).toBe(
      1,
    );
  });
});
