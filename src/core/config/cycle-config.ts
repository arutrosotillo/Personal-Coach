import type { GoalStrategy } from "@/core/enums";

/**
 * Umbrales del dominio de ciclos (`src/core/cycles/`): resumen al cerrar,
 * evolución del rendimiento y aviso de composición en fases de ganancia.
 * Mismo criterio de evidencia que `body-config.ts`.
 */
export const CYCLE_CONFIG = {
  summary: {
    /** El peso de inicio y de cierre es la media de los primeros/últimos 7 días. */
    edgeDays: 7,
  },

  performance: {
    /**
     * Se compara el mejor e1RM de cada variante en las 3 primeras semanas del
     * ciclo con el de las 3 últimas. [HEURÍSTICA] Una sola sesión no dice nada;
     * tres semanas suelen tener 2–3 exposiciones por variante.
     */
    windowDays: 21,
    /** Por debajo de 7 días por ventana no hay nada que comparar. */
    minWindowDays: 7,
    /**
     * Un cambio de e1RM menor del 2,5 % es "se mantiene". [HEURÍSTICA] Es del
     * orden del error de la propia estimación de Epley en series de 6–12.
     */
    stableChangePct: 2.5,
    highlights: 3,
  },

  composition: {
    /**
     * Puntuación de señales a partir de la cual se sugiere revisar la fase, y
     * a partir de la cual se dice "vigilo". Ninguna señal sola, salvo una
     * cintura que sube más allá del error de medida junto a otra, basta para
     * sugerir nada. [HEURÍSTICA de producto]
     */
    reviewScore: 2,
    watchScore: 1,
    /** Ganar más de un 10 % del peso de inicio merece una nota (no una alarma). */
    cumulativeGainNotePct: 10,
  },

  /** Límites admisibles de la preferencia "% graso máximo" (solo orienta). */
  bodyFatCeilingPct: { min: 8, max: 35 },

  /**
   * Ritmos que se ofrecen como atajo al empezar un ciclo, % del peso por
   * semana. El rango admisible de verdad es el de `NUTRITION_CONFIG`.
   */
  ratePresets: {
    FAT_LOSS_MUSCLE_PRESERVATION: [-0.25, -0.5, -0.75],
    RECOMP_MAINTAIN_WEIGHT: [0],
    LEAN_GAIN: [0.1, 0.15, 0.2],
    MAINTENANCE: [0],
  } satisfies Record<GoalStrategy, readonly number[]>,
} as const;
