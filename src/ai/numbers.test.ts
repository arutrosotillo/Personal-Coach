import { describe, expect, it } from "vitest";

import type { CoachBodyContext, CoachContext } from "@/ai/context";
import { citations, isSupported, supportedNumbers } from "@/ai/numbers";

/**
 * Modelo semántico de cifras (B6.1).
 *
 * Lo que se comprueba aquí es la propiedad que el `Set<number>` plano no podía
 * tener: que el guardrail sepa QUÉ dice ser una cifra antes de darla por
 * buena. La colisión que lo motivó es real y está reproducida abajo.
 */

const CUERPO: CoachBodyContext = {
  goal: {
    strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
    goalType: "FAT_LOSS",
    targetPctPerWeek: -0.5,
    targetKgPerWeek: -0.41,
    targetWeightKg: 78,
    kgToTargetWeight: -4.4,
    phaseStartLocalDate: "2026-07-23",
  },
  weight: {
    status: "LOSING",
    reasonCode: "CI_BELOW_ZERO",
    slopeKgPerWeek: -0.42,
    ciLowPerWeek: -0.54,
    ciHighPerWeek: -0.37,
    windowDays: 28,
    measurementsInWindow: 28,
    latestKg: 82.4,
    latestEmaKg: 82.6,
    totalChangeKg: -1.6,
  },
  waist: {
    status: "DECREASING",
    latestCm: 91.9,
    fittedChangeCm: -4,
    minDetectableChangeCm: 3.1,
    protocol: "MEAN_OF_THREE",
    measurementsUsed: 4,
  },
  bodyFat: {
    status: "NOT_INTERPRETABLE",
    latestPct: 18,
    reliability: "ESTIMATED",
    changePp: -1,
    minInterpretableChangePp: 2,
    spanDays: 56,
  },
  checkIn: { status: "NOT_DUE", daysSinceLast: 3, intervalDays: 14 },
  insight: null,
};

function contexto(body: CoachBodyContext | null = CUERPO): CoachContext {
  return {
    meta: {
      todayLocalDate: "2026-09-01",
      windowDays: 28,
      progressionEngine: "2.0.0",
      fatigueEngine: "1.0.0",
    },
    profile: {
      goal: "FAT_LOSS",
      strategy: null,
      experienceLevel: "intermediate",
      daysPerWeek: 4,
    },
    adherence: {
      sessionsInWindow: 12,
      avgCompletionPct: 100,
      sesionesDeDescarga: 0,
      weeksSinceDeload: 3,
    },
    sessions: [],
    exercises: [
      {
        variantId: "v1",
        exercise: "Press banca",
        variant: "Barra",
        prescription: "3×6–8 @2 RIR (incremento 2.5 kg)",
        loadStepKg: 2.5,
        exposures: 4,
        daysSinceLast: 3,
        recentSets: ["2026-08-28: 70×8@2, 70×8@2"],
        totalRepTrend: [24],
        equivalentLoadTrend: [70],
        equivalentLoadTrendPct: 0,
        bestRecentE1rm: 88,
        progression: {
          action: "HOLD",
          reasonCode: "NEAR_FAILURE_HOLD",
          suggestedWeightKg: 70,
          suggestedReps: 8,
          confidence: "MEDIUM",
          explanation: "Mantén la carga.",
        },
        signals: [],
        plateaued: false,
        regressed: false,
      },
      {
        variantId: "v2",
        exercise: "Elevaciones laterales",
        variant: "Mancuerna",
        prescription: "3×12–15 @1 RIR (incremento 1 kg)",
        loadStepKg: 1,
        exposures: 4,
        daysSinceLast: 3,
        recentSets: ["2026-08-28: 8×14@1"],
        totalRepTrend: [42],
        equivalentLoadTrend: [8],
        equivalentLoadTrendPct: 0,
        bestRecentE1rm: 11,
        progression: {
          action: "HOLD",
          reasonCode: "HOLD_DEFAULT",
          suggestedWeightKg: 8,
          suggestedReps: 14,
          confidence: "MEDIUM",
          explanation: "Mantén.",
        },
        signals: [],
        plateaued: false,
        regressed: false,
      },
    ],
    fatigue: {
      level: "LOW",
      decision: "CONTINUE",
      score: 1,
      objectiveScore: 1,
      confidence: "MEDIUM",
      signals: [],
      jointPain: null,
      plan: null,
      explanation: "ok",
    },
    limits: { e1rmErrorPct: 5, rirErrorReps: 1, notes: [] },
    notAvailable: [],
    body,
  };
}

