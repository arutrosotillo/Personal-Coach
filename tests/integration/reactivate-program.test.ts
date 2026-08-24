import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";
import type { ManualProgramInput } from "@/core/schemas/manual-program";

import { createTestDatabase } from "./helpers/test-db";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * Integración Fase 3.1b: reactivar un programa archivado. Solo cambia isActive;
 * no crea programas ni traza, no toca plantillas/sesiones/snapshots/historial.
 */

const testDb = createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { createManualProgram } =
  await import("@/server/services/manual-program.service");
const { reactivateProgram } =
  await import("@/server/services/program-edit.service");
const { listArchivedPrograms } =
  await import("@/server/repositories/program.repo");
const { getExerciseHistorySummary } =
  await import("@/server/services/progression.service");

let profileId: string;
let variantIds: string[];

beforeAll(async () => {
  await runSeed(prisma);
  const data = onboardingSchema.parse({
    sex: "MALE",
    birthDate: "1992-03-10",
    heightCm: 178,
    weightKg: 84,
    trainingYears: 3,
    daysPerWeek: 3,
    minutesPerSession: 75,
    equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
    strategy: "LEAN_GAIN",
    dailySteps: 8000,
    workActivity: "SEDENTARY",
    balancedProgram: true,
    priorityMuscles: [],
  });
  const r = await completeOnboarding(data, new Date("2026-07-14T10:00:00Z"));
  profileId = r.profileId;
  const variants = await prisma.exerciseVariant.findMany({
    where: { deletedAt: null },
    take: 4,
    orderBy: { name: "asc" },
  });
  variantIds = variants.map((v) => v.id);
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

function manual(name: string, variantId: string): ManualProgramInput {
  return {
    name,
    days: [
      {
        name: "Día 1",
        exercises: [
          {
            exerciseVariantId: variantId,
            baseSets: 3,
            repRangeMin: 6,
            repRangeMax: 8,
            targetRir: 2,
            restSeconds: 150,
          },
        ],
      },
    ],
  };
}

const activePrograms = () =>
  prisma.trainingProgram.findMany({ where: { profileId, isActive: true } });

describe("reactivateProgram", () => {
  it("A activo → reactivar B → A archivado / B activo; nunca dos activos; sin traza nueva", async () => {
    // A y B (manuales). Al crear B, A queda archivado y B activo.
    await createManualProgram(profileId, manual("Programa A", variantIds[0]));
    const A = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
    });
    await createManualProgram(profileId, manual("Programa B", variantIds[1]));
    const B = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
    });
    expect(B.id).not.toBe(A.id);

    // Snapshot de las plantillas de A ANTES de reactivar.
    const aTemplatesBefore = await prisma.workoutTemplate.findMany({
      where: { mesocycle: { programId: A.id } },
      orderBy: { ordinal: "asc" },
      include: { exercises: { orderBy: { ordinal: "asc" } } },
    });
    const decisionsBefore = await prisma.algorithmDecision.count();
    const recsBefore = await prisma.recommendation.count();
    const programsBefore = await prisma.trainingProgram.count({
      where: { profileId },
    });

    // Reactivar A.
    await reactivateProgram(profileId, A.id);

    // Exactamente un activo, y es A.
    const active = await activePrograms();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(A.id);
    expect(
      (await prisma.trainingProgram.findUniqueOrThrow({ where: { id: B.id } }))
        .isActive,
    ).toBe(false);

    // No se crearon programas ni traza al reactivar.
    expect(await prisma.trainingProgram.count({ where: { profileId } })).toBe(
      programsBefore,
    );
    expect(await prisma.algorithmDecision.count()).toBe(decisionsBefore);
    expect(await prisma.recommendation.count()).toBe(recsBefore);

    // Las plantillas de A siguen EXACTAMENTE iguales (no se regeneraron).
    const aTemplatesAfter = await prisma.workoutTemplate.findMany({
      where: { mesocycle: { programId: A.id } },
      orderBy: { ordinal: "asc" },
      include: { exercises: { orderBy: { ordinal: "asc" } } },
    });
    expect(aTemplatesAfter).toEqual(aTemplatesBefore);
  });

  it("el historial hecho con B (antes) y con A (después) se conserva; B→A→B funciona", async () => {
    // Estado: A activo (del test anterior), B archivado.
    const A = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
    });
    const B = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: false, name: "Programa B" },
      include: { mesocycles: true },
    });

    // Sesión histórica hecha con B (variantIds[1]).
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: B.mesocycles[0].id,
      variantId: variantIds[1],
      localDate: "2026-07-18",
      sets: [{ setNumber: 1, weightKg: 70, reps: 6, rir: 2 }],
    });
    // Sesión histórica hecha con A (variantIds[0]).
    const aMeso = await prisma.mesocycle.findFirstOrThrow({
      where: { programId: A.id },
    });
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: aMeso.id,
      variantId: variantIds[0],
      localDate: "2026-07-26",
      sets: [{ setNumber: 1, weightKg: 55, reps: 6, rir: 2 }],
    });

    // Reactivar B: su historial y el de A siguen ahí.
    await reactivateProgram(profileId, B.id);
    expect((await activePrograms())[0].id).toBe(B.id);

    const histB = await getExerciseHistorySummary(profileId, variantIds[1]);
    expect(histB.sessionCount).toBeGreaterThanOrEqual(1);
    const histA = await getExerciseHistorySummary(profileId, variantIds[0]);
    expect(histA.sessionCount).toBeGreaterThanOrEqual(1);

    // Volver a A funciona.
    await reactivateProgram(profileId, A.id);
    expect((await activePrograms())[0].id).toBe(A.id);
  });

  it("reactivar el programa ya activo es un no-op seguro", async () => {
    const active = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
    });
    await reactivateProgram(profileId, active.id);
    const still = await activePrograms();
    expect(still).toHaveLength(1);
    expect(still[0].id).toBe(active.id);
  });

  it("rechaza reactivar un programa de otro perfil / inexistente (controlado)", async () => {
    await expect(reactivateProgram(profileId, "no-existe")).rejects.toThrow(
      /no existe|no es tuyo/,
    );
  });

  it("listArchivedPrograms devuelve los archivados con origen derivado", async () => {
    const archived = await listArchivedPrograms(profileId);
    expect(archived.length).toBeGreaterThanOrEqual(2);
    // El generado del onboarding está entre los archivados y marcado como generado.
    const generated = archived.filter((p) => p.isGenerated);
    expect(generated.length).toBeGreaterThanOrEqual(1);
    // Los manuales no son "generados".
    expect(
      archived.some((p) => p.name === "Programa B" && !p.isGenerated),
    ).toBe(true);
    // Ninguno es el activo.
    const active = (await activePrograms())[0];
    expect(archived.some((p) => p.id === active.id)).toBe(false);
  });
});
