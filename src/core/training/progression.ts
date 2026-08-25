import {
  PROGRESSION,
  PROGRESSION_ENGINE_VERSION,
  RECENCY,
} from "@/core/config/training-config";
import { diffDays } from "@/core/dates";
import type { Confidence } from "@/core/enums";

/**
 * Motor de progressive overload (v2 — Fase 3.2b). Puro y determinista: mismos
 * inputs → misma salida. SOLO sugiere: nunca modifica el programa, ni el
 * volumen, ni recomienda deload. Ver docs/TRAINING_ENGINE_FINAL_AUDIT.md.
 *
 * Filosofía: double progression (primero repeticiones dentro del rango, después
 * carga), decidida sobre TENDENCIA y no sobre una sola sesión. Una mala sesión
 * nunca baja la carga; dos exposiciones comparables sí.
 *
 * Escalera de decisión (la primera regla que aplica gana):
 *   0. NO_HISTORY               → START
 *   1. SESSION_INCOMPLETE       → HOLD
 *   2. REPEATED_UNDERPERFORMANCE→ DECREASE_LOAD
 *   3. rango cerrado:
 *        a. esfuerzo mayor del prescrito, 1ª vez → HOLD  (CLOSED_RANGE_AT_FAILURE)
 *        b. sin carga externa cuantificable      → ADD_REP (NO_LOAD_STEP / _CAPPED)
 *        c. el salto cabe en el rango            → INCREASE_LOAD
 *        d. el salto NO cabe en el rango         → ADD_REP (EXTEND_RANGE)
 *   4. ONE_OFF_UNDERPERFORMANCE → HOLD
 *   5. NEAR_FAILURE_HOLD        → HOLD
 *   6. ADD_REP                  → ADD_REP  (sube la serie más floja)
 *   7. HOLD_DEFAULT             → HOLD
 *
 * La señal de meseta (PLATEAU_SIGNAL) es INFORMATIVA: viaja en `signals` y
 * nunca sustituye ni altera la acción.
 */

export type ProgressionAction =
  "START" | "INCREASE_LOAD" | "ADD_REP" | "HOLD" | "DECREASE_LOAD";

export type ProgressionReasonCode =
  | "NO_HISTORY"
  | "SESSION_INCOMPLETE"
  | "REPEATED_UNDERPERFORMANCE"
  | "CLOSED_RANGE_AT_FAILURE"
  | "INCOMPLETE_FOR_INCREASE"
  | "NEEDS_RIR_CONFIRMATION"
  | "ATYPICAL_LOAD_DROP"
  /** No lo emite el motor: lo pone `applyRecoveryVeto` (dolor o descarga). */
  | "RECOVERY_VETO"
  | "MIXED_LOADS"
  | "STUCK_BELOW_RANGE"
  | "RANGE_CLOSED"
  | "RANGE_CLOSED_AFTER_FAILURE"
  | "LOAD_CLEARLY_TOO_LIGHT"
  | "EXTEND_RANGE"
  | "STEP_TOO_BIG_FOR_RANGE"
  | "NO_LOAD_STEP"
  | "NO_LOAD_STEP_CAPPED"
  | "ONE_OFF_UNDERPERFORMANCE"
  | "NEAR_FAILURE_HOLD"
  | "ADD_REP"
  | "STALE_HISTORY"
  | "HOLD_DEFAULT";

export type ProgressionSignalCode =
  | "PLATEAU_SIGNAL"
  | "MIXED_LOADS"
  /** No lo emite el motor: guarda la subida que `applyRecoveryVeto` suspendió. */
  | "VETO_SUSPENDED_INCREASE";

export interface ProgressionSignal {
  code: ProgressionSignalCode;
  message: string;
  numbers: Record<string, number>;
}

export interface ProgressionPrescription {
  repRangeMin: number;
  repRangeMax: number;
  targetRir: number;
  /** Menor incremento del material. `0` = ejercicio sin carga cuantificable. */
  loadStepKg: number;
  plannedSets: number;
}

export interface ProgressionSet {
  weightKg: number;
  reps: number;
  /** `null` = el usuario NO lo registró. Jamás se imputa al objetivo. */
  rir: number | null;
}

/** Una sesión válida de la variante (solo series de TRABAJO completadas). */
export interface ProgressionExposure {
  localDate?: string;
  sets: ProgressionSet[];
}

export interface ProgressionInput {
  prescription: ProgressionPrescription;
  /** Exposiciones de la variante, de la MÁS ANTIGUA a la MÁS RECIENTE. */
  history: ProgressionExposure[];
  /**
   * Día del usuario (Fase 3.3). Sin él, el motor no puede saber si el
   * historial es de la semana pasada o de hace dos meses y lo trata como
   * fresco. El tiempo NUNCA cambia la carga por sí solo: degrada la confianza,
   * rompe rachas separadas por huecos largos y suspende las subidas.
   */
  todayLocalDate?: string;
}

