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
  /** No se envía al modelo: se usa para enfocar el contexto. */
  variantId: string;
  exercise: string;
  variant: string;
  prescription: string;
  /**
   * Escalón de carga de la prescripción, en kg.
   *
   * Va TIPADO y no solo dentro del texto de `prescription` porque el guardrail
   * necesita una fuente autorizada para él: la regla 1 del system prompt manda
   * citar el incremento ("el siguiente escalón son 2,5 kg") y sin este campo
   * esa cifra se bloqueaba como carga inventada — el filtro tiraba justo la
   * frase que el prompt había pedido.
   */
  loadStepKg: number;
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

/**
 * Bloque CORPORAL del contexto (B6).
 *
 * Todo viene YA CALCULADO por `src/core/body` y `src/core/insights`. Al modelo
 * no se le pide que derive una tendencia, ni que compare con el objetivo, ni
 * que decida si un cambio de cintura es significativo: se le dan los veredictos
 * y sus márgenes de error, y su trabajo es explicarlos.
 *
 * QUÉ NO ESTÁ AQUÍ, y es deliberado:
 *   · La serie cruda de pesajes. Con ella el modelo podría "recalcular" una
 *     tendencia distinta de la del motor, que es justo lo que la arquitectura
 *     prohíbe. Solo viaja el veredicto.
 *   · La pendiente cuando el motor la ha declarado no afirmable. Con
 *     `INCONCLUSIVE` el número existe pero `slopeKgPerWeek` va a `null`: si no
 *     se puede afirmar en pantalla, tampoco se le puede dar al modelo.
 */
export interface CoachBodyContext {
  goal: {
    strategy: string;
    goalType: string;
    /** % del peso corporal por semana. Negativo = pérdida. */
    targetPctPerWeek: number;
    targetKgPerWeek: number | null;
    targetWeightKg: number | null;
    kgToTargetWeight: number | null;
    /** Día en que empezó la fase actual. La tendencia solo mira desde aquí. */
    phaseStartLocalDate: string | null;
  } | null;
  weight: {
    /** LOSING | GAINING | MAINTAINING | INCONCLUSIVE | INSUFFICIENT_DATA. */
    status: string;
    reasonCode: string;
    /** SOLO si el motor la respalda. `null` con INCONCLUSIVE. */
    slopeKgPerWeek: number | null;
    ciLowPerWeek: number | null;
    ciHighPerWeek: number | null;
    windowDays: number | null;
    /** Pesajes usados: también es la adherencia al registro. */
    measurementsInWindow: number;
    latestKg: number | null;
    /** Valor suavizado. Es el que representa "cuánto pesas" de verdad. */
    latestEmaKg: number | null;
    totalChangeKg: number | null;
  };
  waist: {
    status: string;
    latestCm: number | null;
    /** Cambio ajustado sobre el periodo. */
    fittedChangeCm: number | null;
    /** Por debajo de esto, el cambio no se distingue del error de la cinta. */
    minDetectableChangeCm: number;
    /** SINGLE | MEAN_OF_THREE | MIXED. Determina el umbral de arriba. */
    protocol: string | null;
    measurementsUsed: number;
  } | null;
  bodyFat: {
    status: string;
    /** Estimación, NUNCA una medición. Su error va en `limits`. */
    latestPct: number | null;
    reliability: string | null;
    /** El dato que sí sirve: el cambio entre lecturas comparables. */
    changePp: number | null;
    minInterpretableChangePp: number;
    spanDays: number | null;
  } | null;
  checkIn: {
    status: string;
    daysSinceLast: number | null;
    intervalDays: number;
  };
  /**
   * Veredicto del motor de insights cruzando cuerpo y rendimiento. Se manda
   * para que el modelo EXPLIQUE la conclusión determinista en vez de fabricar
   * la suya: `goalAssessmentCode` es `null` cuando el motor decidió que no hay
   * nada defendible que decir, y entonces el modelo tampoco puede decirlo.
   */
  insight: {
    observationCode: string;
    goalAssessmentCode: string | null;
  } | null;
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
    /** Porcentaje entero (91), no fracción: el modelo lo cita tal cual. */
    avgCompletionPct: number;
    /** Sesiones de descarga en la ventana (excluidas del porcentaje). */
    sesionesDeDescarga: number;
    weeksSinceDeload: number | null;
  };
  sessions: Array<{
    date: string;
    template: string;
    setsLogged: number;
    setsPlanned: number;
    /** Descarga ejecutada: el recorte de series fue deliberado. */
    descarga: boolean;
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
  /** Seguimiento corporal. `null` si el perfil no tiene ninguna medición. */
  body: CoachBodyContext | null;
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
  /** Bloque corporal ya calculado, o `null` si no hay ninguna medición. */
  body: CoachBodyContext | null = null,
  /**
   * Variante sobre la que se pregunta. Va SIEMPRE la primera, aunque no esté
   * entre las entrenadas más recientemente: en una rutina de 4 días los
   * ejercicios de hoy son justo los de mayor `daysSinceLast` y caían fuera del
   * corte, con lo que el coach acababa respondiendo sobre otro ejercicio.
   */
  focusVariantId?: string,
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
      descarga: s.deload,
      feedback: {
        rendimiento: s.perceivedPerformance,
        fatiga: s.fatigue,
        motivacion: s.motivation,
        dolorArticular: s.jointPain,
      },
      note: s.notes ? s.notes.slice(0, CONTEXT_LIMITS.noteChars) : null,
    }));

  // Los ejercicios más relevantes primero: el preguntado, y luego los
  // entrenados más recientemente.
  const exercises: CoachExerciseContext[] = [...variants]
    .sort((a, b) => {
      if (a.variantId === focusVariantId) return -1;
      if (b.variantId === focusVariantId) return 1;
      return a.daysSinceLast - b.daysSinceLast;
    })
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
        variantId: v.variantId,
        exercise: v.exerciseName,
        variant: v.variantName,
        prescription: `${rx.plannedSets}×${rx.repRangeMin}–${rx.repRangeMax} @${rx.targetRir} RIR (incremento ${rx.loadStepKg} kg)`,
        loadStepKg: rx.loadStepKg,
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

  // Las descargas se EXCLUYEN del promedio: incluirlas daba un 90 % de
  // adherencia a quien había completado el 100 % de lo que le tocaba, y luego
  // se le decía al modelo "no lo trates como falta de adherencia" mientras se
  // le pasaba un número ya contaminado que la regla 1 le prohíbe recalcular.
  const paraAdherencia = context.sessions.filter((s) => !s.deload);
  const avgCompletion =
    paraAdherencia.length > 0
      ? paraAdherencia.reduce((a, s) => a + (s.completionRate ?? 1), 0) /
        paraAdherencia.length
      : 1;

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
      // Entero. `round1(x*100)/100` devolvía 0.9129999999999999 por coma
      // flotante, y el modelo lo escribía literalmente en la respuesta.
      avgCompletionPct: Math.round(avgCompletion * 100),
      sesionesDeDescarga: context.sessions.length - paraAdherencia.length,
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
        // Márgenes del seguimiento corporal. Solo se mandan si hay cuerpo que
        // interpretar: si no, son ruido que ocupa contexto.
        ...(body
          ? [
              "El peso corporal oscila cerca de 1 kg entre días por agua, glucógeno y contenido digestivo: un pesaje suelto no es una tendencia.",
              "La tendencia de peso solo se afirma cuando su intervalo de confianza excluye el cero. Si `slopeKgPerWeek` es null, NO hay dirección que citar.",
              `Una cinta métrica en casa no distingue cambios de cintura menores de ${body.waist?.minDetectableChangeCm ?? 5.4} cm.`,
              "El % graso es una ESTIMACIÓN con varios puntos de error, no una medición. Solo el cambio entre lecturas del mismo método es interpretable, y solo a partir de 2 puntos.",
              "El peso y las cargas NO permiten deducir una causa: ni déficit, ni recuperación, ni sueño, ni pérdida de músculo. Son dos hechos a la vez.",
            ]
          : []),
      ],
    },
    // Solo se declara ausente lo que de verdad no está registrado: decirle al
    // modelo que no tenemos un dato que el usuario SÍ ha anotado es tan
    // dañino como dejar que lo invente.
    // El bloque corporal, cuando existe, PRUEBA que esas métricas están
    // registradas: declararlas ausentes teniéndolas delante es tan dañino
    // como inventarlas.
    notAvailable: POTENTIALLY_MISSING.filter(
      (m) =>
        !available.has(m) &&
        !(m === "peso corporal actual" && body?.weight.latestKg != null) &&
        !(m === "medidas corporales" && body?.waist != null),
    ),
    body,
  };
}

