import { describe, expect, it } from "vitest";

import {
  suggestProgression,
  type ProgressionExposure,
  type ProgressionPrescription,
  type ProgressionSuggestion,
} from "./progression";

/**
 * Simulación longitudinal determinista del motor de progresión (12 semanas).
 *
 * Por qué existe: las reglas unitarias no capturan cómo se comporta el motor a
 * lo largo de un mesociclo. Estas pruebas fijan el COMPORTAMIENTO AGREGADO
 * (escapar de una carga mal elegida, no sobrerreaccionar a un mal día, señalar
 * mesetas, no premiar forzar PRs) para que un cambio futuro de umbral no lo
 * rompa en silencio. Ver docs/TRAINING_ENGINE_FINAL_AUDIT.md §11.
 *
 * Todo es determinista: el "ruido" sale de un LCG con semilla fija; no se usan
 * `Math.random()` ni `Date.now()`.
 */

/** Generador congruencial lineal: ruido reproducible, mismo output siempre. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Repeticiones hasta el fallo con carga `w` para un e1RM `e` (Epley inverso). */
function repsToFailure(e: number, w: number): number {
  if (w <= 0 || w >= e) return 0;
  return Math.max(0, Math.floor(30 * (e / w - 1)));
}

interface Persona {
  name: string;
  /** e1RM real inicial (el motor NUNCA lo ve). */
  e1rm: number;
  startWeight: number;
  /** Ganancia real semanal si el estímulo es suficiente. */
  weeklyGain: number;
  /** Variabilidad diaria del rendimiento (fracción). */
  dayNoise: number;
  /** Sesgo del RIR reportado (+ = se cree más lejos del fallo). */
  rirBias: number;
  /** Ruido de la estimación de RIR, en repeticiones. */
  rirNoise: number;
  /** Semana con una caída puntual de rendimiento. */
  badWeek?: number;
  /** Semana a partir de la cual deja de ganar. */
  stallFromWeek?: number;
  /** Sube la carga por su cuenta cada semana, ignorando al coach. */
  forcesPr?: boolean;
}

interface WeekRow {
  week: number;
  weightKg: number;
  reps: number[];
  rir: Array<number | null>;
  action: ProgressionSuggestion["action"];
  reasonCode: ProgressionSuggestion["reasonCode"];
  suggestedWeightKg: number | null;
  suggestedReps: number | null;
  signals: string[];
  trueE1rm: number;
}

interface SimResult {
  rows: WeekRow[];
  actions: ProgressionSuggestion["action"][];
  reasonCodes: ProgressionSuggestion["reasonCode"][];
  signals: string[][];
  weights: number[];
  finalWeight: number;
  finalE1rm: number;
  trace: string;
}

