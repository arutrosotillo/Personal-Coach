import { describe, expect, it } from "vitest";

import { addDays } from "@/core/dates";
import {
  analyzeTraining,
  type TrainingAnalysis,
  type TrainingContext,
} from "@/core/training/analysis";

/**
 * Simulación longitudinal de F3.3: atletas ficticios deterministas entrenados
 * durante 8–16 semanas, pasados por el pipeline COMPLETO (motor de progresión
 * por variante → motor de fatiga), no por el motor de fatiga aislado.
 *
 * Fija el comportamiento agregado que pedimos: una mala semana no dispara
 * nada, una caída sostenida sí, la motivación sola nunca, el dolor articular
 * escala por su cuenta y una vuelta tras un parón largo es conservadora.
 *
 * Determinista: LCG con semilla, sin `Math.random()` ni `Date.now()`.
 */

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const repsToFailure = (e1rm: number, w: number) =>
  w <= 0 || w >= e1rm ? 0 : Math.max(0, Math.floor(30 * (e1rm / w - 1)));

interface Athlete {
  name: string;
  weeks: number;
  /** Ganancia real semanal. Negativa = desentrenamiento. */
  weeklyGain: number;
  /** Semana a partir de la cual la fuerza real cae (fatiga acumulada). */
  declineFromWeek?: number;
  /** Semana con un bache puntual. */
  badWeek?: number;
  feedback?: (week: number) => {
    fatigue?: number | null;
    motivation?: number | null;
    jointPain?: number | null;
    perceivedPerformance?: number | null;
    completionRate?: number;
  };
  /** Semanas sin entrenar antes de la última sesión. */
  layoffWeeks?: number;
}

const EXERCISES = [
  {
    name: "Press banca",
    variant: "Barra",
    min: 6,
    max: 8,
    rir: 2,
    step: 2.5,
    start: 75,
    e1rm: 100,
  },
  {
    name: "Sentadilla",
    variant: "Barra",
    min: 5,
    max: 8,
    rir: 2,
    step: 2.5,
    start: 100,
    e1rm: 140,
  },
  {
    name: "Remo con barra",
    variant: "Barra",
    min: 6,
    max: 10,
    rir: 2,
    step: 2.5,
    start: 70,
    e1rm: 95,
  },
];

const TODAY = "2026-08-25";

