import {
  assessFatigue,
  type FatigueAssessment,
  type FatigueExerciseInput,
} from "@/core/training/fatigue";
import {
  suggestProgression,
  type ProgressionSuggestion,
} from "@/core/training/progression";
import { applyRecoveryVeto, type RecoveryVeto } from "@/core/training/veto";

/**
 * Análisis longitudinal del entrenamiento (Fase 3.3): corre el motor de
 * progresión sobre cada variante y agrega el resultado en el motor de fatiga.
 *
 * Vive en `core` porque es DOMINIO PURO: mismos datos → mismo veredicto, sin
 * base de datos ni reloj. La capa de servidor solo le pasa hechos ya leídos.
 */

export interface ContextExposure {
  localDate: string;
  sets: Array<{ weightKg: number; reps: number; rir: number | null }>;
}

export interface ContextSession {
  id: string;
  localDate: string;
  templateName: string;
  perceivedPerformance: number | null;
  pump: number | null;
  jointPain: number | null;
  fatigue: number | null;
  motivation: number | null;
  notes: string | null;
  plannedSets: number;
  loggedSets: number;
  /**
   * Series registradas ÷ previstas, acotado a 1. `null` si no había series
   * previstas: una sesión así no es una sesión "acortada".
   */
  completionRate: number | null;
  durationMin: number | null;
}

export interface ContextVariant {
  variantId: string;
  exerciseName: string;
  variantName: string;
  prescription: {
    repRangeMin: number;
    repRangeMax: number;
    targetRir: number;
    plannedSets: number;
    loadStepKg: number;
  };
  /** De la más antigua a la más reciente. */
  exposures: ContextExposure[];
  daysSinceLast: number;
}

export interface TrainingContext {
  todayLocalDate: string;
  sinceLocalDate: string;
  sessions: ContextSession[];
  variants: ContextVariant[];
  /** Semanas de acumulación continua sin descarga. */
  weeksSinceDeload: number | null;
}

export interface VariantAnalysis {
  variantId: string;
  exerciseName: string;
  variantName: string;
  daysSinceLast: number;
  exposures: number;
  suggestion: ProgressionSuggestion;
  regressed: boolean;
  plateaued: boolean;
}

export interface TrainingAnalysis {
  context: TrainingContext;
  variants: VariantAnalysis[];
  fatigue: FatigueAssessment;
}

/**
 * Códigos del motor de progresión que significan "el rendimiento ha caído".
 *
 * `ONE_OFF_UNDERPERFORMANCE` NO está aquí a propósito: por definición es un mal
 * día suelto. Estaba, acompañado de `sameWeightRun >= 2`, y esa condición mide
 * otra cosa —exposiciones seguidas AL MISMO PESO, no seguidas por debajo del
 * rango—, así que una única sesión mala bastaba para que la tarjeta dijese "el
 * rendimiento ha caído" mientras la pantalla de sesión decía, a la vez, "no
 * cambio nada por una sesión". Los dos códigos que quedan ya exigen 2 y 4
 * exposiciones consecutivas bajo rango dentro del propio motor.
 *
 * Quitarlo dejaba fuera un caso legítimo: quien lleva semanas cayendo oscila
 * entre `DECREASE_LOAD` y "un mal día" al peso recién bajado, así que la mitad
 * de las veces se le veía "bien". Eso lo cubre ahora `walkedBack`, que mira el
 * peso de trabajo en vez del código.
 */
const REGRESSION_CODES = new Set([
  "REPEATED_UNDERPERFORMANCE",
  "STUCK_BELOW_RANGE",
]);

/** Peso de trabajo de una exposición: la mediana de sus series útiles. */
function workWeight(exposure: ContextExposure): number | null {
  const weights = exposure.sets
    .filter((x) => x.reps > 0)
    .map((x) => x.weightKg)
    .sort((a, b) => a - b);
  if (weights.length === 0) return null;
  return weights[Math.floor((weights.length - 1) / 2)];
}