function simulate(
  persona: Persona,
  rx: ProgressionPrescription,
  weeks = 12,
  /** RIR omitido en el registro (para el caso "no lo sé"). */
  omitRir = false,
): SimResult {
  const rnd = lcg(20260824);
  let trueE1rm = persona.e1rm;
  let weight = persona.startWeight;
  let targets = Array.from({ length: rx.plannedSets }, () => rx.repRangeMin);
  const history: ProgressionExposure[] = [];
  const rows: WeekRow[] = [];

  for (let week = 1; week <= weeks; week++) {
    let dayE1rm = trueE1rm * (1 + (rnd() - 0.5) * 2 * persona.dayNoise);
    if (persona.badWeek === week) dayE1rm *= 0.93;

    const reps: number[] = [];
    const rir: Array<number | null> = [];
    for (let i = 0; i < rx.plannedSets; i++) {
      // Fatiga intra-sesión: −2 % de capacidad por serie acumulada.
      const setE1rm = dayE1rm * (1 - 0.02 * i);
      const rtf = repsToFailure(setE1rm, weight);
      const target = targets[i] ?? rx.repRangeMin;
      // El atleta respeta el RIR objetivo salvo que fuerce PRs (va al fallo).
      const ceiling = persona.forcesPr ? rtf : rtf - rx.targetRir;
      const done = Math.max(0, Math.min(target, ceiling));
      reps.push(done);
      const trueRir = rtf - done;
      rir.push(
        omitRir
          ? null
          : Math.max(
              0,
              Math.min(
                4,
                Math.round(
                  trueRir +
                    persona.rirBias +
                    (rnd() - 0.5) * 2 * persona.rirNoise,
                ),
              ),
            ),
      );
    }

    history.push({
      sets: reps.map((r, i) => ({ weightKg: weight, reps: r, rir: rir[i] })),
    });
    const suggestion = suggestProgression({ prescription: rx, history });

    rows.push({
      week,
      weightKg: weight,
      reps: [...reps],
      rir: [...rir],
      action: suggestion.action,
      reasonCode: suggestion.reasonCode,
      suggestedWeightKg: suggestion.suggestedWeightKg,
      suggestedReps: suggestion.suggestedReps,
      signals: suggestion.signals.map((x) => x.code),
      trueE1rm,
    });

    // El atleta aplica la sugerencia (salvo que fuerce PRs).
    if (persona.forcesPr) {
      weight += rx.loadStepKg;
      targets = Array.from({ length: rx.plannedSets }, () => rx.repRangeMax);
    } else {
      if (
        (suggestion.action === "INCREASE_LOAD" ||
          suggestion.action === "DECREASE_LOAD") &&
        suggestion.suggestedWeightKg !== null
      ) {
        weight = suggestion.suggestedWeightKg;
      }
      targets =
        suggestion.setTargets ??
        Array.from({ length: rx.plannedSets }, () => rx.repRangeMin);
    }

    // Crecimiento real: solo si el estímulo fue suficiente.
    const stimulated =
      reps.filter((r) => r >= rx.repRangeMin - 1).length >=
      Math.ceil(rx.plannedSets / 2);
    let gain = stimulated ? persona.weeklyGain : persona.weeklyGain * 0.3;
    if (persona.stallFromWeek && week >= persona.stallFromWeek) gain = 0;
    if (persona.forcesPr) gain *= 0.5; // exceso de fatiga
    trueE1rm *= 1 + gain;
  }

  const trace = rows
    .map(
      (r) =>
        `s${String(r.week).padStart(2)} ${String(r.weightKg).padStart(6)}kg ` +
        `${r.reps.map((x, i) => `${x}@${r.rir[i] ?? "-"}`).join(" ")}` +
        ` → ${r.action}/${r.reasonCode}` +
        `${r.suggestedWeightKg !== null ? ` ${r.suggestedWeightKg}kg×${r.suggestedReps}` : ""}` +
        `${r.signals.length > 0 ? ` [${r.signals.join(",")}]` : ""}`,
    )
    .join("\n");

  return {
    rows,
    actions: rows.map((r) => r.action),
    reasonCodes: rows.map((r) => r.reasonCode),
    signals: rows.map((r) => r.signals),
    weights: rows.map((r) => r.weightKg),
    finalWeight: weight,
    finalE1rm: trueE1rm,
    trace,
  };
}

const BENCH: ProgressionPrescription = {
  repRangeMin: 6,
  repRangeMax: 8,
  targetRir: 2,
  loadStepKg: 2.5,
  plannedSets: 3,
};
const LATERAL: ProgressionPrescription = {
  repRangeMin: 10,
  repRangeMax: 15,
  targetRir: 1,
  loadStepKg: 2,
  plannedSets: 3,
};
const BAND: ProgressionPrescription = {
  repRangeMin: 15,
  repRangeMax: 25,
  targetRir: 1,
  loadStepKg: 0,
  plannedSets: 3,
};

const BASE = {
  weeklyGain: 0.008,
  dayNoise: 0.02,
  rirBias: 0,
  rirNoise: 0.5,
};

