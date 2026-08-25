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
  /** La sesión se registró como una DESCARGA ejecutada (`weekKind`). */
  deload: boolean;
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
/**
 * Códigos con los que el motor ya ha dicho "esto NO es accionable": un mal día
 * suelto, una carga que parece un error de tecleo, media sesión. Si el motor no
 * actúa sobre ellos, la tarjeta de recuperación tampoco puede tratarlos como
 * caída del rendimiento.
 */
const NOT_ACTIONABLE = new Set([
  "ONE_OFF_UNDERPERFORMANCE",
  "ATYPICAL_LOAD_DROP",
  "SESSION_INCOMPLETE",
]);

function walkedBack(
  exposures: ContextExposure[],
  suggestion: ProgressionSuggestion,
): boolean {
  // Cuando el motor ha declarado la ÚLTIMA exposición no accionable (un mal
  // día, un peso que parece un error de tecleo, media sesión), se juzga sin
  // ella. Si no, `walkedBack` reintroducía por la puerta de atrás lo que
  // `REGRESSION_CODES` sacó por la de delante: un único mal día tras una
  // bajada ya consolidada volvía a producir "el rendimiento ha caído" —con un
  // mensaje falso y confianza media-alta— mientras la pantalla de sesión decía
  // "no cambio nada por una sesión". Descartar el dato en vez de la variante
  // entera conserva el caso opuesto: si el peso ya venía bajado y las
  // exposiciones ANTERIORES también estaban por debajo, sigue siendo una
  // caída real.
  const considered = exposures;
  // Si el motor ya está pidiendo avanzar (más carga o más reps), el ejercicio
  // está reconstruyendo, no cayendo. Bajar una vez de más y volver a subir es
  // el funcionamiento normal de la doble progresión, no una regresión.
  if (
    suggestion.action === "INCREASE_LOAD" ||
    suggestion.action === "ADD_REP"
  ) {
    return false;
  }
  const weights = considered
    .map(workWeight)
    .filter((w): w is number => w !== null);
  if (weights.length < 2) return false;
  const current = weights[weights.length - 1];
  return current > 0 && current < Math.max(...weights);
}

/**
 * ¿Este ejercicio ha ido hacia atrás, de verdad?
 *
 * Cuando la última exposición es un dato que el motor mismo ha declarado no
 * accionable —un mal día, una carga que parece un error de tecleo, media
 * sesión— no basta con ignorarla: hay que preguntarse si, sin ella, el
 * ejercicio venía RECUPERÁNDOSE. Se vuelve a correr el motor sobre el resto del
 * historial y, si dice "avanza" (subir carga o sumar repeticiones), es que el
 * usuario ya había reconstruido y lo de hoy fue solo un mal día.
 *
 * Sin esto, `walkedBack` reintroducía por la puerta de atrás lo que
 * `REGRESSION_CODES` sacó por la de delante: un único mal día tras una bajada
 * ya consolidada producía "el rendimiento ha caído" —con un mensaje falso y
 * confianza media-alta— mientras la pantalla de sesión decía, a la vez, "no
 * cambio nada por una sesión".
 */
function hasRegressed(
  v: ContextVariant,
  suggestion: ProgressionSuggestion,
  todayLocalDate: string,
): boolean {
  if (suggestion.action === "DECREASE_LOAD") return true;
  if (REGRESSION_CODES.has(suggestion.reasonCode)) return true;
  if (!walkedBack(v.exposures, suggestion)) return false;

  if (NOT_ACTIONABLE.has(suggestion.reasonCode) && v.exposures.length > 1) {
    const sinHoy = suggestProgression({
      prescription: v.prescription,
      history: v.exposures.slice(0, -1),
      todayLocalDate,
    });
    if (sinHoy.action === "INCREASE_LOAD" || sinHoy.action === "ADD_REP") {
      return false;
    }
  }
  return true;
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
      regressed: hasRegressed(v, suggestion, context.todayLocalDate),
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
      deload: s.deload,
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
