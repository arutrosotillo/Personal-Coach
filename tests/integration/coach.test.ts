import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * Coach AI de extremo a extremo contra una base de datos real, con proveedor
 * FALSO. Comprueba lo que los tests puros no pueden: que el contexto se
 * construya desde datos reales y que la IA sea estrictamente READ-ONLY.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;
delete process.env.OPENAI_API_KEY;
delete process.env.AI_COACH_FAKE;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { askCoach } = await import("@/server/services/coach.service");
const { FakeCoachProvider } = await import("@/ai/provider");
const { seedDemoHistory, clearDemoHistory, DEMO_MARKER } =
  await import("../../prisma/seed/demo-history");

let profileId: string;
let mesocycleId: string;

const GOOD = JSON.stringify({
  headline: "Semana correcta.",
  highlights: [
    {
      label: "Adherencia",
      detail: "Has completado las sesiones.",
      direction: "UP",
    },
  ],
  fatigue: null,
  recommendation: "Sigue con el plan.",
  hypotheses: [],
});

function fake(text = GOOD) {
  return new FakeCoachProvider({
    kind: "OK" as const,
    text,
    model: "fake",
    inputTokens: 900,
    outputTokens: 120,
    estimatedCostUsd: 0.0004,
  });
}

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
    new Date("2026-07-01T10:00:00Z"),
  );
  profileId = result.profileId;
  const program = await prisma.trainingProgram.findUniqueOrThrow({
    where: { id: result.programId },
    include: { mesocycles: { include: { templates: true } } },
  });
  mesocycleId = program.mesocycles[0].id;
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("Coach AI sobre datos reales", () => {
  it("sin API key devuelve NOT_CONFIGURED con instrucciones, sin romper nada", async () => {
    const result = await askCoach({ task: "WEEKLY" }, null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("NOT_CONFIGURED");
    expect(result.message).toMatch(/OPENAI_API_KEY/);
    expect(result.message).toMatch(/resto de la app funciona/i);
  });

  it("con historial real construye contexto y responde, SIN escribir en la DB", async () => {
    const te = await prisma.templateExercise.findFirstOrThrow({
      where: { template: { mesocycleId } },
      orderBy: { ordinal: "asc" },
    });
    for (const [i, date] of [
      "2026-08-05",
      "2026-08-12",
      "2026-08-19",
    ].entries()) {
      await seedCompletedSessionWithSets(prisma, {
        mesocycleId,
        variantId: te.exerciseVariantId,
        localDate: date,
        plannedSets: 3,
        sets: [1, 2, 3].map((n) => ({
          setNumber: n,
          weightKg: 60,
          reps: te.repRangeMin + i,
          rir: 2,
        })),
      });
    }

    const before = {
      sessions: await prisma.workoutSession.count(),
      sets: await prisma.setLog.count(),
      decisions: await prisma.algorithmDecision.count(),
      recommendations: await prisma.recommendation.count(),
    };

    const result = await askCoach(
      { task: "WEEKLY" },
      fake(),
      new Date("2026-08-25T10:00:00Z"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.headline).toContain("Semana correcta");

    // READ-ONLY: nada ha cambiado en la base de datos.
    expect({
      sessions: await prisma.workoutSession.count(),
      sets: await prisma.setLog.count(),
      decisions: await prisma.algorithmDecision.count(),
      recommendations: await prisma.recommendation.count(),
    }).toEqual(before);
  });

  it("una respuesta con cargas inventadas se bloquea y cae al motor", async () => {
    const result = await askCoach(
      { task: "WEEKLY" },
      fake(
        JSON.stringify({
          headline: "Vas genial.",
          highlights: [],
          fatigue: null,
          recommendation: "Ponte 999 kg la semana que viene.",
          hypotheses: [],
        }),
      ),
      new Date("2026-08-25T10:00:00Z"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("GUARDRAIL_BLOCKED");
    expect(result.fallback).toBeTruthy();
  });
});

describe("seed de demo", () => {
  it("siembra 8 semanas marcadas y se puede revertir por completo", async () => {
    const before = await prisma.workoutSession.count();
    const result = await seedDemoHistory(
      prisma,
      new Date("2026-08-25T10:00:00Z"),
    );
    expect(result.sessionsCreated).toBeGreaterThan(15);
    expect(result.setsCreated).toBeGreaterThan(100);

    const demoSessions = await prisma.workoutSession.count({
      where: { notes: { startsWith: DEMO_MARKER } },
    });
    expect(demoSessions).toBe(result.sessionsCreated);

    // Y el análisis determinista encuentra material suficiente.
    const { getTrainingAnalysis } =
      await import("@/server/services/fatigue.service");
    const analysis = await getTrainingAnalysis(
      profileId,
      new Date("2026-08-25T10:00:00Z"),
    );
    expect(analysis.context.sessions.length).toBeGreaterThan(3);
    expect(analysis.variants.length).toBeGreaterThan(0);

    const cleared = await clearDemoHistory(prisma);
    expect(cleared.sessionsDeleted).toBe(result.sessionsCreated);
    expect(await prisma.workoutSession.count()).toBe(before);
  });
});