/**
 * ¿El motor ha tenido que llevar este ejercicio HACIA ATRÁS y todavía no lo ha
 * recuperado? Es la definición literal de "el rendimiento ha caído", y tiene la
 * propiedad que hace falta: un mal día no mueve la carga, así que no puede
 * disparar esto. Solo lo dispara una bajada que el motor ya ejecutó.
 */
function walkedBack(
  exposures: ContextExposure[],
  suggestion: ProgressionSuggestion,
): boolean {
  // Si el motor ya está pidiendo avanzar (más carga o más reps), el ejercicio
  // está reconstruyendo, no cayendo. Bajar una vez de más y volver a subir es
  // el funcionamiento normal de la doble progresión, no una regresión.
  if (
    suggestion.action === "INCREASE_LOAD" ||
    suggestion.action === "ADD_REP"
  ) {
    return false;
  }
  const weights = exposures
    .map(workWeight)
    .filter((w): w is number => w !== null);
  if (weights.length < 2) return false;
  const current = weights[weights.length - 1];
  return current > 0 && current < Math.max(...weights);
}

export function analyzeTraining(context: TrainingContext): TrainingAnalysis {
  const variants: VariantAnalysis[] = context.variants.map((v) => {
    const suggestion = suggestProgression({
      prescription: v.prescription,
      history: v.exposures,
      todayLocalDate: context.todayLocalDate,
    });
    return {
      variantId: v.variantId,
      exerciseName: v.exerciseName,
      variantName: v.variantName,
      daysSinceLast: v.daysSinceLast,
      exposures: v.exposures.length,
      suggestion,
      // Una regresión "de verdad": el motor bajó la carga, o lleva varias
      // exposiciones sin alcanzar el rango. Un mal día suelto no cuenta.
      regressed:
        suggestion.action === "DECREASE_LOAD" ||
        REGRESSION_CODES.has(suggestion.reasonCode) ||
        walkedBack(v.exposures, suggestion),
      plateaued: suggestion.signals.some((s) => s.code === "PLATEAU_SIGNAL"),
    };
  });

  const exercises: FatigueExerciseInput[] = variants.map((v) => ({
    variantId: v.variantId,
    name: `${v.exerciseName} (${v.variantName})`,
    regressed: v.regressed,
    plateaued: v.plateaued,
    daysSinceLast: v.daysSinceLast,
  }));

  const fatigue = assessFatigue({
    todayLocalDate: context.todayLocalDate,
    sessions: context.sessions.map((s) => ({
      localDate: s.localDate,
      perceivedPerformance: s.perceivedPerformance,
      fatigue: s.fatigue,
      motivation: s.motivation,
      jointPain: s.jointPain,
      completionRate: s.completionRate,
    })),
    exercises,
    weeksSinceDeload: context.weeksSinceDeload,
  });

  // El veto va al final, con el veredicto ya cerrado: la fatiga se calcula
  // sobre lo que el motor decidió de verdad, no sobre lo que el veto dejó ver.
  const veto = recoveryVeto(fatigue);
  return {
    context,
    variants: variants.map((v) => ({
      ...v,
      suggestion: applyRecoveryVeto(v.suggestion, veto),
    })),
    fatigue,
  };
}

/**
 * Traduce el veredicto de recuperación al veto que suspende las subidas.
 * El dolor tiene precedencia sobre la descarga: si hay las dos cosas, manda él.
 */
export function recoveryVeto(fatigue: FatigueAssessment): RecoveryVeto | null {
  if (fatigue.jointPain.level === "ACTION") {
    return {
      kind: "JOINT_PAIN",
      message: `${fatigue.jointPain.message ?? "Has reportado dolor articular repetido."} La app no registra QUÉ articulación te duele, así que aplico el aviso a todos los ejercicios.`,
    };
  }
  if (fatigue.decision === "DELOAD_RECOMMENDED") {
    return { kind: "DELOAD", message: fatigue.headline };
  }
  return null;
}