export interface ProgressionSuggestion {
  action: ProgressionAction;
  reasonCode: ProgressionReasonCode;
  suggestedWeightKg: number | null;
  /** Titular: objetivo de reps de la serie que marca el siguiente paso. */
  suggestedReps: number | null;
  /** Objetivo por serie para hoy (longitud = plannedSets). `null` en START. */
  setTargets: number[] | null;
  confidence: Confidence;
  explanation: string;
  /** Señales informativas. NUNCA cambian la acción. */
  signals: ProgressionSignal[];
  engineVersion: string;
  numbers: {
    pesoRef: number | null;
    loadStepKg: number;
    repRange: [number, number];
    targetRir: number;
    /** Series de la última exposición usadas para decidir. */
    n: number;
    plannedSets: number;
    /** Series sin RIR registrado en la última exposición. */
    missingRir: number;
    /** Exposiciones válidas disponibles en la ventana de historial. */
    exposures: number;
    /** Exposiciones consecutivas al mismo peso (incluida la última). */
    sameWeightRun: number;
    /** Días desde la última exposición (`-1` si no se conoce la fecha). */
    daysSinceLast: number;
  };
}

// ── Utilidades puras ──────────────────────────────────────────────────────

/** Mediana BAJA: con n par devuelve el menor de los dos centrales (conservador). */
function lowerMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Equivalencia carga↔repeticiones (Epley usado como modelo RELATIVO dentro de
 * la MISMA variante, nunca como afirmación sobre el 1RM): con qué repeticiones
 * se corresponde `reps` a `fromKg` si la carga pasa a `toKg`.
 */
export function equivalentReps(
  fromKg: number,
  reps: number,
  toKg: number,
): number {
  if (fromKg <= 0 || toKg <= 0) return reps;
  return 30 * ((fromKg * (1 + reps / 30)) / toKg - 1);
}

/**
 * Carga equivalente a `referenceReps` repeticiones. Es la misma matemática que
 * `equivalentReps`, expresada como carga: sirve como MÉTRICA DE TENDENCIA
 * comparable dentro de la misma variante, también en rangos altos donde el e1RM
 * no es honesto. No es una afirmación sobre el 1RM.
 */
export function equivalentLoad(
  weightKg: number,
  reps: number,
  referenceReps: number,
): number {
  if (weightKg <= 0) return 0;
  return (weightKg * (1 + reps / 30)) / (1 + referenceReps / 30);
}

/** Resumen determinista de una exposición, ya interpretado con la prescripción. */
interface ExposureSummary {
  localDate: string | null;
  sets: ProgressionSet[];
  n: number;
  weight: number;
  /** Peso máximo movido en la exposición (top set). */
  maxWeight: number;
  /** Las series NO se hicieron todas a la misma carga (top set + back-off…). */
  mixedLoads: boolean;
  reps: number[];
  minReps: number;
  medianReps: number;
  topReps: number;
  totalReps: number;
  missingRir: number;
  /** Menor RIR REGISTRADO; `null` si no se registró ninguno. */
  minKnownRir: number | null;
  /** Alguna serie claramente más dura de lo prescrito (fallo o casi). */
  harder: boolean;
  /** Rango consolidado: n−1 series al techo y ninguna bajo `repMax − 1`. */
  rangeClosed: boolean;
}

function summarize(
  exposure: ProgressionExposure,
  rx: ProgressionPrescription,
  config: typeof PROGRESSION,
): ExposureSummary {
  const sets = exposure.sets;
  const n = sets.length;
  const reps = sets.map((s) => s.reps);
  const knownRir = sets
    .map((s) => s.rir)
    .filter((r): r is number => r !== null);
  const minKnownRir = knownRir.length > 0 ? Math.min(...knownRir) : null;

  // Esfuerzo MAYOR del prescrito: RIR muy por debajo del objetivo, o fallo
  // absoluto cuando la prescripción pedía reserva. El RIR ausente NO cuenta:
  // no saber no es evidencia ni a favor ni en contra.
  const harder = knownRir.some(
    (r) => r < rx.targetRir - config.RIR_BAND || (r === 0 && rx.targetRir >= 2),
  );

  const atTop = reps.filter((r) => r >= rx.repRangeMax).length;
  const rangeClosed =
    n > 0 &&
    atTop >= Math.max(n - 1, 1) &&
    Math.min(...reps) >= rx.repRangeMax - 1;

  const weights = sets.map((s) => s.weightKg);
  return {
    localDate: exposure.localDate ?? null,
    sets,
    n,
    weight: n > 0 ? lowerMedian(weights) : 0,
    maxWeight: n > 0 ? Math.max(...weights) : 0,
    mixedLoads: new Set(weights).size > 1,
    reps,
    minReps: n > 0 ? Math.min(...reps) : 0,
    medianReps: n > 0 ? lowerMedian(reps) : 0,
    topReps: n > 0 ? Math.max(...reps) : 0,
    totalReps: reps.reduce((a, b) => a + b, 0),
    missingRir: sets.filter((s) => s.rir === null).length,
    minKnownRir,
    harder,
    rangeClosed,
  };
}

/** Objetivos por serie para hoy, con la longitud de `plannedSets`. */
function padTargets(values: number[], plannedSets: number): number[] {
  if (values.length === 0) return [];
  const out = values.slice(0, plannedSets);
  while (out.length < plannedSets) out.push(values[values.length - 1]);
  return out;
}

/**
 * Objetivos por serie con TRINQUETE: ninguna serie pide menos de lo que ya
 * lograste en ese hueco con esta misma carga. Sin esto, un día flojo rebajaría
 * el objetivo de todas las series y se perdería el progreso ya consolidado
 * (además de disparar falsas mesetas).
 */