/** Construye un `TrainingContext` completo entrenando al atleta semana a semana. */
function simulate(athlete: Athlete): TrainingAnalysis {
  const rnd = lcg(20260825);
  const sessions: TrainingContext["sessions"] = [];
  const variants: TrainingContext["variants"] = EXERCISES.map((e) => ({
    variantId: e.name,
    exerciseName: e.name,
    variantName: e.variant,
    prescription: {
      repRangeMin: e.min,
      repRangeMax: e.max,
      targetRir: e.rir,
      plannedSets: 3,
      loadStepKg: e.step,
    },
    exposures: [],
    daysSinceLast: 0,
  }));

  const state = EXERCISES.map((e) => ({
    weight: e.start,
    e1rm: e.e1rm,
    targets: [e.min, e.min, e.min],
  }));

  for (let week = 1; week <= athlete.weeks; week++) {
    // La sesión más reciente es la de hace `layoffWeeks` semanas.
    const weeksAgo = athlete.weeks - week + (athlete.layoffWeeks ?? 0);
    const localDate = addDays(TODAY, -weeksAgo * 7 - 1);
    const fb = athlete.feedback?.(week) ?? {};
    let plannedSets = 0;
    let loggedSets = 0;

    state.forEach((st, i) => {
      const e = EXERCISES[i];
      let day = st.e1rm * (1 + (rnd() - 0.5) * 0.04);
      if (athlete.badWeek === week) day *= 0.9;
      const sets: Array<{
        weightKg: number;
        reps: number;
        rir: number | null;
      }> = [];
      const completion = fb.completionRate ?? 1;
      const doneSets = Math.max(1, Math.round(3 * completion));
      plannedSets += 3;
      loggedSets += doneSets;
      for (let s = 0; s < doneSets; s++) {
        const cap = repsToFailure(day * (1 - 0.02 * s), st.weight);
        const reps = Math.max(0, Math.min(st.targets[s] ?? e.min, cap - e.rir));
        sets.push({ weightKg: st.weight, reps, rir: Math.max(0, cap - reps) });
      }
      variants[i].exposures.push({ localDate, sets });

      // El atleta sigue al coach: se recalcula al vuelo con lo acumulado.
      const partial = analyzeTraining({
        todayLocalDate: localDate,
        sinceLocalDate: addDays(localDate, -60),
        sessions: [],
        variants: [{ ...variants[i], daysSinceLast: 0 }],
        weeksSinceDeload: week,
      }).variants[0].suggestion;
      if (
        (partial.action === "INCREASE_LOAD" ||
          partial.action === "DECREASE_LOAD") &&
        partial.suggestedWeightKg !== null
      ) {
        st.weight = partial.suggestedWeightKg;
      }
      st.targets = partial.setTargets ?? [e.min, e.min, e.min];

      let gain = athlete.weeklyGain;
      if (athlete.declineFromWeek && week >= athlete.declineFromWeek) {
        gain = -0.012;
      }
      st.e1rm *= 1 + gain;
    });

    sessions.push({
      id: `s${week}`,
      localDate,
      templateName: "Full body",
      perceivedPerformance: fb.perceivedPerformance ?? null,
      pump: null,
      jointPain: fb.jointPain ?? null,
      fatigue: fb.fatigue ?? null,
      motivation: fb.motivation ?? null,
      notes: null,
      plannedSets,
      loggedSets,
      completionRate: loggedSets / plannedSets,
      durationMin: 70,
      deload: false,
    });
  }

  return analyzeTraining({
    todayLocalDate: TODAY,
    sinceLocalDate: addDays(TODAY, -60),
    sessions,
    variants: variants.map((v) => ({
      ...v,
      daysSinceLast: (athlete.layoffWeeks ?? 0) * 7 + 1,
    })),
    weeksSinceDeload: athlete.weeks,
  });
}

const BASE = { weeklyGain: 0.008, weeks: 10 };

