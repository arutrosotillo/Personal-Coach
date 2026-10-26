import { describe, expect, it } from "vitest";

import { kg, type BodyMeasurementPoint } from "@/core/body";
import {
  planCycleTargets,
  summarizeCycle,
  type CycleSummary,
} from "@/core/cycles";
import { addDays, diffDays } from "@/core/dates";
import {
  STRATEGY_TO_GOAL_TYPE,
  type GoalStrategy,
  type GoalType,
} from "@/core/enums";
import {
  evaluateCalorieAdjustment,
  type KcalDirection,
} from "@/core/nutrition/calorie-adjustment";
import {
  estimateMaintenance,
  regimeStartFor,
  type IntakeDay,
  type PriorEstimate,
} from "@/core/nutrition/energy-balance";
import { estimateInitialTargets } from "@/core/nutrition/initial-estimate";

/**
 * Simulación longitudinal de ciclos y nutrición adaptativa (docs/CYCLES.md
 * §6): personas ficticias deterministas durante 6, 12 y 24 meses, pasadas por
 * el pipeline COMPLETO —motor de ajuste día a día, estimación del
 * mantenimiento y plan al cambiar de ciclo—, aceptando cada propuesta en
 * cuanto aparece (el peor caso para la estabilidad).
 *
 * El "cuerpo" simulado NO usa los supuestos del motor, a propósito:
 *   · el gasto real escala con el peso y puede estar lejos de la fórmula;
 *   · la densidad energética real de la ganancia es 5.500 kcal/kg (mezcla de
 *     masa magra y grasa) aunque el motor asume 7.700;
 *   · el agua sigue un AR(1) con picos de sal de fin de semana, y el
 *     glucógeno salta al pasar de déficit a superávit;
 *   · lo comido no es el objetivo: hay ruido diario y sesgo de adherencia.
 * Si el motor solo funcionara cuando el mundo coincide con sus supuestos, se
 * vería aquí.
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

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const DAY0 = "2027-01-04";

const PROFILE = {
  sex: "MALE" as const,
  ageYears: 32,
  heightCm: 178,
  dailySteps: 9000,
  workActivity: "SEDENTARY" as const,
  trainingSessionsPerWeek: 4,
  minutesPerSession: 70,
};

/** Fórmula aditiva del onboarding con el peso dado. */
const formulaTdee = (weightKg: number) =>
  estimateInitialTargets({ ...PROFILE, weightKg, goalType: "MAINTENANCE" })
    .tdee;

interface Person {
  /** Gasto real − fórmula, kcal/día (positivo = gasta más de lo estimado). */
  tdeeOffset: number;
  /** Desviación típica del agua diaria (kg). */
  waterSd: number;
  /** Picos de sal/hidratos: +kg algunos lunes. */
  weekendSpikeKg: number;
  /** Comido / objetivo − 1 (sesgo medio de adherencia). */
  adherenceBias: number;
  /** ¿Registra lo que come? Con qué infraregistro. */
  logs: boolean;
  underReport: number;
  /** ¿Se pesa hoy? */
  weighs: (day: number, rand: () => number) => boolean;
}

const DAILY = () => true;

const BASE_PERSON: Person = {
  tdeeOffset: 0,
  waterSd: 0.5,
  weekendSpikeKg: 0.4,
  adherenceBias: 0,
  logs: false,
  underReport: 0,
  weighs: DAILY,
};

interface Phase {
  startDay: number;
  strategy: GoalStrategy;
  rate: number;
}

interface Change {
  day: number;
  delta: number;
  direction: KcalDirection;
  reasonCode: string;
  policy: string;
}

