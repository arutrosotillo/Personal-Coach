import {
  assessFatigue,
  type FatigueAssessment,
  type FatigueExerciseInput,
} from "@/core/training/fatigue";
import {
  suggestProgression,
  type ProgressionSuggestion,
} from "@/core/training/progression";

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
  /** Series registradas ÷ previstas, acotado a 1. */
  completionRate: number;
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

/** Códigos del motor de progresión que significan "el rendimiento ha caído". */
const REGRESSION_CODES = new Set([
  "REPEATED_UNDERPERFORMANCE",
  "STUCK_BELOW_RANGE",
  "ONE_OFF_UNDERPERFORMANCE",
]);

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
      // Una regresión "de verdad": el motor bajó la carga, o lleva al menos dos
      // exposiciones sin alcanzar el rango. Un mal día suelto no cuenta.
      regressed:
        suggestion.action === "DECREASE_LOAD" ||
        (REGRESSION_CODES.has(suggestion.reasonCode) &&
          suggestion.numbers.sameWeightRun >= 2),
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

  return { context, variants, fatigue };
}
