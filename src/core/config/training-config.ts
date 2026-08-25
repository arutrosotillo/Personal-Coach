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

/** Máximo de series directas de un mismo grupo en una sola sesión (techo de
 * densidad por grupo). La prioridad NO sube las series por ejercicio; su efecto
 * real es un objetivo semanal mayor → más FRECUENCIA (más días con el grupo). El
 * tope `priority` (4) es una holgura que rara vez actúa (un ejercicio ya ocupa 3
 * de las 4). Ver PHASE_3_2_VOLUME_PLAN §5. */
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
 * Umbrales del motor de progresión (`src/core/training/progression.ts`, v2 —
 * Fase 3.2b). Fuente de verdad única: nunca hardcodear estos números en la
 * lógica. Justificación de cada uno en docs/TRAINING_ENGINE_FINAL_AUDIT.md.
 */
export const PROGRESSION = {
  /**
   * Banda de tolerancia del RIR. Un esfuerzo es COMPATIBLE con la prescripción
   * si `rir >= targetRir - RIR_BAND`. Motivo: el error típico de estimación del
   * RIR es de ~1 repetición (Halperin 2022, meta-análisis), así que exigir
   * `rir >= targetRir` con igualdad estricta decide dentro del ruido del dato.
   * [HEURÍSTICA derivada de EVIDENCIA FUERTE]
   */
  RIR_BAND: 1,
  /** Fracción mínima de las series previstas para que la sesión sea utilizable. */
  MIN_USABLE_SET_FRACTION: 0.5,
  /** Nº de exposiciones recientes de la variante que mira el motor. */
  HISTORY_WINDOW: 6,
  /**
   * Una carga por debajo de esta fracción de la exposición anterior se trata
   * como ATÍPICA (error de tecleo o descarga puntual), no como la nueva
   * referencia. Sin esto, un solo dedo gordo reancla el ejercicio para siempre.
   */
  ATYPICAL_DROP_FRACTION: 0.75,
  /**
   * Exposiciones consecutivas al MISMO peso por debajo del mínimo del rango
   * (con esfuerzo alto) antes de bajar la carga. Nunca por una sola sesión.
   */
  DECREASE_AFTER_EXPOSURES: 2,
  /** Bajada mínima de carga, en incrementos del material. */
  DECREASE_STEPS: 1,
  /**
   * Exposiciones consecutivas al mismo peso por debajo del mínimo del rango
   * tras las que se baja la carga IGNORANDO el RIR. Sin esta salida, un
   * usuario que teclea habitualmente un RIR alto (o que corta las series por
   * dolor) queda atrapado para siempre: el guardia anti-sandbagging nunca deja
   * bajar. La evidencia de repeticiones, repetida, manda sobre el dato
   * subjetivo.
   */
  STUCK_EXPOSURES: 4,
  /**
   * Tope de la bajada por corrección. La bajada se dimensiona con la
   * equivalencia carga↔reps (para que UNA corrección devuelva al rango en vez
   * de encadenar siete de 2,5 kg), pero nunca recorta más de esta fracción.
   */
  MAX_DECREASE_FRACTION: 0.15,
  /**
   * Exposiciones consecutivas al mismo peso cerrando el rango con esfuerzo
   * mayor del prescrito tras las que se sube igualmente (evita el estado
   * absorbente de quedarse indefinidamente en el mismo peso).
   */
  FAILURE_PATIENCE_EXPOSURES: 2,
  /**
   * Exposiciones al mismo peso sin batir el mejor total de reps para emitir la
   * señal informativa de meseta. La señal NO cambia la acción.
   */
  PLATEAU_EXPOSURES: 3,
  /**
   * Reps por encima del techo del rango a partir de las cuales la carga se
   * considera claramente corta y se permite un salto doble. [HEURÍSTICA]
   */
  DOUBLE_STEP_OVERSHOOT_REPS: 3,
  /** Nunca más de este nº de incrementos en una sola subida. */
  MAX_STEPS_PER_INCREASE: 2,
  /**
   * Salto relativo máximo por subida respecto al peso de trabajo. Solo recorta
   * el salto DOBLE: un único incremento del material siempre está permitido
   * (si no cabe en el rango, se extiende el rango en vez de subir). [HEURÍSTICA]
   */
  MAX_RELATIVE_STEP: 0.1,
  /** Repeticiones que se pueden añadir por encima del techo del rango. */
  RANGE_EXTENSION_CAP: 5,
  /**
   * Repeticiones por debajo del mínimo del rango que se aceptan al subir carga
   * cuando ya no tiene sentido esperar más (rango cerrado al fallo dos veces).
   * Aterrizar 1–2 reps por debajo un par de sesiones es normal; 5 no.
   */
  ACCEPTABLE_SHORTFALL_REPS: 2,
} as const;