interface SimResult {
  changes: Change[];
  /** Cambio en dirección contraria al anterior y a menos de 56 días. */
  reversals: number;
  /** Vaivén encadenado: dos reversiones seguidas (+, −, + en < 112 días). */
  flipFlops: number;
  meanAbsStep: number;
  minDaysBetweenChanges: number | null;
  kcalStart: number;
  kcalEnd: number;
  trueTdeeEnd: number;
  weightStart: number;
  weightEnd: number;
  /** Ritmo REAL (kg/semana de peso de tejido) por bloques de 91 días de cada fase. */
  blockRates: {
    phase: number;
    fromDay: number;
    kgPerWeek: number;
    targetKgPerWeek: number;
  }[];
  summaries: CycleSummary[];
  maintenanceAtStarts: {
    phase: number;
    estimated: number;
    trueTdee: number;
    basis: string;
  }[];
  reasons: Record<string, number>;
  measurements: number;
  floorViolations: number;
  badSteps: number;
}

function simulate(opts: {
  person: Person;
  days: number;
  phases: Phase[];
  seed: number;
  startKg?: number;
}): SimResult {
  const rand = lcg(opts.seed);
  const p = opts.person;

  let tissue = opts.startKg ?? 75;
  let glycogen = 0;
  let glycogenTarget = 0;
  let water = 0;

  const measurements: BodyMeasurementPoint[] = [];
  const intake: IntakeDay[] = [];
  const targets: {
    effectiveFrom: string;
    kcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
  }[] = [];
  const changes: Change[] = [];
  const reasons: Record<string, number> = {};
  const summaries: CycleSummary[] = [];
  const maintenanceAtStarts: SimResult["maintenanceAtStarts"] = [];
  const dailyTissue: number[] = [];
  let floorViolations = 0;
  let badSteps = 0;

  let phaseIndex = -1;
  let goal: {
    type: GoalType;
    strategy: GoalStrategy;
    rate: number;
    startDate: string;
    startKg: number;
  } | null = null;
  let current = {
    kcal: 0,
    proteinG: 0,
    fatG: 0,
    carbsG: 0,
    effectiveFrom: DAY0,
  };
  let lastChange: { localDate: string; direction: KcalDirection } | null = null;
  let previousGoalType: GoalType | null = null;
  let prior: PriorEstimate | null = null;
  let weightStart = 0;

  const trueTdee = (day: number) =>
    formulaTdee(tissue + glycogen) +
    p.tdeeOffset +
    // Deriva lenta del gasto (estaciones, NEAT): ±60 kcal en ~un año.
    60 * Math.sin((2 * Math.PI * day) / 365);

  const observedKg = () => tissue + glycogen + water;

  for (let day = 0; day < opts.days; day++) {
    const today = addDays(DAY0, day);

    // ── Cambio de ciclo (decisión de la persona, nunca del motor) ──
    const next = opts.phases[phaseIndex + 1];
    if (next && next.startDay === day) {
      const nextType = STRATEGY_TO_GOAL_TYPE[next.strategy];
      const weightNow = measurements.length
        ? (measurements[measurements.length - 1].weightKg as number)
        : observedKg();
      let maintenanceKcal: number;
      let basis = "FORMULA";
      if (goal) {
        // Cierre del ciclo anterior: resumen + estimación congelada.
        const regime = regimeStartFor(
          goal.startDate,
          previousGoalType === "FAT_LOSS",
          goal.type === "FAT_LOSS",
        );
        const est = estimateMaintenance({
          todayLocalDate: addDays(today, -1),
          regimeStartLocalDate: regime,
          measurements,
          intake: p.logs ? intake : [],
          targets,
          formulaTdeeKcal: formulaTdee(weightNow),
          formulaTdeeAtPriorWeightKcal: prior
            ? formulaTdee(prior.weightKg)
            : null,
          prior,
          currentIsDeficit: goal.type === "FAT_LOSS",
        });
        summaries.push(
          summarizeCycle({
            goal: {
              strategy: goal.strategy,
              type: goal.type,
              status: "COMPLETED",
              startDate: goal.startDate,
              weeklyRatePct: goal.rate,
              startWeightKg: goal.startKg,
              targetWeightKg: null,
            },
            endLocalDate: addDays(today, -1),
            measurements,
            targets,
            intake: p.logs ? intake : [],
            performance: null,
            maintenance: est,
          }),
        );
        // Se hereda la MEMORIA (parte de datos), no la combinación con la
        // fórmula: la fórmula entra una sola vez, en cada estimación.
        prior = est.memory && {
          tdeeKcal: est.memory.tdeeKcal,
          seKcal: est.memory.seKcal,
          localDate: addDays(today, -1),
          weightKg: weightNow,
          fromDeficit: goal.type === "FAT_LOSS",
        };
        // Al empezar el nuevo, la estimación ya no tiene régimen propio: es
        // la del cierre (prior) combinada con la fórmula.
        const atStart = estimateMaintenance({
          todayLocalDate: today,
          regimeStartLocalDate: regimeStartFor(
            today,
            goal.type === "FAT_LOSS",
            nextType === "FAT_LOSS",
          ),
          measurements,
          intake: [],
          targets,
          formulaTdeeKcal: formulaTdee(weightNow),
          formulaTdeeAtPriorWeightKcal: prior
            ? formulaTdee(prior.weightKg)
            : null,
          prior,
          currentIsDeficit: nextType === "FAT_LOSS",
        });
        maintenanceKcal = atStart.tdeeKcal;
        basis = atStart.basis;
        previousGoalType = goal.type;
        const planned = planCycleTargets({
          strategy: next.strategy,
          weeklyRatePct: next.rate,
          ...PROFILE,
          weightKg: weightNow,
          maintenance: atStart,
          previousGoalType,
          currentKcal: current.kcal,
        });
        current = {
          kcal: planned.kcal,
          proteinG: planned.proteinG,
          fatG: planned.fatG,
          carbsG: planned.carbsG,
          effectiveFrom: today,
        };
      } else {
        // Primer ciclo: el onboarding (fórmula pura).
        const est = estimateInitialTargets({
          ...PROFILE,
          weightKg: weightNow,
          goalType: nextType,
          weeklyRatePct: next.rate,
        });
        maintenanceKcal = est.tdee;
        current = {
          kcal: est.kcalTarget,
          proteinG: est.proteinG,
          fatG: est.fatG,
          carbsG: est.carbsG,
          effectiveFrom: today,
        };
        weightStart = weightNow;
      }
      maintenanceAtStarts.push({
        phase: phaseIndex + 1,
        estimated: maintenanceKcal,
        trueTdee: Math.round(trueTdee(day)),
        basis,
      });
      targets.push({ ...current });
      // Glucógeno: comer más tras un déficit rellena; empezar un déficit vacía.
      const wasDeficit = goal?.type === "FAT_LOSS";
      if (wasDeficit && nextType !== "FAT_LOSS") glycogenTarget += 1.5;
      if (!wasDeficit && nextType === "FAT_LOSS") glycogenTarget -= 1.0;
      goal = {
        type: nextType,
        strategy: next.strategy,
        rate: next.rate,
        startDate: today,
        startKg: weightNow,
      };
      lastChange = null;
      phaseIndex++;
    }
    if (!goal) throw new Error("La simulación necesita una fase en el día 0");

    // ── El cuerpo ──
    const eaten = current.kcal * (1 + p.adherenceBias) + 150 * gaussian(rand);
    const balance = eaten - trueTdee(day);
    tissue += balance / (balance >= 0 ? 5500 : 7700);
    glycogen += (glycogenTarget - glycogen) / 4;
    water = 0.6 * water + p.waterSd * Math.sqrt(1 - 0.36) * gaussian(rand);
    dailyTissue.push(tissue);
    const spike = diffDays(DAY0, today) % 7 === 0 ? p.weekendSpikeKg : 0;

    if (p.weighs(day, rand)) {
      measurements.push({
        localDate: today,
        weightKg: kg(Math.round((observedKg() + spike) * 10) / 10),
        waistCm: null,
        waistProtocol: null,
        bodyFatPct: null,
        bodyFatReliability: null,
      });
    }
    if (p.logs) {
      intake.push({
        localDate: today,
        kcal: Math.round(eaten * (1 - p.underReport)),
      });
    }

    // ── El motor, como si la persona abriera la app cada día ──
    const r = evaluateCalorieAdjustment({
      todayLocalDate: today,
      ...PROFILE,
      goal: {
        type: goal.type,
        strategy: goal.strategy,
        weeklyRatePct: goal.rate,
        startWeightKg: kg(goal.startKg),
        targetWeightKg: null,
        startDate: goal.startDate,
      },
      measurements,
      currentTarget: current,
      lastChange,
      lastRejectedLocalDate: null,
      intake: p.logs ? intake : [],
      previousGoalType,
      performanceTrend: "STABLE",
    });
    reasons[r.reasonCode] = (reasons[r.reasonCode] ?? 0) + 1;
    if (r.action === "ADJUST" && r.proposal) {
      const step = Math.abs(r.proposal.deltaKcal);
      if (
        step % 25 !== 0 ||
        step > 150 ||
        (step < 50 && !r.proposal.clampedToFloor)
      )
        badSteps++;
      if (r.floorKcal !== null && r.proposal.kcal < r.floorKcal)
        floorViolations++;
      changes.push({
        day,
        delta: r.proposal.deltaKcal,
        direction: r.proposal.direction,
        reasonCode: r.reasonCode,
        policy: r.policy,
      });
      if (process.env.SIM_DEBUG) {
        const w = r.now!;
        const from = Math.max(0, day - w.windowDays + 1);
        const trueSlope =
          ((dailyTissue[day] - dailyTissue[from]) / Math.max(day - from, 1)) *
          7;
        console.log(
          `  d${day} ${r.reasonCode} obs=${w.observedKgPerWeek.toFixed(3)} ci=[${w.ciLowKgPerWeek.toFixed(3)},${w.ciHighKgPerWeek.toFixed(3)}] win=${w.windowDays} n=${w.measurements} target=${w.targetKgPerWeek.toFixed(3)} trueTissue=${trueSlope.toFixed(3)} weekAgo=${r.weekAgo?.observedKgPerWeek.toFixed(3)} track=${r.trackingStartLocalDate}`,
        );
      }
      current = {
        kcal: r.proposal.kcal,
        proteinG: r.proposal.proteinG,
        fatG: r.proposal.fatG,
        carbsG: r.proposal.carbsG,
        effectiveFrom: today,
      };
      targets.push({ ...current });
      lastChange = { localDate: today, direction: r.proposal.direction };
    }
  }

  // ── Métricas ──
  let reversals = 0;
  let minGap: number | null = null;
  for (let i = 1; i < changes.length; i++) {
    const gap = changes[i].day - changes[i - 1].day;
    // La definición conserva sus enfriamientos de 7/14 días (R3); el mínimo
    // de 28 días es de las políticas adaptativas.
    if (changes[i].policy !== "LOSS") {
      minGap = minGap === null ? gap : Math.min(minGap, gap);
    }
    if (changes[i].direction !== changes[i - 1].direction && gap < 56)
      reversals++;
  }
  let flipFlops = 0;
  for (let i = 2; i < changes.length; i++) {
    const a = changes[i - 2];
    const b = changes[i - 1];
    const c = changes[i];
    if (
      a.direction !== b.direction &&
      b.direction !== c.direction &&
      c.day - a.day < 112
    ) {
      flipFlops++;
    }
  }
  const meanAbsStep =
    changes.length === 0
      ? 0
      : changes.reduce((acc, c) => acc + Math.abs(c.delta), 0) / changes.length;
  const blockRates: SimResult["blockRates"] = [];
  opts.phases.forEach((ph, idx) => {
    const end = opts.phases[idx + 1]?.startDay ?? opts.days;
    // Se salta la estabilización: los bloques empiezan en el día 28 de la fase.
    for (let from = ph.startDay + 28; from + 91 <= end; from += 91) {
      const kgPerWeek = ((dailyTissue[from + 90] - dailyTissue[from]) / 90) * 7;
      blockRates.push({
        phase: idx,
        fromDay: from,
        kgPerWeek,
        targetKgPerWeek: (ph.rate / 100) * dailyTissue[from],
      });
    }
  });

  return {
    changes,
    reversals,
    flipFlops,
    meanAbsStep,
    minDaysBetweenChanges: minGap,
    kcalStart: targets[0].kcal,
    kcalEnd: current.kcal,
    trueTdeeEnd: Math.round(trueTdee(opts.days - 1)),
    weightStart,
    weightEnd: tissue + glycogen,
    blockRates,
    summaries,
    maintenanceAtStarts,
    reasons,
    measurements: measurements.length,
    floorViolations,
    badSteps,
  };
}

