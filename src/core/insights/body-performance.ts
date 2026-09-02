import type { BodyAnalysis, WeightTrendStatus } from "@/core/body";
import type { GoalType } from "@/core/enums";

import type {
  PerformanceAssessment,
  PerformanceTrend,
} from "@/core/insights/performance";

/**
 * Insight cuerpo × rendimiento. Determinista, puro y deliberadamente callado.
 *
 * LA INVARIANTE CENTRAL: hay dos capas, y no se mezclan.
 *
 *   · `observation` — un HECHO. "Tu peso baja y tu rendimiento se mantiene".
 *     No depende del objetivo y no valora nada. Siempre existe.
 *   · `goalAssessment` — qué significa ese hecho PARA EL OBJETIVO que la
 *     persona eligió. Puede ser `null`, y lo es a menudo.
 *
 * Lo que este motor NO puede hacer, por diseño y no por falta de ganas: nombrar
 * una CAUSA. Que el peso baje y el rendimiento caiga a la vez son dos hechos
 * simultáneos. Podrían explicarse por un déficit agresivo, por poco sueño, por
 * exceso de volumen, por una semana de trabajo horrible o por nada en
 * particular, y con peso y cargas no se puede distinguir entre esas
 * posibilidades. Un motor que dijera "tu déficit es demasiado agresivo" estaría
 * inventando. Esas hipótesis son material para el Coach (B6), COMO HIPÓTESIS
 * ETIQUETADAS, nunca como hechos.
 *
 * Por eso no hay ningún código llamado `MUSCLE_LOSS`, `EXCESSIVE_DEFICIT`,
 * `POOR_RECOVERY` ni parecidos: los nombres describen lo que se ve, no lo que
 * se supone.
 */

export const INSIGHT_ENGINE_VERSION = "1.0.0";

/**
 * El hecho conjunto. Nombres puramente descriptivos: dirección del peso ×
 * dirección del rendimiento.
 */
export type ObservationCode =
  | "WEIGHT_DOWN_PERFORMANCE_UP"
  | "WEIGHT_DOWN_PERFORMANCE_HELD"
  | "WEIGHT_DOWN_PERFORMANCE_DOWN"
  | "WEIGHT_UP_PERFORMANCE_UP"
  | "WEIGHT_UP_PERFORMANCE_HELD"
  | "WEIGHT_UP_PERFORMANCE_DOWN"
  | "WEIGHT_HELD_PERFORMANCE_UP"
  | "WEIGHT_HELD_PERFORMANCE_HELD"
  | "WEIGHT_HELD_PERFORMANCE_DOWN"
  /** El cuerpo no da para afirmar dirección. */
  | "BODY_INCONCLUSIVE"
  | "BODY_INSUFFICIENT_DATA"
  /** El entrenamiento no da para afirmar dirección. */
  | "PERFORMANCE_INSUFFICIENT_DATA";

/**
 * Qué significa el hecho para el objetivo elegido. El objetivo cambia el
 * SIGNIFICADO del dato, nunca el dato.
 */
export type GoalAssessmentCode =
  /** Bajas de peso y el rendimiento sube. */
  | "LOSING_PERFORMANCE_UP"
  /** Bajas de peso y el rendimiento se mantiene. */
  | "LOSING_PERFORMANCE_HELD"
  /** Bajas de peso y varios ejercicios han ido hacia atrás. */
  | "LOSING_PERFORMANCE_DOWN"
  /** Subes de peso y el rendimiento sube. */
  | "GAINING_PERFORMANCE_UP"
  /** Subes de peso y el rendimiento se mantiene. */
  | "GAINING_PERFORMANCE_HELD"
  /** Subes de peso y varios ejercicios han ido hacia atrás. */
  | "GAINING_PERFORMANCE_DOWN"
  /** Peso estable y rendimiento subiendo, quisieras moverlo o no. */
  | "RECOMP_SIGNAL"
  /** Peso estable cuando el objetivo es moverlo. */
  | "WEIGHT_NOT_MOVING"
  /** El peso se mueve en la dirección contraria al objetivo. */
  | "MOVING_AGAINST_GOAL"
  /** Objetivo de mantener, y se mantiene. */
  | "HOLDING_AS_INTENDED"
  /** Objetivo de mantener, y el peso se está yendo. */
  | "WEIGHT_DRIFTING";

export interface BodyPerformanceInsight {
  observation: {
    weight: WeightTrendStatus;
    performance: PerformanceTrend;
    code: ObservationCode;
  };
  /** `null` = no hay nada defendible que decir sobre el objetivo. */
  goalAssessment: {
    code: GoalAssessmentCode;
    goalType: GoalType;
  } | null;
  /**
   * Cifras que la capa de presentación puede CITAR sin recalcular nada. Mismo
   * contrato que con el Coach: los números los pone el motor.
   */
  numbers: {
    weightSlopeKgPerWeek: number | null;
    weightWindowDays: number | null;
    judgedVariants: number;
    improving: number;
    declining: number;
  };
  /**
   * ¿Merece ocupar sitio en pantalla?
   *
   * Regla: SOLO si hay valoración respecto al objetivo. Una observación sin
   * lectura para el objetivo de la persona es una frase bonita que no ayuda a
   * nadie, y rellenar hueco con eso es peor que no enseñar nada.
   */
  worthShowing: boolean;
  engineVersion: string;
}

export interface BodyPerformanceInput {
  bodyAnalysis: BodyAnalysis;
  performance: PerformanceAssessment;
}

