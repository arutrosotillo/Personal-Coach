import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CoachProvider } from "@/ai/provider";
import type { CoachBodyContext } from "@/ai/context";
import { bodyCheckInSchema } from "@/core/schemas/body-measurement";
import { onboardingSchema } from "@/core/schemas/onboarding";
import { addDays } from "@/core/dates";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * El bloque corporal que de verdad viaja a OpenAI (B6), construido sobre datos
 * reales y capturado con un proveedor falso.
 *
 * Lo que se vigila: que lleve los VEREDICTOS y no la serie cruda, que respete
 * las mismas cautelas que la pantalla, y que no declare ausente lo que sí
 * tenemos.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const body = await import("@/server/services/body.service");
const { askCoach } = await import("@/server/services/coach.service");

const HOY = "2026-09-01";
const AHORA = new Date(`${HOY}T10:00:00Z`);

const BASE = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
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

/** Captura el contexto exacto que habría viajado al proveedor. */
function proveedorEspia(): {
  provider: CoachProvider;
  leer: () => string | null;
} {
  let capturado: string | null = null;
  return {
    leer: () => capturado,
    provider: {
      generate: async (peticion) => {
        capturado = peticion.contextJson;
        return {
          kind: "OK",
          text: JSON.stringify({
            headline: "ok",
            highlights: [],
            fatigue: null,
            recommendation: "ok",
            hypotheses: [],
          }),
          model: "fake",
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: null,
        };
      },
    },
  };
}

async function montar(
  username: string,
  opts: { pesajes?: number; cintura?: boolean } = {},
) {
  const userId = await createTestUser(prisma, username);
  const { profileId } = await completeOnboarding(
    userId,
    onboardingSchema.parse(BASE),
    new Date(`${addDays(HOY, -40)}T10:00:00Z`),
  );
  const program = await prisma.trainingProgram.findFirstOrThrow({
    where: { profileId, isActive: true },
    include: {
      mesocycles: {
        include: {
          templates: {
            orderBy: { ordinal: "asc" },
            include: { exercises: true },
          },
        },
      },
    },
  });
  const meso = program.mesocycles[0];
  // Una sesión, para que `runCoach` no corte con NO_DATA.
  await seedCompletedSessionWithSets(prisma, {
    mesocycleId: meso.id,
    templateId: meso.templates[0].id,
    variantId: meso.templates[0].exercises[0].exerciseVariantId,
    localDate: addDays(HOY, -3),
    sets: [{ setNumber: 1, weightKg: 60, reps: 10, rir: 2 }],
  });

  for (let i = (opts.pesajes ?? 28) - 1; i >= 0; i--) {
    await body.saveWeight(
      profileId,
      {
        localDate: addDays(HOY, -i),
        weightKg: 84 - 0.06 * ((opts.pesajes ?? 28) - 1 - i),
      },
      AHORA,
    );
  }
  if (opts.cintura) {
    await body.submitCheckIn(
      profileId,
      bodyCheckInSchema.parse({
        localDate: HOY,
        waist1: 91.5,
        waist2: 92,
        waist3: 91.8,
      }),
      AHORA,
    );
  }
  return profileId;
}

async function contextoDe(profileId: string): Promise<CoachBodyContext | null> {
  const espia = proveedorEspia();
  await askCoach(profileId, { task: "WEEKLY" }, espia.provider, AHORA);
  const json = espia.leer();
  expect(json).not.toBeNull();
  return (JSON.parse(json!) as { body: CoachBodyContext | null }).body;
}