function report(name: string, r: SimResult) {
  if (!process.env.SIM_VERBOSE) return;
  const rates = r.blockRates
    .map(
      (b) =>
        `${(b.kgPerWeek * 1000).toFixed(0)}/${(b.targetKgPerWeek * 1000).toFixed(0)}g`,
    )
    .join(" ");
  console.log(
    `${name}: cambios=${r.changes.length} [${r.changes.map((c) => `d${c.day}:${c.delta > 0 ? "+" : ""}${c.delta}`).join(" ")}] reversiones=${r.reversals} minGap=${r.minDaysBetweenChanges} kcal ${r.kcalStart}→${r.kcalEnd} (gasto real final ${r.trueTdeeEnd}) peso ${r.weightStart.toFixed(1)}→${r.weightEnd.toFixed(1)} bloques(real/objetivo)=${rates} mant@inicio=${JSON.stringify(r.maintenanceAtStarts)}`,
  );
}

/**
 * Invariantes que deben cumplirse en TODA simulación. La estabilidad se mide
 * como la pide la spec —sin vaivenes de +100/−100 encadenados—, no como "cero
 * cambios de dirección": la simulación incluye una deriva estacional del gasto
 * y el gasto sube con el peso ganado, y responder a eso es correcto.
 */
function expectSane(r: SimResult, days?: number) {
  expect(r.floorViolations).toBe(0);
  expect(r.badSteps).toBe(0);
  expect(r.flipFlops).toBe(0);
  if (days !== undefined) {
    // Como mucho una reversión por año, y pasos pequeños de media.
    expect(r.reversals).toBeLessThanOrEqual(
      Math.max(1, Math.floor(days / 365)),
    );
    if (r.changes.length > 0) expect(r.meanAbsStep).toBeLessThanOrEqual(110);
  }
  // Nunca dos cambios a menos de 28 días.
  if (r.minDaysBetweenChanges !== null) {
    expect(r.minDaysBetweenChanges).toBeGreaterThanOrEqual(28);
  }
}

