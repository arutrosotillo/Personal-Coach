import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * Integración Fase 2B: recuperación de historial por variante. Verifica que
 * "última vez" ignora WARMUP y sesiones no completadas, y que getVariantHistory
 * agrupa por sesión el trabajo real. DB temporal real.
 */

const testDb = createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { getExecutionSession, getVariantHistory } =
  await import("@/server/repositories/workout.repo");
const wsService = await import("@/server/services/workout-session.service");

let profileId: string;
let mesocycleId: string;
let variantId: string;
let secondVariantId: string;
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
  mesocycleId = program.mesocycles[0].id;
  templateId = program.mesocycles[0].templates[0].id;
  const variants = program.mesocycles[0].templates.flatMap((t) =>
    t.exercises.map((e) => e.exerciseVariantId),
  );
  variantId = variants[0];
  secondVariantId = variants.find((v) => v !== variantId)!;
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("última vez (contexto in-session)", () => {
  it("ignora las series WARMUP: solo devuelve las de trabajo", async () => {
    // Sesión histórica con 1 calentamiento + 2 series de trabajo.
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId,
      localDate: "2026-07-10",
      sets: [
        { setNumber: 1, weightKg: 40, reps: 15, setType: "WARMUP" },
        { setNumber: 2, weightKg: 80, reps: 8, rir: 2, setType: "WORKING" },
        { setNumber: 3, weightKg: 80, reps: 8, rir: 1, setType: "WORKING" },
      ],
    });
    // Sesión "de hoy" en curso para pedir el contexto.
    const today = await wsService.startOrResumeSession(
      profileId,
      templateId,
      new Date("2026-07-17T10:00:00Z"),
    );
    const exec = await getExecutionSession(profileId, today.sessionId);
    const target = exec?.exercises.find((e) => e.variantId === variantId);
    expect(target?.lastTime).not.toBeNull();
    // Solo las 2 de trabajo; el calentamiento 40×15 no aparece.
    expect(target?.lastTime?.sets).toHaveLength(2);
    expect(target?.lastTime?.sets.every((s) => s.weightKg === 80)).toBe(true);
    expect(target?.lastTime?.localDate).toBe("2026-07-10");

    await wsService.discardSession(profileId, today.sessionId);
  });

  it("con dos sesiones COMPLETED elige la del localDate más reciente", async () => {
    const v = variantId;
    await prisma.setLog.deleteMany({ where: { exerciseVariantId: v } });
    // Sesión reciente por localDate, pero SEMBRADA PRIMERO (completedAt anterior):
    // debe ganar por fecha, no por marca de auditoría.
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId: v,
      localDate: "2026-07-20",
      sets: [{ setNumber: 1, weightKg: 90, reps: 8, rir: 2 }],
    });
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId: v,
      localDate: "2026-07-05",
      sets: [{ setNumber: 1, weightKg: 70, reps: 8, rir: 2 }],
    });

    const today = await wsService.startOrResumeSession(
      profileId,
      templateId,
      new Date("2026-07-25T10:00:00Z"),
    );
    const exec = await getExecutionSession(profileId, today.sessionId);
    const target = exec?.exercises.find((e) => e.variantId === v);
    expect(target?.lastTime?.localDate).toBe("2026-07-20");
    expect(target?.lastTime?.sets[0].weightKg).toBe(90);
    // Dos sesiones comparables distintas.
    expect(target?.lastTime?.comparableSessions).toBe(2);

    await wsService.discardSession(profileId, today.sessionId);
  });

  it("ignora sesiones ABORTED: usa la última COMPLETED", async () => {
    // Trabajo válido antiguo…
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId: secondVariantId,
      localDate: "2026-07-08",
      sets: [{ setNumber: 1, weightKg: 50, reps: 10, rir: 2 }],
    });
    // …y una sesión ABORTED más reciente que NO debe elegirse.
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId: secondVariantId,
      localDate: "2026-07-12",
      status: "ABORTED",
      sets: [{ setNumber: 1, weightKg: 999, reps: 1 }],
    });

    const today = await wsService.startOrResumeSession(
      profileId,
      templateId,
      new Date("2026-07-18T10:00:00Z"),
    );
    const exec = await getExecutionSession(profileId, today.sessionId);
    const target = exec?.exercises.find((e) => e.variantId === secondVariantId);
    expect(target?.lastTime?.localDate).toBe("2026-07-08");
    expect(target?.lastTime?.sets[0].weightKg).toBe(50);

    await wsService.discardSession(profileId, today.sessionId);
  });
});

describe("getVariantHistory", () => {
  it("agrupa el trabajo por sesión, en orden cronológico y sin WARMUP", async () => {
    const v = variantId;
    // Limpia historial previo de esta variante para aislar el test.
    await prisma.setLog.deleteMany({ where: { exerciseVariantId: v } });

    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId: v,
      localDate: "2026-06-01",
      sets: [
        { setNumber: 1, weightKg: 30, reps: 20, setType: "WARMUP" },
        { setNumber: 2, weightKg: 75, reps: 8, rir: 2 },
        { setNumber: 3, weightKg: 75, reps: 7, rir: 1 },
      ],
    });
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId: v,
      localDate: "2026-06-08",
      sets: [
        { setNumber: 1, weightKg: 77.5, reps: 8, rir: 2 },
        { setNumber: 2, weightKg: 77.5, reps: 8, rir: 1 },
      ],
    });

    const history = await getVariantHistory(profileId, v);
    expect(history).toHaveLength(2);
    // Orden cronológico ascendente.
    expect(history[0].localDate).toBe("2026-06-01");
    expect(history[1].localDate).toBe("2026-06-08");
    // Sin WARMUP: la primera sesión tiene 2 sets de trabajo, no 3.
    expect(history[0].sets).toHaveLength(2);
    expect(history[0].sets.every((s) => s.weightKg === 75)).toBe(true);
    // e1RM persistido disponible para el mini-historial.
    expect(history[1].sets[0].estimated1Rm).not.toBeNull();
  });

  it("filtra por sinceLocalDate", async () => {
    const recent = await getVariantHistory(profileId, variantId, "2026-06-05");
    expect(recent).toHaveLength(1);
    expect(recent[0].localDate).toBe("2026-06-08");
  });
});