describe("simulación 12 semanas · el motor no sobrerreacciona ni se atasca", () => {
  it("A · progresión normal: reps → carga → reps, con subidas de un solo incremento", () => {
    const sim = simulate(
      { name: "A", e1rm: 100, startWeight: 75, ...BASE },
      BENCH,
    );
    const increases = sim.actions.filter((a) => a === "INCREASE_LOAD").length;
    expect(increases, sim.trace).toBeGreaterThanOrEqual(2);
    expect(sim.actions, sim.trace).not.toContain("DECREASE_LOAD");
    expect(sim.finalWeight, sim.trace).toBeGreaterThan(75);
    // Todas las subidas de un solo incremento: nada de saltos agresivos.
    for (const row of sim.rows) {
      if (row.action !== "INCREASE_LOAD") continue;
      expect(row.suggestedWeightKg! - row.weightKg, sim.trace).toBeCloseTo(
        BENCH.loadStepKg,
        6,
      );
    }
  });

  it("B · arranque DEMASIADO PESADO: escapa del estado absorbente y acaba progresando", () => {
    const sim = simulate(
      { name: "B", e1rm: 100, startWeight: 82.5, ...BASE },
      BENCH,
    );
    const firstDecrease = sim.actions.indexOf("DECREASE_LOAD");
    expect(firstDecrease, sim.trace).toBeGreaterThanOrEqual(0);
    // Corrige pronto, no tras dos meses de HOLD.
    expect(firstDecrease, sim.trace).toBeLessThanOrEqual(3);
    // Y una vez corregida la carga, el rango vuelve a ser alcanzable: deja de
    // quedarse corto y reanuda la escalera de repeticiones. (No se exige una
    // subida de carga dentro de la ventana: con ~0,8 %/semana de ganancia real
    // la carga corregida ya está justo en el mínimo del rango.)
    const after = sim.rows.slice(firstDecrease + 1);
    expect(
      after.map((r) => r.action),
      sim.trace,
    ).toContain("ADD_REP");
    expect(
      after.some((r) => Math.min(...r.reps) >= BENCH.repRangeMin),
      sim.trace,
    ).toBe(true);
    // Nunca más de 4 HOLD seguidos en toda la simulación.
    let run = 0;
    let maxRun = 0;
    for (const a of sim.actions) {
      run = a === "HOLD" ? run + 1 : 0;
      maxRun = Math.max(maxRun, run);
    }
    expect(maxRun, sim.trace).toBeLessThanOrEqual(4);
  });

  it("C · arranque DEMASIADO LIGERO: sube sin saltos absurdos", () => {
    const sim = simulate(
      { name: "C", e1rm: 100, startWeight: 55, ...BASE },
      BENCH,
    );
    expect(
      sim.actions.filter((a) => a === "INCREASE_LOAD").length,
      sim.trace,
    ).toBeGreaterThanOrEqual(3);
    // Ninguna subida supera 2 incrementos.
    for (const row of sim.rows) {
      if (row.action !== "INCREASE_LOAD") continue;
      const steps = (row.suggestedWeightKg! - row.weightKg) / BENCH.loadStepKg;
      expect(steps, sim.trace).toBeLessThanOrEqual(2);
      expect(steps, sim.trace).toBeGreaterThanOrEqual(1);
    }
    expect(sim.actions, sim.trace).not.toContain("DECREASE_LOAD");
  });

  it("D · un solo mal día NO baja la carga", () => {
    const sim = simulate(
      { name: "D", e1rm: 100, startWeight: 75, ...BASE, badWeek: 6 },
      BENCH,
    );
    expect(sim.actions, sim.trace).not.toContain("DECREASE_LOAD");
    expect(sim.reasonCodes, sim.trace).toContain("ONE_OFF_UNDERPERFORMANCE");
    // Se recupera y sigue subiendo después del bache.
    expect(sim.actions.slice(6), sim.trace).toContain("INCREASE_LOAD");
  });

  it("E · dos exposiciones malas de verdad → una única bajada conservadora", () => {
    const sim = simulate(
      { name: "E", e1rm: 100, startWeight: 85, ...BASE },
      BENCH,
      6,
    );
    const decreases = sim.rows.filter((r) => r.action === "DECREASE_LOAD");
    expect(decreases.length, sim.trace).toBeGreaterThanOrEqual(1);
    for (const row of decreases) {
      expect(row.weightKg - row.suggestedWeightKg!, sim.trace).toBeCloseTo(
        BENCH.loadStepKg,
        6,
      );
    }
    // Nunca dos bajadas consecutivas: tras bajar hay que volver a acumular
    // evidencia en el peso nuevo.
    for (let i = 1; i < sim.actions.length; i++) {
      expect(
        sim.actions[i] === "DECREASE_LOAD" &&
          sim.actions[i - 1] === "DECREASE_LOAD",
        sim.trace,
      ).toBe(false);
    }
  });

  it("F · meseta: emite señal informativa y NO interviene", () => {
    const sim = simulate(
      { name: "F", e1rm: 100, startWeight: 75, ...BASE, stallFromWeek: 4 },
      BENCH,
    );
    const withPlateau = sim.signals.filter((s) =>
      s.includes("PLATEAU_SIGNAL"),
    ).length;
    expect(withPlateau, sim.trace).toBeGreaterThanOrEqual(1);
    // La señal nunca cambia la carga por sí sola.
    for (const row of sim.rows) {
      if (!row.signals.includes("PLATEAU_SIGNAL")) continue;
      expect(["ADD_REP", "HOLD"], sim.trace).toContain(row.action);
    }
  });

  it("G · RIR ruidoso (±1,5 reps): la trayectoria sigue siendo sana", () => {
    const sim = simulate(
      {
        name: "G",
        e1rm: 100,
        startWeight: 75,
        ...BASE,
        dayNoise: 0.03,
        rirNoise: 1.5,
      },
      BENCH,
    );
    expect(
      sim.actions.filter((a) => a === "INCREASE_LOAD").length,
      sim.trace,
    ).toBeGreaterThanOrEqual(2);
    expect(
      sim.actions.filter((a) => a === "DECREASE_LOAD").length,
      sim.trace,
    ).toBeLessThanOrEqual(1);
    expect(sim.finalWeight, sim.trace).toBeGreaterThan(75);
  });

  it("H · sin RIR registrado nunca: progresa por reps, jamás baja por falta de dato", () => {
    const sim = simulate(
      { name: "H", e1rm: 100, startWeight: 75, ...BASE },
      BENCH,
      12,
      true,
    );
    expect(sim.actions, sim.trace).toContain("INCREASE_LOAD");
    // Sin RIR nunca se concede el salto doble.
    for (const row of sim.rows) {
      if (row.action !== "INCREASE_LOAD") continue;
      expect(row.suggestedWeightKg! - row.weightKg, sim.trace).toBeCloseTo(
        BENCH.loadStepKg,
        6,
      );
    }
  });

  it("I · incremento grande de material (lateral 2 kg sobre 10): extiende el rango antes de subir", () => {
    const sim = simulate(
      { name: "I", e1rm: 22, startWeight: 10, ...BASE, dayNoise: 0.03 },
      LATERAL,
    );
    expect(sim.reasonCodes, sim.trace).toContain("EXTEND_RANGE");
    const extendIdx = sim.reasonCodes.indexOf("EXTEND_RANGE");
    const increaseIdx = sim.actions.indexOf("INCREASE_LOAD");
    // Primero extiende el rango; solo después sube de mancuerna.
    if (increaseIdx >= 0) {
      expect(extendIdx, sim.trace).toBeLessThan(increaseIdx);
    }
    // Y cuando sube, es exactamente una mancuerna.
    for (const row of sim.rows) {
      if (row.action !== "INCREASE_LOAD") continue;
      expect(row.suggestedWeightKg! - row.weightKg, sim.trace).toBeCloseTo(
        LATERAL.loadStepKg,
        6,
      );
    }
  });

  it("J · sin carga cuantificable (banda): nunca sugiere kilos ni baja peso", () => {
    const sim = simulate(
      { name: "J", e1rm: 40, startWeight: 0, ...BASE },
      BAND,
    );
    expect(sim.actions, sim.trace).not.toContain("INCREASE_LOAD");
    expect(sim.actions, sim.trace).not.toContain("DECREASE_LOAD");
    for (const row of sim.rows) {
      expect(row.suggestedWeightKg, sim.trace).toBe(0);
    }
    expect(sim.finalWeight, sim.trace).toBe(0);
  });

  it("K · atleta que fuerza PRs: el motor nunca lo valida", () => {
    const sim = simulate(
      { name: "K", e1rm: 100, startWeight: 75, ...BASE, forcesPr: true },
      BENCH,
    );
    // Casi nunca aprueba: la mayoría de semanas son HOLD/DECREASE.
    const approved = sim.actions.filter((a) => a === "INCREASE_LOAD").length;
    expect(approved, sim.trace).toBeLessThanOrEqual(2);
    // Y en algún momento le dice explícitamente que la carga es demasiada.
    expect(sim.reasonCodes, sim.trace).toContain("REPEATED_UNDERPERFORMANCE");
    // El consejo nunca valida la escalada: el peso propuesto está siempre por
    // debajo del que acaba de usar, y anclado al más bajo que falló dentro de
    // la ventana de historial (por eso puede derivar si se ignora al coach
    // durante meses: limitación conocida y documentada de la ventana).
    for (const row of sim.rows) {
      if (row.action !== "DECREASE_LOAD") continue;
      expect(row.suggestedWeightKg!, sim.trace).toBeLessThanOrEqual(
        row.weightKg - BENCH.loadStepKg,
      );
    }
  });
});