const HORIZONS = [
  { label: "6 meses", days: 182 },
  { label: "12 meses", days: 365 },
  { label: "24 meses", days: 730 },
];

const BULK: Phase[] = [{ startDay: 0, strategy: "LEAN_GAIN", rate: 0.15 }];

describe("volumen limpio de larga duración", () => {
  for (const h of HORIZONS) {
    it(`progresa bien (${h.label}): pocos cambios, sin oscilar, al ritmo`, () => {
      const r = simulate({
        person: BASE_PERSON,
        days: h.days,
        phases: BULK,
        seed: 11,
      });
      report(`ok-${h.days}`, r);
      expectSane(r, h.days);
      // Como mucho un cambio cada ~2 meses de media.
      expect(r.changes.length).toBeLessThanOrEqual(Math.ceil(h.days / 60));
      // Cada bloque de 13 semanas tras la estabilización, cerca del objetivo.
      for (const b of r.blockRates) {
        expect(b.kgPerWeek).toBeGreaterThan(0);
        expect(b.kgPerWeek).toBeLessThan(b.targetKgPerWeek * 2.5);
      }
    });
  }

  it("24 meses: las calorías suben con el peso ganado (el gasto también sube)", () => {
    const r = simulate({
      person: BASE_PERSON,
      days: 730,
      phases: BULK,
      seed: 11,
    });
    expect(r.weightEnd - r.weightStart).toBeGreaterThan(2);
    expect(r.kcalEnd).toBeGreaterThanOrEqual(r.kcalStart);
    // Ganancia media de los dos años, en el orden del objetivo (0,15 %/sem).
    const weeks = 730 / 7;
    const pctPerWeek =
      ((r.weightEnd - r.weightStart) / r.weightStart / weeks) * 100;
    expect(pctPerWeek).toBeGreaterThan(0.05);
    expect(pctPerWeek).toBeLessThan(0.3);
  });

  for (const h of HORIZONS.slice(1)) {
    it(`no gana peso porque gasta 300 kcal más de lo estimado (${h.label}): sube calorías hasta corregirlo`, () => {
      const r = simulate({
        person: { ...BASE_PERSON, tdeeOffset: 300 },
        days: h.days,
        phases: BULK,
        seed: 23,
      });
      report(`noGana-${h.days}`, r);
      expectSane(r, h.days);
      // Lo primero que hace es subir, y en neto sube al menos lo que faltaba.
      expect(r.changes[0].direction).toBe("UP");
      expect(r.changes[0].day).toBeLessThan(90);
      expect(r.kcalEnd - r.kcalStart).toBeGreaterThanOrEqual(200);
      // El último bloque ya gana peso.
      const last = r.blockRates[r.blockRates.length - 1];
      expect(last.kgPerWeek).toBeGreaterThan(0.25 * last.targetKgPerWeek);
    });

    it(`gana demasiado rápido porque gasta 300 kcal menos (${h.label}): baja calorías sin pasarse`, () => {
      const r = simulate({
        person: { ...BASE_PERSON, tdeeOffset: -300 },
        days: h.days,
        phases: BULK,
        seed: 31,
      });
      report(`rapido-${h.days}`, r);
      expectSane(r, h.days);
      // Baja pronto y lo suficiente: los primeros 6 meses acaban ≥ 150 kcal
      // por debajo. (A dos años el gasto ha subido con los kilos ganados y es
      // correcto que las calorías vuelvan a subir.)
      expect(r.changes[0].direction).toBe("DOWN");
      expect(r.changes[0].day).toBeLessThan(90);
      const firstHalfYear = r.changes.filter((c) => c.day < 182);
      expect(
        firstHalfYear.reduce((a, c) => a + c.delta, 0),
      ).toBeLessThanOrEqual(-150);
      const last = r.blockRates[r.blockRates.length - 1];
      expect(last.kgPerWeek).toBeLessThan(2 * last.targetKgPerWeek);
      // A largo plazo, el ritmo medio queda cerca del objetivo (0,15 %/sem).
      const pctPerWeek =
        ((r.weightEnd - r.weightStart) / r.weightStart / (h.days / 7)) * 100;
      expect(pctPerWeek).toBeLessThan(0.3);
    });
  }

  it("pesajes irregulares (2–4 días/semana, con huecos de 10 días): decide menos, nunca absurdo", () => {
    const weighs = (day: number, rand: () => number) =>
      !(day % 60 >= 40 && day % 60 < 50) && rand() < 0.45;
    const r = simulate({
      person: { ...BASE_PERSON, tdeeOffset: 250, weighs },
      days: 365,
      phases: BULK,
      seed: 47,
    });
    report("irregular", r);
    expectSane(r, 365);
    expect(r.changes[0].direction).toBe("UP");
    expect(r.kcalEnd - r.kcalStart).toBeGreaterThanOrEqual(150);
    expect(r.measurements).toBeLessThan(200);
  });

  it("fluctuaciones de agua grandes (±1 kg y picos de 1,5 kg), al ritmo: no reacciona al ruido", () => {
    const r = simulate({
      person: { ...BASE_PERSON, waterSd: 1.0, weekendSpikeKg: 1.5 },
      days: 365,
      phases: BULK,
      seed: 59,
    });
    report("agua", r);
    expectSane(r, 365);
    expect(r.changes.length).toBeLessThanOrEqual(3);
  });

  it("registra lo que come y come por debajo del objetivo: no sube el número, señala la adherencia", () => {
    const r = simulate({
      person: { ...BASE_PERSON, logs: true, adherenceBias: -0.12 },
      days: 240,
      phases: BULK,
      seed: 61,
    });
    report("adherencia", r);
    expectSane(r, 240);
    expect(r.reasons.ADHERENCE_GAP ?? 0).toBeGreaterThan(0);
    expect(r.changes.filter((c) => c.direction === "UP")).toHaveLength(0);
  });

  it("no registra lo que come: el motor funciona igual con el objetivo como referencia", () => {
    const r = simulate({
      person: { ...BASE_PERSON, tdeeOffset: 200 },
      days: 365,
      phases: BULK,
      seed: 67,
    });
    report("sinRegistro", r);
    expectSane(r, 365);
    expect(r.reasons.ADHERENCE_GAP ?? 0).toBe(0);
    expect(r.changes.length).toBeGreaterThan(0);
  });
});

