import { toLocalDate, ageInYears } from "@/core/dates";
import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import {
  estimateInitialTargets,
  NUTRITION_ESTIMATE_VERSION,
} from "@/core/nutrition/initial-estimate";
import {
  generateInitialProgram,
  PROGRAM_GENERATOR_VERSION,
} from "@/core/program/generate-initial-program";
import type { OnboardingData } from "@/core/schemas/onboarding";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { loadCatalog } from "@/server/repositories/catalog.repo";

const DEFAULT_TIMEZONE = "Europe/Madrid";

/**
 * Serializa un valor a JSON válido para columnas Prisma `Json`. El round-trip
 * elimina claves `undefined` (que `InputJsonValue` no admite) de forma segura.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Completa el onboarding de forma TRANSACCIONAL: perfil, objetivo, medición
 * inicial, target nutricional, preferencias, programa inicial (con su
 * AlgorithmDecision + Recommendation) — todo o nada.
 *
 * Re-ejecutable de forma segura: si ya existe un perfil, lo actualiza,
 * abandona el objetivo activo anterior y desactiva el programa anterior.
 * Nunca crea un segundo perfil.
 */
export async function completeOnboarding(
  data: OnboardingData,
  now: Date = new Date(),
) {
  const localDate = toLocalDate(now, DEFAULT_TIMEZONE);

  // 1. Cálculos puros (fuera de la transacción)
  const estimate = estimateInitialTargets({
    sex: data.sex,
    ageYears: ageInYears(data.birthDate, localDate),
    heightCm: data.heightCm,
    weightKg: data.weightKg,
    dailySteps: data.dailySteps,
    workActivity: data.workActivity,
    trainingSessionsPerWeek: data.daysPerWeek,
    minutesPerSession: data.minutesPerSession,
    goalType: data.goalType,
    weeklyRatePct: data.weeklyRatePct,
  });

  const catalog = await loadCatalog();
  const program = generateInitialProgram({
    daysPerWeek: data.daysPerWeek,
    minutesPerSession: data.minutesPerSession,
    equipment: data.equipment,
    contraindications: data.contraindications,
    excludedExerciseNames: data.excludedExerciseNames,
    priorityMuscles: data.priorityMuscles,
    goalType: data.goalType,
    catalog,
  });

  // 2. Escritura transaccional
  return prisma.$transaction(async (tx) => {
    const existing = await tx.userProfile.findFirst({
      orderBy: { createdAt: "asc" },
    });

    const profileFields = {
      sex: data.sex,
      birthDate: data.birthDate,
      heightCm: data.heightCm,
      timezone: DEFAULT_TIMEZONE,
      dailySteps: data.dailySteps,
      workActivity: data.workActivity,
      sleepHoursTypical: data.sleepHoursTypical ?? null,
      trainingYears: data.trainingYears,
    };

    const profile = existing
      ? await tx.userProfile.update({
          where: { id: existing.id },
          data: profileFields,
        })
      : await tx.userProfile.create({ data: profileFields });

    // Re-ejecución: cerrar objetivo activo y desactivar programas anteriores.
    await tx.goal.updateMany({
      where: { profileId: profile.id, status: "ACTIVE" },
      data: { status: "ABANDONED" },
    });
    await tx.trainingProgram.updateMany({
      where: { profileId: profile.id, isActive: true },
      data: { isActive: false },
    });

    const goal = await tx.goal.create({
      data: {
        profileId: profile.id,
        type: data.goalType,
        startDate: localDate,
        weeklyRatePct: estimate.weeklyRatePct,
        targetWeightKg: data.targetWeightKg ?? null,
      },
    });

    // Medición inicial (peso + cintura opcional) — upsert por día.
    await tx.bodyMeasurement.upsert({
      where: { profileId_localDate: { profileId: profile.id, localDate } },
      create: {
        profileId: profile.id,
        localDate,
        weightKg: data.weightKg,
        waistCm: data.waistCm ?? null,
      },
      update: { weightKg: data.weightKg, waistCm: data.waistCm ?? null },
    });

    // Target nutricional inicial — upsert por (profileId, effectiveFrom).
    await tx.nutritionTarget.upsert({
      where: {
        profileId_effectiveFrom: {
          profileId: profile.id,
          effectiveFrom: localDate,
        },
      },
      create: {
        profileId: profile.id,
        effectiveFrom: localDate,
        kcal: estimate.kcalTarget,
        proteinG: estimate.proteinG,
        carbsG: estimate.carbsG,
        fatG: estimate.fatG,
        source: "ONBOARDING",
        notes: estimate.explanations.kcal,
      },
      update: {
        kcal: estimate.kcalTarget,
        proteinG: estimate.proteinG,
        carbsG: estimate.carbsG,
        fatG: estimate.fatG,
        source: "ONBOARDING",
        notes: estimate.explanations.kcal,
      },
    });

    // Preferencias (clave/valor) usadas por generación futura y UI.
    const preferences: Array<[string, unknown]> = [
      ["equipment", data.equipment],
      ["days_per_week", data.daysPerWeek],
      ["minutes_per_session", data.minutesPerSession],
      ["priority_muscles", data.priorityMuscles],
      ["contraindications", data.contraindications],
      ["excluded_exercises", data.excludedExerciseNames],
      ["dietary_preference", data.dietaryPreference],
      ["meals_per_day", data.mealsPerDay ?? null],
    ];
    for (const [key, value] of preferences) {
      await tx.userPreference.upsert({
        where: { key },
        create: { key, value: toJson(value) },
        update: { value: toJson(value) },
      });
    }

    // Programa inicial + trazabilidad.
    const dbProgram = await tx.trainingProgram.create({
      data: {
        profileId: profile.id,
        name: program.name,
        daysPerWeek: program.daysPerWeek,
        description: program.explanation,
        mesocycles: {
          create: {
            ordinal: 1,
            status: "PLANNED",
            weeksPlanned: 6,
            templates: {
              create: program.days.map((day) => ({
                name: day.name,
                ordinal: day.ordinal,
                exercises: {
                  create: day.exercises.map((exercise, i) => ({
                    exerciseVariantId: exercise.variantId,
                    ordinal: i + 1,
                    baseSets: exercise.sets,
                    repRangeMin: exercise.repRangeMin,
                    repRangeMax: exercise.repRangeMax,
                    targetRir: exercise.targetRir,
                    restSeconds: exercise.restSeconds,
                  })),
                },
              })),
            },
          },
        },
      },
    });

    const decision = await tx.algorithmDecision.create({
      data: {
        engine: "program-generator",
        algorithmVersion: PROGRAM_GENERATOR_VERSION,
        ruleId: program.ruleId,
        inputSnapshot: toJson({
          onboarding: data,
          estimateVersion: NUTRITION_ESTIMATE_VERSION,
          nutritionDefaults: {
            weeklyRatePct: NUTRITION_CONFIG.weeklyRatePct[data.goalType],
          },
        }),
        output: toJson({
          splitType: program.splitType,
          weeklySetsByGroup: program.weeklySetsByGroup,
          warnings: program.warnings,
          estimate: {
            tdee: estimate.tdee,
            kcalTarget: estimate.kcalTarget,
            proteinG: estimate.proteinG,
            fatG: estimate.fatG,
            carbsG: estimate.carbsG,
          },
        }),
        explanation: program.explanation,
        evaluationDate: localDate,
      },
    });

    await tx.recommendation.create({
      data: {
        profileId: profile.id,
        decisionId: decision.id,
        type: "INITIAL_PROGRAM",
        scope: "PROGRAM",
        scopeId: dbProgram.id,
        priority: "MEDIUM",
        status: "ACCEPTED",
        title: `Programa inicial: ${program.name}`,
        body: program.explanation,
        appliesToLocalDate: localDate,
        resolvedAt: now,
      },
    });

    return { profileId: profile.id, goalId: goal.id, programId: dbProgram.id };
  });
}
