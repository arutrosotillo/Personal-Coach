import { FATIGUE, FATIGUE_ENGINE_VERSION } from "@/core/config/training-config";
import { diffDays } from "@/core/dates";
import type { Confidence } from "@/core/enums";

/**
 * Motor de fatiga y deload reactivo (Fase 3.3). Puro y determinista.
 *
 * SOLO RECOMIENDA. No modifica el programa, ni las series, ni la carga, ni el
 * mesociclo: devuelve una evaluación con sus números y, si procede, un plan de
 * descarga que el usuario puede aceptar más adelante.
 *
 * Dos reglas que gobiernan todo el motor:
 *
 *  1. **Una mala sesión no es información.** Toda señal exige repetición
 *     (`SUSTAINED_COUNT`) o varios ejercicios afectados.
 *  2. **Lo subjetivo no basta.** Recomendar una descarga exige al menos
 *     `MIN_OBJECTIVE_SCORE` puntos de señales OBJETIVAS (rendimiento medido).
 *     Tres chips malos seguidos no pueden, por sí solos, mandarte a descargar.
 *
 * La salud va por otra vía: el dolor articular NO puntúa, escala su propio
 * aviso y tiene precedencia (COACH_PHILOSOPHY §2).
 */

export type FatigueLevel = "LOW" | "MODERATE" | "HIGH" | "INSUFFICIENT_DATA";

export type FatigueSignalCode =
  | "PERFORMANCE_DECLINE"
  | "WIDESPREAD_PLATEAU"
  | "SESSION_COMPLETION_DROP"
  | "HIGH_FATIGUE_SUSTAINED"
  | "LOW_PERCEIVED_PERFORMANCE"
  | "LOW_MOTIVATION_SUSTAINED"
  | "SINGLE_LIFT_DECLINE"
  | "SEVERE_PERFORMANCE_DECLINE"
  | "LONG_ACCUMULATION";

export type JointPainLevel = "NONE" | "WATCH" | "ACTION";

export type DeloadDecision =
  "NO_DELOAD" | "DELOAD_WATCH" | "DELOAD_RECOMMENDED" | "INSUFFICIENT_DATA";

export interface FatigueSignal {
  code: FatigueSignalCode;
  /** Puntos que aporta al score. */
  weight: number;
  /**
   * Objetiva = medida sobre el rendimiento registrado. Conductual = lo que
   * hiciste (acortar sesiones), que correlaciona con la fatiga pero también
   * con la agenda. Subjetiva = chip del usuario. Calendario = paso del tiempo.
   * Solo las OBJETIVAS cuentan para la puerta de `MIN_OBJECTIVE_SCORE`.
   */
  kind: "OBJECTIVE" | "BEHAVIORAL" | "SUBJECTIVE" | "CALENDAR";
  /** Frase con los NÚMEROS que la disparan. Nunca "parece que...". */
  message: string;
  numbers: Record<string, number>;
}

/** Feedback de una sesión completada, tal y como se guarda (chips 1..5). */
export interface FatigueSessionInput {
  localDate: string;
  perceivedPerformance: number | null;
  fatigue: number | null;
  motivation: number | null;
  jointPain: number | null;
  /** Series de trabajo registradas ÷ previstas en esa sesión (0..1). */
  completionRate: number | null;
}

/** Resumen por ejercicio derivado del motor de progresión. */
export interface FatigueExerciseInput {
  variantId: string;
  name: string;
  /** El motor pidió bajar la carga o detectó que no permite el rango. */
  regressed: boolean;
  /** El motor emitió `PLATEAU_SIGNAL`. */
  plateaued: boolean;
  /** Días desde la última exposición (para no contar ejercicios abandonados). */
  daysSinceLast: number;
}

export interface FatigueInput {
  todayLocalDate: string;
  sessions: FatigueSessionInput[];
  exercises: FatigueExerciseInput[];
  /** Semanas de acumulación continua sin descarga (derivado, sin migración). */
  weeksSinceDeload: number | null;
}

export interface DeloadPlan {
  days: number;
  setFraction: number;
  minSetsPerExercise: number;
  loadChange: "KEEP" | "REDUCE_10_PCT";
  summary: string;
}