/** Tipo y respaldo de la primera cifra citada en `texto`. */
function cita(texto: string, body: CoachBodyContext | null = CUERPO) {
  const ctx = contexto(body);
  const c = citations(texto, ctx)[0];
  expect(c, `sin cifras en "${texto}"`).toBeDefined();
  return { kind: c.kind, ok: isSupported(c, supportedNumbers(ctx)) };
}

describe("clasificación por dominio", () => {
  it.each([
    ["Tu peso está en 82,4 kg.", "BODY_WEIGHT_KG"],
    ["Tu peso ha bajado 1,6 kg.", "BODY_CHANGE_KG"],
    ["Te quedan 4,4 kg para el objetivo.", "BODY_CHANGE_KG"],
    ["El peso baja a 0,42 kg por semana.", "BODY_RATE_KG_PER_WEEK"],
    ["Haz press banca con 70 kg.", "TRAINING_LOAD_KG"],
    ["Mantén 8 kg en las elevaciones laterales.", "TRAINING_LOAD_KG"],
    ["El siguiente escalón son 2,5 kg.", "LOAD_STEP_KG"],
    ["Tu cintura está en 91,9 cm.", "WAIST_CM"],
    ["Tu grasa estimada es del 18 %.", "BODY_FAT_PCT"],
    ["Recorta 300 kcal.", "INTAKE"],
    ["Mantén los 70 kg.", "AMBIGUOUS_KG"],
  ])("«%s» → %s", (texto, kind) => {
    expect(cita(texto).kind).toBe(kind);
  });
});

describe("la colisión que motivó todo esto", () => {
  it("el peso corporal NO legitima una carga de entrenamiento", () => {
    // 82,4 es un peso corporal real del contexto. Como carga de press banca
    // es una invención, y antes pasaba por estar "en algún sitio".
    expect(cita("Haz press banca con 82,4 kg.")).toEqual({
      kind: "TRAINING_LOAD_KG",
      ok: false,
    });
  });

  it("ni los kilos que faltan para el objetivo legitiman una mancuerna", () => {
    expect(cita("Ponte 4,4 kg en las elevaciones laterales.")).toEqual({
      kind: "TRAINING_LOAD_KG",
      ok: false,
    });
  });

  it("ni el peso objetivo", () => {
    expect(cita("Sube a 78 kg en press banca.")).toEqual({
      kind: "TRAINING_LOAD_KG",
      ok: false,
    });
  });

  it("pero el MISMO número sí pasa cuando de verdad es una carga", () => {
    expect(cita("Haz press banca con 70 kg.").ok).toBe(true);
    expect(cita("Mantén 8 kg en las elevaciones laterales.").ok).toBe(true);
  });

  it("y una carga no legitima un peso corporal inventado", () => {
    // 70 es una carga real; como peso corporal no está respaldado.
    expect(cita("Tu peso está en 70 kg.")).toEqual({
      kind: "BODY_WEIGHT_KG",
      ok: false,
    });
  });
});

describe("fuentes autorizadas", () => {
  it("el escalón de carga está tipado y respaldado (F2)", () => {
    const s = supportedNumbers(contexto());
    expect(s.LOAD_STEP_KG.has(2.5)).toBe(true);
    expect(s.LOAD_STEP_KG.has(1)).toBe(true);
    expect(cita("El siguiente escalón son 2,5 kg.").ok).toBe(true);
  });

  it("el signo y la magnitud valen los dos", () => {
    const s = supportedNumbers(contexto());
    expect(s.BODY_CHANGE_KG.has(-4.4)).toBe(true);
    expect(s.BODY_CHANGE_KG.has(4.4)).toBe(true);
  });

  it("sin bloque corporal no hay ninguna fuente de cuerpo", () => {
    const s = supportedNumbers(contexto(null));
    expect(s.BODY_WEIGHT_KG.size).toBe(0);
    expect(cita("Tu peso está en 82,4 kg.", null).ok).toBe(false);
  });

  it("la cintura solo la respalda la cintura", () => {
    expect(cita("Tu cintura está en 91,9 cm.").ok).toBe(true);
    expect(cita("Tu cintura está en 82,4 cm.").ok).toBe(false);
  });

  it("ninguna fuente respalda una kilocaloría", () => {
    expect(cita("Recorta 300 kcal.").ok).toBe(false);
    // Ni siquiera si el número existe en otro sitio del contexto.
    expect(cita("Recorta 70 kcal.").ok).toBe(false);
  });

  it("una carga se compara al gramo; el cuerpo, al redondeo", () => {
    // 70,5 no es 70: en una barra medio kilo es un disco.
    expect(cita("Haz press banca con 70,5 kg.").ok).toBe(false);
    // 82,4 ↔ 82,44 sí, porque el peso viaja redondeado a un decimal.
    expect(cita("Tu peso está en 82,44 kg.").ok).toBe(true);
  });
});
