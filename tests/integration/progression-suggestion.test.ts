import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";
import { equivalentReps } from "@/core/training/progression";

import { createTestDatabase } from "./helpers/test-db";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * Integración Fase 2B: la sugerencia de progresión se calcula desde el
 * historial real + el snapshot de la sesión, y es EFÍMERA (no escribe en DB).
 */

const testDb = createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { getExecutionSession } =
  await import("@/server/repositories/workout.repo");
const { buildSuggestions, getExerciseHistorySummary } =
  await import("@/server/services/progression.service");
const wsService = await import("@/server/services/workout-session.service");

let profileId: string;
let mesocycleId: string;
let templateId: string;

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
  const result = await completeOnboarding(
    data,
    new Date("2026-07-14T10:00:00Z"),
  );
  profileId = result.profileId;
  const program = await prisma.trainingProgram.findUniqueOrThrow({
    where: { id: result.programId },
    include: { mesocycles: { include: { templates: true } } },
  });
  mesocycleId = program.mesocycles[0].id;
  templateId = program.mesocycles[0].templates[0].id;
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

async function firstTemplateExercise() {
  return prisma.templateExercise.findFirstOrThrow({
    where: { templateId },
    orderBy: { ordinal: "asc" },
    include: { exerciseVariant: true },
  });
}

describe("sugerencia de progresión (efímera)", () => {
  it("historial al tope del rango → INCREASE_LOAD con +1 loadStep, sin escribir en DB", async () => {
    const te = await firstTemplateExercise();
    const variantId = te.exerciseVariantId;
    const step = te.exerciseVariant.loadStepKg;

    // Sesión histórica: todas las series al tope con RIR objetivo.
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId,
      localDate: "2026-07-10",
      plannedSets: te.baseSets,
      sets: Array.from({ length: te.baseSets }, (_, i) => ({
        setNumber: i + 1,
        weightKg: 80,
        reps: te.repRangeMax,
        rir: te.targetRir,
      })),
    });

    const decisionsBefore = await prisma.algorithmDecision.count();

    const started = await wsService.startOrResumeSession(
      profileId,
      templateId,
      new Date("2026-07-17T10:00:00Z"),
    );
    const exec = await getExecutionSession(profileId, started.sessionId);
    const suggestions = buildSuggestions(exec!);
    const target = exec!.exercises.find((e) => e.variantId === variantId)!;
    const s = suggestions[target.id];

    expect(s.action).toBe("INCREASE_LOAD");
    expect(s.reasonCode).toBe("RANGE_CLOSED");
    expect(s.suggestedWeightKg).toBeCloseTo(80 + step, 6);
    // El objetivo de reps sale de la equivalencia carga↔reps, no de repRangeMin:
    // subir de peso ya no tira el estímulo al suelo del rango.
    const predicted = Math.floor(
      equivalentReps(80, te.repRangeMax, 80 + step) + 1e-6,
    );
    expect(s.suggestedReps).toBe(Math.min(predicted, te.repRangeMax));
    expect(s.suggestedReps!).toBeGreaterThanOrEqual(te.repRangeMin);
    expect(s.setTargets).toHaveLength(te.baseSets);

    // Efímera: calcularla no crea ninguna AlgorithmDecision/Recommendation.
    expect(await prisma.algorithmDecision.count()).toBe(decisionsBefore);
    expect(
      await prisma.recommendation.count({ where: { type: "INCREASE_LOAD" } }),
    ).toBe(0);

    await wsService.discardSession(profileId, started.sessionId);
  });

  it("ejercicio sustituido a una variante sin historial → START (NO_HISTORY)", async () => {
    const started = await wsService.startOrResumeSession(
      profileId,
      templateId,
      new Date("2026-07-18T10:00:00Z"),
    );
    const exec1 = await getExecutionSession(profileId, started.sessionId);
    const first = exec1!.exercises[0];

    // Una variante del catálogo que NO esté en la sesión ni tenga historial.
    const usedVariantIds = new Set(exec1!.exercises.map((e) => e.variantId));
    const fresh = await prisma.exerciseVariant.findFirstOrThrow({
      where: { id: { notIn: [...usedVariantIds] }, deletedAt: null },
    });

    await wsService.substituteExercise(profileId, first.id, fresh.id);

    const exec2 = await getExecutionSession(profileId, started.sessionId);
    const suggestions = buildSuggestions(exec2!);
    const subbed = exec2!.exercises.find((e) => e.id === first.id)!;
    expect(subbed.variantId).toBe(fresh.id);
    expect(suggestions[first.id].action).toBe("START");
    expect(suggestions[first.id].reasonCode).toBe("NO_HISTORY");
    expect(suggestions[first.id].suggestedWeightKg).toBeNull();

    await wsService.discardSession(profileId, started.sessionId);
  });
});

