import { PROGRESSION_2B } from "@/core/config/training-config";
import type { Confidence } from "@/core/enums";

/**
 * Motor de sugerencia de progressive overload — Fase 2B (double progression,
 * SOLO sugiere; nunca modifica el programa ni baja el peso). Puro y
 * determinista: mismos inputs → misma salida. Ver docs/PHASE_2B_PLAN.md.
 *
 * Reglas transparentes evaluadas en orden (la primera que aplica gana):
 *  - NO_HISTORY        → START     (primera vez: no inventa peso)
 *  - SESSION_UNUSABLE  → HOLD      (sesión previa con datos parciales)
 *  - INCREASE_LOAD     → INCREASE_LOAD (cerró el tope del rango con RIR ≥ objetivo)
 *  - NEAR_FAILURE_HOLD → HOLD      (fallo o casi, sin llegar al tope)
 *  - BELOW_MIN_HOLD    → HOLD      (por debajo del mínimo de reps)
 *  - ADD_REP           → ADD_REP   (dentro del rango, aún no toca subir)
 *  - HOLD_DEFAULT      → HOLD
 */

export type ProgressionAction = "START" | "INCREASE_LOAD" | "ADD_REP" | "HOLD";

export interface ProgressionPrescription {
  repRangeMin: number;
  repRangeMax: number;
  targetRir: number;
  loadStepKg: number;
  plannedSets: number;
}

export interface ProgressionSet {
  weightKg: number;
  reps: number;
  rir: number | null;
}

export interface ProgressionInput {
  prescription: ProgressionPrescription;
  /**
   * Última sesión válida de la variante, o null. `sets` = series de TRABAJO;
   * `comparableSessions` = nº de sesiones válidas de la variante en el historial
   * (para no dar confianza ALTA con una sola sesión). Si se omite, se asume ≥2.
   */
  lastSession: { sets: ProgressionSet[]; comparableSessions?: number } | null;
}

export interface ProgressionSuggestion {
  action: ProgressionAction;
  reasonCode: string;
  suggestedWeightKg: number | null;
  suggestedReps: number | null;
  confidence: Confidence;
  explanation: string;
  numbers: {
    pesoRef: number | null;
    loadStepKg: number;
    repRange: [number, number];
    targetRir: number;
    n: number;
    plannedSets: number;
    imputedRir: number;
  };
}

