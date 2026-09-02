import { ageInYears, DEFAULT_TIMEZONE, toLocalDate } from "@/core/dates";
import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import { STRATEGY_TO_GOAL_TYPE, type BodyFatReliability } from "@/core/enums";
import {
  estimateInitialTargets,
  NUTRITION_ESTIMATE_VERSION,
} from "@/core/nutrition/initial-estimate";
import {
  experienceFromYears,
  generateInitialProgram,
  PROGRAM_GENERATOR_VERSION,
} from "@/core/program/generate-initial-program";
import type { OnboardingData } from "@/core/schemas/onboarding";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { loadCatalog } from "@/server/repositories/catalog.repo";

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
  userId: string,
  data: OnboardingData,
  now: Date = new Date(),
) {
  const localDate = toLocalDate(now, DEFAULT_TIMEZONE);
  // La estrategia elegida por el usuario deriva el comportamiento calórico interno.
  const goalType = STRATEGY_TO_GOAL_TYPE[data.strategy];

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
    goalType,
    weeklyRatePct: data.weeklyRatePct,
    bodyFatPct: data.bodyFatPct,
    bodyFatMeasured: data.bodyFatMeasured,
    targetWeightKg: data.targetWeightKg,
  });

  // Re-ejecución del onboarding: si esta cuenta ya tiene perfil, sus
  // ejercicios propios entran en el catálogo del generador. La primera vez no
  // hay perfil todavía y solo se usa el catálogo global.
  const existingProfile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  const catalog = await loadCatalog(existingProfile?.id ?? null);
  const program = generateInitialProgram({
    daysPerWeek: data.daysPerWeek,
    minutesPerSession: data.minutesPerSession,
    equipment: data.equipment,
    contraindications: data.contraindications,
    excludedExerciseNames: data.excludedExerciseNames,
    priorityMuscles: data.balancedProgram ? [] : data.priorityMuscles,
    goalType,
    experienceLevel: experienceFromYears(data.trainingYears),
    catalog,
  });

  // 2. Escritura transaccional
  return prisma.$transaction(async (tx) => {
    // El perfil que se reutiliza es el de ESTE usuario. Antes se cogía el más
    // antiguo de toda la base de datos: con varias cuentas, el onboarding de un
    // familiar habría sobrescrito el perfil de otro y archivado sus programas.
    const existing = await tx.userProfile.findUnique({ where: { userId } });
    if (existing) {
      const inProgress = await tx.workoutSession.findFirst({
        where: {
          status: "IN_PROGRESS",
          mesocycle: { program: { profileId: existing.id } },
        },
        select: { id: true },
      });
      if (inProgress) {
        throw new Error(
          "Finaliza o descarta la sesión en curso antes de cambiar de programa.",
        );
      }
    }

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
      : await tx.userProfile.create({ data: { ...profileFields, userId } });

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
        strategy: data.strategy,
        type: goalType,
        startDate: localDate,
        startWeightKg: data.weightKg,
        weeklyRatePct: estimate.weeklyRatePct,
        targetWeightKg: data.targetWeightKg ?? null,
      },
    });

    // Medición inicial: la primera fila de la serie corporal. `BodyMeasurement`
    // es la fuente única del peso (ver el comentario del modelo en el schema),
    // así que el onboarding tiene que dejarla bien puesta o la serie empieza
    // torcida.
    //
    // El % graso se guarda AQUÍ, no solo en el snapshot de la decisión: antes
    // se preguntaba en el wizard y acababa enterrado en un JSON de auditoría,
    // que no se puede consultar como serie. Va acompañado de su procedencia,
    // porque un % graso sin saber de dónde sale no es comparable con nada.
    //
    // Los mismos campos para `create` y `update`: el onboarding es una
    // declaración COMPLETA del estado corporal de hoy, así que re-ejecutarlo
    // sin cintura tiene que borrar la que hubiera, no dejar un valor huérfano
    // de una ejecución anterior.
    const measurementFields = {
      weightKg: data.weightKg,
      waistCm: data.waistCm ?? null,
      bodyFatPct: data.bodyFatPct ?? null,
      bodyFatReliability:
        data.bodyFatPct === undefined
          ? null
          : ((data.bodyFatMeasured
              ? "MEASURED"
              : "ESTIMATED") satisfies BodyFatReliability | null),
    };

    // Upsert por (perfil, día): registrar dos veces el mismo día actualiza la
    // fila, nunca la duplica. La clave única lo garantiza en la base de datos,
    // no solo en el código.
    await tx.bodyMeasurement.upsert({
      where: { profileId_localDate: { profileId: profile.id, localDate } },
      create: { profileId: profile.id, localDate, ...measurementFields },
      update: measurementFields,
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
        where: { profileId_key: { profileId: profile.id, key } },
        create: { profileId: profile.id, key, value: toJson(value) },
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
            weeklyRatePct: NUTRITION_CONFIG.weeklyRatePct[goalType],
          },
        }),
        output: toJson({
          splitType: program.splitType,
          splitLabel: program.name,
          daysPerWeek: program.daysPerWeek,
          minutesPerSession: program.minutesPerSession,
          perDayMinutes: program.days.map((d) => d.estimatedMinutes),
          equipment: data.equipment,
          contraindications: data.contraindications,
          excludedExerciseNames: data.excludedExerciseNames,
          volumeByGroup: program.volumeByGroup,
          priorityMuscles: program.priorityMuscles,
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