describe("integridad del RIR registrado (Fase 3.2c)", () => {
  it("RIR sin registrar (null) sobrevive a logSet y el motor NO lo imputa al objetivo", async () => {
    const te = await firstTemplateExercise();
    const variantId = te.exerciseVariantId;
    await prisma.setLog.deleteMany({ where: { exerciseVariantId: variantId } });

    const started = await wsService.startOrResumeSession(
      profileId,
      templateId,
      new Date("2026-08-01T10:00:00Z"),
    );
    const exec = await getExecutionSession(profileId, started.sessionId);
    const we = exec!.exercises.find((e) => e.variantId === variantId)!;
    for (let n = 1; n <= we.plannedSets; n++) {
      await wsService.logSet(profileId, {
        workoutExerciseId: we.id,
        setNumber: n,
        setType: "WORKING",
        weightKg: 60,
        reps: te.repRangeMax,
        rir: null,
      });
    }
    // Se persiste como null, no como el objetivo.
    const rows = await prisma.setLog.findMany({
      where: { workoutExerciseId: we.id },
      orderBy: { setNumber: "asc" },
    });
    expect(rows).toHaveLength(we.plannedSets);
    expect(rows.every((r) => r.rir === null)).toBe(true);

    await wsService.finishSession(
      profileId,
      started.sessionId,
      {},
      new Date("2026-08-01T11:00:00Z"),
    );

    const next = await wsService.startOrResumeSession(
      profileId,
      templateId,
      new Date("2026-08-04T10:00:00Z"),
    );
    const exec2 = await getExecutionSession(profileId, next.sessionId);
    const target = exec2!.exercises.find((e) => e.variantId === variantId)!;
    const s = buildSuggestions(exec2!)[target.id];

    // Progresa por REPETICIONES, pero la falta de RIR nunca es evidencia
    // positiva: confianza BAJA y jamás un salto doble.
    expect(s.action).toBe("INCREASE_LOAD");
    expect(s.confidence).toBe("LOW");
    expect(s.numbers.missingRir).toBe(target.plannedSets);
    expect(s.suggestedWeightKg).toBeCloseTo(60 + target.loadStepKg, 6);

    await wsService.discardSession(profileId, next.sessionId);
  });

  it("un RIR de fallo REGISTRADO manda sobre las series sin registrar", async () => {
    const te = await firstTemplateExercise();
    const variantId = te.exerciseVariantId;
    await prisma.setLog.deleteMany({ where: { exerciseVariantId: variantId } });

    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId,
      localDate: "2026-08-08",
      plannedSets: te.baseSets,
      sets: Array.from({ length: te.baseSets }, (_, i) => ({
        setNumber: i + 1,
        weightKg: 60,
        reps: te.repRangeMax,
        rir: i === te.baseSets - 1 ? 0 : null,
      })),
    });

    const started = await wsService.startOrResumeSession(
      profileId,
      templateId,
      new Date("2026-08-11T10:00:00Z"),
    );
    const exec = await getExecutionSession(profileId, started.sessionId);
    const target = exec!.exercises.find((e) => e.variantId === variantId)!;
    const s = buildSuggestions(exec!)[target.id];

    expect(s.action).toBe("HOLD");
    expect(s.reasonCode).toBe("CLOSED_RANGE_AT_FAILURE");
    expect(s.suggestedWeightKg).toBe(60);

    await wsService.discardSession(profileId, started.sessionId);
  });
});

describe("mini-historial del ejercicio", () => {
  it("resume mejor set, e1RM~ actual y tendencia desde el historial de la variante", async () => {
    const te = await firstTemplateExercise();
    const variantId = te.exerciseVariantId;
    await prisma.setLog.deleteMany({ where: { exerciseVariantId: variantId } });

    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId,
      localDate: "2026-06-01",
      sets: [
        { setNumber: 1, weightKg: 75, reps: 8, rir: 2 },
        { setNumber: 2, weightKg: 75, reps: 8, rir: 1 },
      ],
    });
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId,
      localDate: "2026-06-15",
      sets: [
        { setNumber: 1, weightKg: 80, reps: 8, rir: 2 },
        { setNumber: 2, weightKg: 80, reps: 7, rir: 1 },
      ],
    });

    const summary = await getExerciseHistorySummary(profileId, variantId);
    expect(summary.sessionCount).toBe(2);
    expect(summary.bestSet?.weightKg).toBe(80);
    expect(summary.currentE1rm).not.toBeNull();
    expect(summary.trend.direction).toBe("UP");
  });
});
