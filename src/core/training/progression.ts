import {
  PROGRESSION,
  PROGRESSION_ENGINE_VERSION,
} from "@/core/config/training-config";
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
  | "RANGE_CLOSED"
  | "RANGE_CLOSED_AFTER_FAILURE"
  | "LOAD_CLEARLY_TOO_LIGHT"
  | "EXTEND_RANGE"
  | "STEP_TOO_BIG_ACCEPTED"
  | "NO_LOAD_STEP"
  | "NO_LOAD_STEP_CAPPED"
  | "ONE_OFF_UNDERPERFORMANCE"
  | "NEAR_FAILURE_HOLD"
  | "ADD_REP"
  | "HOLD_DEFAULT";

export type ProgressionSignalCode = "PLATEAU_SIGNAL";

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

/** Resumen determinista de una exposición, ya interpretado con la prescripción. */
interface ExposureSummary {
  sets: ProgressionSet[];
  n: number;
  weight: number;
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
    (r) => r < rx.targetRir - config.RIR_BAND || (r === 0 && rx.targetRir >= 1),
  );

  const atTop = reps.filter((r) => r >= rx.repRangeMax).length;
  const rangeClosed =
    n > 0 &&
    atTop >= Math.max(n - 1, 1) &&
    Math.min(...reps) >= rx.repRangeMax - 1;

  return {
    sets,
    n,
    weight: n > 0 ? lowerMedian(sets.map((s) => s.weightKg)) : 0,
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

  const numbersFor = (s: ExposureSummary, sameWeightRun: number) => ({
    pesoRef: s.weight,
    ...base,
    n: s.n,
    missingRir: s.missingRir,
    exposures: usable.length,
    sameWeightRun,
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
      numbers: numbersFor(last, 1),
    };
  }

  // Racha de exposiciones VÁLIDAS consecutivas al mismo peso de trabajo.
  const sameWeightRun: ExposureSummary[] = [];
  for (let i = usable.length - 1; i >= 0; i--) {
    if (usable[i].weight !== last.weight) break;
    sameWeightRun.unshift(usable[i]);
  }

  const numbers = numbersFor(last, sameWeightRun.length);
  const loadable = loadStepKg > 0;

  // Confianza: el RIR ausente NUNCA sube la confianza (§F3.2c).
  const confidence: Confidence =
    last.missingRir === last.n
      ? "LOW"
      : usable.length >= 3 && last.missingRir === 0 && last.n >= plannedSets
        ? "HIGH"
        : usable.length >= 2
          ? "MEDIUM"
          : "LOW";

  // Señal informativa de meseta: N exposiciones al mismo peso sin batir el
  // mejor total de repeticiones alcanzado a ese peso. No altera la acción.
  const signals: ProgressionSignal[] = [];
  if (sameWeightRun.length >= config.PLATEAU_EXPOSURES) {
    const totals = sameWeightRun.map((s) => s.totalReps);
    const best = Math.max(...totals);
    const sinceBest = totals.length - 1 - totals.indexOf(best);
    if (sinceBest >= config.PLATEAU_EXPOSURES - 1) {
      const shown = totals.slice(-config.PLATEAU_EXPOSURES);
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

  // ── 2. REPEATED_UNDERPERFORMANCE → DECREASE_LOAD ────────────────────────
  // Dos exposiciones consecutivas al mismo peso con la MEDIANA por debajo del
  // mínimo del rango y sin señales de haberse guardado (RIR conocido > objetivo
  // = se paró lejos, eso no es un problema de carga).
  const notSandbagging = (s: ExposureSummary) =>
    s.minKnownRir === null || s.minKnownRir <= targetRir;
  const underRun: ExposureSummary[] = [];
  let underRef = last.weight;
  for (let i = usable.length - 1; i >= 0; i--) {
    const s = usable[i];
    if (s.weight > underRef) break; // ya había bajado por su cuenta
    if (s.medianReps >= repRangeMin || !notSandbagging(s)) break;
    underRun.unshift(s);
    underRef = s.weight;
  }

  if (underRun.length >= config.DECREASE_AFTER_EXPOSURES) {
    const medians = underRun
      .slice(-config.DECREASE_AFTER_EXPOSURES)
      .map((s) => s.medianReps);
    const sameLoadRun = underRun.every((s) => s.weight === last.weight);
    if (loadable) {
      const anchor = Math.min(...underRun.map((s) => s.weight));
      const newWeight = round3(anchor - config.DECREASE_STEPS * loadStepKg);
      if (newWeight > 0) {
        return done({
          action: "DECREASE_LOAD",
          reasonCode: "REPEATED_UNDERPERFORMANCE",
          suggestedWeightKg: newWeight,
          suggestedReps: repRangeMin,
          setTargets: uniformTargets(repRangeMin, plannedSets),
          explanation: `${underRun.length} sesiones seguidas por debajo de ${repRangeMin} reps${sameLoadRun ? ` en ${last.weight} kg` : ""} (mediana ${medians.join(" y ")}). La carga no te deja hacer el rango: baja a ${newWeight} kg y reconstruye desde ahí.`,
        });
      }
    }
    return done({
      action: "HOLD",
      reasonCode: "REPEATED_UNDERPERFORMANCE",
      suggestedWeightKg: last.weight,
      suggestedReps: repRangeMin,
      setTargets: uniformTargets(repRangeMin, plannedSets),
      explanation: `${underRun.length} sesiones seguidas por debajo de ${repRangeMin} reps (mediana ${medians.join(" y ")}). Aquí no puedo bajar la carga: usa una variante más fácil o menos recorrido, y vuelve al rango.`,
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
        explanation: `Cerraste el rango (${last.topReps} reps) pero al fallo o casi (RIR ${last.minKnownRir}, objetivo ${targetRir}). Repite ${last.weight} kg buscando dejar ${targetRir} en reserva; si vuelves a cerrarlo así, subimos igualmente.`,
      });
    }

    // 3b. Sin carga externa cuantificable: se progresa por repeticiones.
    if (!loadable) {
      const cap = repRangeMax + config.RANGE_EXTENSION_CAP;
      if (last.topReps < cap) {
        const target = Math.min(last.minReps + 1, cap);
        return done({
          action: "ADD_REP",
          reasonCode: "NO_LOAD_STEP",
          suggestedWeightKg: last.weight,
          suggestedReps: target,
          setTargets: padTargets(
            last.reps.map((r) => Math.min(Math.max(r, target), cap)),
            plannedSets,
          ),
          explanation: `Este ejercicio no tiene carga externa que pueda cuantificar: se progresa con repeticiones y recorrido. Cerraste ${repRangeMax}: busca ${target} manteniendo la técnica.`,
        });
      }
      return done({
        action: "HOLD",
        reasonCode: "NO_LOAD_STEP_CAPPED",
        suggestedWeightKg: last.weight,
        suggestedReps: cap,
        setTargets: uniformTargets(cap, plannedSets),
        explanation: `Ya estás en ${last.topReps} reps y sin carga externa que añadir. Seguir sumando repeticiones aporta poco: pasa a una variante más difícil (más recorrido, una banda más dura o versión unilateral).`,
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
        explanation: `Cerraste ${repRangeMax} reps a peso corporal: añade ${loadStepKg} kg de lastre y busca ${target} reps. Sin saber tu peso corporal no puedo afinar más el objetivo.`,
      });
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
    const predicted = Math.floor(
      equivalentReps(last.weight, last.medianReps, newWeight) + 1e-6,
    );

    if (predicted >= repRangeMin) {
      const target = Math.min(predicted, repRangeMax);
      const reasonCode: ProgressionReasonCode =
        steps > 1
          ? "LOAD_CLEARLY_TOO_LIGHT"
          : afterFailure && last.harder
            ? "RANGE_CLOSED_AFTER_FAILURE"
            : "RANGE_CLOSED";
      const tail =
        predicted > repRangeMax
          ? ` Sigue quedándose corta: si vuelves a cerrar el rango, subimos otra vez.`
          : "";
      const head =
        reasonCode === "RANGE_CLOSED_AFTER_FAILURE"
          ? `Has cerrado el rango dos veces seguidas llegando al fallo: quedarte en ${last.weight} kg ya no aporta.`
          : reasonCode === "LOAD_CLEARLY_TOO_LIGHT"
            ? `Hiciste ${last.medianReps} reps con un rango de ${repRangeMin}–${repRangeMax}: la carga se te ha quedado claramente corta.`
            : `Cerraste ${repRangeMax} reps en ${last.weight} kg con el esfuerzo previsto.`;
      return done({
        action: "INCREASE_LOAD",
        reasonCode,
        suggestedWeightKg: newWeight,
        suggestedReps: target,
        setTargets: uniformTargets(target, plannedSets),
        explanation: `${head} Sube a ${newWeight} kg: a esa carga te corresponden ~${predicted} reps, así que busca ${target}.${tail}`,
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
      return done({
        action: "ADD_REP",
        reasonCode: "EXTEND_RANGE",
        suggestedWeightKg: last.weight,
        suggestedReps: target,
        setTargets: padTargets(
          last.reps.map((r) => Math.min(Math.max(r, target), needed)),
          plannedSets,
        ),
        explanation: `El salto mínimo aquí son ${loadStepKg} kg sobre ${last.weight} (${jumpPct} %), más de lo que absorbe el rango ${repRangeMin}–${repRangeMax}. Sigue en ${last.weight} kg hasta ${needed} reps: entonces ${newWeight} kg × ${repRangeMin} será alcanzable.`,
      });
    }
    return done({
      action: "INCREASE_LOAD",
      reasonCode: "STEP_TOO_BIG_ACCEPTED",
      suggestedWeightKg: newWeight,
      suggestedReps: Math.max(predicted, 1),
      setTargets: uniformTargets(Math.max(predicted, 1), plannedSets),
      explanation: `Sube a ${newWeight} kg aunque el salto sea grande (${jumpPct} %): esperamos ~${predicted} reps, por debajo de ${repRangeMin}. Es normal las primeras sesiones; con discos fraccionales el salto sería más suave.`,
    });
  }

  // ── 4. ONE_OFF_UNDERPERFORMANCE ─────────────────────────────────────────
  if (last.medianReps < repRangeMin) {
    return done({
      action: "HOLD",
      reasonCode: "ONE_OFF_UNDERPERFORMANCE",
      suggestedWeightKg: last.weight,
      suggestedReps: repRangeMin,
      setTargets: uniformTargets(repRangeMin, plannedSets),
      explanation: `El rendimiento quedó por debajo del rango (${last.reps.join("/")} reps, mínimo ${repRangeMin}). No cambio nada por una sesión: repite ${last.weight} kg. Si se repite, ajustaremos la carga.`,
    });
  }

  // ── 5. NEAR_FAILURE_HOLD ────────────────────────────────────────────────
  if (last.harder) {
    const target = Math.max(
      repRangeMin,
      Math.min(last.minReps + 1, repRangeMax),
    );
    return done({
      action: "HOLD",
      reasonCode: "NEAR_FAILURE_HOLD",
      suggestedWeightKg: last.weight,
      suggestedReps: target,
      setTargets: padTargets(
        last.reps.map((r) => Math.min(Math.max(r, target), repRangeMax)),
        plannedSets,
      ),
      explanation: `Llegaste al fallo o casi (RIR ${last.minKnownRir}, objetivo ${targetRir}) sin cerrar ${repRangeMax} reps. Mantén ${last.weight} kg: el objetivo es sumar repeticiones con algo de reserva, no forzar.`,
    });
  }

  // ── 6. ADD_REP: sube la serie más floja ─────────────────────────────────
  if (last.minReps < repRangeMax) {
    const target = Math.min(last.minReps + 1, repRangeMax);
    const setTargets = padTargets(
      last.reps.map((r) => Math.min(Math.max(r, target), repRangeMax)),
      plannedSets,
    );
    return done({
      action: "ADD_REP",
      reasonCode: "ADD_REP",
      suggestedWeightKg: last.weight,
      suggestedReps: target,
      setTargets,
      explanation: `Dentro del rango en ${last.weight} kg (${last.reps.join("/")}). Mismo peso: mantén lo que ya hiciste y sube la serie más floja a ${target}. Objetivo de hoy: ${setTargets.join("/")}. Cuando todas lleguen a ${repRangeMax}, subimos carga.`,
    });
  }

  // ── 7. HOLD_DEFAULT (no debería alcanzarse) ─────────────────────────────
  return done({
    action: "HOLD",
    reasonCode: "HOLD_DEFAULT",
    suggestedWeightKg: last.weight,
    suggestedReps: repRangeMax,
    setTargets: uniformTargets(repRangeMax, plannedSets),
    explanation: `Mantén ${last.weight} kg y consolida ${repRangeMax} repeticiones en todas las series.`,
  });
}
