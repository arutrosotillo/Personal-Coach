import { describe, expect, it } from "vitest";

import { kg, type BodyMeasurementPoint } from "@/core/body";
import { addDays } from "@/core/dates";
import {
  estimateMaintenance,
  meanTargetBetween,
  regimeStartFor,
  summarizeLoggedIntake,
  type EnergyBalanceInput,
} from "@/core/nutrition/energy-balance";

const START = "2026-03-02";

/** Ruido determinista de agua/intestino: nunca `Math.random` en un test de motor. */
const noise = (i: number, amp = 1) =>
  amp * (0.35 * Math.sin(i * 1.7) + 0.15 * Math.cos(i * 0.9));

function weighings(
  days: number,
  kgPerWeek: number,
  { startKg = 82, every = 1, amp = 1, from = START } = {},
): BodyMeasurementPoint[] {
  const out: BodyMeasurementPoint[] = [];
  for (let i = 0; i < days; i += every) {
    out.push({
      localDate: addDays(from, i),
      weightKg: kg(
        Math.round((startKg + (kgPerWeek / 7) * i + noise(i, amp)) * 10) / 10,
      ),
      waistCm: null,
      waistProtocol: null,
      bodyFatPct: null,
      bodyFatReliability: null,
    });
  }
  return out;
}

function input(over: Partial<EnergyBalanceInput> = {}): EnergyBalanceInput {
  return {
    todayLocalDate: addDays(START, 111),
    regimeStartLocalDate: addDays(START, 14),
    measurements: weighings(112, -0.4),
    intake: [],
    targets: [{ effectiveFrom: START, kcal: 2150 }],
    formulaTdeeKcal: 2800,
    formulaTdeeAtPriorWeightKcal: null,
    prior: null,
    currentIsDeficit: true,
    ...over,
  };
}

describe("estimateMaintenance — parte observada", () => {
  it("el ejemplo de la spec: 2.150 kcal y −0,4 kg/semana ≈ 2.590 de gasto observado", () => {
    const r = estimateMaintenance(input());
    expect(r.observed).not.toBeNull();
    // 2.150 + 0,4 × 7.700 / 7 = 2.590 (el ruido mueve la pendiente unos gramos).
    expect(r.observed!.tdeeKcal).toBeGreaterThan(2540);
    expect(r.observed!.tdeeKcal).toBeLessThan(2640);
    expect(r.observed!.intakeSource).toBe("TARGET_PROXY");
    expect(r.observed!.windowDays).toBeGreaterThanOrEqual(41);
    // Sin registro, la ingesta lleva su incertidumbre (10 % del objetivo).
    expect(r.observed!.seBreakdown.intake).toBeCloseTo(215, 0);
    expect(r.explanation).toContain("se asume que lo cumpliste");
    expect(r.notes.join(" ")).toContain("Registrar kcal");
  });

  it("combina con la fórmula por precisión: los datos pesan más, la fórmula tira algo", () => {
    const r = estimateMaintenance(input());
    expect(r.observedWeight).toBeGreaterThan(0.5);
    expect(r.formula.weight).toBeGreaterThan(0);
    expect(r.tdeeKcal).toBeGreaterThan(r.observed!.tdeeKcal - 25);
    expect(r.tdeeKcal).toBeLessThan(2800);
    expect(r.lowKcal).toBeLessThan(r.tdeeKcal);
    expect(r.highKcal).toBeGreaterThan(r.tdeeKcal);
    expect(r.basis).toBe("OBSERVED");
  });

  it("con registro suficiente usa lo COMIDO, no lo prescrito", () => {
    // Objetivo 2.150, pero come 2.400 de media y aun así pierde 0,4 kg/sem.
    const intake = Array.from({ length: 112 }, (_, i) => ({
      localDate: addDays(START, i),
      kcal: 2400 + (i % 3 === 0 ? 120 : -60),
    }));
    const r = estimateMaintenance(input({ intake }));
    expect(r.observed!.intakeSource).toBe("LOGGED");
    expect(r.observed!.meanIntakeKcal).toBeCloseTo(2400, -1);
    expect(r.observed!.tdeeKcal).toBeGreaterThan(2790);
    expect(r.observed!.tdeeKcal).toBeLessThan(2900);
    expect(r.explanation).toContain("según tu registro");
    // El registro es más preciso que suponer el objetivo.
    const proxy = estimateMaintenance(input());
    expect(r.observed!.seKcal).toBeLessThan(proxy.observed!.seKcal);
  });

  it("registro escaso (< 60 % de los días): vuelve al objetivo y lo dice", () => {
    const intake = Array.from({ length: 20 }, (_, i) => ({
      localDate: addDays(START, 60 + i * 2),
      kcal: 2500,
    }));
    const r = estimateMaintenance(input({ intake }));
    expect(r.observed!.intakeSource).toBe("TARGET_PROXY");
  });

  it("descarta días registrados muy por debajo de lo habitual (registro incompleto)", () => {
    const intake = Array.from({ length: 112 }, (_, i) => ({
      localDate: addDays(START, i),
      kcal: i % 10 === 0 ? 700 : 2300,
    }));
    const r = estimateMaintenance(input({ intake }));
    expect(r.observed!.excludedIncompleteDays).toBeGreaterThan(0);
    expect(r.observed!.meanIntakeKcal).toBeCloseTo(2300, 0);
    expect(r.notes.join(" ")).toContain("registros incompletos");
  });

  it("los cambios de objetivo cuentan día a día en la ingesta supuesta", () => {
    expect(
      meanTargetBetween(
        [
          { effectiveFrom: START, kcal: 2000 },
          { effectiveFrom: addDays(START, 10), kcal: 2100 },
        ],
        START,
        addDays(START, 19),
      ),
    ).toBe(2050);
  });
});

