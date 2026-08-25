import type { TrainingAnalysis } from "@/core/training/analysis";
import { estimateOneRepMax } from "@/core/training/e1rm";
import { equivalentLoad } from "@/core/training/progression";

/**
 * Context builder de Coach AI: convierte el análisis DETERMINISTA en el objeto
 * exacto que se envía al modelo.
 *
 * Principio de la capa: **los números ya vienen calculados**. Al modelo no se
 * le pide que decida si progresas, ni que calcule un e1RM, ni que estime
 * volumen: se le dan los hechos y las decisiones del motor, y se le pide que
 * los interprete y los explique. Todo lo que aquí no esté, el modelo no lo sabe
 * — y `notAvailable` se lo dice explícitamente para que no lo invente.
 *
 * Puro y determinista: mismos datos → mismo contexto.
 */

/** Cuántos elementos como mucho viajan al modelo (control de coste). */
export const CONTEXT_LIMITS = {
  sessions: 12,
  exercises: 12,
  exposuresPerExercise: 4,
  setsPerExposure: 6,
  noteChars: 200,
} as const;

export interface CoachExerciseContext {
  exercise: string;
  variant: string;
  prescription: string;
  exposures: number;
  daysSinceLast: number;
  /** Últimas exposiciones: `"2026-08-20: 80×8@2, 80×8@2, 80×7@2"`. */
  recentSets: string[];
  /** Repeticiones totales por exposición (tendencia bruta). */
  totalRepTrend: number[];
  /** Carga equivalente al mínimo del rango, en kg, por exposición. */
  equivalentLoadTrend: number[];
  /** Variación de la carga equivalente entre la 1.ª y la última, en %. */
  equivalentLoadTrendPct: number | null;
  bestRecentE1rm: number | null;
  progression: {
    action: string;
    reasonCode: string;
    suggestedWeightKg: number | null;
    suggestedReps: number | null;
    confidence: string;
    explanation: string;
  };
  signals: string[];
  plateaued: boolean;
  regressed: boolean;
}

export interface CoachContext {
  meta: {
    todayLocalDate: string;
    windowDays: number;
    progressionEngine: string;
    fatigueEngine: string;
  };
  profile: {
    goal: string | null;
    strategy: string | null;
    experienceLevel: string | null;
    daysPerWeek: number | null;
  };
  adherence: {
    sessionsInWindow: number;
    avgCompletionRate: number;
    weeksSinceDeload: number | null;
  };
  sessions: Array<{
    date: string;
    template: string;
    setsLogged: number;
    setsPlanned: number;
    feedback: {
      rendimiento: number | null;
      fatiga: number | null;
      motivacion: number | null;
      dolorArticular: number | null;
    };
    note: string | null;
  }>;
  exercises: CoachExerciseContext[];
  fatigue: {
    level: string;
    decision: string;
    score: number;
    objectiveScore: number;
    confidence: string;
    signals: string[];
    jointPain: string | null;
    plan: string | null;
    explanation: string;
  };
  /** Márgenes de error reales, para que el modelo no lea ruido como señal. */
  limits: {
    e1rmErrorPct: number;
    rirErrorReps: number;
    notes: string[];
  };
  /** Datos que la app NO tiene. El modelo no puede inventarlos. */
  notAvailable: string[];
}

