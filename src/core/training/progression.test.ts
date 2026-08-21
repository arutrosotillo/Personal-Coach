import { describe, expect, it } from "vitest";

import {
  suggestProgression,
  type ProgressionInput,
  type ProgressionSet,
} from "./progression";

/** Prescripción por defecto: 3×8–12 @ RIR 2, incremento 2,5 kg. */
function input(
  sets: ProgressionSet[] | null,
  rx: Partial<ProgressionInput["prescription"]> = {},
  comparableSessions = 2,
): ProgressionInput {
  return {
    prescription: {
      repRangeMin: 8,
      repRangeMax: 12,
      targetRir: 2,
      loadStepKg: 2.5,
      plannedSets: 3,
      ...rx,
    },
    lastSession: sets === null ? null : { sets, comparableSessions },
  };
}

const S = (
  weightKg: number,
  reps: number,
  rir: number | null,
): ProgressionSet => ({
  weightKg,
  reps,
  rir,
});

describe("suggestProgression — reglas", () => {
  it("sin historial → START, sin peso sugerido", () => {
    const r = suggestProgression(input(null));
    expect(r.action).toBe("START");
    expect(r.reasonCode).toBe("NO_HISTORY");
    expect(r.suggestedWeightKg).toBeNull();
    expect(r.suggestedReps).toBe(8);
    expect(r.confidence).toBe("LOW");
    expect(r.explanation).toMatch(/Primera vez/i);
  });

  it("lista de sets vacía → START (variante recién sustituida)", () => {
    const r = suggestProgression(input([]));
    expect(r.action).toBe("START");
    expect(r.reasonCode).toBe("NO_HISTORY");
  });

  it("tope del rango con RIR ≥ objetivo → INCREASE_LOAD (+1 step, vuelve a repMin)", () => {
    const r = suggestProgression(
      input([S(80, 12, 2), S(80, 12, 2), S(80, 11, 2)]),
    );
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.reasonCode).toBe("INCREASE_LOAD");
    expect(r.suggestedWeightKg).toBe(82.5);
    expect(r.suggestedReps).toBe(8);
    expect(r.confidence).toBe("HIGH");
    expect(r.explanation).toContain("82.5");
  });

  it("dentro del rango → ADD_REP (mismo peso, +1 rep)", () => {
    const r = suggestProgression(
      input([S(80, 10, 2), S(80, 10, 2), S(80, 9, 2)]),
    );
    expect(r.action).toBe("ADD_REP");
    expect(r.reasonCode).toBe("ADD_REP");
    expect(r.suggestedWeightKg).toBe(80);
    expect(r.suggestedReps).toBe(11);
  });

  it("por debajo del mínimo de reps → HOLD, nunca baja el peso", () => {
    const r = suggestProgression(
      input([S(80, 8, 2), S(80, 7, 2), S(80, 6, 2)]),
    );
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("BELOW_MIN_HOLD");
    expect(r.suggestedWeightKg).toBe(80);
  });

  it("fallo o casi, sin llegar al tope → HOLD (consolidar)", () => {
    const r = suggestProgression(
      input([S(80, 10, 0), S(80, 9, 0)], { plannedSets: 2 }),
    );
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("NEAR_FAILURE_HOLD");
    expect(r.suggestedWeightKg).toBe(80);
  });

  it("tope de reps pero RIR por debajo del objetivo → HOLD_DEFAULT (no sube)", () => {
    const r = suggestProgression(
      input([S(80, 12, 1), S(80, 12, 1), S(80, 12, 1)]),
    );
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("HOLD_DEFAULT");
    expect(r.suggestedWeightKg).toBe(80);
  });

  it("pesos distintos entre series → sube desde el peso de referencia (modal)", () => {
    const r = suggestProgression(
      input([S(80, 12, 2), S(80, 12, 2), S(77.5, 12, 2)]),
    );
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.numbers.pesoRef).toBe(80);
    expect(r.suggestedWeightKg).toBe(82.5);
  });

  it("empate de peso modal → usa el menor (conservador)", () => {
    const r = suggestProgression(
      input([S(80, 12, 2), S(77.5, 12, 2)], { plannedSets: 2 }),
    );
    expect(r.numbers.pesoRef).toBe(77.5);
    expect(r.suggestedWeightKg).toBe(80);
  });

  it("incremento grande (máquina, step 5) → múltiplo exacto, nunca 62.3", () => {
    const r = suggestProgression(
      input([S(60, 12, 2), S(60, 12, 2), S(60, 12, 2)], { loadStepKg: 5 }),
    );
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.suggestedWeightKg).toBe(65);
  });

  it("sin RIR en la mayoría de series → imputa al objetivo y confianza LOW", () => {
    const r = suggestProgression(
      input([S(80, 12, null), S(80, 12, null), S(80, 12, null)]),
    );
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.numbers.imputedRir).toBe(3);
    expect(r.confidence).toBe("LOW");
    expect(r.explanation).toContain("82.5");
  });

  it("RIR mezclado (uno ausente) → confianza MEDIA", () => {
    const r = suggestProgression(
      input([S(80, 12, 2), S(80, 12, null), S(80, 12, 3)]),
    );
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.numbers.imputedRir).toBe(1);
    expect(r.confidence).toBe("MEDIUM");
  });

  it("sesión con datos parciales (menos del 70%) → HOLD, confianza LOW", () => {
    const r = suggestProgression(
      input([S(80, 12, 2), S(80, 12, 2)], { plannedSets: 4 }),
    );
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("SESSION_UNUSABLE");
    expect(r.confidence).toBe("LOW");
    expect(r.explanation).toContain("2 de 4");
  });

  it("una sola serie de trabajo → confianza MEDIA aunque suba", () => {
    const r = suggestProgression(input([S(80, 12, 2)], { plannedSets: 1 }));
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.confidence).toBe("MEDIUM");
  });

  it("una sola sesión comparable → confianza MEDIA (nunca ALTA por un dato)", () => {
    const r = suggestProgression(
      input([S(80, 12, 2), S(80, 12, 2), S(80, 11, 2)], {}, 1),
    );
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.confidence).toBe("MEDIUM");
  });

  it("aislamiento entrenado al fallo (RIR objetivo 1) → HOLD, no ADD_REP", () => {
    const r = suggestProgression(
      input([S(30, 9, 0), S(30, 9, 0)], {
        targetRir: 1,
        plannedSets: 2,
      }),
    );
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("NEAR_FAILURE_HOLD");
  });

  it("una serie limpia al tope + otra a fallo bajo el techo → HOLD (no sube)", () => {
    const r = suggestProgression(
      input([S(80, 12, 2), S(80, 11, 0)], { plannedSets: 2 }),
    );
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("NEAR_FAILURE_HOLD");
    expect(r.suggestedWeightKg).toBe(80);
  });
});