describe("estimateMaintenance — datos insuficientes", () => {
  it("régimen de menos de 20 días: sin parte observada, solo fórmula", () => {
    const r = estimateMaintenance(
      input({
        todayLocalDate: addDays(START, 25),
        regimeStartLocalDate: addDays(START, 14),
      }),
    );
    expect(r.observed).toBeNull();
    expect(r.observedUnavailableReason).toBe("REGIME_TOO_SHORT");
    expect(r.reasonCode).toBe("FORMULA_ONLY");
    expect(r.tdeeKcal).toBe(2800);
    expect(r.confidence).toBe("LOW");
    expect(r.explanation).toContain("solo la fórmula");
  });

  it("pesajes demasiado escasos: no inventa una pendiente", () => {
    const r = estimateMaintenance(
      input({ measurements: weighings(112, -0.4, { every: 16 }) }),
    );
    expect(r.observed).toBeNull();
    expect(r.observedUnavailableReason).toBe("INSUFFICIENT_WEIGHINGS");
    expect(r.explanation).toContain("Faltan pesajes");
  });

  it("los días de estabilización no entran: un salto de glucógeno al empezar no infla el gasto", () => {
    // +1,5 kg los primeros 10 días (glucógeno al salir de una definición) y
    // después estable. Con régimen desde el día 21 el gasto ≈ la ingesta.
    const pts: BodyMeasurementPoint[] = weighings(112, 0, { amp: 0.6 }).map(
      (p, i) => ({
        ...p,
        weightKg: kg(p.weightKg! + Math.min(i, 10) * 0.15),
      }),
    );
    const sinEstabilizar = estimateMaintenance(
      input({
        measurements: pts,
        regimeStartLocalDate: START,
        todayLocalDate: addDays(START, 41),
        targets: [{ effectiveFrom: START, kcal: 2700 }],
        currentIsDeficit: false,
      }),
    );
    const estabilizado = estimateMaintenance(
      input({
        measurements: pts,
        regimeStartLocalDate: regimeStartFor(START, true, false),
        todayLocalDate: addDays(START, 111),
        targets: [{ effectiveFrom: START, kcal: 2700 }],
        currentIsDeficit: false,
      }),
    );
    // Sin estabilizar, el salto de agua parece superávit y rebaja el gasto.
    expect(sinEstabilizar.observed!.tdeeKcal).toBeLessThan(2600);
    expect(estabilizado.observed!.tdeeKcal).toBeGreaterThan(2620);
    expect(estabilizado.observed!.tdeeKcal).toBeLessThan(2780);
  });
});

