import type { MuscleGroupCode } from "@/core/enums";

/**
 * Umbrales y defaults del generador de programa inicial (docs/TRAINING_ENGINE.md §1,
 * docs/PHASE_3_2_VOLUME_PLAN.md). Ningún número de entrenamiento debe estar
 * hardcodeado fuera de este archivo.
 *
 * MODELO DE VOLUMEN (Fase 3.2): todo razona en VOLUMEN EFECTIVO semanal por músculo
 * = series directas×1.0 + Σ(series indirectas × factor de contribución del catálogo).
 * El conteo fraccional directo/indirecto está respaldado por la literatura
 * (Pelland 2025 lo modela explícitamente) [EVIDENCIA RAZONABLE]. Los NÚMEROS
 * concretos de abajo son un PUNTO DE PARTIDA conservador de PRODUCTO, no óptimos
 * fisiológicos universales — se pueden recalibrar sin contradecir la ciencia
 * (ver COACH_PHILOSOPHY §7 y PHASE_3_RESEARCH). Sin sesgo estético oculto: la única
 * palanca de prioridad es la selección explícita del usuario.
 */

/**
 * Objetivo de VOLUMEN EFECTIVO semanal por músculo (intermedio, punto de partida).
 * [HEURÍSTICA DE PRODUCTO] Banda inicial conservadora (~6–10) con margen para
 * progresar; NO es un "óptimo científico". La evidencia (Pelland 2025, Schoenfeld
 * 2017) indica dosis-respuesta con rendimientos decrecientes y SIN techo claro, y
 * ganancias ya a volúmenes bajos: por eso se arranca bajo y se progresa.
 */
export const EFFECTIVE_TARGET: Record<MuscleGroupCode, number> = {
  PECHO_SUPERIOR: 6,
  PECHO_MEDIO_INFERIOR: 8,
  DELT_ANTERIOR: 6, // casi todo indirecto (empujes)
  DELT_LATERAL: 8,
  DELT_POSTERIOR: 6,
  DORSAL: 9,
  ESPALDA_ALTA: 7,
  TRAPECIO_SUPERIOR: 4,
  BICEPS: 8,
  TRICEPS: 8,
  ANTEBRAZO: 3,
  CUADRICEPS: 9,
  ISQUIOS: 8,
  GLUTEO: 8,
  GEMELO: 7,
  CORE: 5,
};

/**
 * Suelo de series DIRECTAS deseado por grupo: asegura estímulo directo (que un
 * músculo no viva SOLO de indirecto). `0` = puede cubrirse con indirecto y NUNCA
 * genera aviso. [HEURÍSTICA DE PRODUCTO]. El indirecto JAMÁS satisface este suelo.
 */
export const DIRECT_MIN: Record<MuscleGroupCode, number> = {
  PECHO_SUPERIOR: 3,
  PECHO_MEDIO_INFERIOR: 3,
  DELT_ANTERIOR: 0, // suficiente indirecto
  DELT_LATERAL: 5,
  DELT_POSTERIOR: 3,
  DORSAL: 5,
  ESPALDA_ALTA: 3,
  TRAPECIO_SUPERIOR: 0,
  BICEPS: 4,
  TRICEPS: 3,
  ANTEBRAZO: 0,
  CUADRICEPS: 5,
  ISQUIOS: 3,
  GLUTEO: 0, // vive del indirecto de sentadillas/RDL/hip thrust
  GEMELO: 4,
  CORE: 0,
};

/**
 * Aviso de músculo desatendido: solo si DIRECT_MIN[g] > 0 (músculo con estímulo
 * directo requerido) Y su volumen EFECTIVO < WARN_FRACTION × objetivo efectivo.
 * Así NUNCA se avisa por series directas ignorando el indirecto (bug del glúteo).
 */
export const WARN_FRACTION = 0.6;

/** Series efectivas añadidas al OBJETIVO SEMANAL de un grupo priorizado (no a las
 * series por ejercicio). [HEURÍSTICA DE PRODUCTO]. */
export const PRIORITY_BONUS_EFFECTIVE = 5;

/** Multiplicador del objetivo por experiencia (deriva de trainingYears).
 * [HEURÍSTICA conservadora] — principiantes crecen con menos volumen (Schoenfeld
 * 2017); avanzados toleran algo más. Nunca es un techo. */
export const EXPERIENCE_MULT = {
  beginner: 0.75,
  intermediate: 1.0,
  advanced: 1.15,
} as const;

/** Escalado suave del objetivo semanal por nº de días. [HEURÍSTICA DE GENERACIÓN]
 * — NO es una relación dosis-respuesta demostrada. Más días sirven sobre todo para
 * REPARTIR (frecuencia + sesiones más cortas), no para multiplicar el volumen. */
export const DAY_MULT: Record<number, number> = {
  2: 0.9,
  3: 1.0,
  4: 1.0,
  5: 1.08,
  6: 1.12,
};

/** Techo DURO de volumen efectivo por grupo (red de seguridad; el objetivo ya es
 * conservador, así que rara vez actúa). */
export const MAX_WEEKLY_SETS = 20;

/** En pérdida de grasa se reduce el volumen de partida (peor recuperación en déficit). */
export const FAT_LOSS_VOLUME_FACTOR = 0.85;

/** Máximo de series directas de un mismo grupo en una sola sesión. La prioridad da
 * 1 slot más/día, NO series por ejercicio más grandes. */
export const MAX_SETS_PER_GROUP_PER_SESSION = {
  priority: 4,
  standard: 3,
} as const;

/** Series por ejercicio al prescribir. `max` es un GUARDRAIL INICIAL del generador
 * (no un límite fisiológico): 4+ series requerirían una razón que hoy no existe. */
export const SETS_PER_EXERCISE = { min: 2, max: 3 } as const;

/** Tope BLANDO de series de trabajo por sesión (guardrail de densidad/fatiga/UX,
 * NO una frontera científica): evita sesiones de 24 series. [HEURÍSTICA]. */
export const SESSION_SET_CAP = 18;

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

/**
 * Umbrales del motor de sugerencia de progresión de Fase 2B (double progression
 * solo-sugerencia; ver docs/PHASE_2B_PLAN.md y TRAINING_ENGINE.md §1b). Nunca
 * hardcodear en la lógica: la fuente de verdad está aquí.
 */
export const PROGRESSION_2B = {
  /** La última sesión se considera inutilizable si registró menos de esta
   * fracción de las series previstas (datos parciales → no ajustar). */
  UNUSABLE_SESSION_FRACTION: 0.7,
  /** rirEff ≤ targetRir − este margen = fallo o casi (consolidar, no subir). */
  NEAR_FAILURE_MARGIN: 2,
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