describe("suggestProgression — invariantes (property-style, rejilla determinista)", () => {
  const weights = [20, 21, 40, 60, 77.5, 80, 100];
  const steps = [0.5, 2, 2.5, 5];
  const prescriptions = [
    { repRangeMin: 8, repRangeMax: 12, targetRir: 2 },
    { repRangeMin: 6, repRangeMax: 8, targetRir: 3 },
    { repRangeMin: 10, repRangeMax: 15, targetRir: 1 },
    { repRangeMin: 8, repRangeMax: 8, targetRir: 2 }, // rango estrecho
    { repRangeMin: 5, repRangeMax: 6, targetRir: 0 }, // targetRir 0
  ];
  const repsGrid = [
    [15, 15, 15],
    [12, 12, 11],
    [10, 10, 9],
    [8, 7, 6],
    [12, 8, 10],
    [6, 6, 6],
  ];
  const rirGrid: Array<Array<number | null>> = [
    [2, 2, 2],
    [1, 1, 1],
    [0, 0, 0],
    [null, null, null],
    [2, null, 3],
    [3, 3, 3],
  ];

  function* cases() {
    for (const w of weights)
      for (const step of steps)
        for (const rx of prescriptions)
          for (const reps of repsGrid)
            for (const rir of rirGrid) {
              const sets = reps.map((rp, i) => S(w, rp, rir[i] ?? null));
              yield { sets, step, w, rx };
            }
  }

  it("P1: si INCREASE_LOAD, el peso sugerido es exactamente pesoRef + un incremento", () => {
    for (const c of cases()) {
      const r = suggestProgression(
        input(c.sets, { ...c.rx, loadStepKg: c.step }),
      );
      if (r.action === "INCREASE_LOAD") {
        expect(r.suggestedWeightKg).not.toBeNull();
        expect(Math.abs(r.suggestedWeightKg! - (c.w + c.step))).toBeLessThan(
          1e-9,
        );
      }
    }
  });

  it("P2: nunca INCREASE_LOAD sin ≥ n−1 series al tope con RIR ≥ objetivo, ninguna a repMax−2, ninguna a fallo", () => {
    for (const c of cases()) {
      const r = suggestProgression(
        input(c.sets, { ...c.rx, loadStepKg: c.step }),
      );
      if (r.action === "INCREASE_LOAD") {
        const n = c.sets.length;
        const t = c.rx.targetRir;
        const rirEff = c.sets.map((s) => (s.rir === null ? t : s.rir));
        const qualifying = c.sets.filter(
          (s, i) => s.reps >= c.rx.repRangeMax && rirEff[i] >= t,
        ).length;
        expect(c.sets.every((s) => s.reps >= c.rx.repRangeMax - 1)).toBe(true);
        expect(qualifying).toBeGreaterThanOrEqual(Math.max(n - 1, 1));
        // Ninguna serie a fallo (rir 0 con objetivo ≥1).
        expect(rirEff.every((r0) => !(r0 === 0 && t >= 1))).toBe(true);
      }
    }
  });

  it("P3: nunca reduce el peso — el sugerido (si existe) es ≥ pesoRef", () => {
    for (const c of cases()) {
      const r = suggestProgression(
        input(c.sets, { ...c.rx, loadStepKg: c.step }),
      );
      if (r.suggestedWeightKg !== null && r.numbers.pesoRef !== null) {
        expect(r.suggestedWeightKg).toBeGreaterThanOrEqual(r.numbers.pesoRef);
      }
    }
  });

  it("P4: idempotente y confianza siempre en el enum de 3 niveles", () => {
    for (const c of cases()) {
      const a = suggestProgression(
        input(c.sets, { ...c.rx, loadStepKg: c.step }),
      );
      const b = suggestProgression(
        input(c.sets, { ...c.rx, loadStepKg: c.step }),
      );
      expect(a).toEqual(b);
      expect(["LOW", "MEDIUM", "HIGH"]).toContain(a.confidence);
    }
  });
});