export interface FatigueAssessment {
  level: FatigueLevel;
  /**
   * Veredicto en una frase, con el recuento de señales. Es lo que se enseña en
   * pantalla: el detalle numérico de cada señal ya viaja en `signals`, y
   * repetirlo entero convertía la tarjeta en un muro de texto.
   */
  headline: string;
  score: number;
  objectiveScore: number;
  signals: FatigueSignal[];
  decision: DeloadDecision;
  /** Plan sugerido. SIEMPRE advisory: nada se aplica solo. */
  plan: DeloadPlan | null;
  jointPain: {
    level: JointPainLevel;
    message: string | null;
    numbers: Record<string, number>;
  };
  confidence: Confidence;
  explanation: string;
  engineVersion: string;
  numbers: {
    sessionsInWindow: number;
    exercisesTracked: number;
    windowDays: number;
    weeksSinceDeload: number | null;
  };
}

// ── Utilidades puras ──────────────────────────────────────────────────────

/** Lista de nombres acotada: con 50 ejercicios el mensaje era ilegible. */
function namesOf(items: { name: string }[], max = 4): string {
  const shown = items.slice(0, max).map((i) => i.name);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} y ${rest} más` : shown.join(", ");
}

const CONFIDENCE_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
const lowerOf = (a: Confidence, b: Confidence): Confidence =>
  CONFIDENCE_ORDER[a] <= CONFIDENCE_ORDER[b] ? a : b;

function countAtMost<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length;
}

/** Sesiones dentro de la ventana, de la más antigua a la más reciente. */
function withinWindow(
  sessions: FatigueSessionInput[],
  today: string,
  windowDays: number,
): FatigueSessionInput[] {
  return sessions
    .filter((s) => {
      // La cota inferior importa: sin ella una sesión fechada en el futuro
      // (dato corrupto, o un import) entraba en la ventana y podía disparar
      // una recomendación de descarga.
      const days = diffDays(s.localDate, today);
      return days >= 0 && days <= windowDays;
    })
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
}

// ── Motor ─────────────────────────────────────────────────────────────────

export function assessFatigue(
  input: FatigueInput,
  config = FATIGUE,
): FatigueAssessment {
  const sessions = withinWindow(
    input.sessions,
    input.todayLocalDate,
    config.WINDOW_DAYS,
  );
  // Solo ejercicios vivos: uno que no se toca desde hace un mes no dice nada
  // sobre la fatiga de esta semana.
  const exercises = input.exercises.filter(
    (e) => e.daysSinceLast <= config.WINDOW_DAYS,
  );
  const recent = sessions.slice(-config.RECENT_SESSIONS);

  const base = {
    sessionsInWindow: sessions.length,
    exercisesTracked: exercises.length,
    windowDays: config.WINDOW_DAYS,
    weeksSinceDeload: input.weeksSinceDeload,
  };

  // ── Dolor articular: vía separada, no puntúa, tiene precedencia ─────────
  const severePain = countAtMost(
    recent,
    (s) => s.jointPain !== null && s.jointPain >= config.JOINT_PAIN_SEVERE,
  );
  const mildPain = countAtMost(
    recent,
    (s) => s.jointPain !== null && s.jointPain >= config.JOINT_PAIN_MILD,
  );
  const jointPainLevel: JointPainLevel =
    severePain >= 1 || mildPain >= config.SUSTAINED_COUNT
      ? "ACTION"
      : mildPain >= 1
        ? "WATCH"
        : "NONE";
  const jointPain = {
    level: jointPainLevel,
    message:
      jointPainLevel === "ACTION"
        ? `Has reportado dolor articular ${severePain >= 1 ? `${config.JOINT_PAIN_SEVERE}/5 o más` : `${config.JOINT_PAIN_MILD}/5`} en ${severePain >= 1 ? severePain : mildPain} de las últimas ${recent.length} ${recent.length === 1 ? "sesión" : "sesiones"}. Antes que cualquier ajuste de carga: cambia o retira el ejercicio que te duele, y si persiste, consulta con un profesional.`
        : jointPainLevel === "WATCH"
          ? `Dolor articular ${config.JOINT_PAIN_MILD}/5 en una de las últimas ${recent.length} sesiones. De momento solo lo vigilo; si se repite, hay que cambiar el ejercicio.`
          : null,
    numbers: {
      severas: severePain,
      moderadas: mildPain,
      sesiones: recent.length,
    },
  };

  if (sessions.length < config.MIN_SESSIONS) {
    return {
      level: "INSUFFICIENT_DATA",
      headline: `Sin datos suficientes: ${sessions.length} ${sessions.length === 1 ? "sesión" : "sesiones"} en ${config.WINDOW_DAYS} días.`,
      score: 0,
      objectiveScore: 0,
      signals: [],
      decision: "INSUFFICIENT_DATA",
      plan: null,
      jointPain,
      confidence: "LOW",
      explanation: `Con ${sessions.length} ${sessions.length === 1 ? "sesión" : "sesiones"} en los últimos ${config.WINDOW_DAYS} días no puedo valorar tu fatiga. Con ${config.MIN_SESSIONS} podré.`,
      engineVersion: FATIGUE_ENGINE_VERSION,
      numbers: base,
    };
  }

  const signals: FatigueSignal[] = [];
  const add = (
    code: FatigueSignalCode,
    kind: FatigueSignal["kind"],
    message: string,
    numbers: Record<string, number>,
  ) => {
    signals.push({
      code,
      kind,
      weight: config.WEIGHTS[code],
      message,
      numbers,
    });
  };

  // ── Señales OBJETIVAS (rendimiento medido) ─────────────────────────────
  const regressed = exercises.filter((e) => e.regressed);
  const declineThreshold = Math.max(
    config.DECLINE_MIN_EXERCISES,
    Math.ceil(exercises.length * config.DECLINE_FRACTION),
  );
  // El peso escala con la FRACCIÓN afectada. Era plano: valía lo mismo que
  // cayeran 2 de 8 ejercicios que los 8 de 8, y como el tope objetivo quedaba
  // en 3 y el umbral de recomendación es 5, a quien el motor le había bajado la
  // carga en TODOS los levantamientos se le decía "lo vigilo" si no rellenaba
  // los chips — que son opcionales. La decisión no puede depender de un dato
  // opcional y subjetivo cuando el rendimiento medido ya está gritando.
  // Hacen falta las DOS cosas: una fracción alta y un número mínimo. Solo con
  // la fracción, 2 de 2 ejercicios seguidos ya era "colapso"; con un catálogo
  // pequeño eso pasa constantemente.
  const declineWidespread =
    regressed.length >= config.SEVERE_DECLINE_MIN_EXERCISES &&
    regressed.length / exercises.length >= config.SEVERE_DECLINE_FRACTION;
  if (regressed.length >= declineThreshold) {
    add(
      declineWidespread ? "SEVERE_PERFORMANCE_DECLINE" : "PERFORMANCE_DECLINE",
      "OBJECTIVE",
      `El rendimiento ha caído en ${regressed.length} de ${exercises.length} ejercicios (${namesOf(regressed)}): el motor ha tenido que bajar la carga, o llevas varias sesiones sin alcanzar el rango.`,
      { ejercicios: regressed.length, total: exercises.length },
    );
  } else if (regressed.length === 1) {
    // Crédito parcial. El sobrealcance suele empezar exactamente así: primero
    // cede el levantamiento más demandante y el resto aguanta. Vale 1 punto
    // objetivo —nunca basta por sí solo para recomendar una descarga— pero
    // deja de valer lo MISMO que "ningún ejercicio en caída", que era la
    // consecuencia de tener una puerta dura en 2 sin crédito parcial.
    add(
      "SINGLE_LIFT_DECLINE",
      "OBJECTIVE",
      `${regressed[0].name} ha ido hacia atrás, pero es el único: el resto de tus ejercicios no han caído. Cuando cae uno solo suele ser el ejercicio y no tu recuperación — revisa técnica, en qué puesto de la sesión lo haces y el descanso entre series antes de tocar nada más.`,
      { ejercicios: 1, total: exercises.length },
    );
  }

  const plateaued = exercises.filter((e) => e.plateaued);
  if (
    exercises.length > 0 &&
    plateaued.length / exercises.length >= config.PLATEAU_FRACTION &&
    plateaued.length >= 2
  ) {
    add(
      "WIDESPREAD_PLATEAU",
      "OBJECTIVE",
      `${plateaued.length} de ${exercises.length} ejercicios llevan varias exposiciones sin mejorar (${namesOf(plateaued)}).`,
      { enMeseta: plateaued.length, total: exercises.length },
    );
  }

  const measurable = recent.filter((s) => s.completionRate !== null);
  const shortSessions = countAtMost(
    measurable,
    (s) => (s.completionRate ?? 1) < config.COMPLETION_LOW,
  );
  if (shortSessions >= config.SUSTAINED_COUNT) {
    add(
      "SESSION_COMPLETION_DROP",
      "BEHAVIORAL",
      `Has acortado ${shortSessions} de las últimas ${measurable.length} sesiones (menos del ${Math.round(config.COMPLETION_LOW * 100)} % de las series previstas).`,
      { acortadas: shortSessions, sesiones: measurable.length },
    );
  }

  // ── Señales SUBJETIVAS (chips) — siempre exigen repetición ─────────────
  const highFatigue = countAtMost(
    recent,
    (s) => s.fatigue !== null && s.fatigue >= config.HIGH_FATIGUE,
  );
  if (highFatigue >= config.SUSTAINED_COUNT) {
    add(
      "HIGH_FATIGUE_SUSTAINED",
      "SUBJECTIVE",
      `Has reportado fatiga ≥${config.HIGH_FATIGUE}/5 en ${highFatigue} de las últimas ${recent.length} sesiones.`,
      { veces: highFatigue, sesiones: recent.length },
    );
  }

  const lowPerf = countAtMost(
    recent,
    (s) =>
      s.perceivedPerformance !== null &&
      s.perceivedPerformance <= config.LOW_PERFORMANCE,
  );
  if (lowPerf >= config.SUSTAINED_COUNT) {
    add(
      "LOW_PERCEIVED_PERFORMANCE",
      "SUBJECTIVE",
      `Has valorado tu rendimiento ≤${config.LOW_PERFORMANCE}/5 en ${lowPerf} de las últimas ${recent.length} sesiones.`,
      { veces: lowPerf, sesiones: recent.length },
    );
  }

  const lowMotivation = countAtMost(
    recent,
    (s) => s.motivation !== null && s.motivation <= config.LOW_MOTIVATION,
  );
  if (lowMotivation >= config.SUSTAINED_COUNT + 1) {
    add(
      "LOW_MOTIVATION_SUSTAINED",
      "SUBJECTIVE",
      `Motivación ≤${config.LOW_MOTIVATION}/5 en ${lowMotivation} de las últimas ${recent.length} sesiones. Es una señal de adherencia, no de fatiga: por sí sola no cambia nada.`,
      { veces: lowMotivation, sesiones: recent.length },
    );
  }

  // ── CALENDARIO: red suave, jamás suficiente por sí sola ────────────────
  if (
    input.weeksSinceDeload !== null &&
    input.weeksSinceDeload >= config.LONG_ACCUMULATION_WEEKS
  ) {
    add(
      "LONG_ACCUMULATION",
      "CALENDAR",
      `Llevas ${input.weeksSinceDeload} semanas entrenando sin una semana suave ni un parón. No es un motivo por sí solo —no hay evidencia de que descargar por calendario mejore las ganancias— pero suma al resto.`,
      { semanas: input.weeksSinceDeload },
    );
  }

  const score = signals.reduce((a, s) => a + s.weight, 0);
  const objectiveScore = signals
    .filter((s) => s.kind === "OBJECTIVE")
    .reduce((a, s) => a + s.weight, 0);

  const decision: DeloadDecision =
    score >= config.RECOMMEND_SCORE &&
    objectiveScore >= config.MIN_OBJECTIVE_SCORE
      ? "DELOAD_RECOMMENDED"
      : score >= config.WATCH_SCORE
        ? "DELOAD_WATCH"
        : "NO_DELOAD";

  const level: FatigueLevel =
    decision === "DELOAD_RECOMMENDED"
      ? "HIGH"
      : decision === "DELOAD_WATCH"
        ? "MODERATE"
        : "LOW";

  // Confianza en ESTE veredicto, sea cual sea. Dos ejes distintos:
  //   · cuántos datos hay (sesiones y ejercicios seguidos) → techo;
  //   · si el veredicto es "descarga", cuánta evidencia objetiva lo sostiene.
  // Antes solo miraba lo segundo, así que un "estás perfectamente" apoyado en
  // 12 sesiones limpias salía con confianza BAJA: la lectura invertida.
  const dataConfidence: Confidence =
    sessions.length >= config.MIN_SESSIONS + 2 && exercises.length >= 2
      ? "HIGH"
      : sessions.length >= config.MIN_SESSIONS
        ? "MEDIUM"
        : "LOW";
  const confidence: Confidence =
    decision === "NO_DELOAD"
      ? dataConfidence
      : objectiveScore >= 3
        ? dataConfidence
        : objectiveScore >= 2
          ? lowerOf(dataConfidence, "MEDIUM")
          : "LOW";

  const plan: DeloadPlan | null =
    decision === "DELOAD_RECOMMENDED"
      ? {
          days: config.DELOAD_PLAN.DAYS,
          setFraction: config.DELOAD_PLAN.SET_FRACTION,
          minSetsPerExercise: config.DELOAD_PLAN.MIN_SETS_PER_EXERCISE,
          loadChange: jointPainLevel === "ACTION" ? "REDUCE_10_PCT" : "KEEP",
          summary:
            jointPainLevel === "ACTION"
              ? `Una semana: la mitad de las series (mínimo ${config.DELOAD_PLAN.MIN_SETS_PER_EXERCISE} por ejercicio), el mismo RIR objetivo y −${Math.round(config.DELOAD_PLAN.LOAD_REDUCTION_WITH_PAIN * 100)} % de carga. Normalmente en una descarga se recortaría solo el volumen y se dejarían los kilos —la carga alta es lo que conserva la fuerza—, pero con dolor articular manda la articulación.`
              : `Una semana: la mitad de las series (mínimo ${config.DELOAD_PLAN.MIN_SETS_PER_EXERCISE} por ejercicio), la misma carga y el mismo RIR objetivo de siempre. Se recorta el volumen y se dejan los kilos: mantener la exposición a carga alta es lo que conserva la fuerza.`,
        }
      : null;

  const objectiveCount = signals.filter((s) => s.kind === "OBJECTIVE").length;
  // "objetiva / no objetiva" obligaba al usuario a saber qué significan esas
  // etiquetas. Se cuentan señales (que puede contar él mismo en la lista de
  // abajo) y se nombra la categoría por lo que es: rendimiento medido.
  const total = signals.length;
  const tally = `${total} ${total === 1 ? "señal" : "señales"}${
    objectiveCount === 0
      ? ", ninguna de rendimiento medido"
      : total === 1
        ? " de rendimiento medido"
        : `, ${objectiveCount === 1 ? "una de ellas" : `${objectiveCount} de ellas`} de rendimiento medido`
  }`;

  // "Sigue con el plan" no se dice si hay dolor articular accionable: el
  // titular no miraba el dolor y quedaba justo encima de un aviso rojo que
  // manda retirar el ejercicio y consultar con un profesional.
  const sigueConElPlan =
    jointPainLevel === "ACTION"
      ? " Pero atento al aviso de dolor de abajo."
      : " Sigue con el plan.";
  const headline =
    decision === "DELOAD_RECOMMENDED"
      ? `Te recomiendo una semana de descarga: ${tally}. No la aplico, la decides tú.`
      : decision === "DELOAD_WATCH"
        ? `${tally}: no basta para recomendarte una descarga, pero lo vigilo.`
        : signals.length > 0
          ? `${tally}, nada que indique fatiga acumulada.${sigueConElPlan}`
          : `Sin señales de fatiga en ${sessions.length} ${sessions.length === 1 ? "sesión" : "sesiones"} de ${config.WINDOW_DAYS} días.${sigueConElPlan}`;

  // Explicación LARGA con todos los números: la consume Coach AI y el fallback
  // determinista, no la tarjeta (que ya lista las señales una a una).
  const explanation =
    signals.length > 0
      ? `${signals.map((s) => s.message).join(" ")} ${headline}`
      : headline;

  return {
    level,
    headline,
    score,
    objectiveScore,
    signals,
    decision,
    plan,
    jointPain,
    confidence,
    explanation,
    engineVersion: FATIGUE_ENGINE_VERSION,
    numbers: base,
  };
}
