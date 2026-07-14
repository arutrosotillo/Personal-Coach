import { z } from "zod";

import {
  Contraindication,
  Equipment,
  GoalType,
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

export const onboardingSchema = z.object({
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

  // Paso 4 — Objetivo
  goalType: GoalType,
  weeklyRatePct: z
    .number()
    .min(-1.0, "El ritmo máximo de pérdida es 1 % de tu peso por semana")
    .max(0.25, "El ritmo máximo de ganancia es 0,25 % por semana")
    .optional(),
  targetWeightKg: z.number().min(30).max(300).optional(),

  // Paso 5 — Prioridades musculares
  priorityMuscles: z
    .array(MuscleGroupCode)
    .max(6, "Máximo 6 grupos prioritarios: priorizarlo todo es no priorizar nada")
    .default([]),

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
});

export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingData = z.output<typeof onboardingSchema>;
