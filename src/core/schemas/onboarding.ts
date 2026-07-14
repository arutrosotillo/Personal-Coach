import { z } from "zod";

import {
  Contraindication,
  Equipment,
  GoalStrategy,
  MuscleGroupCode,
  Sex,
  WorkActivity,
} from "@/core/enums";
import { isLocalDate } from "@/core/dates";

/**
 * Schema único del onboarding: se usa en el cliente (react-hook-form) y
 * SIEMPRE de nuevo en la server action. Límites plausibles con mensajes útiles.
 */

const localDate = z
  .string()
  .refine(isLocalDate, "Fecha inválida (formato AAAA-MM-DD)");

/** Umbral a partir del cual un peso objetivo se considera "materialmente inferior". */
export const RECOMP_WEIGHT_MISMATCH_PCT = 0.03; // 3 % del peso actual

export const onboardingSchema = z
  .object({
    // Paso 1 — Perfil básico
    sex: Sex,
    birthDate: localDate,
    heightCm: z
      .number({ error: "Indica tu altura en cm" })
      .min(120, "Altura entre 120 y 230 cm")
      .max(230, "Altura entre 120 y 230 cm"),
    weightKg: z
      .number({ error: "Indica tu peso en kg" })
      .min(30, "El peso debe estar entre 30 y 300 kg")
      .max(300, "El peso debe estar entre 30 y 300 kg. ¿Sobra un dígito?"),
    waistCm: z
      .number()
      .min(40, "Cintura entre 40 y 200 cm")
      .max(200, "Cintura entre 40 y 200 cm")
      .optional(),
    /** % graso estimado; marcado como fiable solo si viene de una medición real. */
    bodyFatPct: z.number().min(3).max(60).optional(),
    bodyFatMeasured: z.boolean().default(false),

    // Paso 2 — Experiencia y disponibilidad
    trainingYears: z
      .number({ error: "¿Cuántos años llevas entrenando? (0 si empiezas)" })
      .min(0)
      .max(60, "¿Seguro? Máximo 60 años"),
    daysPerWeek: z
      .number()
      .int()
      .min(2, "Mínimo 2 días para un programa útil")
      .max(6, "Máximo 6 días: el descanso también entrena"),
    minutesPerSession: z
      .number()
      .int()
      .min(30, "Con menos de 30 minutos no cabe una sesión efectiva")
      .max(180, "Máximo 180 minutos"),

    // Paso 3 — Equipamiento
    equipment: z
      .array(Equipment)
      .min(1, "Selecciona al menos un tipo de equipamiento"),

    // Paso 4 — Objetivo (estrategia en lenguaje natural)
    strategy: GoalStrategy,
    weeklyRatePct: z
      .number()
      .min(-1.0, "El ritmo máximo de pérdida es 1 % de tu peso por semana")
      .max(0.25, "El ritmo máximo de ganancia es 0,25 % por semana")
      .optional(),
    targetWeightKg: z.number().min(30).max(300).optional(),
    /** El usuario confirma expresamente recomponer aunque su objetivo pese menos. */
    acknowledgedRecompWeightMismatch: z.boolean().default(false),

    // Paso 5 — Prioridades musculares (sin defaults ocultos)
    balancedProgram: z.boolean(),
    priorityMuscles: z.array(MuscleGroupCode).max(6),

    // Paso 6 — Actividad y nutrición
    dailySteps: z
      .number()
      .int()
      .min(0)
      .max(50_000, "Máximo 50.000 pasos")
      .default(6_000),
    workActivity: WorkActivity.default("SEDENTARY"),
    sleepHoursTypical: z
      .number()
      .min(3, "Entre 3 y 12 horas")
      .max(12, "Entre 3 y 12 horas")
      .optional(),
    mealsPerDay: z.number().int().min(1).max(8).optional(),
    dietaryPreference: z
      .enum(["NONE", "VEGETARIAN", "VEGAN", "OTHER"])
      .default("NONE"),

    // Paso 7 — Restricciones y preferencias
    contraindications: z.array(Contraindication).default([]),
    excludedExerciseNames: z.array(z.string().max(120)).max(50).default([]),
  })
  .superRefine((data, ctx) => {
    // Prioridades: o programa equilibrado, o 1–6 grupos; nunca ambos ni ninguno.
    if (data.balancedProgram && data.priorityMuscles.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["priorityMuscles"],
        message:
          "No puedes combinar 'programa equilibrado' con grupos prioritarios: elige una opción u otra.",
      });
    }
    if (!data.balancedProgram && data.priorityMuscles.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["priorityMuscles"],
        message:
          "Elige entre 1 y 6 grupos a priorizar, o marca 'programa equilibrado, sin prioridad'.",
      });
    }

    // Recomposición con peso objetivo materialmente inferior: exige confirmación.
    if (
      data.strategy === "RECOMP_MAINTAIN_WEIGHT" &&
      data.targetWeightKg !== undefined &&
      data.targetWeightKg < data.weightKg * (1 - RECOMP_WEIGHT_MISMATCH_PCT) &&
      !data.acknowledgedRecompWeightMismatch
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["strategy"],
        message:
          "Has elegido recomposición (peso estable) pero tu objetivo pesa bastante menos que tu peso actual. Para perder grasa elige 'Perder grasa manteniendo músculo', o confirma que quieres recomponer sin bajar de peso.",
      });
    }
  });

export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingData = z.output<typeof onboardingSchema>;
