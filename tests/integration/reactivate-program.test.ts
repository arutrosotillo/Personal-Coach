import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";
import type { ManualProgramInput } from "@/core/schemas/manual-program";

import { createTestDatabase } from "./helpers/test-db";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * Integración Fase 3.1b: reactivar un programa archivado. Solo cambia isActive;
 * no crea programas ni traza, no toca plantillas/sesiones/snapshots/historial.
 */

const testDb = await createTestDatabase();
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
const { getExecutionSession } =
  await import("@/server/repositories/workout.repo");
const { buildSuggestions, getExerciseHistorySummary } =
  await import("@/server/services/progression.service");
const workout = await import("@/server/services/workout-session.service");

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

async function immutableProgramState(programIds: string[]) {
  const mesocycleWhere = { programId: { in: programIds } };
  const templateWhere = { mesocycle: mesocycleWhere };
  const sessionWhere = { mesocycle: mesocycleWhere };
  const exerciseWhere = { session: sessionWhere };
  return {
    mesocycles: await prisma.mesocycle.findMany({
      where: mesocycleWhere,
      orderBy: { id: "asc" },
    }),
    templates: await prisma.workoutTemplate.findMany({
      where: templateWhere,
      orderBy: { id: "asc" },
    }),
    templateExercises: await prisma.templateExercise.findMany({
      where: { template: templateWhere },
      orderBy: { id: "asc" },
    }),
    sessions: await prisma.workoutSession.findMany({
      where: sessionWhere,
      orderBy: { id: "asc" },
    }),
    workoutExercises: await prisma.workoutExercise.findMany({
      where: exerciseWhere,
      orderBy: { id: "asc" },
    }),
    setLogs: await prisma.setLog.findMany({
      where: { workoutExercise: exerciseWhere },
      orderBy: { id: "asc" },
    }),
  };
}

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

    // Sesión histórica hecha con B (variantIds[1]), suficiente para sugerir
    // aumento de carga al volver a abrir una sesión comparable.
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: B.mesocycles[0].id,
      variantId: variantIds[1],
      localDate: "2026-07-18",
      plannedSets: 3,
      sets: [1, 2, 3].map((setNumber) => ({
        setNumber,
        weightKg: 70,
        reps: 8,
        rir: 2,
      })),
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

    const before = await immutableProgramState([A.id, B.id]);
    const decisionsBefore = await prisma.algorithmDecision.count();
    const recommendationsBefore = await prisma.recommendation.count();

    // Reactivar B: solo cambian los flags de programa.
    await reactivateProgram(profileId, B.id);
    const activeB = await activePrograms();
    expect(activeB).toHaveLength(1);
    expect(activeB[0].id).toBe(B.id);
    expect(await immutableProgramState([A.id, B.id])).toEqual(before);
    expect(await prisma.algorithmDecision.count()).toBe(decisionsBefore);
    expect(await prisma.recommendation.count()).toBe(recommendationsBefore);

    const histB = await getExerciseHistorySummary(profileId, variantIds[1]);
    expect(histB.sessionCount).toBeGreaterThanOrEqual(1);
    expect(histB.currentE1rm).not.toBeNull();
    const histA = await getExerciseHistorySummary(profileId, variantIds[0]);
    expect(histA.sessionCount).toBeGreaterThanOrEqual(1);
    expect(histA.currentE1rm).not.toBeNull();

    const bTemplate = await prisma.workoutTemplate.findFirstOrThrow({
      where: { mesocycle: { programId: B.id }, deletedAt: null },
      orderBy: { ordinal: "asc" },
    });
    const nextB = await workout.startOrResumeSession(
      profileId,
      bTemplate.id,
      new Date("2026-08-02T10:00:00Z"),
    );
    const execution = await getExecutionSession(profileId, nextB.sessionId);
    expect(execution?.exercises[0].lastTime?.localDate).toBe("2026-07-18");
    expect(
      buildSuggestions(execution!)[execution!.exercises[0].id].action,
    ).toBe("INCREASE_LOAD");
    expect(await prisma.algorithmDecision.count()).toBe(decisionsBefore);
    expect(await prisma.recommendation.count()).toBe(recommendationsBefore);
    await workout.discardSession(profileId, nextB.sessionId);

    // B → A → B funciona y nunca deja dos activos.
    await reactivateProgram(profileId, A.id);
    const activeA = await activePrograms();
    expect(activeA).toHaveLength(1);
    expect(activeA[0].id).toBe(A.id);
    await reactivateProgram(profileId, B.id);
    const activeBAgain = await activePrograms();
    expect(activeBAgain).toHaveLength(1);
    expect(activeBAgain[0].id).toBe(B.id);
  });

  it("bloquea el cambio mientras hay una sesión en curso y la conserva", async () => {
    const active = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
      include: { mesocycles: { include: { templates: true } } },
    });
    const archived = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: false, name: "Programa A" },
    });
    const started = await workout.startOrResumeSession(
      profileId,
      active.mesocycles[0].templates[0].id,
    );

    await expect(reactivateProgram(profileId, archived.id)).rejects.toThrow(
      /sesión en curso/,
    );
    expect((await activePrograms()).map((program) => program.id)).toEqual([
      active.id,
    ]);
    expect(
      (
        await prisma.workoutSession.findUniqueOrThrow({
          where: { id: started.sessionId },
        })
      ).status,
    ).toBe("IN_PROGRESS");
    await workout.discardSession(profileId, started.sessionId);
  });

  it("la base de datos impide dos programas activos del mismo perfil", async () => {
    const archived = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: false },
    });
    await expect(
      prisma.trainingProgram.update({
        where: { id: archived.id },
        data: { isActive: true },
      }),
    ).rejects.toThrow();
    expect(await activePrograms()).toHaveLength(1);
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
      archived.some((p) => p.name === "Programa A" && !p.isGenerated),
    ).toBe(true);
    // Ninguno es el activo.
    const active = (await activePrograms())[0];
    expect(archived.some((p) => p.id === active.id)).toBe(false);
  });
});