/**
 * Recencia del historial (Fase 3.3). El tiempo NUNCA cambia la carga por sí
 * solo; lo que hace es degradar la CONFIANZA y volver la recomendación más
 * conservadora. Un rendimiento de hace seis semanas no es evidencia del mismo
 * peso que el de la semana pasada. [HEURÍSTICA]
 */
export const RECENCY = {
  /** Hasta aquí, el historial es plenamente utilizable. */
  FRESH_MAX_DAYS: 10,
  /** A partir de aquí el historial es VIEJO: no se sube carga y baja confianza. */
  STALE_MIN_DAYS: 21,
  /** A partir de aquí es MUY viejo: confianza mínima y mensaje de reentrada. */
  OLD_MIN_DAYS: 42,
  /**
   * Un hueco mayor que esto entre dos exposiciones ROMPE la racha: dos sesiones
   * separadas por un mes no son comparables para detectar mesetas ni caídas.
   */
  RUN_GAP_DAYS: 21,
} as const;

/**
 * Motor de fatiga y deload reactivo (Fase 3.3, `src/core/training/fatigue.ts`).
 *
 * Principio: el deload se RECOMIENDA, nunca se aplica. Y una sola señal
 * subjetiva jamás basta — hace falta al menos una señal OBJETIVA (rendimiento
 * medido), porque `fatigue = 5` un martes no es información suficiente.
 *
 * Evidencia: los deloads NO mejoran las ganancias (Coleman et al. 2024, PeerJ
 * 12:e16777: sin diferencia en hipertrofia y PEOR fuerza en el grupo con
 * deload). Son gestión de fatiga. Por eso el disparador es reactivo y el
 * calendario pesa poco. Los PESOS de abajo son [HEURÍSTICA].
 */
export const FATIGUE = {
  /** Ventana de análisis en días (aprox. 2–3 semanas de entrenamiento). */
  WINDOW_DAYS: 21,
  /** Sesiones mínimas en la ventana para evaluar algo. */
  MIN_SESSIONS: 3,
  /** Puntos por señal. Objetivas pesan más que subjetivas. */
  WEIGHTS: {
    PERFORMANCE_DECLINE: 3,
    WIDESPREAD_PLATEAU: 2,
    SESSION_COMPLETION_DROP: 2,
    HIGH_FATIGUE_SUSTAINED: 2,
    LOW_PERCEIVED_PERFORMANCE: 1,
    LOW_MOTIVATION_SUSTAINED: 1,
    LONG_ACCUMULATION: 1,
  },
  /** Score a partir del cual se RECOMIENDA deload. */
  RECOMMEND_SCORE: 5,
  /** Score a partir del cual se avisa sin recomendar. */
  WATCH_SCORE: 3,
  /**
   * Puntos objetivos mínimos para recomendar. Sin esto, tres chips subjetivos
   * malos bastarían para pedir una semana de descarga.
   */
  MIN_OBJECTIVE_SCORE: 2,
  /** Ejercicios distintos con regresión para contar PERFORMANCE_DECLINE. */
  DECLINE_MIN_EXERCISES: 2,
  /** Fracción de ejercicios en meseta para contar WIDESPREAD_PLATEAU. */
  PLATEAU_FRACTION: 0.5,
  /** Sesiones con feedback malo repetido (de las últimas `RECENT_SESSIONS`). */
  RECENT_SESSIONS: 4,
  SUSTAINED_COUNT: 2,
  /** Umbrales de los chips 1..5. */
  HIGH_FATIGUE: 4,
  LOW_PERFORMANCE: 2,
  LOW_MOTIVATION: 2,
  JOINT_PAIN_SEVERE: 4,
  JOINT_PAIN_MILD: 3,
  /** Fracción de series completadas por debajo de la cual la sesión se acortó. */
  COMPLETION_LOW: 0.7,
  /** Semanas de acumulación continua tras las que el calendario suma 1 punto. */
  LONG_ACCUMULATION_WEEKS: 8,
  /** Prescripción del deload recomendado (advisory). */
  DELOAD_PLAN: {
    /** Fracción de las series habituales. Mantener carga, recortar volumen. */
    SET_FRACTION: 0.5,
    MIN_SETS_PER_EXERCISE: 1,
    /** Puntos de RIR que se añaden al objetivo. */
    RIR_INCREASE: 2,
    /** Solo se recorta carga si hay dolor articular. */
    LOAD_REDUCTION_WITH_PAIN: 0.1,
    DAYS: 7,
  },
} as const;

/** Versión del motor de fatiga. */
export const FATIGUE_ENGINE_VERSION = "1.0.0";

/** Versión del motor de progresión. Cambiar comportamiento obliga a subirla. */
export const PROGRESSION_ENGINE_VERSION = "2.0.0";

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