beforeAll(async () => {
  await runSeed(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("el bloque corporal que viaja al modelo", () => {
  it("lleva el veredicto del motor, no la serie de pesajes", async () => {
    const profileId = await montar("viaja");
    const b = await contextoDe(profileId);

    expect(b).not.toBeNull();
    expect(b!.weight.status).toBe("LOSING");
    expect(b!.weight.slopeKgPerWeek).toBeCloseTo(-0.42, 1);
    expect(b!.weight.windowDays).toBe(28);
    expect(b!.weight.measurementsInWindow).toBe(28);

    // NINGÚN array de pesajes: con la serie cruda el modelo podría fabricar
    // una tendencia distinta de la del motor.
    expect(Object.keys(b!).sort()).toEqual([
      "bodyFat",
      "checkIn",
      "goal",
      "insight",
      "waist",
      "weight",
    ]);
    expect(JSON.stringify(b)).not.toContain("rawKg");
  });

  it("lleva el objetivo y la fase, para que no compare contra lo que no toca", async () => {
    const profileId = await montar("objetivo");
    const b = await contextoDe(profileId);
    expect(b!.goal!.goalType).toBe("FAT_LOSS");
    expect(b!.goal!.targetWeightKg).toBe(78);
    expect(b!.goal!.phaseStartLocalDate).toBe(addDays(HOY, -40));
  });

  it("lleva el veredicto del motor de insights, no una conclusión propia", async () => {
    const profileId = await montar("insight");
    const b = await contextoDe(profileId);
    expect(b!.insight).not.toBeNull();
    expect(b!.insight!.observationCode).toBeTruthy();
  });

  it("con cintura de tres tomas, lleva el umbral fino", async () => {
    const profileId = await montar("cintura", { cintura: true });
    const b = await contextoDe(profileId);
    expect(b!.waist!.protocol).toBe("MEAN_OF_THREE");
    expect(b!.waist!.minDetectableChangeCm).toBe(3.1);
  });

  it("sin datos suficientes, la pendiente viaja como null y el estado lo dice", async () => {
    // Tres pesajes: el motor no puede afirmar tendencia, y el modelo tampoco.
    const profileId = await montar("pocos", { pesajes: 3 });
    const b = await contextoDe(profileId);
    expect(b!.weight.status).toBe("INSUFFICIENT_DATA");
    expect(b!.weight.slopeKgPerWeek).toBeNull();
  });

  it("con tendencia INCONCLUSIVE la pendiente viaja null AUNQUE esté calculada", async () => {
    // Es la regla más fácil de romper de todo B6: `weight.trend.slopePerWeek`
    // existe y tienta, pero el motor ha declarado que el intervalo cruza el
    // cero. Si viajara, el modelo diría "bajas 0,05 kg/semana" sobre un
    // número que la pantalla se niega a enseñar.
    const userId = await createTestUser(prisma, "inconcluso");
    const { profileId } = await completeOnboarding(
      userId,
      onboardingSchema.parse(BASE),
      new Date(`${addDays(HOY, -40)}T10:00:00Z`),
    );
    const program = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
      include: {
        mesocycles: {
          include: {
            templates: {
              orderBy: { ordinal: "asc" },
              include: { exercises: true },
            },
          },
        },
      },
    });
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: program.mesocycles[0].id,
      templateId: program.mesocycles[0].templates[0].id,
      variantId:
        program.mesocycles[0].templates[0].exercises[0].exerciseVariantId,
      localDate: addDays(HOY, -3),
      sets: [{ setNumber: 1, weightKg: 60, reps: 10, rir: 2 }],
    });

    // Peso plano con ruido grande: hay tendencia calculada, pero su intervalo
    // cruza el cero.
    const ruido = [0.9, -0.8, 0.3, -0.9, 0.8, -0.2, -0.1];
    for (let i = 27; i >= 0; i--) {
      await body.saveWeight(
        profileId,
        { localDate: addDays(HOY, -i), weightKg: 84 + ruido[(27 - i) % 7] },
        AHORA,
      );
    }

    const progreso = await body.getBodyProgress(profileId, AHORA);
    expect(progreso.analysis.weight.status).toBe("INCONCLUSIVE");
    // La pendiente EXISTE en el motor...
    expect(progreso.analysis.weight.trend).not.toBeNull();

    // ...pero NO viaja al modelo.
    const b = await contextoDe(profileId);
    expect(b!.weight.status).toBe("INCONCLUSIVE");
    expect(b!.weight.slopeKgPerWeek).toBeNull();
    // El intervalo sí, para que pueda explicar POR QUÉ no lo sabe.
    expect(b!.weight.ciLowPerWeek).not.toBeNull();
    expect(b!.weight.ciHighPerWeek).not.toBeNull();
  });

  it("un perfil sin ninguna medición no manda bloque corporal", async () => {
    const userId = await createTestUser(prisma, "sin-cuerpo-coach");
    const { profileId } = await completeOnboarding(
      userId,
      onboardingSchema.parse(BASE),
      new Date(`${HOY}T10:00:00Z`),
    );
    await prisma.bodyMeasurement.deleteMany({ where: { profileId } });
    const program = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
      include: {
        mesocycles: {
          include: { templates: { include: { exercises: true } } },
        },
      },
    });
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: program.mesocycles[0].id,
      templateId: program.mesocycles[0].templates[0].id,
      variantId:
        program.mesocycles[0].templates[0].exercises[0].exerciseVariantId,
      localDate: addDays(HOY, -3),
      sets: [{ setNumber: 1, weightKg: 60, reps: 10, rir: 2 }],
    });

    const espia = proveedorEspia();
    await askCoach(profileId, { task: "WEEKLY" }, espia.provider, AHORA);
    const ctx = JSON.parse(espia.leer()!) as {
      body: unknown;
      notAvailable: string[];
    };
    expect(ctx.body).toBeNull();
    // Y se declara ausente, que es lo cierto.
    expect(ctx.notAvailable).toContain("peso corporal actual");
  });

  it("con cuerpo, NO se le dice al modelo que falta el peso", async () => {
    const profileId = await montar("no-ausente");
    const espia = proveedorEspia();
    await askCoach(profileId, { task: "WEEKLY" }, espia.provider, AHORA);
    const ctx = JSON.parse(espia.leer()!) as { notAvailable: string[] };
    expect(ctx.notAvailable).not.toContain("peso corporal actual");
    // Lo que sigue sin registrarse, sí.
    expect(ctx.notAvailable).toContain("calorías diarias");
  });

  it("los números viajan REDONDEADOS por semántica (F7)", async () => {
    // El modelo tiene prohibido calcular, así que transcribe lo que recibe: en
    // la QA en vivo escribió literalmente «-0.4189655172413784 kg por semana»
    // y «83.98681344989609» en 13 de 95 respuestas. Los motores conservan la
    // precisión completa; lo que se recorta es la REPRESENTACIÓN.
    const profileId = await montar("redondeo", { cintura: true });
    const b = (await contextoDe(profileId))!;

    const decimales = (v: number | null) =>
      v === null ? 0 : (String(v).split(".")[1] ?? "").length;

    expect(decimales(b.weight.latestKg)).toBeLessThanOrEqual(1);
    expect(decimales(b.weight.latestEmaKg)).toBeLessThanOrEqual(1);
    expect(decimales(b.weight.totalChangeKg)).toBeLessThanOrEqual(1);
    expect(decimales(b.weight.slopeKgPerWeek)).toBeLessThanOrEqual(2);
    expect(decimales(b.weight.ciLowPerWeek)).toBeLessThanOrEqual(2);
    expect(decimales(b.weight.ciHighPerWeek)).toBeLessThanOrEqual(2);
    expect(decimales(b.waist!.latestCm)).toBeLessThanOrEqual(1);
    expect(decimales(b.goal!.targetKgPerWeek)).toBeLessThanOrEqual(2);

    // Y ninguna cifra del bloque entero se escapa: la garantía es del bloque,
    // no de los campos que se me hayan ocurrido.
    for (const m of JSON.stringify(b).matchAll(/-?\d+\.(\d+)/g)) {
      expect(
        m[1].length,
        `${m[0]} tiene demasiados decimales`,
      ).toBeLessThanOrEqual(2);
    }
  });

  it("con tendencia inconclusa, el intervalo también viaja redondeado", async () => {
    const userId = await createTestUser(prisma, "redondeo-ic");
    const { profileId } = await completeOnboarding(
      userId,
      onboardingSchema.parse(BASE),
      new Date(`${addDays(HOY, -40)}T10:00:00Z`),
    );
    const program = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
      include: {
        mesocycles: {
          include: {
            templates: {
              orderBy: { ordinal: "asc" },
              include: { exercises: true },
            },
          },
        },
      },
    });
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: program.mesocycles[0].id,
      templateId: program.mesocycles[0].templates[0].id,
      variantId:
        program.mesocycles[0].templates[0].exercises[0].exerciseVariantId,
      localDate: addDays(HOY, -3),
      sets: [{ setNumber: 1, weightKg: 60, reps: 10, rir: 2 }],
    });
    const ruido = [0.9, -0.8, 0.3, -0.9, 0.8, -0.2, -0.1];
    for (let i = 27; i >= 0; i--) {
      await body.saveWeight(
        profileId,
        { localDate: addDays(HOY, -i), weightKg: 84 + ruido[(27 - i) % 7] },
        AHORA,
      );
    }
    const b = (await contextoDe(profileId))!;
    expect(b.weight.status).toBe("INCONCLUSIVE");
    // El intervalo crudo era -0.2500503495491756 … 0.21020360625415607.
    expect(b.weight.ciLowPerWeek).toBe(-0.25);
    expect(b.weight.ciHighPerWeek).toBe(0.21);
  });

  it("los márgenes de error viajan con el cuerpo", async () => {
    const profileId = await montar("limites");
    const espia = proveedorEspia();
    await askCoach(profileId, { task: "WEEKLY" }, espia.provider, AHORA);
    const ctx = JSON.parse(espia.leer()!) as { limits: { notes: string[] } };
    const notas = ctx.limits.notes.join(" ");
    expect(notas).toMatch(/1 kg entre días/);
    expect(notas).toMatch(/NO permiten deducir una causa/);
  });
});
