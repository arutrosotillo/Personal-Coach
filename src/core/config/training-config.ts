import type { MuscleGroupCode } from "@/core/enums";

/**
 * Umbrales y defaults del generador de programa inicial (docs/TRAINING_ENGINE.md).
 * Ningún número de entrenamiento debe estar hardcodeado fuera de este archivo.
 *
 * IMPORTANTE — sin sesgo estético oculto: los volúmenes base reflejan las
 * necesidades de cada músculo en un programa de hipertrofia equilibrado
 * (los grupos que reciben poco estímulo indirecto —deltoides lateral/posterior—
 * necesitan más trabajo directo; los grupos grandes toleran/necesitan más series).
 * NO codifican las prioridades estéticas de nadie: la única palanca de prioridad
 * es la selección explícita del usuario (PRIORITY_BONUS_SETS).
 */

/** Series DIRECTAS semanales de partida por grupo (conservadoras, equilibradas). */
export const BASELINE_WEEKLY_SETS: Record<MuscleGroupCode, number> = {
  PECHO_SUPERIOR: 6,
  PECHO_MEDIO_INFERIOR: 6,
  DELT_ANTERIOR: 2, // recibe mucho volumen indirecto de los empujes
  DELT_LATERAL: 8, // apenas se estimula en compuestos → más trabajo directo
  DELT_POSTERIOR: 6, // idem
  DORSAL: 9,
  ESPALDA_ALTA: 6,
  TRAPECIO_SUPERIOR: 3,
  BICEPS: 7,
  TRICEPS: 7,
  ANTEBRAZO: 2,
  CUADRICEPS: 9,
  ISQUIOS: 8,
  GLUTEO: 6,
  GEMELO: 6,
  CORE: 4,
};

/** Series directas añadidas a un grupo priorizado por el usuario (acotado por máximo). */
export const PRIORITY_BONUS_SETS = 4;

/** Suelo de series directas por grupo (nunca se abandona por debajo, salvo tiempo). */
export const MIN_WEEKLY_SETS: Record<MuscleGroupCode, number> = {
  PECHO_SUPERIOR: 4,
  PECHO_MEDIO_INFERIOR: 4,
  DELT_ANTERIOR: 0, // suficiente indirecto
  DELT_LATERAL: 6,
  DELT_POSTERIOR: 4,
  DORSAL: 6,
  ESPALDA_ALTA: 4,
  TRAPECIO_SUPERIOR: 0,
  BICEPS: 4,
  TRICEPS: 4,
  ANTEBRAZO: 0,
  CUADRICEPS: 6,
  ISQUIOS: 4,
  GLUTEO: 3,
  GEMELO: 3,
  CORE: 0,
};

/** Techo de series directas por grupo (evita volumen basura inicial). */
export const MAX_WEEKLY_SETS = 20;

/** En pérdida de grasa se reduce el volumen de partida (peor recuperación en déficit). */
export const FAT_LOSS_VOLUME_FACTOR = 0.85;

/** Máximo de series directas de un mismo grupo en una sola sesión. */
export const MAX_SETS_PER_GROUP_PER_SESSION = {
  priority: 6,
  standard: 4,
} as const;

/** Series por ejercicio al prescribir (mínimo y máximo, algo mayor si es prioridad). */
export const SETS_PER_EXERCISE = { min: 2, max: 4, maxPriority: 5 } as const;

/**
 * Coste en minutos por serie de trabajo, incluido el descanso, según el rol.
 * Overhead fijo por sesión = calentamiento general + montaje.
 */
export const TIME_COST_MIN = {
  compoundHeavy: 4, // systemicFatigue 3 (sentadilla, peso muerto, remo pesado)
  compound: 3,
  isolation: 2,
} as const;
export const SESSION_OVERHEAD_MIN = 10;

/**
 * RIR objetivo inicial por rol de ejercicio. Los compuestos pesados se dejan
 * más lejos del fallo (más fatiga y riesgo); los aislamientos, más cerca.
 * El rango de repeticiones lo aporta cada variante del catálogo (rol-apropiado).
 */
export const TARGET_RIR = {
  compoundHeavy: 3,
  compound: 2,
  isolation: 1,
} as const;

/** Patrones de movimiento considerados "compuestos" (multiarticulares). */
export const COMPOUND_PATTERNS: ReadonlySet<string> = new Set([
  "HORIZONTAL_PUSH",
  "VERTICAL_PUSH",
  "HORIZONTAL_PULL",
  "VERTICAL_PULL",
  "SQUAT",
  "HINGE",
  "LUNGE",
]);