describe("estimateMaintenance — historial de ciclos", () => {
  it("la estimación del ciclo anterior se escala al peso de hoy y pierde precisión con el tiempo", () => {
    const prior = {
      tdeeKcal: 2600,
      seKcal: 120,
      localDate: START,
      weightKg: 78,
      fromDeficit: true,
    };
    const r = estimateMaintenance(
      input({
        todayLocalDate: addDays(START, 20),
        regimeStartLocalDate: addDays(START, 21),
        formulaTdeeKcal: 2860,
        formulaTdeeAtPriorWeightKcal: 2750,
        prior,
        currentIsDeficit: false,
      }),
    );
    expect(r.observed).toBeNull();
    // 2.600 × 2.860 / 2.750 ≈ 2.704
    expect(r.prior!.tdeeKcal).toBe(2704);
    // Error: √(120² + drift² + 100² de transición) > 156
    expect(r.prior!.seKcal).toBeGreaterThan(156);
    expect(r.prior!.weight).toBeGreaterThan(r.formula.weight);
    expect(r.basis).toBe("PRIOR");
    expect(r.explanation).toContain("ciclo anterior");
  });

  it("con datos del ciclo actual, lo observado manda sobre la estimación anterior", () => {
    const r = estimateMaintenance(
      input({
        prior: {
          tdeeKcal: 2300,
          seKcal: 150,
          localDate: addDays(START, -200),
          weightKg: 82,
          fromDeficit: false,
        },
        formulaTdeeAtPriorWeightKcal: 2800,
      }),
    );
    expect(r.basis).toBe("OBSERVED");
    expect(r.tdeeKcal).toBeGreaterThan(2450);
  });

  it("la memoria que se hereda es la parte de DATOS: la fórmula no se acumula ciclo tras ciclo", () => {
    const r = estimateMaintenance(input({ formulaTdeeKcal: 3400 }));
    // La combinación sí se acerca a la fórmula (muy alta aquí)…
    expect(r.tdeeKcal).toBeGreaterThan(r.observed!.tdeeKcal + 50);
    // …pero la memoria es solo lo observado (no había ciclo anterior).
    expect(r.memory!.tdeeKcal).toBe(Math.round(r.observed!.tdeeKcal));
    // Sin ningún dato propio no hay memoria que heredar.
    const soloFormula = estimateMaintenance(
      input({ todayLocalDate: addDays(START, 20) }),
    );
    expect(soloFormula.memory).toBeNull();
  });

  it("el error combinado nunca baja del mínimo declarado", () => {
    const intake = Array.from({ length: 112 }, (_, i) => ({
      localDate: addDays(START, i),
      kcal: 2150,
    }));
    const r = estimateMaintenance(
      input({
        intake,
        measurements: weighings(112, -0.4, { amp: 0.05 }),
        prior: {
          tdeeKcal: 2590,
          seKcal: 40,
          localDate: addDays(START, 100),
          weightKg: 80,
          fromDeficit: true,
        },
        formulaTdeeAtPriorWeightKcal: 2800,
      }),
    );
    expect(r.seKcal).toBeGreaterThanOrEqual(75);
  });
});

describe("summarizeLoggedIntake", () => {
  it("sin registro no presume nada", () => {
    const s = summarizeLoggedIntake([], START, addDays(START, 27));
    expect(s.sufficient).toBe(false);
    expect(s.meanKcal).toBeNull();
  });

  it("ignora días fuera de la ventana y valores no positivos", () => {
    const s = summarizeLoggedIntake(
      [
        { localDate: addDays(START, -1), kcal: 5000 },
        { localDate: START, kcal: 0 },
        { localDate: addDays(START, 1), kcal: 2000 },
      ],
      START,
      addDays(START, 1),
    );
    expect(s.loggedDays).toBe(1);
    expect(s.meanKcal).toBe(2000);
  });
});