function ratchetTargets(
  run: ExposureSummary[],
  weakestTarget: number,
  cap: number,
  plannedSets: number,
): number[] {
  // Suelo = la MEJOR exposición realmente ejecutada de la racha (más reps
  // totales; en empate, la más reciente). Nunca un máximo por hueco: componer
  // el récord de cada serie por separado pediría una sesión que jamás ocurrió.
  let best: ExposureSummary | null = null;
  for (const e of run) {
    if (best === null || e.totalReps >= best.totalReps) best = e;
  }
  const floors = best ? best.reps : [];
  return padTargets(
    (floors.length > 0 ? floors : [weakestTarget]).map((f) =>
      Math.min(Math.max(f, weakestTarget), cap),
    ),
    plannedSets,
  );
}

function uniformTargets(value: number, plannedSets: number): number[] {
  return Array.from({ length: plannedSets }, () => value);
}

// ── Motor ─────────────────────────────────────────────────────────────────

export function suggestProgression(
  input: ProgressionInput,
  config = PROGRESSION,
): ProgressionSuggestion {
  const rx = input.prescription;
  const { repRangeMin, repRangeMax, targetRir, loadStepKg, plannedSets } = rx;

  const base = {
    loadStepKg,
    repRange: [repRangeMin, repRangeMax] as [number, number],
    targetRir,
    plannedSets,
  };
  const empty = {
    pesoRef: null,
    ...base,
    n: 0,
    missingRir: 0,
    exposures: 0,
    sameWeightRun: 0,
    daysSinceLast: -1,
  };

  const window = input.history
    .filter((e) => e.sets.length > 0)
    .slice(-config.HISTORY_WINDOW);

  // ── 0. NO_HISTORY ───────────────────────────────────────────────────────
  if (window.length === 0) {
    return {
      action: "START",
      reasonCode: "NO_HISTORY",
      suggestedWeightKg: null,
      suggestedReps: repRangeMin,
      setTargets: null,
      confidence: "LOW",
      explanation: `Primera vez con este ejercicio: elige una carga con la que cierres ${repRangeMin} repeticiones dejando ~${targetRir} en reserva. Si te pasas, en cuanto se repita bajo la carga; no penaliza.`,
      signals: [],
      engineVersion: PROGRESSION_ENGINE_VERSION,
      numbers: empty,
    };
  }

  const minUsableSets = Math.max(
    1,
    Math.ceil(plannedSets * config.MIN_USABLE_SET_FRACTION),
  );
  const summaries = window.map((e) => summarize(e, rx, config));
  const usable = summaries.filter((s) => s.n >= minUsableSets);
  const last = summaries[summaries.length - 1];

  // ── Recencia (Fase 3.3) ─────────────────────────────────────────────────
  // Sin `todayLocalDate` el motor no puede saber si esto es de la semana
  // pasada o de hace dos meses; en ese caso lo trata como fresco (compatible
  // con las llamadas antiguas) y lo dice en `numbers.daysSinceLast = -1`.
  // `-1` significa "no lo sé" (llamada sin `todayLocalDate`). Una exposición
  // fechada mañana daba también -1 y se colaba como desconocida: se acota a 0.
  const daysSinceLast =
    input.todayLocalDate && last.localDate
      ? Math.max(0, diffDays(last.localDate, input.todayLocalDate))
      : -1;
  const recency: "FRESH" | "STALE" | "OLD" =
    daysSinceLast < 0
      ? "FRESH"
      : daysSinceLast >= RECENCY.OLD_MIN_DAYS
        ? "OLD"
        : daysSinceLast >= RECENCY.STALE_MIN_DAYS
          ? "STALE"
          : "FRESH";

  /** Un hueco largo entre dos exposiciones las hace incomparables. */
  const gapBreaks = (older: ExposureSummary, newer: ExposureSummary): boolean =>
    older.localDate !== null &&
    newer.localDate !== null &&
    diffDays(older.localDate, newer.localDate) >= RECENCY.RUN_GAP_DAYS;

  const numbersFor = (s: ExposureSummary, sameWeightRun: number) => ({
    pesoRef: s.weight,
    ...base,
    n: s.n,
    missingRir: s.missingRir,
    exposures: usable.length,
    sameWeightRun,
    daysSinceLast,
  });

  // ── 1. SESSION_INCOMPLETE ───────────────────────────────────────────────
  if (last.n < minUsableSets) {
    return {
      action: "HOLD",
      reasonCode: "SESSION_INCOMPLETE",
      suggestedWeightKg: last.weight,
      suggestedReps: repRangeMin,
      setTargets: uniformTargets(repRangeMin, plannedSets),
      confidence: "LOW",
      explanation: `Tu última sesión registró ${last.n} de ${plannedSets} series: con media sesión no ajusto nada. Repite ${last.weight} kg y complétala.`,
      signals: [],
      engineVersion: PROGRESSION_ENGINE_VERSION,
      numbers: numbersFor(last, 0),
    };
  }

  // Racha de exposiciones VÁLIDAS consecutivas al mismo peso de trabajo.
  const sameWeightRun: ExposureSummary[] = [];
  for (let i = usable.length - 1; i >= 0; i--) {
    if (usable[i].weight !== last.weight) break;
    const newer = sameWeightRun[0];
    if (newer && gapBreaks(usable[i], newer)) break;
    sameWeightRun.unshift(usable[i]);
  }

  const numbers = numbersFor(last, sameWeightRun.length);
  const loadable = loadStepKg > 0;

  // Confianza: el RIR ausente NUNCA sube la confianza (§F3.2c).
  const rawConfidence: Confidence =
    last.missingRir === last.n
      ? "LOW"
      : usable.length >= 3 &&
          last.missingRir === 0 &&
          last.n >= plannedSets &&
          last.n >= 2
        ? "HIGH"
        : usable.length >= 2
          ? "MEDIUM"
          : "LOW";
  // Un historial viejo no puede sostener una confianza alta.
  const confidence: Confidence =
    recency === "OLD"
      ? "LOW"
      : recency === "STALE" && rawConfidence === "HIGH"
        ? "MEDIUM"
        : rawConfidence;

  // Señal informativa de meseta: N exposiciones al mismo peso sin batir el
  // mejor total de repeticiones alcanzado a ese peso. No altera la acción.
  const signals: ProgressionSignal[] = [];

  // Aviso de esquema con cargas mezcladas (top set + back-off, drop-sets): el
  // motor razona sobre UNA carga de trabajo, así que su lectura es parcial.
  if (last.mixedLoads) {
    signals.push({
      code: "MIXED_LOADS",
      message: `Las series no fueron todas al mismo peso (${last.sets.map((x) => `${x.weightKg}×${x.reps}`).join(" · ")}). Razono sobre ${last.weight} kg; en esquemas de serie top + descarga la sugerencia es solo orientativa.`,
      numbers: { pesoRef: last.weight, pesoMax: last.maxWeight, n: last.n },
    });
  }

  if (sameWeightRun.length >= config.PLATEAU_EXPOSURES) {
    const totals = sameWeightRun.map((s) => s.totalReps);
    const best = Math.max(...totals);
    const sinceBest = totals.length - 1 - totals.indexOf(best);
    const shown = totals.slice(-config.PLATEAU_EXPOSURES);
    const improvingWindow = shown[shown.length - 1] > shown[0];
    if (sinceBest >= config.PLATEAU_EXPOSURES - 1 && !improvingWindow) {
      signals.push({
        code: "PLATEAU_SIGNAL",
        message: `En las últimas ${shown.length} exposiciones con ${last.weight} kg: ${shown.join(" → ")} repeticiones totales. No has superado tu mejor registro reciente.`,
        numbers: {
          pesoRef: last.weight,
          exposiciones: shown.length,
          mejorTotal: best,
          ultimoTotal: totals[totals.length - 1],
        },
      });
    }
  }

  const done = (
    s: Omit<
      ProgressionSuggestion,
      "signals" | "engineVersion" | "numbers" | "confidence"
    > & { confidence?: Confidence },
  ): ProgressionSuggestion => ({
    ...s,
    confidence: s.confidence ?? confidence,
    signals,
    engineVersion: PROGRESSION_ENGINE_VERSION,
    numbers,
  });

  // ── 1b. ATYPICAL_LOAD_DROP: la última carga cae muy por debajo de la
  //     anterior y encima con esfuerzo sobrado. Puede ser un error de tecleo o
  //     una descarga puntual; en ningún caso es evidencia para reanclar el
  //     ejercicio ahí. Se pide confirmarlo repitiéndolo.
  const previous = usable.length >= 2 ? usable[usable.length - 2] : null;
  if (
    previous !== null &&
    // Si entre las dos exposiciones hay un parón, la caída de carga no es
    // atípica: es exactamente lo que hay que hacer al volver.
    !gapBreaks(previous, last) &&
    previous.weight > 0 &&
    last.weight > 0 &&
    last.weight < previous.weight * config.ATYPICAL_DROP_FRACTION &&
    (last.minKnownRir === null || last.minKnownRir > targetRir)
  ) {
    const dropPct = Math.round((1 - last.weight / previous.weight) * 100);
    return done({
      action: "HOLD",
      reasonCode: "ATYPICAL_LOAD_DROP",
      suggestedWeightKg: previous.weight,
      suggestedReps: repRangeMin,
      setTargets: uniformTargets(repRangeMin, plannedSets),
      explanation: `Registraste ${last.weight} kg, un ${dropPct} % menos que la sesión anterior (${previous.weight} kg), y con esfuerzo de sobra. Si fue un error de registro, corrígelo; si bajaste a propósito, repítelo y lo tomo como tu nueva referencia. De momento sigo con ${previous.weight} kg.`,
    });
  }

  // ── 2. REPEATED_UNDERPERFORMANCE → DECREASE_LOAD ────────────────────────
  // Dos exposiciones consecutivas al mismo peso con la MEDIANA por debajo del
  // mínimo del rango y sin señales de haberse guardado (RIR conocido > objetivo
  // = se paró lejos, eso no es un problema de carga).
  const notSandbagging = (s: ExposureSummary) =>
    s.minKnownRir === null || s.minKnownRir <= targetRir + config.RIR_BAND;
  const underRun: ExposureSummary[] = [];
  let underRef = last.weight;
  for (let i = usable.length - 1; i >= 0; i--) {
    const s = usable[i];
    if (s.weight > underRef) break; // ya había bajado por su cuenta
    if (s.medianReps >= repRangeMin || !notSandbagging(s)) break;
    const newer = underRun[0];
    if (newer && gapBreaks(s, newer)) break;
    underRun.unshift(s);
    underRef = s.weight;
  }

  // Racha al mismo peso por debajo del mínimo, IGNORANDO el RIR: es la salida
  // que impide que un RIR alto (mal calibrado, o por dolor) atrape al usuario.
  const stuckBelowRun: ExposureSummary[] = [];
  for (let i = sameWeightRun.length - 1; i >= 0; i--) {
    if (sameWeightRun[i].medianReps >= repRangeMin) break;
    stuckBelowRun.unshift(sameWeightRun[i]);
  }
  const stuckBelow = stuckBelowRun.length >= config.STUCK_EXPOSURES;

  if (underRun.length >= config.DECREASE_AFTER_EXPOSURES || stuckBelow) {
    const run =
      underRun.length >= config.DECREASE_AFTER_EXPOSURES
        ? underRun
        : stuckBelowRun;
    const reasonCode: ProgressionReasonCode =
      underRun.length >= config.DECREASE_AFTER_EXPOSURES
        ? "REPEATED_UNDERPERFORMANCE"
        : "STUCK_BELOW_RANGE";
    const medians = run.map((s) => s.medianReps);
    const sameLoadRun = run.every((s) => s.weight === last.weight);
    const anchor = Math.min(...run.map((s) => s.weight));
    const worstMedian = Math.min(...medians);
    const where = sameLoadRun ? ` en ${last.weight} kg` : "";
    const detail =
      reasonCode === "STUCK_BELOW_RANGE"
        ? `${run.length} sesiones seguidas${where} sin llegar a ${repRangeMin} reps (mediana ${medians.join(", ")}). Da igual cómo se sienta el esfuerzo: la carga no permite el rango`
        : `${run.length} ${run.length === 1 ? "sesión" : "sesiones"} seguidas por debajo de ${repRangeMin} reps${where} (mediana ${medians.join(", ")})`;
    if (loadable && anchor > loadStepKg) {
      // La bajada se dimensiona con la equivalencia carga↔reps: la carga que
      // SÍ dejaría el mínimo del rango. Nunca menos de un incremento, nunca
      // más de MAX_DECREASE_FRACTION.
      const equivalent =
        (anchor * (1 + worstMedian / 30)) / (1 + repRangeMin / 30);
      const floorLimit = anchor * (1 - config.MAX_DECREASE_FRACTION);
      const targetWeight = Math.max(equivalent, floorLimit);
      const steps = Math.max(
        config.DECREASE_STEPS,
        Math.floor((anchor - targetWeight) / loadStepKg + 1e-9),
      );
      const newWeight = round3(anchor - steps * loadStepKg);
      if (newWeight > 0) {
        return done({
          action: "DECREASE_LOAD",
          reasonCode,
          suggestedWeightKg: newWeight,
          suggestedReps: repRangeMin,
          setTargets: uniformTargets(repRangeMin, plannedSets),
          explanation: `${detail}. Con esas repeticiones, la carga que sí te deja el rango ronda los ${newWeight} kg: baja ahí y reconstruye.`,
        });
      }
    }
    return done({
      action: "HOLD",
      reasonCode,
      suggestedWeightKg: last.weight,
      suggestedReps: repRangeMin,
      setTargets: uniformTargets(repRangeMin, plannedSets),
      explanation: loadable
        ? `${detail}. Ya estás en el escalón más bajo que puedo proponerte con incrementos de ${loadStepKg} kg: usa una variante más fácil o recorta el recorrido.`
        : `${detail}. Este ejercicio no tiene carga externa que quitar: usa una variante más fácil (menos recorrido, una banda más suave o versión asistida).`,
    });
  }

  // ── 3. Rango cerrado ────────────────────────────────────────────────────
  if (last.rangeClosed) {
    // 3a. Esfuerzo mayor del prescrito: se consolida una vez; a la segunda se
    //     sube igualmente (nunca dejar al usuario atrapado).
    const failureRun: ExposureSummary[] = [];
    for (let i = sameWeightRun.length - 1; i >= 0; i--) {
      const s = sameWeightRun[i];
      if (!s.rangeClosed || !s.harder) break;
      failureRun.unshift(s);
    }
    const afterFailure = failureRun.length >= config.FAILURE_PATIENCE_EXPOSURES;
    if (last.harder && !afterFailure) {
      return done({
        action: "HOLD",
        reasonCode: "CLOSED_RANGE_AT_FAILURE",
        suggestedWeightKg: last.weight,
        suggestedReps: repRangeMax,
        setTargets: uniformTargets(repRangeMax, plannedSets),
        explanation: `Cerraste el rango (${last.topReps} reps) con más esfuerzo del previsto: ${last.minKnownRir === 0 ? "llegaste al fallo" : `te quedaste a ${last.minKnownRir} en reserva`}, y el objetivo es ${targetRir}. Repite ${last.weight} kg buscando dejar ${targetRir}; si vuelves a cerrarlo así, subimos igualmente.`,
      });
    }

    // 3a-bis. Historial viejo: no se progresa sobre un rendimiento que puede
    // tener semanas. El tiempo NO baja la carga por sí solo; lo que hace es
    // suspender el avance hasta reconfirmar. Va ANTES de las ramas sin carga
    // externa: a peso corporal el desentrenamiento pega antes, no después.
    if (recency !== "FRESH") {
      const semanas = Math.round(daysSinceLast / 7);
      const cuando = `hace ${semanas} ${semanas === 1 ? "semana" : "semanas"}`;
      return done({
        action: "HOLD",
        reasonCode: "STALE_HISTORY",
        suggestedWeightKg: last.weight,
        suggestedReps: repRangeMax,
        setTargets: ratchetTargets(
          sameWeightRun,
          Math.min(last.minReps, repRangeMax),
          repRangeMax,
          plannedSets,
        ),
        explanation: loadable
          ? `Cerraste el rango, pero hace ${semanas} ${semanas === 1 ? "semana" : "semanas"} de esa sesión. Vuelve con ${last.weight} kg para reconfirmar: si sale, subimos. No te bajo la carga por el parón.`
          : `Cerraste el rango, pero de eso ${cuando}. Repite las mismas repeticiones para reconfirmar antes de pedirte más; si sale, seguimos sumando. No te bajo el objetivo por el parón.`,
      });
    }

    // 3b. Sin carga externa cuantificable: se progresa por repeticiones.
    if (!loadable) {
      const cap = repRangeMax + config.RANGE_EXTENSION_CAP;
      const plateauedAtTop =
        signals.some((x) => x.code === "PLATEAU_SIGNAL") &&
        last.minReps >= repRangeMax;
      if (last.minReps < cap && !plateauedAtTop) {
        const target = Math.min(last.minReps + 1, cap);
        const setTargets = ratchetTargets(
          sameWeightRun,
          target,
          cap,
          plannedSets,
        );
        return done({
          action: "ADD_REP",
          reasonCode: "NO_LOAD_STEP",
          suggestedWeightKg: last.weight,
          suggestedReps: Math.min(...setTargets),
          setTargets,
          explanation: `Este ejercicio no tiene carga externa que pueda cuantificar: se progresa con repeticiones y recorrido. Hiciste ${last.reps.join("/")}: busca ${setTargets.join("/")} manteniendo la técnica.`,
        });
      }
      return done({
        action: "HOLD",
        reasonCode: "NO_LOAD_STEP_CAPPED",
        suggestedWeightKg: last.weight,
        suggestedReps: cap,
        setTargets: uniformTargets(cap, plannedSets),
        explanation: `Ya estás en ${last.minReps} reps y sin carga externa que añadir, y llevas varias sesiones sin sumar. Las repeticiones altas siguen sirviendo, pero a partir de aquí la serie la limita el ardor más que el músculo: pasa a una variante más difícil (más recorrido, una banda más dura o versión unilateral).`,
      });
    }

    // 3b-bis. Peso corporal sin lastre registrado (0 kg): no hay base sobre la
    // que calcular una equivalencia relativa, así que se añade el primer
    // incremento y se pide una repetición menos. [HEURÍSTICA]
    if (last.weight <= 0) {
      const target = Math.min(
        repRangeMax,
        Math.max(repRangeMin, last.medianReps - 1),
      );
      return done({
        action: "INCREASE_LOAD",
        reasonCode: "RANGE_CLOSED",
        suggestedWeightKg: loadStepKg,
        suggestedReps: target,
        setTargets: uniformTargets(target, plannedSets),
        explanation: `Cerraste ${last.medianReps} reps a peso corporal: añade ${loadStepKg} kg de lastre y busca ${target} reps. Aquí solo cuento el lastre, así que el objetivo es aproximado.`,
      });
    }

    // 3b-ter. Media sesión no sube la carga. La serie que falta suele ser la
    // última, que es justo la que más informa sobre si la carga aguanta.
    if (last.n < plannedSets) {
      const setTargets = uniformTargets(repRangeMax, plannedSets);
      return done({
        action: "ADD_REP",
        reasonCode: "INCOMPLETE_FOR_INCREASE",
        suggestedWeightKg: last.weight,
        suggestedReps: repRangeMax,
        setTargets,
        explanation: `Cerraste el rango, pero solo con ${last.n} de ${plannedSets} series. Repite ${last.weight} kg completando las ${plannedSets}: si aguanta, subimos.`,
      });
    }

    // 3b-quater. Sin ningún RIR registrado no hay forma de saber si el esfuerzo
    // fue el previsto: las repeticiones bastan como evidencia, pero se pide
    // verlo dos veces antes de mover la carga (es la misma exigencia de
    // tendencia que el motor aplica para bajar).
    if (last.missingRir === last.n) {
      const confirmed =
        sameWeightRun.length >= 2 &&
        sameWeightRun[sameWeightRun.length - 2].rangeClosed;
      if (!confirmed) {
        return done({
          action: "HOLD",
          reasonCode: "NEEDS_RIR_CONFIRMATION",
          suggestedWeightKg: last.weight,
          suggestedReps: repRangeMax,
          setTargets: uniformTargets(repRangeMax, plannedSets),
          explanation: `Cerraste ${last.medianReps} reps en ${last.weight} kg, pero sin RIR registrado no puedo valorar el esfuerzo. Repítelo: si vuelve a salir, subimos. Registrando el RIR subo a la primera.`,
        });
      }
    }

    // 3c/3d. Tamaño del salto: normalmente 1 incremento; 2 solo con un exceso
    // muy claro sobre el techo del rango, con esfuerzo compatible y con RIR
    // registrado (nunca un salto doble a ciegas). Tope relativo del 10 %.
    const overshoot = last.medianReps - repRangeMax;
    let steps = 1;
    if (
      overshoot >= config.DOUBLE_STEP_OVERSHOOT_REPS &&
      !last.harder &&
      last.missingRir === 0
    ) {
      steps = config.MAX_STEPS_PER_INCREASE;
    }
    while (
      steps > 1 &&
      (steps * loadStepKg) / last.weight > config.MAX_RELATIVE_STEP
    ) {
      steps -= 1;
    }

    const newWeight = round3(last.weight + steps * loadStepKg);
    const refReps = Math.max(last.medianReps, repRangeMax);
    const predicted = Math.round(
      equivalentReps(last.weight, refReps, newWeight),
    );
    // Tras cerrar el rango al fallo dos veces, aterrizar 1–2 reps por debajo
    // del mínimo es aceptable: esperar más no aporta nada.
    const acceptShortfall =
      afterFailure &&
      predicted >= repRangeMin - config.ACCEPTABLE_SHORTFALL_REPS;

    if (last.mixedLoads && newWeight <= last.maxWeight) {
      const setTargets = uniformTargets(repRangeMax, plannedSets);
      return done({
        action: "HOLD",
        reasonCode: "MIXED_LOADS",
        suggestedWeightKg: last.maxWeight,
        suggestedReps: repRangeMax,
        setTargets,
        explanation: `Cerraste el rango, pero las series fueron a pesos distintos (${last.sets.map((x) => `${x.weightKg}×${x.reps}`).join(" · ")}) y subir sobre ${last.weight} kg daría ${newWeight} kg, menos de los ${last.maxWeight} que ya moviste. No te bajo la carga: repite el esquema y, si quieres que progrese solo, haz las series al mismo peso.`,
      });
    }

    if (predicted >= repRangeMin || acceptShortfall) {
      const reasonCode: ProgressionReasonCode =
        steps > 1
          ? "LOAD_CLEARLY_TOO_LIGHT"
          : afterFailure && last.harder
            ? "RANGE_CLOSED_AFTER_FAILURE"
            : "RANGE_CLOSED";
      const tail =
        predicted > repRangeMax
          ? ` Sigue quedándose corta: si vuelves a cerrar el rango, subimos otra vez.`
          : predicted < repRangeMin
            ? ` Puede que las primeras sesiones te quedes algo por debajo de ${repRangeMin}: es normal justo después de subir.`
            : "";
      const target2 = Math.max(Math.min(predicted, repRangeMax), 1);
      const head =
        reasonCode === "RANGE_CLOSED_AFTER_FAILURE"
          ? `Has cerrado el rango dos veces seguidas con más esfuerzo del previsto en ${last.weight} kg: toca subir.`
          : reasonCode === "LOAD_CLEARLY_TOO_LIGHT"
            ? `Hiciste ${last.medianReps} reps con un rango de ${repRangeMin}–${repRangeMax}: la carga se te ha quedado claramente corta.`
            : `Cerraste ${last.medianReps} reps en ${last.weight} kg${last.missingRir === last.n ? "" : " con el esfuerzo previsto"}.`;
      return done({
        action: "INCREASE_LOAD",
        reasonCode,
        suggestedWeightKg: newWeight,
        suggestedReps: target2,
        setTargets: uniformTargets(target2, plannedSets),
        explanation: `${head} Sube a ${newWeight} kg: a esa carga te corresponden ~${target2} reps, así que busca ${target2}.${tail}`,
      });
    }

    // 3d. El menor incremento del material no cabe en el rango: se extiende el
    // techo hasta que el salto aterrice en `repRangeMin`.
    const needed = Math.ceil(
      30 * ((1 + repRangeMin / 30) * (newWeight / last.weight) - 1) - 1e-6,
    );
    const cap = repRangeMax + config.RANGE_EXTENSION_CAP;
    const jumpPct = Math.round((loadStepKg / last.weight) * 100);
    if (needed <= cap) {
      const target = Math.min(last.minReps + 1, needed);
      const setTargets = ratchetTargets(
        sameWeightRun,
        target,
        needed,
        plannedSets,
      );
      return done({
        action: "ADD_REP",
        reasonCode: "EXTEND_RANGE",
        suggestedWeightKg: last.weight,
        suggestedReps: Math.min(...setTargets),
        setTargets,
        explanation: `El salto mínimo aquí son ${loadStepKg} kg sobre ${last.weight} (${jumpPct} %), más de lo que absorbe el rango ${repRangeMin}–${repRangeMax}. Sigue en ${last.weight} kg y sube hasta ${needed} reps: entonces ${newWeight} kg × ${repRangeMin} será alcanzable. Hoy: ${setTargets.join("/")}.`,
      });
    }
    // Ni extendiendo el rango cabe el salto: proponer una carga a la que solo
    // se pueden hacer 1-2 reps sería un consejo inservible. Se dice la verdad y
    // se ofrecen las salidas reales.
    const insisted = sameWeightRun.length >= config.PLATEAU_EXPOSURES;
    const stuckTargets = ratchetTargets(
      sameWeightRun,
      last.minReps,
      cap,
      plannedSets,
    );
    return done({
      action: "HOLD",
      reasonCode: "STEP_TOO_BIG_FOR_RANGE",
      suggestedWeightKg: last.weight,
      suggestedReps: Math.min(...stuckTargets),
      setTargets: stuckTargets,
      explanation: insisted
        ? `Llevas ${sameWeightRun.length} sesiones en ${last.weight} kg y el siguiente escalón (${loadStepKg} kg, ${jumpPct} %) sigue sin caber en un rango de ${repRangeMin}–${repRangeMax}. Este ejercicio ya no puede progresar aquí: cambia a una variante con incrementos más finos (mancuernas más juntas, polea, unilateral) o consigue discos fraccionales.`
        : `El salto mínimo aquí son ${loadStepKg} kg sobre ${last.weight} (${jumpPct} %): demasiado para un rango de ${repRangeMin}–${repRangeMax}, ni siquiera sumando repeticiones. Opciones: discos fraccionales, una variante con incrementos más finos, o aceptar quedarte por debajo del rango unas sesiones.`,
    });
  }

  // ── 4. ONE_OFF_UNDERPERFORMANCE ─────────────────────────────────────────
  if (last.medianReps < repRangeMin) {
    // ¿Es realmente la primera vez, o viene de una carga más alta que ya falló
    // (bajada propia o sugerida por el motor)? El texto tiene que decir la
    // verdad: prometer "si se repite ajustaremos" al cuarto fallo es mentir.
    const recentHeavierFailure = usable
      .slice(0, -1)
      .slice(-2)
      .some((s) => s.weight > last.weight && s.medianReps < repRangeMin);
    return done({
      action: "HOLD",
      reasonCode: "ONE_OFF_UNDERPERFORMANCE",
      suggestedWeightKg: last.weight,
      suggestedReps: repRangeMin,
      setTargets: uniformTargets(repRangeMin, plannedSets),
      explanation: recentHeavierFailure
        ? `Aún por debajo del rango (${last.reps.join("/")} reps, mínimo ${repRangeMin}), pero ya vienes de una carga más alta. Doy una sesión a ${last.weight} kg para asentarla antes de tocar nada más.`
        : `El rendimiento quedó por debajo del rango (${last.reps.join("/")} reps, mínimo ${repRangeMin}). No cambio nada por una sesión: repite ${last.weight} kg. Si se repite, ajustaremos la carga.`,
    });
  }

  // ── 5. NEAR_FAILURE_HOLD ────────────────────────────────────────────────
  if (last.harder) {
    // Escape: si esto se repite al mismo peso sin sumar repeticiones, no es una
    // cuestión de esfuerzo — la carga es demasiada. Mismo patrón de paciencia
    // que la rama 3a, para no crear otro estado absorbente.
    const stuckRun: ExposureSummary[] = [];
    for (let i = sameWeightRun.length - 1; i >= 0; i--) {
      const s = sameWeightRun[i];
      if (!s.harder || s.rangeClosed) break;
      stuckRun.unshift(s);
    }
    const noProgress =
      stuckRun.length >= config.PLATEAU_EXPOSURES &&
      stuckRun[stuckRun.length - 1].totalReps <= stuckRun[0].totalReps;
    if (noProgress && loadable && last.weight > loadStepKg) {
      const newWeight = round3(
        last.weight - config.DECREASE_STEPS * loadStepKg,
      );
      if (newWeight > 0) {
        return done({
          action: "DECREASE_LOAD",
          reasonCode: "REPEATED_UNDERPERFORMANCE",
          suggestedWeightKg: newWeight,
          suggestedReps: repRangeMin,
          setTargets: uniformTargets(repRangeMin, plannedSets),
          explanation: `${stuckRun.length} sesiones en ${last.weight} kg llegando al fallo sin cerrar ${repRangeMax} reps ni sumar repeticiones (${stuckRun.map((s) => s.totalReps).join(" → ")} en total). No es cuestión de apretar más: baja a ${newWeight} kg.`,
        });
      }
    }
    const target = Math.max(
      repRangeMin,
      Math.min(last.minReps + 1, repRangeMax),
    );
    const setTargets = ratchetTargets(
      sameWeightRun,
      target,
      repRangeMax,
      plannedSets,
    );
    return done({
      action: "HOLD",
      reasonCode: "NEAR_FAILURE_HOLD",
      suggestedWeightKg: last.weight,
      suggestedReps: Math.min(...setTargets),
      setTargets,
      explanation: `${last.minKnownRir === 0 ? "Llegaste al fallo" : `Te quedaste a ${last.minKnownRir} en reserva (objetivo ${targetRir})`} sin cerrar ${repRangeMax} reps. Mantén ${last.weight} kg: el objetivo es sumar repeticiones con algo de reserva, no forzar.`,
    });
  }

  // ── 6. ADD_REP: sube la serie más floja ─────────────────────────────────
  if (last.minReps < repRangeMax) {
    const target = Math.min(last.minReps + 1, repRangeMax);
    const setTargets = ratchetTargets(
      sameWeightRun,
      target,
      repRangeMax,
      plannedSets,
    );
    return done({
      action: "ADD_REP",
      reasonCode: "ADD_REP",
      suggestedWeightKg: last.weight,
      suggestedReps: Math.min(...setTargets),
      setTargets,
      explanation: `Dentro del rango en ${last.weight} kg (${last.reps.join("/")}). Mismo peso: mantén lo que ya hiciste y sube la serie más floja. Objetivo de hoy: ${setTargets.join("/")}. Cuando cierres ${repRangeMax} con algo de reserva, subimos carga.`,
    });
  }

  // ── 7. HOLD_DEFAULT ─────────────────────────────────────────────────────
  // Red de seguridad. Es INALCANZABLE por construcción: si todas las series
  // llegaron al techo, `rangeClosed` ya era cierto y la regla 3 ganó. Se
  // conserva para que la función sea total y para no romper si alguien cambia
  // la definición de `rangeClosed`. Cubierto por la invariante P8 del test.
  return done({
    action: "HOLD",
    reasonCode: "HOLD_DEFAULT",
    suggestedWeightKg: last.weight,
    suggestedReps: repRangeMax,
    setTargets: uniformTargets(repRangeMax, plannedSets),
    explanation: `Mantén ${last.weight} kg y consolida ${repRangeMax} repeticiones en todas las series.`,
  });
}