/** Peso modal de las series; en empate, el menor (conservador). */
function referenceWeight(sets: ProgressionSet[]): number {
  const counts = new Map<number, number>();
  for (const s of sets)
    counts.set(s.weightKg, (counts.get(s.weightKg) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [w, c] of counts) {
    if (c > bestCount || (c === bestCount && (best === null || w < best))) {
      best = w;
      bestCount = c;
    }
  }
  return best ?? 0;
}

export function suggestProgression(
  input: ProgressionInput,
  config = PROGRESSION_2B,
): ProgressionSuggestion {
  const { prescription: rx, lastSession } = input;
  const { repRangeMin, repRangeMax, targetRir, loadStepKg, plannedSets } = rx;

  const base = {
    loadStepKg,
    repRange: [repRangeMin, repRangeMax] as [number, number],
    targetRir,
    plannedSets,
  };

  // ── NO_HISTORY: primera vez / variante recién sustituida ────────────────
  const sets = lastSession?.sets ?? [];
  if (sets.length === 0) {
    return {
      action: "START",
      reasonCode: "NO_HISTORY",
      suggestedWeightKg: null,
      suggestedReps: repRangeMin,
      confidence: "LOW",
      explanation: `Primera vez con este ejercicio: elige un peso con el que cierres ${repRangeMin} repeticiones dejando ~${targetRir} en reserva. La próxima vez, con tus datos, te sugiero el siguiente paso.`,
      numbers: { pesoRef: null, ...base, n: 0, imputedRir: 0 },
    };
  }

  const n = sets.length;
  const comparableSessions = lastSession?.comparableSessions ?? 2;
  const pesoRef = referenceWeight(sets);
  const imputedRir = sets.filter((s) => s.rir === null).length;
  const rirEff = sets.map((s) => (s.rir === null ? targetRir : s.rir));

  const numbers = { pesoRef, ...base, n, imputedRir };

  // Confianza base: degrada si falta RIR, hay pocas series, o solo hay una
  // sesión comparable (nunca ALTA por un único dato).
  const confidence: Confidence =
    imputedRir > n / 2
      ? "LOW"
      : imputedRir > 0 || n === 1 || comparableSessions <= 1
        ? "MEDIUM"
        : "HIGH";

  // ── SESSION_UNUSABLE: la última sesión registró datos parciales ─────────
  const minSets = Math.ceil(plannedSets * config.UNUSABLE_SESSION_FRACTION);
  if (n < minSets) {
    return {
      action: "HOLD",
      reasonCode: "SESSION_UNUSABLE",
      suggestedWeightKg: pesoRef,
      suggestedReps: repRangeMin,
      confidence: "LOW",
      explanation: `Tu última sesión solo registró ${n} de ${plannedSets} series: no ajusto con datos parciales. Repite ${pesoRef} kg y complétala.`,
      numbers,
    };
  }

  // Fallo o casi: rirEff ≥ NEAR_FAILURE_MARGIN por debajo del objetivo, o fallo
  // absoluto (rir 0) cuando la prescripción pedía reserva. Se calcula antes que
  // INCREASE para que una serie a fallo bloquee la subida.
  const isNearFailure = (i: number) =>
    rirEff[i] <= targetRir - config.NEAR_FAILURE_MARGIN ||
    (rirEff[i] === 0 && targetRir >= 1);

  // ── INCREASE_LOAD: tope del rango con RIR ≥ objetivo, sin series a fallo ──
  const qualifying = sets.filter(
    (s, i) => s.reps >= repRangeMax && rirEff[i] >= targetRir,
  ).length;
  const noneTooLow = sets.every((s) => s.reps >= repRangeMax - 1);
  const noneNearFailure = sets.every((_, i) => !isNearFailure(i));
  if (qualifying >= Math.max(n - 1, 1) && noneTooLow && noneNearFailure) {
    const suggestedWeightKg = pesoRef + loadStepKg;
    return {
      action: "INCREASE_LOAD",
      reasonCode: "INCREASE_LOAD",
      suggestedWeightKg,
      suggestedReps: repRangeMin,
      confidence,
      explanation: `Cerraste el techo del rango (${repRangeMax} reps) con al menos ${targetRir} en reserva en ${pesoRef} kg → sube a ${suggestedWeightKg} kg y vuelve a ${repRangeMin} reps.`,
      numbers,
    };
  }

  // ── NEAR_FAILURE_HOLD: fallo o casi, sin llegar al tope ─────────────────
  const nearFailure = sets.some(
    (s, i) => isNearFailure(i) && s.reps < repRangeMax,
  );
  if (nearFailure) {
    return {
      action: "HOLD",
      reasonCode: "NEAR_FAILURE_HOLD",
      suggestedWeightKg: pesoRef,
      suggestedReps: repRangeMin,
      confidence,
      explanation: `Llegaste cerca del fallo sin tocar el techo de reps: mantén ${pesoRef} kg y busca cerrar más repeticiones con algo de reserva antes de subir.`,
      numbers,
    };
  }

  // ── BELOW_MIN_HOLD: por debajo del mínimo de reps ───────────────────────
  if (sets.some((s) => s.reps < repRangeMin)) {
    return {
      action: "HOLD",
      reasonCode: "BELOW_MIN_HOLD",
      suggestedWeightKg: pesoRef,
      suggestedReps: repRangeMin,
      confidence,
      explanation: `Alguna serie quedó por debajo de ${repRangeMin} reps: no bajo el peso por una sesión. Repite ${pesoRef} kg e intenta cerrar el rango.`,
      numbers,
    };
  }

  // ── ADD_REP: dentro del rango, aún no toca subir peso ───────────────────
  const firstBelowTop = sets.find((s) => s.reps < repRangeMax);
  if (firstBelowTop) {
    const suggestedReps = Math.min(firstBelowTop.reps + 1, repRangeMax);
    return {
      action: "ADD_REP",
      reasonCode: "ADD_REP",
      suggestedWeightKg: pesoRef,
      suggestedReps,
      confidence,
      explanation: `Estás dentro del rango en ${pesoRef} kg: mantén el peso e intenta ${suggestedReps} reps antes de subir carga.`,
      numbers,
    };
  }

  // ── HOLD_DEFAULT ────────────────────────────────────────────────────────
  return {
    action: "HOLD",
    reasonCode: "HOLD_DEFAULT",
    suggestedWeightKg: pesoRef,
    suggestedReps: repRangeMin,
    confidence,
    explanation: `Mantén ${pesoRef} kg y consolida la técnica y las repeticiones.`,
    numbers,
  };
}
