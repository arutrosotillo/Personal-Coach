import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OnboardingData } from "@/core/schemas/onboarding";
import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";

/**
 * Integración: seed + onboarding transaccional contra una DB real temporal.
 * La DATABASE_URL se fija ANTES de importar dinámicamente los módulos de
 * servidor (el singleton de Prisma la lee al crearse).
 */

const testDb = createTestDatabase();
process.env.DATABASE_URL = testDb.url;

// Imports dinámicos tras fijar el entorno.
const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");

const VALID: OnboardingData = onboardingSchema.parse({
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  waistCm: 88,
  trainingYears: 3,
  daysPerWeek: 4,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
  strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
  dailySteps: 8500,
  workActivity: "SEDENTARY",
  balancedProgram: false,
  priorityMuscles: ["BICEPS"],
  contraindications: ["KNEE"],
  excludedExerciseNames: ["Press banca"],
});

beforeAll(async () => {
  await runSeed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("seed", () => {
  it("es idempotente: dos ejecuciones producen los mismos conteos y sin duplicados", async () => {
    const first = await runSeed(prisma);
    const second = await runSeed(prisma);
    expect(second).toEqual(first);
    expect(first.muscleGroups).toBe(16);
    expect(first.exercises).toBeGreaterThanOrEqual(40);
    // Sin duplicados por clave natural
    const names = await prisma.exercise.findMany({ select: { name: true } });
    expect(new Set(names.map((n) => n.name)).size).toBe(names.length);
  });
});

describe("completeOnboarding", () => {
  it("crea perfil, objetivo, medición, target, preferencias, programa y trazabilidad en una transacción", async () => {
    const result = await completeOnboarding(
      VALID,
      new Date("2026-07-14T10:00:00Z"),
    );

    const profile = await prisma.userProfile.findUniqueOrThrow({
      where: { id: result.profileId },
    });
    expect(profile.heightCm).toBe(178);

    const goal = await prisma.goal.findUniqueOrThrow({
      where: { id: result.goalId },
    });
    expect(goal.status).toBe("ACTIVE");
    expect(goal.type).toBe("FAT_LOSS");
    expect(goal.weeklyRatePct).toBe(-0.5);

    const measurement = await prisma.bodyMeasurement.findUniqueOrThrow({
      where: {
        profileId_localDate: { profileId: profile.id, localDate: "2026-07-14" },
      },
    });
    expect(measurement.weightKg).toBe(84);
    expect(measurement.waistCm).toBe(88);

    const target = await prisma.nutritionTarget.findFirstOrThrow({
      where: { profileId: profile.id },
      orderBy: { effectiveFrom: "desc" },
    });
    expect(target.source).toBe("ONBOARDING");
    // 84 kg / 178 cm / 34 años / 8500 pasos / 4×75 min:
    // BMR 1788 × 1.5 + 180 = 2862 → TDEE 2850 − déficit 462 → round25 = 2400
    expect(target.kcal).toBe(2400);
    expect(target.proteinG).toBe(185);

    const program = await prisma.trainingProgram.findUniqueOrThrow({
      where: { id: result.programId },
      include: {
        mesocycles: {
          include: { templates: { include: { exercises: true } } },
        },
      },
    });
    expect(program.isActive).toBe(true);
    expect(program.daysPerWeek).toBe(4);
    const templates = program.mesocycles[0].templates;
    expect(templates).toHaveLength(4);
    expect(templates.every((t) => t.exercises.length > 0)).toBe(true);

    // Restricciones respetadas también tras persistir
    const variantIds = templates.flatMap((t) =>
      t.exercises.map((e) => e.exerciseVariantId),
    );
    const variants = await prisma.exerciseVariant.findMany({
      where: { id: { in: variantIds } },
      include: { exercise: true },
    });
    expect(variants.some((v) => v.exercise.name === "Press banca")).toBe(false);
    for (const v of variants) {
      expect(v.contraindications).not.toContain("KNEE");
    }

    // Trazabilidad 1:1: la recomendación INITIAL_PROGRAM apunta a una decisión
    // cuyo snapshot contiene el input completo del onboarding.
    const recommendation = await prisma.recommendation.findFirstOrThrow({
      where: { profileId: profile.id, type: "INITIAL_PROGRAM" },
      include: { decision: true },
    });
    expect(recommendation.scopeId).toBe(program.id);
    expect(recommendation.decision.engine).toBe("program-generator");
    expect(recommendation.decision.explanation.length).toBeGreaterThan(50);
    const snapshot = recommendation.decision.inputSnapshot as {
      onboarding?: { weightKg?: number };
    };
    expect(snapshot.onboarding?.weightKg).toBe(84);
  });

  it("re-ejecutar el onboarding NO crea un segundo perfil y archiva objetivo y programa anteriores", async () => {
    const second = await completeOnboarding(
      { ...VALID, strategy: "MAINTENANCE", daysPerWeek: 3 },
      new Date("2026-07-14T18:00:00Z"),
    );

    expect(await prisma.userProfile.count()).toBe(1);

    const activeGoals = await prisma.goal.findMany({
      where: { status: "ACTIVE" },
    });
    expect(activeGoals).toHaveLength(1);
    expect(activeGoals[0].type).toBe("MAINTENANCE");
    expect(await prisma.goal.count({ where: { status: "ABANDONED" } })).toBe(1);

    const activePrograms = await prisma.trainingProgram.findMany({
      where: { isActive: true },
    });
    expect(activePrograms).toHaveLength(1);
    expect(activePrograms[0].id).toBe(second.programId);
    expect(activePrograms[0].daysPerWeek).toBe(3);
    expect(
      await prisma.trainingProgram.count({ where: { isActive: false } }),
    ).toBe(1);

    // Mismo día → la medición se actualiza (upsert), no se duplica.
    expect(await prisma.bodyMeasurement.count()).toBe(1);
  });

  it("acepta datos incompletos válidos (sin cintura, sin peso objetivo, sin sueño)", async () => {
    const minimal = onboardingSchema.parse({
      sex: "FEMALE",
      birthDate: "1995-01-20",
      heightCm: 165,
      weightKg: 62,
      trainingYears: 0,
      daysPerWeek: 3,
      minutesPerSession: 60,
      equipment: ["DUMBBELL", "BODYWEIGHT"],
      strategy: "RECOMP_MAINTAIN_WEIGHT",
      balancedProgram: true,
      priorityMuscles: [],
    });
    const result = await completeOnboarding(
      minimal,
      new Date("2026-07-15T08:00:00Z"),
    );
    expect(result.programId).toBeTruthy();
    const target = await prisma.nutritionTarget.findFirstOrThrow({
      where: { effectiveFrom: "2026-07-15" },
    });
    // Recomposición: kcal = TDEE estimado (sin déficit)
    expect(target.kcal).toBeGreaterThan(1200);
  });
});
