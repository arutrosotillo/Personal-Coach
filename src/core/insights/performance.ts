import {
  INSIGHT_CONFIG,
  type InsightConfig,
} from "@/core/config/insight-config";
import { diffDays } from "@/core/dates";
import type {
  TrainingAnalysis,
  VariantAnalysis,
} from "@/core/training/analysis";

/**
 * Estado del RENDIMIENTO, derivado de lo que el motor de progresión ya decidió.
 *
 * REGLA DE ESTE ARCHIVO: no hay ni una línea de lógica de progresión nueva. El
 * motor de entrenamiento ya resolvió la parte difícil —distinguir un mal día
 * de una caída real, saber cuándo una bajada de carga fue deliberada, marcar
 * las mesetas— y duplicar ese razonamiento aquí crearía dos verdades sobre el
 * mismo hecho. Aquí solo se AGREGA lo que aquel afirma, variante a variante.
 *
 * Las señales que se leen, todas existentes:
 *   · `VariantAnalysis.regressed` — "el rendimiento ha caído", ya calculado
 *     con exclusión explícita de las sesiones malas sueltas
 *     (`ONE_OFF_UNDERPERFORMANCE` NO cuenta) y de las bajadas ya recuperadas.
 *   · `suggestion.action` — `INCREASE_LOAD`/`ADD_REP` significan que el motor
 *     pide avanzar, y solo lo pide cuando la última exposición lo mereció.
 *   · `suggestion.reasonCode` — `RECOVERY_VETO` (descarga o dolor),
 *     `NO_HISTORY`, `STALE_HISTORY`, `NEEDS_RIR_CONFIRMATION`.
 *   · `suggestion.numbers.exposures` y `daysSinceLast`.
 *   · `ContextSession.deload` — descarga EJECUTADA, ya verificada.
 */

export type PerformanceTrend =
  "IMPROVING" | "STABLE" | "DECLINING" | "INSUFFICIENT_DATA";

/** Por qué una variante no entra en el recuento. */
export type PerformanceExclusion =
  /** Menos de tres exposiciones: un ejercicio nuevo o recién sustituido. */
  | "TOO_FEW_EXPOSURES"
  /** Hace demasiado que no se entrena: no dice nada del presente. */
  | "STALE"
  /** El motor no tiene historial con el que decidir. */
  | "NO_HISTORY"
  /** Descarga o dolor: el motor suspendió su juicio y aquí también. */
  | "RECOVERY_VETO"
  /** Sin RIR no se puede confirmar el esfuerzo: no se sabe, no se inventa. */
  | "RIR_MISSING";

export type VariantState = "IMPROVING" | "STABLE" | "DECLINING" | "NOT_JUDGED";

export interface VariantPerformance {
  variantId: string;
  exerciseName: string;
  variantName: string;
  state: VariantState;
  excludedBecause: PerformanceExclusion | null;
  exposures: number;
  daysSinceLast: number;
}

export type PerformanceReasonCode =
  | "TOO_FEW_JUDGED_VARIANTS"
  | "MAJORITY_PROGRESSING"
  | "SEVERAL_REGRESSED"
  | "MIXED_SIGNALS"
  /** Habría sido DECLINING, pero hay una descarga reciente en la ventana. */
  | "DELOAD_IN_WINDOW";

export interface PerformanceAssessment {
  trend: PerformanceTrend;
  reasonCode: PerformanceReasonCode;
  /** Variantes que sí se pudieron juzgar. */
  judged: number;
  improving: number;
  stable: number;
  declining: number;
  notJudged: number;
  /** Hay una descarga ejecutada dentro de la ventana de bloqueo. */
  recentDeload: boolean;
  variants: readonly VariantPerformance[];
}

/** Códigos con los que el motor de progresión declara que NO puede juzgar. */
const NO_JUDGEMENT: Partial<Record<string, PerformanceExclusion>> = {
  NO_HISTORY: "NO_HISTORY",
  STALE_HISTORY: "STALE",
  RECOVERY_VETO: "RECOVERY_VETO",
  NEEDS_RIR_CONFIRMATION: "RIR_MISSING",
};