describe("varios cambios de objetivo a lo largo de dos años", () => {
  const PHASES: Phase[] = [
    { startDay: 0, strategy: "FAT_LOSS_MUSCLE_PRESERVATION", rate: -0.5 },
    { startDay: 120, strategy: "LEAN_GAIN", rate: 0.15 },
    { startDay: 485, strategy: "MAINTENANCE", rate: 0 },
    { startDay: 575, strategy: "LEAN_GAIN", rate: 0.1 },
  ];

  it("definición → volumen → mantenimiento → volumen: estimaciones aprendidas, historial entero", () => {
    const r = simulate({
      person: { ...BASE_PERSON, tdeeOffset: -150 },
      days: 730,
      phases: PHASES,
      seed: 73,
      startKg: 84,
    });
    report("multiciclo", r);
    expectSane(r, 730);

    // Historial: un resumen por ciclo cerrado, encadenados sin huecos.
    expect(r.summaries).toHaveLength(3);
    for (let i = 1; i < r.summaries.length; i++) {
      expect(
        diffDays(
          r.summaries[i - 1].endLocalDate,
          r.summaries[i].startLocalDate,
        ),
      ).toBe(1);
    }
    expect(r.summaries[0].weight.changeKg!).toBeLessThan(-4);
    expect(r.measurements).toBe(730);

    // El onboarding usa la fórmula (que aquí se equivoca en 150 kcal); los
    // ciclos siguientes usan lo aprendido y se acercan al gasto real.
    const [first, ...later] = r.maintenanceAtStarts;
    expect(first.basis).toBe("FORMULA");
    for (const m of later) {
      expect(m.basis).toBe("PRIOR");
      expect(Math.abs(m.estimated - m.trueTdee)).toBeLessThan(
        Math.abs(first.estimated - first.trueTdee) + 50,
      );
      expect(Math.abs(m.estimated - m.trueTdee)).toBeLessThan(250);
    }

    // Tras la definición, el relleno de glucógeno no provoca un recorte.
    const earlyBulkCuts = r.changes.filter(
      (c) => c.day >= 120 && c.day < 120 + 45 && c.direction === "DOWN",
    );
    expect(earlyBulkCuts).toHaveLength(0);
  });
});