describe("simulación · invariantes globales del mesociclo", () => {
  const personas: Persona[] = [
    { name: "normal", e1rm: 100, startWeight: 75, ...BASE },
    { name: "pesado", e1rm: 100, startWeight: 82.5, ...BASE },
    { name: "ligero", e1rm: 100, startWeight: 55, ...BASE },
    { name: "malDia", e1rm: 100, startWeight: 75, ...BASE, badWeek: 6 },
    { name: "meseta", e1rm: 100, startWeight: 75, ...BASE, stallFromWeek: 4 },
    {
      name: "ruidoso",
      e1rm: 100,
      startWeight: 75,
      ...BASE,
      dayNoise: 0.03,
      rirNoise: 1.5,
    },
    { name: "forzado", e1rm: 100, startWeight: 75, ...BASE, forcesPr: true },
  ];

  it("nunca baja la carga dos semanas seguidas (para quien sigue al coach), ni baja sin dos exposiciones malas", () => {
    // Se excluye al atleta que ignora al coach y sube cada semana: ahí repetir
    // el aviso de bajar es el comportamiento correcto (y el peso propuesto es
    // estable, lo verifica la simulación K).
    for (const p of personas.filter((x) => !x.forcesPr)) {
      const sim = simulate(p, BENCH);
      for (let i = 0; i < sim.rows.length; i++) {
        if (sim.rows[i].action !== "DECREASE_LOAD") continue;
        expect(sim.rows[i - 1]?.action, `${p.name}\n${sim.trace}`).not.toBe(
          "DECREASE_LOAD",
        );
        expect(i, `${p.name}\n${sim.trace}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("el número de series previstas nunca cambia y no aparece ninguna acción de volumen", () => {
    for (const p of personas) {
      const sim = simulate(p, BENCH);
      for (const row of sim.rows) {
        expect(row.reps, `${p.name}`).toHaveLength(BENCH.plannedSets);
      }
      expect(
        sim.actions.every((a) =>
          [
            "START",
            "INCREASE_LOAD",
            "ADD_REP",
            "HOLD",
            "DECREASE_LOAD",
          ].includes(a),
        ),
        p.name,
      ).toBe(true);
    }
  });

  it("es reproducible: dos ejecuciones idénticas dan exactamente la misma traza", () => {
    for (const p of personas) {
      expect(simulate(p, BENCH).trace).toBe(simulate(p, BENCH).trace);
    }
  });
});