// ───────────────────────────────────────────────────────────────────────────
describe("simulación F3.3 · fatiga y deload reactivo", () => {
  it("A · progreso normal → sin deload", () => {
    const r = simulate({ name: "A", ...BASE });
    expect(r.fatigue.decision, r.fatigue.explanation).toBe("NO_DELOAD");
    expect(r.fatigue.plan).toBeNull();
    expect(r.variants.filter((v) => v.regressed)).toHaveLength(0);
  });

  it("B · una semana mala → sin deload", () => {
    const r = simulate({
      name: "B",
      ...BASE,
      badWeek: 8,
      feedback: (w) => (w === 8 ? { fatigue: 5, perceivedPerformance: 1 } : {}),
    });
    expect(r.fatigue.decision, r.fatigue.explanation).not.toBe(
      "DELOAD_RECOMMENDED",
    );
    expect(r.fatigue.plan).toBeNull();
  });

  it("C · caída sostenida de rendimiento → señal objetiva", () => {
    const r = simulate({ name: "C", ...BASE, weeks: 16, declineFromWeek: 8 });
    // Tras 8 semanas cayendo: al press banca el motor le ha bajado la carga y
    // los otros dos llevan exposiciones sin mejorar. Ninguno de los tres
    // progresa, y eso tiene que verse en la evidencia OBJETIVA.
    const codes = r.fatigue.signals.map((s) => s.code);
    expect(codes, r.fatigue.explanation).toContain("SINGLE_LIFT_DECLINE");
    expect(codes, r.fatigue.explanation).toContain("WIDESPREAD_PLATEAU");
    expect(r.fatigue.objectiveScore).toBeGreaterThanOrEqual(3);
    // Pero sigue sin bastar para recomendar una descarga: no hay ni una sola
    // señal de que el usuario se encuentre mal.
    expect(r.fatigue.decision).not.toBe("DELOAD_RECOMMENDED");
  });

  it("D · caída + fatiga alta repetida → deload RECOMENDADO con números", () => {
    const r = simulate({
      name: "D",
      ...BASE,
      weeks: 16,
      declineFromWeek: 8,
      feedback: (w) => (w >= 12 ? { fatigue: 5 } : {}),
    });
    expect(r.fatigue.decision, r.fatigue.explanation).toBe(
      "DELOAD_RECOMMENDED",
    );
    expect(r.fatigue.plan).not.toBeNull();
    expect(r.fatigue.explanation).toMatch(/\d+ ejercicios/);
    expect(r.fatigue.explanation).toMatch(/fatiga ≥4\/5 en \d+ de las últimas/);
  });

  it("E · dolor articular repetido → escala por su cuenta, sin inflar el score", () => {
    const r = simulate({
      name: "E",
      ...BASE,
      feedback: (w) => (w >= 8 ? { jointPain: 4 } : {}),
    });
    expect(r.fatigue.jointPain.level).toBe("ACTION");
    expect(r.fatigue.jointPain.message).toMatch(/cambia o retira/i);
    // El dolor no puntúa: la decisión de deload sigue mandada por el rendimiento.
    expect(r.fatigue.signals.map((s) => s.code)).not.toContain("JOINT_PAIN");
  });

  it("F · motivación baja con rendimiento estable → no sobrerreacciona", () => {
    const r = simulate({
      name: "F",
      ...BASE,
      feedback: () => ({ motivation: 1 }),
    });
    expect(r.fatigue.decision, r.fatigue.explanation).toBe("NO_DELOAD");
    expect(r.fatigue.objectiveScore).toBe(0);
  });

  it("G · vuelve tras 6 semanas → historial viejo, recomendación conservadora", () => {
    const r = simulate({ name: "G", ...BASE, layoffWeeks: 6 });
    // Ningún ejercicio entra en la ventana de fatiga.
    expect(r.fatigue.decision).toBe("INSUFFICIENT_DATA");
    // Y el motor de progresión suspende las subidas por historial viejo.
    for (const v of r.variants) {
      expect(v.suggestion.numbers.daysSinceLast).toBeGreaterThanOrEqual(42);
      expect(v.suggestion.action).not.toBe("INCREASE_LOAD");
      expect(v.suggestion.confidence).toBe("LOW");
    }
  });

  it("H · meseta sin fatiga → nunca deload ni cambio de volumen", () => {
    const r = simulate({ name: "H", ...BASE, weeks: 14, weeklyGain: 0 });
    expect(r.fatigue.decision, r.fatigue.explanation).not.toBe(
      "DELOAD_RECOMMENDED",
    );
    expect(JSON.stringify(r.fatigue)).not.toMatch(/ADD_SET|REMOVE_SET/);
  });

  it("I · sesiones acortadas repetidas → señal objetiva de fatiga", () => {
    const r = simulate({
      name: "I",
      ...BASE,
      weeks: 12,
      declineFromWeek: 7,
      feedback: (w) => (w >= 9 ? { completionRate: 0.5, fatigue: 4 } : {}),
    });
    const codes = r.fatigue.signals.map((s) => s.code);
    expect(codes, r.fatigue.explanation).toContain("SESSION_COMPLETION_DROP");
    expect(r.fatigue.decision).toBe("DELOAD_RECOMMENDED");
  });

  it("determinista: dos ejecuciones idénticas dan el mismo veredicto", () => {
    const a = simulate({ name: "X", ...BASE, weeks: 12, declineFromWeek: 8 });
    const b = simulate({ name: "X", ...BASE, weeks: 12, declineFromWeek: 8 });
    expect(a.fatigue).toEqual(b.fatigue);
  });
});