/**
 * Estado de UNA variante.
 *
 * `IMPROVING` = el motor pide avanzar. Ojo con una sutileza documentada: tras
 * una bajada de carga, cuando el motor vuelve a pedir subir, esto marca
 * `IMPROVING` aunque la carga siga por debajo del máximo anterior. Es
 * deliberado —describe la dirección de AHORA, no la distancia al récord— y
 * `regressed` ya se encarga de que una bajada sin recuperar no cuente como
 * mejora.
 */
function classifyVariant(
  v: VariantAnalysis,
  config: InsightConfig,
): VariantPerformance {
  const base = {
    variantId: v.variantId,
    exerciseName: v.exerciseName,
    variantName: v.variantName,
    exposures: v.suggestion.numbers.exposures,
    daysSinceLast: v.daysSinceLast,
  };

  const excluded = NO_JUDGEMENT[v.suggestion.reasonCode];
  if (excluded) {
    return { ...base, state: "NOT_JUDGED", excludedBecause: excluded };
  }
  if (v.daysSinceLast > config.staleVariantDays) {
    return { ...base, state: "NOT_JUDGED", excludedBecause: "STALE" };
  }
  if (v.suggestion.numbers.exposures < config.minExposuresPerVariant) {
    return {
      ...base,
      state: "NOT_JUDGED",
      excludedBecause: "TOO_FEW_EXPOSURES",
    };
  }

  // El orden importa: una variante en retroceso lo está aunque el motor pida
  // subir hoy. `regressed` es la señal más conservadora de las dos.
  if (v.regressed) {
    return { ...base, state: "DECLINING", excludedBecause: null };
  }
  const avanza =
    v.suggestion.action === "INCREASE_LOAD" ||
    v.suggestion.action === "ADD_REP";
  return {
    ...base,
    state: avanza ? "IMPROVING" : "STABLE",
    excludedBecause: null,
  };
}

/**
 * Agrega el rendimiento de todas las variantes en un único estado.
 *
 * Función pura: la fecha de corte sale del propio análisis, que ya la lleva.
 */
export function assessPerformance(
  analysis: TrainingAnalysis,
  config: InsightConfig = INSIGHT_CONFIG,
): PerformanceAssessment {
  const variants = analysis.variants.map((v) => classifyVariant(v, config));

  const improving = variants.filter((v) => v.state === "IMPROVING").length;
  const stable = variants.filter((v) => v.state === "STABLE").length;
  const declining = variants.filter((v) => v.state === "DECLINING").length;
  const judged = improving + stable + declining;
  const notJudged = variants.length - judged;

  // Descarga EJECUTADA en la ventana de bloqueo. Se mira `deload`, que el
  // motor solo marca cuando la descarga estaba recomendada Y las series
  // quedaron por debajo del 70 % de lo previsto: no es una sesión corta
  // cualquiera.
  const recentDeload = analysis.context.sessions.some(
    (s) =>
      s.deload &&
      diffDays(s.localDate, analysis.context.todayLocalDate) <=
        config.deloadBlockWindowDays,
  );

  const base = {
    judged,
    improving,
    stable,
    declining,
    notJudged,
    recentDeload,
    variants,
  };

  if (judged < config.minJudgedVariants) {
    return {
      ...base,
      trend: "INSUFFICIENT_DATA",
      reasonCode: "TOO_FEW_JUDGED_VARIANTS",
    };
  }

  // DECLINING exige número Y proporción. Es lo que impide que un solo
  // ejercicio estancado tiña el entrenamiento entero.
  const caeDeVerdad =
    declining >= config.decliningMinCount &&
    declining >= judged * config.decliningMinShare;

  if (caeDeVerdad) {
    // Una descarga es menos volumen A PROPÓSITO. Con una en la ventana, el
    // veredicto se degrada a STABLE y se dice por qué: leerla como caída sería
    // confundir el tratamiento con la enfermedad.
    if (recentDeload) {
      return { ...base, trend: "STABLE", reasonCode: "DELOAD_IN_WINDOW" };
    }
    return { ...base, trend: "DECLINING", reasonCode: "SEVERAL_REGRESSED" };
  }

  if (declining === 0 && improving >= judged * config.improvingMinShare) {
    return { ...base, trend: "IMPROVING", reasonCode: "MAJORITY_PROGRESSING" };
  }

  return { ...base, trend: "STABLE", reasonCode: "MIXED_SIGNALS" };
}
