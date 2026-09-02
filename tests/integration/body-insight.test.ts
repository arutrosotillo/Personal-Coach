import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";
import { addDays } from "@/core/dates";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * El insight cuerpo × rendimiento sobre datos reales: mediciones en la base,
 * sesiones de entrenamiento reales y el análisis de progresión de verdad.
 *
 * Aquí es donde se comprueba que el motor de insights se alimenta del motor de
 * entrenamiento EXISTENTE, y no de una segunda lógica paralela.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const body = await import("@/server/services/body.service");

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
  dailySteps: 8500,
  workActivity: "SEDENTARY",
  balancedProgram: true,
  priorityMuscles: [],
  contraindications: [],
  excludedExerciseNames: [],
} as const;

interface Montaje {
  profileId: string;
  mesocycleId: string;
  templateIds: string[];
  variantIds: string[];
}

async function montar(username: string): Promise<Montaje> {
  const userId = await createTestUser(prisma, username);
  const { profileId } = await completeOnboarding(
    userId,
    onboardingSchema.parse(BASE),
    new Date(`${addDays(HOY, -60)}T10:00:00Z`),
  );
  const program = await prisma.trainingProgram.findFirstOrThrow({
    where: { profileId, isActive: true },
    include: {
      mesocycles: {
        include: {
          templates: {
            orderBy: { ordinal: "asc" },
            include: { exercises: { orderBy: { ordinal: "asc" } } },
          },
        },
      },
    },
  });
  const meso = program.mesocycles[0];
  return {
    profileId,
    mesocycleId: meso.id,
    templateIds: meso.templates.map((t) => t.id),
    variantIds: meso.templates
      .flatMap((t) => t.exercises)
      .map((e) => e.exerciseVariantId),
  };
}

/** 28 pesajes diarios bajando ~0,42 kg/semana. */
async function pesajesBajando(profileId: string) {
  for (let i = 27; i >= 0; i--) {
    await body.saveWeight(
      profileId,
      { localDate: addDays(HOY, -i), weightKg: 84 - 0.06 * (27 - i) },
      AHORA,
    );
  }
}

/** Historial de una variante: `n` exposiciones con la carga indicada. */
async function exposiciones(
  m: Montaje,
  variantId: string,
  cargas: number[],
  deloadEn: number[] = [],
) {
  for (let i = 0; i < cargas.length; i++) {
    const diasAtras = (cargas.length - i) * 4;
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: m.mesocycleId,
      templateId: m.templateIds[0],
      variantId,
      localDate: addDays(HOY, -diasAtras),
      weekNumber: i + 1,
      sets: [
        { setNumber: 1, weightKg: cargas[i], reps: 10, rir: 2 },
        { setNumber: 2, weightKg: cargas[i], reps: 10, rir: 2 },
        { setNumber: 3, weightKg: cargas[i], reps: 10, rir: 2 },
      ],
    });
    if (deloadEn.includes(i)) {
      await prisma.workoutSession.updateMany({
        where: {
          mesocycleId: m.mesocycleId,
          localDate: addDays(HOY, -diasAtras),
        },
        data: { weekKind: "DELOAD" },
      });
    }
  }
}