/** Recorta el contexto si se pasa del tope de caracteres (control de coste). */
/** Recorta una exposición manteniendo alineadas series y tendencias. */
function trimExercise(
  exercise: CoachExerciseContext,
  keep: number,
): CoachExerciseContext {
  return {
    ...exercise,
    recentSets: exercise.recentSets.slice(-keep),
    totalRepTrend: exercise.totalRepTrend.slice(-keep),
    equivalentLoadTrend: exercise.equivalentLoadTrend.slice(-keep),
  };
}

/**
 * Serializa el contexto respetando un tope DURO de caracteres. Se recorta por
 * pasos (primero la cola del historial, luego ejercicios) y, si aun así no
 * cabe, se trunca: `maxChars` es un límite, no una sugerencia.
 *
 * `<` se escapa a `\u003c` para que una nota del usuario no pueda cerrar el
 * delimitador `</APPLICATION_DATA>` del prompt. Sigue siendo JSON válido.
 */
export function serializeContext(
  context: CoachContext,
  maxChars: number,
): string {
  const encode = (value: CoachContext) =>
    JSON.stringify(value, (key, v) =>
      key === "variantId" ? undefined : v,
    ).replace(/</g, "\\u003c");

  const steps: CoachContext[] = [
    context,
    {
      ...context,
      sessions: context.sessions.slice(-6),
      exercises: context.exercises.slice(0, 8).map((e) => trimExercise(e, 2)),
    },
    {
      ...context,
      sessions: context.sessions.slice(-3),
      exercises: context.exercises.slice(0, 5).map((e) => trimExercise(e, 2)),
    },
  ];
  for (const step of steps) {
    const json = encode(step);
    if (json.length <= maxChars) return json;
  }
  return encode(steps[steps.length - 1]).slice(0, maxChars);
}