/** Dirección del peso reducida a tres casos, o `null` si no es afirmable. */
function weightDirection(
  status: WeightTrendStatus,
): "DOWN" | "UP" | "HELD" | null {
  if (status === "LOSING") return "DOWN";
  if (status === "GAINING") return "UP";
  if (status === "MAINTAINING") return "HELD";
  return null;
}

function performanceDirection(
  trend: PerformanceTrend,
): "UP" | "HELD" | "DOWN" | null {
  if (trend === "IMPROVING") return "UP";
  if (trend === "STABLE") return "HELD";
  if (trend === "DECLINING") return "DOWN";
  return null;
}

function observationCode(
  weight: WeightTrendStatus,
  performance: PerformanceTrend,
): ObservationCode {
  // El orden de las salidas importa: si el cuerpo no da para afirmar
  // dirección, no hay observación conjunta que valga, diga lo que diga el
  // entrenamiento.
  if (weight === "INSUFFICIENT_DATA") return "BODY_INSUFFICIENT_DATA";
  if (weight === "INCONCLUSIVE") return "BODY_INCONCLUSIVE";
  if (performance === "INSUFFICIENT_DATA")
    return "PERFORMANCE_INSUFFICIENT_DATA";

  const w = weightDirection(weight)!;
  const p = performanceDirection(performance)!;
  return `WEIGHT_${w}_PERFORMANCE_${p}` as ObservationCode;
}

/**
 * LA MATRIZ. Qué se puede decir de cada combinación, según el objetivo.
 *
 * Muchas celdas devuelven `null` a propósito. Los criterios para que una celda
 * merezca valoración son dos: que el objetivo cambie de verdad su lectura, y
 * que no duplique algo que la app ya dice en otro sitio. Por ejemplo,
 * "mantener + rendimiento cayendo" no produce nada aquí: la caída de
 * rendimiento ya la cubre el motor de fatiga en la pantalla de entrenar, y
 * repetirla con salsa corporal no añade información, solo ruido.
 */
function assessGoal(
  goalType: GoalType,
  weight: WeightTrendStatus,
  performance: PerformanceTrend,
): GoalAssessmentCode | null {
  const w = weightDirection(weight);
  const p = performanceDirection(performance);
  // Sin dirección afirmable en alguno de los dos ejes no hay valoración
  // posible. Es el caso más frecuente al principio, y está bien que lo sea.
  if (w === null || p === null) return null;

  switch (goalType) {
    case "FAT_LOSS":
      if (w === "DOWN") {
        if (p === "UP") return "LOSING_PERFORMANCE_UP";
        if (p === "HELD") return "LOSING_PERFORMANCE_HELD";
        return "LOSING_PERFORMANCE_DOWN";
      }
      if (w === "HELD") {
        // Peso quieto y fuerza subiendo es la señal clásica de recomposición,
        // y merece decirse aunque el objetivo declarado fuera perder.
        if (p === "UP") return "RECOMP_SIGNAL";
        return "WEIGHT_NOT_MOVING";
      }
      return "MOVING_AGAINST_GOAL";

    case "LEAN_GAIN":
      if (w === "UP") {
        if (p === "UP") return "GAINING_PERFORMANCE_UP";
        if (p === "HELD") return "GAINING_PERFORMANCE_HELD";
        return "GAINING_PERFORMANCE_DOWN";
      }
      if (w === "HELD") return "WEIGHT_NOT_MOVING";
      return "MOVING_AGAINST_GOAL";

    case "RECOMP":
    case "MAINTENANCE":
      if (w === "HELD") {
        if (p === "UP") return "RECOMP_SIGNAL";
        if (p === "HELD") return "HOLDING_AS_INTENDED";
        // Mantener + rendimiento cayendo: deliberadamente sin valoración.
        // No hay nada que el objetivo aporte a esa lectura, y la caída ya se
        // cuenta donde corresponde.
        return null;
      }
      return "WEIGHT_DRIFTING";
  }
}

/**
 * Cruza cuerpo y rendimiento. Puro: sin Prisma, sin React, sin reloj, sin red.
 *
 * El objetivo se lee del propio `bodyAnalysis`, que ya lo lleva comparado: así
 * no hay dos fuentes de "cuál es tu objetivo" que puedan discrepar.
 */
export function analyzeBodyPerformance(
  input: BodyPerformanceInput,
): BodyPerformanceInsight {
  const { bodyAnalysis, performance } = input;
  const weight = bodyAnalysis.weight.status;

  const observation = {
    weight,
    performance: performance.trend,
    code: observationCode(weight, performance.trend),
  };

  const goalType = bodyAnalysis.goal?.goalType ?? null;
  const code =
    goalType === null ? null : assessGoal(goalType, weight, performance.trend);

  return {
    observation,
    goalAssessment: code === null ? null : { code, goalType: goalType! },
    numbers: {
      // Solo se expone la pendiente cuando el motor corporal la respalda: con
      // INCONCLUSIVE existe pero no se puede afirmar, y aquí tampoco.
      weightSlopeKgPerWeek: bodyAnalysis.goal?.observedKgPerWeek ?? null,
      weightWindowDays: bodyAnalysis.weight.windowDays,
      judgedVariants: performance.judged,
      improving: performance.improving,
      declining: performance.declining,
    },
    worthShowing: code !== null,
    engineVersion: INSIGHT_ENGINE_VERSION,
  };
}