beforeAll(async () => {
  await runSeed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("el insight se alimenta del motor de entrenamiento real", () => {
  it("sin historial de entrenamiento no hay insight que dar", async () => {
    const m = await montar("sin-entreno");
    await pesajesBajando(m.profileId);
    const { insight } = await body.getBodyProgress(m.profileId, AHORA);
    expect(insight).not.toBeNull();
    // Cuerpo sí, entrenamiento no: la observación lo dice y no hay valoración.
    expect(insight!.observation.weight).toBe("LOSING");
    expect(insight!.observation.performance).toBe("INSUFFICIENT_DATA");
    expect(insight!.goalAssessment).toBeNull();
    expect(insight!.worthShowing).toBe(false);
  });

  it("sin datos corporales tampoco, por muchas sesiones que haya", async () => {
    const m = await montar("sin-cuerpo");
    for (const v of m.variantIds.slice(0, 4)) {
      await exposiciones(m, v, [60, 62.5, 65, 67.5]);
    }
    const { insight } = await body.getBodyProgress(m.profileId, AHORA);
    expect(insight!.observation.code).toBe("BODY_INSUFFICIENT_DATA");
    expect(insight!.worthShowing).toBe(false);
  });

  it("bajando de peso con las cargas subiendo produce el insight positivo", async () => {
    const m = await montar("bajando-fuerte");
    await pesajesBajando(m.profileId);
    // Cuatro variantes con progresión limpia: el motor pedirá subir carga.
    for (const v of m.variantIds.slice(0, 4)) {
      await exposiciones(m, v, [60, 62.5, 65, 67.5]);
    }

    const { insight } = await body.getBodyProgress(m.profileId, AHORA);
    expect(insight!.observation.weight).toBe("LOSING");
    expect(insight!.numbers.judgedVariants).toBeGreaterThanOrEqual(3);
    expect(insight!.worthShowing).toBe(true);
    // Peso bajando + cargas sin retroceder: uno de los dos códigos buenos.
    expect(["LOSING_PERFORMANCE_UP", "LOSING_PERFORMANCE_HELD"]).toContain(
      insight!.goalAssessment!.code,
    );
  });

  it("una sesión mala aislada NO tumba el veredicto", async () => {
    // El motor de progresión ya trata `ONE_OFF_UNDERPERFORMANCE` como no
    // accionable; el insight hereda esa disciplina en vez de reimplementarla.
    const m = await montar("mal-dia");
    await pesajesBajando(m.profileId);
    for (const v of m.variantIds.slice(0, 4)) {
      // Progresión limpia y una última sesión floja al mismo peso.
      await exposiciones(m, v, [60, 62.5, 65, 65]);
    }
    const { insight } = await body.getBodyProgress(m.profileId, AHORA);
    expect(insight!.observation.performance).not.toBe("DECLINING");
  });

  it("el insight usa el análisis ACOTADO A LA FASE, no todo el historial", async () => {
    // Si usara el historial completo, tras cambiar de fase seguiría diciendo
    // "bajas de peso" con la tendencia de la etapa anterior.
    const m = await montar("fase-nueva");
    await pesajesBajando(m.profileId);
    for (const v of m.variantIds.slice(0, 4)) {
      await exposiciones(m, v, [60, 62.5, 65, 67.5]);
    }
    const antes = await body.getBodyProgress(m.profileId, AHORA);
    expect(antes.insight!.worthShowing).toBe(true);

    const { goalUpdateSchema } = await import("@/core/schemas/goal-update");
    await body.updateGoal(
      m.profileId,
      goalUpdateSchema.parse({
        strategy: "LEAN_GAIN",
        weeklyRatePct: 0.15,
        targetWeightKg: null,
      }),
      AHORA,
    );

    const despues = await body.getBodyProgress(m.profileId, AHORA);
    expect(despues.insight!.observation.weight).toBe("INSUFFICIENT_DATA");
    expect(despues.insight!.goalAssessment).toBeNull();
    expect(despues.insight!.worthShowing).toBe(false);
  });

  it("una descarga reciente impide el veredicto de caída", async () => {
    const m = await montar("con-descarga");
    await pesajesBajando(m.profileId);
    // Cargas que bajan de verdad, con una descarga marcada al final.
    for (const v of m.variantIds.slice(0, 4)) {
      await exposiciones(m, v, [70, 67.5, 65, 62.5], [3]);
    }
    const { insight } = await body.getBodyProgress(m.profileId, AHORA);
    expect(insight!.observation.performance).not.toBe("DECLINING");
  });

  it("dos usuarios no se contaminan el insight", async () => {
    const a = await montar("insight-a");
    const b = await montar("insight-b");
    await pesajesBajando(a.profileId);
    for (const v of a.variantIds.slice(0, 4)) {
      await exposiciones(a, v, [60, 62.5, 65, 67.5]);
    }

    const soloA = await body.getBodyProgress(a.profileId, AHORA);
    const soloB = await body.getBodyProgress(b.profileId, AHORA);

    expect(soloA.insight!.worthShowing).toBe(true);
    // B no tiene nada: su insight no puede heredar el de A.
    expect(soloB.insight!.observation.code).toBe("BODY_INSUFFICIENT_DATA");
    expect(soloB.insight!.numbers.judgedVariants).toBe(0);
  });
});

describe("el insight nunca contradice a la tarjeta de peso", () => {
  it("la dirección del peso del insight ES la del motor corporal", async () => {
    const m = await montar("coherencia");
    await pesajesBajando(m.profileId);
    await prisma.bodyMeasurement.updateMany({
      where: { profileId: m.profileId, localDate: HOY },
      data: { waistCm: 88 },
    });
    const { analysis, insight } = await body.getBodyProgress(
      m.profileId,
      AHORA,
    );
    expect(insight!.observation.weight).toBe(analysis.weight.status);
  });

  it("y la pendiente que cita es la MISMA que expone el objetivo", async () => {
    const m = await montar("coherencia-2");
    await pesajesBajando(m.profileId);
    const { analysis, insight } = await body.getBodyProgress(
      m.profileId,
      AHORA,
    );
    expect(insight!.numbers.weightSlopeKgPerWeek).toBe(
      analysis.goal!.observedKgPerWeek,
    );
  });
});
