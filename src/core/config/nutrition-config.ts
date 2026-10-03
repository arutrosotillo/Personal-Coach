import type { GoalType } from "@/core/enums";

/**
 * Umbrales y defaults del motor de nutrición (docs/NUTRITION_ENGINE.md).
 * Ningún número de nutrición debe estar hardcodeado fuera de este archivo.
 */
export const NUTRITION_CONFIG = {
  // ── Modelo TDEE aditivo (evita el doble conteo pasos/trabajo/ejercicio) ──
  // TDEE = BMR × factorNEAT(trabajo) + kcalPasos + kcalEntrenamiento.
  // Cada componente cubre una fuente distinta de gasto:
  //  · factorNEAT(trabajo): vida diaria y esfuerzo del trabajo SIN los pasos ni el gimnasio.
  //  · kcalPasos: locomoción medida por el podómetro/wearable.
  //  · kcalEntrenamiento: coste neto de las sesiones de fuerza.
  /** Factor NEAT base según actividad laboral (sin pasos ni entrenamiento). */
  workNeatFactor: {
    SEDENTARY: 1.15,
    LIGHT: 1.2,
    MODERATE: 1.3,
    HIGH: 1.4,
  },
  /** kcal por paso y por kg de peso (locomoción neta; ~0,04 kcal/paso a 80 kg). */
  kcalPerStepPerKg: 0.0005,
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
  /** Umbrales de % graso a partir de los cuales usar peso objetivo para la proteína. */
  highBodyFatPctForProteinRef: { MALE: 30, FEMALE: 40 },
  /** Redondeo de objetivos calóricos. */
  kcalRounding: 25,

  /**
   * Ajuste calórico por tendencia de peso (docs/NUTRITION_ENGINE.md §5, versión
   * reducida: solo usa la báscula, porque la app aún no registra ingesta).
   */
  calorieAdjustment: {
    /** Paso del ajuste, kcal/día. [HEURÍSTICA] spec §5: default 100. */
    stepKcal: 100,
    /** R4a: las 2 primeras semanas de dieta son agua y glucógeno. */
    initialPhaseDays: 14,
    /** R3: tras cualquier cambio de objetivo calórico, no tocar en 7 días… */
    cooldownAnyDirectionDays: 7,
    /** …ni repetir la MISMA dirección en 14 (el cambio tarda en verse en la báscula). */
    cooldownSameDirectionDays: 14,
    /** Tras un "ahora no", no volver a proponer lo mismo en una semana. */
    rejectionSnoozeDays: 7,
    /** Distancia entre las dos lecturas que tienen que coincidir (×2 semanas). */
    confirmationLagDays: 7,
    /** R6: banda "vas bien" del ratio observado/objetivo. */
    onTrackRatio: { min: 0.6, max: 1.4 },
    /** R7: por debajo de este ratio, estancado. */
    stalledRatio: 0.5,
    /**
     * R5 (pérdida): pérdida excesiva = más rápida que max(1 % del peso,
     * 1,5 × objetivo) por semana. En ganancia: ratio ≥ 1,5.
     */
    excessiveLossPctOfWeight: 1,
    excessiveRatio: 1.5,
  },
} as const;