function fmtSets(
  sets: Array<{ weightKg: number; reps: number; rir: number | null }>,
): string {
  return sets
    .slice(0, CONTEXT_LIMITS.setsPerExposure)
    .map((s) => `${s.weightKg}×${s.reps}${s.rir === null ? "" : `@${s.rir}`}`)
    .join(", ");
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface CoachProfileInput {
  goal: string | null;
  strategy: string | null;
  experienceLevel: string | null;
  daysPerWeek: number | null;
  /** Métricas que el perfil SÍ tiene registradas (para no listarlas como ausentes). */
  available?: string[];
}

/** Todo lo que la app todavía no registra y por tanto nadie puede citar. */
const POTENTIALLY_MISSING = [
  "peso corporal actual",
  "calorías diarias",
  "proteína diaria",
  "horas de sueño",
  "pasos / actividad diaria",
  "medidas corporales",
] as const;

export function buildCoachContext(
  analysis: TrainingAnalysis,
  profile: CoachProfileInput,
): CoachContext {
  const { context, variants, fatigue } = analysis;
  const available = new Set(profile.available ?? []);

  const sessions = context.sessions
    .slice(-CONTEXT_LIMITS.sessions)
    .map((s) => ({
      date: s.localDate,
      template: s.templateName,
      setsLogged: s.loggedSets,
      setsPlanned: s.plannedSets,
      feedback: {
        rendimiento: s.perceivedPerformance,
        fatiga: s.fatigue,
        motivacion: s.motivation,
        dolorArticular: s.jointPain,
      },
      note: s.notes ? s.notes.slice(0, CONTEXT_LIMITS.noteChars) : null,
    }));

  // Los ejercicios más relevantes primero: los entrenados más recientemente.
  const exercises: CoachExerciseContext[] = [...variants]
    .sort((a, b) => a.daysSinceLast - b.daysSinceLast)
    .slice(0, CONTEXT_LIMITS.exercises)
    .map((v) => {
      const source = context.variants.find((c) => c.variantId === v.variantId)!;
      const recent = source.exposures.slice(
        -CONTEXT_LIMITS.exposuresPerExercise,
      );
      const rx = source.prescription;
      const totalRepTrend = recent.map((e) =>
        e.sets.reduce((a, s) => a + s.reps, 0),
      );
      const equivalentLoadTrend = recent.map((e) => {
        const best = e.sets.reduce(
          (acc, s) =>
            Math.max(acc, equivalentLoad(s.weightKg, s.reps, rx.repRangeMin)),
          0,
        );
        return round1(best);
      });
      const first = equivalentLoadTrend[0];
      const last = equivalentLoadTrend[equivalentLoadTrend.length - 1];
      const e1rms = recent
        .flatMap((e) =>
          e.sets.map((s) => estimateOneRepMax(s.weightKg, s.reps, s.rir)),
        )
        .filter((x): x is number => x !== null);

      return {
        exercise: v.exerciseName,
        variant: v.variantName,
        prescription: `${rx.plannedSets}×${rx.repRangeMin}–${rx.repRangeMax} @${rx.targetRir} RIR (incremento ${rx.loadStepKg} kg)`,
        exposures: v.exposures,
        daysSinceLast: v.daysSinceLast,
        recentSets: recent.map((e) => `${e.localDate}: ${fmtSets(e.sets)}`),
        totalRepTrend,
        equivalentLoadTrend,
        equivalentLoadTrendPct:
          recent.length >= 2 && first > 0
            ? round1(((last - first) / first) * 100)
            : null,
        bestRecentE1rm: e1rms.length > 0 ? Math.max(...e1rms) : null,
        progression: {
          action: v.suggestion.action,
          reasonCode: v.suggestion.reasonCode,
          suggestedWeightKg: v.suggestion.suggestedWeightKg,
          suggestedReps: v.suggestion.suggestedReps,
          confidence: v.suggestion.confidence,
          explanation: v.suggestion.explanation,
        },
        signals: v.suggestion.signals.map((s) => s.message),
        plateaued: v.plateaued,
        regressed: v.regressed,
      };
    });

  const avgCompletion =
    context.sessions.length > 0
      ? context.sessions.reduce((a, s) => a + s.completionRate, 0) /
        context.sessions.length
      : 0;

  return {
    meta: {
      todayLocalDate: context.todayLocalDate,
      windowDays: fatigue.numbers.windowDays,
      progressionEngine: variants[0]?.suggestion.engineVersion ?? "n/a",
      fatigueEngine: fatigue.engineVersion,
    },
    profile: {
      goal: profile.goal,
      strategy: profile.strategy,
      experienceLevel: profile.experienceLevel,
      daysPerWeek: profile.daysPerWeek,
    },
    adherence: {
      sessionsInWindow: context.sessions.length,
      avgCompletionRate: round1(avgCompletion * 100) / 100,
      weeksSinceDeload: context.weeksSinceDeload,
    },
    sessions,
    exercises,
    fatigue: {
      level: fatigue.level,
      decision: fatigue.decision,
      score: fatigue.score,
      objectiveScore: fatigue.objectiveScore,
      confidence: fatigue.confidence,
      signals: fatigue.signals.map((s) => s.message),
      jointPain: fatigue.jointPain.message,
      plan: fatigue.plan?.summary ?? null,
      explanation: fatigue.explanation,
    },
    limits: {
      e1rmErrorPct: 5,
      rirErrorReps: 1,
      notes: [
        "El e1RM es una estimación: variaciones menores del 5 % son ruido, no tendencia.",
        "El RIR autoinformado tiene ~1 repetición de error típico.",
        "Sin RIR registrado (`@` ausente) no se puede valorar el esfuerzo de esa serie.",
        "Las series efectivas son una convención contable, no una medida fisiológica.",
      ],
    },
    notAvailable: POTENTIALLY_MISSING.filter((m) => !available.has(m)),
  };
}

/** Recorta el contexto si se pasa del tope de caracteres (control de coste). */
export function serializeContext(
  context: CoachContext,
  maxChars: number,
): string {
  let json = JSON.stringify(context);
  if (json.length <= maxChars) return json;
  // Primero se recortan las sesiones y luego los ejercicios: lo que decide es
  // el estado actual, no la cola del historial.
  const trimmed: CoachContext = {
    ...context,
    sessions: context.sessions.slice(-6),
    exercises: context.exercises.slice(0, 8).map((e) => ({
      ...e,
      recentSets: e.recentSets.slice(-2),
    })),
  };
  json = JSON.stringify(trimmed);
  if (json.length <= maxChars) return json;
  return JSON.stringify({
    ...trimmed,
    sessions: trimmed.sessions.slice(-3),
    exercises: trimmed.exercises.slice(0, 5),
  });
}
