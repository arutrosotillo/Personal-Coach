import type { GoalType } from "@/core/enums";

/**
 * Umbrales y defaults del motor de nutrición (docs/NUTRITION_ENGINE.md).
 * Ningún número de nutrición debe estar hardcodeado fuera de este archivo.
 */
export const NUTRITION_CONFIG = {
  /** Factor base de actividad según pasos/día (límites inferiores de tramo). */
  stepsFactorTable: [
    { minSteps: 12_000, factor: 1.7 },
    { minSteps: 10_000, factor: 1.6 },
    { minSteps: 8_000, factor: 1.5 },
    { minSteps: 6_000, factor: 1.4 },
    { minSteps: 4_000, factor: 1.3 },
    { minSteps: 0, factor: 1.2 },
  ],
  /** Ajuste por actividad laboral (esfuerzo no capturado por pasos). */
  workActivityAdjustment: {
    SEDENTARY: 0.0,
    LIGHT: 0.05,
    MODERATE: 0.1,
    HIGH: 0.15,
  },
  /** Tope del factor combinado pasos + trabajo. */
  maxActivityFactor: 1.85,
  /** Coste neto de una sesión de fuerza: kcal por kg de peso y minuto. */
  strengthKcalPerKgPerMin: 0.05,
  /** Incertidumbre comunicada de la estimación inicial (±). */
  tdeeUncertaintyPct: 0.12,
  /** kcal por kg de tejido (constante de control, imprecisión reconocida). */
  kcalPerKgBodyweight: 7_700,
  /** Ritmos semanales (% del peso corporal / semana) por objetivo. */
  weeklyRatePct: {
    FAT_LOSS: { default: -0.5, min: -1.0, max: -0.25 },
    RECOMP: { default: 0, min: 0, max: 0 },
    LEAN_GAIN: { default: 0.15, min: 0.1, max: 0.25 },
    MAINTENANCE: { default: 0, min: 0, max: 0 },
  } satisfies Record<GoalType, { default: number; min: number; max: number }>,
  /** Suelos duros de seguridad (docs/NUTRITION_ENGINE.md §2). */
  minKcalAbsolute: { MALE: 1_500, FEMALE: 1_200 },
  minKcalBmrFactor: 0.9,
  maxDeficitPctOfTdee: 0.25,
  /** Macros por objetivo (g/kg de peso de referencia). */
  proteinGPerKg: {
    FAT_LOSS: 2.2,
    RECOMP: 2.2,
    LEAN_GAIN: 1.8,
    MAINTENANCE: 1.8,
  } satisfies Record<GoalType, number>,
  fatGPerKg: {
    FAT_LOSS: 0.8,
    RECOMP: 0.8,
    LEAN_GAIN: 0.9,
    MAINTENANCE: 0.9,
  } satisfies Record<GoalType, number>,
  minFatGPerKg: 0.6,
  minFatGAbsolute: 45,
  minCarbsG: 100,
  /** Redondeo de objetivos calóricos. */
  kcalRounding: 25,
} as const;
