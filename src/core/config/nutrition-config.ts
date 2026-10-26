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
    /**
     * R2 (adherencia), solo cuando hay registro de ingesta suficiente: si lo
     * que comes se aparta de tu objetivo más de este % en la dirección que
     * explica el desvío, no se toca el objetivo —primero hay que comer el que
     * hay—. [HEURÍSTICA] spec §6: "buena" ≤ 10 %.
     */
    adherenceToleranceFraction: 0.1,
  },

  /**
   * Arranque de un régimen nuevo (inicio de ciclo). [RAZONABLE] Al cambiar de
   * dieta, la báscula se mueve las primeras semanas por glucógeno (≈3 g de agua
   * por gramo), sodio y contenido intestinal, no por tejido: entre 1 y 2 kg es
   * habitual al salir de una definición (Kreitzman 1992,
   * doi:10.1093/ajcn/56.1.292S). Esos días no entran ni en la tendencia que
   * decide ajustes ni en la estimación del mantenimiento.
   */
  regimeStart: {
    stabilizationDays: 14,
    /** Salir de un déficit rellena glucógeno: se espera una semana más. */
    postDeficitStabilizationDays: 21,
    /** Un ciclo "sigue" a otro si empieza a menos de estos días de su cierre. */
    contiguousCycleDays: 14,
  },

  /**
   * Estimación del mantenimiento por balance energético (docs/CYCLES.md §3):
   * `gasto = ingesta media − pendiente × densidad`, combinado por precisión con
   * la estimación del ciclo anterior y con la fórmula.
   */
  energyBalance: {
    /**
     * Ventanas candidatas, de la más larga a la más corta: para estimar el
     * gasto interesa la pendiente MÁS PRECISA dentro del régimen, no la más
     * reciente. [FUERTE] Nunca menos de 28 días (Hall & Chow 2011,
     * doi:10.3945/ajcn.111.014399).
     */
    windows: [
      { days: 56, minMeasurements: 8, minSpanDays: 40 },
      { days: 42, minMeasurements: 8, minSpanDays: 28 },
      { days: 28, minMeasurements: 8, minSpanDays: 20 },
    ],
    /** Registro suficiente: ≥ 60 % de los días de la ventana y ≥ 14 días. */
    minLoggedCoverage: 0.6,
    minLoggedDays: 14,
    /**
     * Un día registrado por debajo de esta fracción de la mediana se trata
     * como registro incompleto (se olvidó una comida) y se descarta.
     * [HEURÍSTICA]
     */
    incompleteDayFraction: 0.5,
    /**
     * Error sistemático del registro, en fracción de la ingesta. [RAZONABLE]
     * El autorregistro infraestima, más en población general que en quien
     * pesa la comida; 7 % es un punto medio prudente.
     */
    loggedSystematicSePct: 0.07,
    /** Sin registro se asume que se comió el objetivo: 10 % de incertidumbre. */
    targetProxySePct: 0.1,
    /**
     * Incertidumbre relativa de la densidad energética del cambio de peso.
     * [RAZONABLE] 7.700 kcal/kg es la del tejido graso; un cambio mixto de
     * grasa y masa magra tiene menos (Hall 2008, doi:10.1038/sj.ijo.0803720).
     */
    densityRelativeSe: 0.2,
    /**
     * Error típico de la fórmula aditiva de TDEE PARA UNA PERSONA, en
     * fracción. [RAZONABLE] Suma el error de la ecuación de gasto en reposo
     * (~10 %) y el de estimar la actividad (~10 %): ≈ 15 %. Es mayor que el
     * ±12 % que se enseña en el onboarding porque aquí compite con datos
     * reales, y sobrestimar la fórmula le haría ganar a la báscula.
     */
    formulaSePct: 0.15,
    /** La estimación de un ciclo anterior pierde precisión con el tiempo. */
    priorDriftSeKcalPerMonth: 30,
    /** …y al pasar de déficit a no-déficit (el gasto adaptado se recupera). */
    priorTransitionSeKcal: 100,
    /** Nunca se presume más precisión que ±150 kcal (≈ 1,96 × 75). */
    minSeKcal: 75,
    /** Confianza en tres niveles por error típico combinado. [HEURÍSTICA] */
    confidenceSeKcal: { high: 120, medium: 200 },
  },

  /**
   * Motor adaptativo para ritmos lentos y estables (docs/CYCLES.md §4). La
   * definición sigue con las reglas R0–R8 de arriba; ganancia, mantenimiento y
   * recomposición usan estas, pensadas para meses o años en la misma fase.
   */
  adaptive: {
    /**
     * Ventanas de tendencia, de la más larga a la más corta. Se pueden usar
     * largas sin "describir el pasado" porque la tendencia arranca en el
     * último cambio de calorías (más `settleDaysAfterChange`): nunca mezcla
     * dos objetivos calóricos. A 84 días con pesaje diario el margen de la
     * pendiente es de ±0,03 kg/semana, que ya distingue +0,10 %/semana de 0.
     */
    windows: [
      { days: 84, minMeasurements: 12, minSpanDays: 63 },
      { days: 70, minMeasurements: 12, minSpanDays: 49 },
      { days: 56, minMeasurements: 10, minSpanDays: 42 },
      { days: 42, minMeasurements: 10, minSpanDays: 30 },
      { days: 28, minMeasurements: 10, minSpanDays: 24 },
      /**
       * Solo para detectar pronto un error GRANDE (el intervalo es ancho y
       * por construcción solo confirma desvíos grandes).
       */
      { days: 21, minMeasurements: 10, minSpanDays: 17 },
    ],
    /**
     * Lectura RECIENTE (la escalera primaria del motor corporal): la ventana
     * larga va con retraso cuando cambia el comportamiento sin cambiar las
     * calorías. Se usa para dos cosas: detectar pronto un desvío fuerte y
     * reconocer que el peso "ya vuelve" en mantenimiento.
     */
    recentWindows: [
      { days: 42, minMeasurements: 10, minSpanDays: 30 },
      { days: 35, minMeasurements: 10, minSpanDays: 24 },
      { days: 28, minMeasurements: 10, minSpanDays: 20 },
    ],
    /** Días tras un cambio de calorías que no entran en la tendencia. */
    settleDaysAfterChange: 7,
    /** La lectura que confirma está 14 días antes (no 7: el ritmo es lento). */
    confirmationLagDays: 14,
    /**
     * Un desvío FUERTE (ganancia excesiva, o perder peso en un volumen) se
     * confirma con una lectura a 7 días: esperar 14 sería acumular grasa o
     * perder semanas de entrenamiento por prudencia mal entendida.
     */
    strongConfirmationLagDays: 7,
    /** Mínimo entre dos cambios de calorías, en cualquier dirección. */
    minDaysBetweenChanges: 28,
    /**
     * Antioscilación: durante estos días tras un cambio, ir en la dirección
     * CONTRARIA exige un desvío `reversalEvidenceMultiplier` veces mayor. 13
     * semanas porque, con márgenes honestos, la primera reversión confirmable
     * llega hacia las 9–12 semanas del cambio: una guarda más corta no
     * protegería nunca.
     */
    reversalGuardDays: 91,
    /** "Ya vuelves" (solo para NO actuar): tendencia reciente ≥ 0,1 %/sem de vuelta. */
    returningMinPctPerWeek: 0.1,
    reversalEvidenceMultiplier: 1.5,
    /** Paso proporcional y amortiguado al desvío, acotado. [HEURÍSTICA] */
    damping: 0.6,
    minStepKcal: 50,
    maxStepKcal: 150,
    gain: {
      /** Banda "vas bien": ±50 % del objetivo, nunca menos de ±0,05 %/sem. */
      bandRelative: 0.5,
      bandMinPctPerWeek: 0.05,
      /** Excesivo: más del doble del objetivo y al menos +0,25 %/sem extra. */
      excessiveMultiplier: 2,
      excessiveExtraPctPerWeek: 0.25,
    },
    maintenance: {
      /** spec §10: ancla al entrar y banda ±1 % del peso. */
      bandPctOfWeight: 1,
      /** El desvío se corrige repartido en unas seis semanas. */
      returnOverDays: 42,
    },
    recomp: {
      /** spec §10: sube > 0,25 %/sem sin bajar cintura → −100. */
      risingPctPerWeek: 0.25,
      /** spec §10: baja > 0,35 %/sem y el rendimiento cae → +100. */
      fallingPctPerWeek: 0.35,
      stepKcal: 100,
    },
  },
} as const;
