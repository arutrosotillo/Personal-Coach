import { describe, expect, it } from "vitest";

import { cm, kg, type BodyMeasurementPoint } from "@/core/body";
import { addDays } from "@/core/dates";
import type { GoalStrategy, GoalType } from "@/core/enums";
import {
  evaluateCalorieAdjustment,
  type CalorieAdjustmentInput,
} from "@/core/nutrition/calorie-adjustment";
import { trackingStartFor } from "@/core/nutrition/adaptive-calories";

const START = "2027-01-04";

/** Ruido determinista (agua, intestino): nunca `Math.random` en un test de motor. */
const noise = (i: number, amp = 1) =>
  amp * (0.35 * Math.sin(i * 1.7) + 0.15 * Math.cos(i * 0.9));

function series(
  days: number,
  kgPerWeekAt: (i: number) => number,
  { startKg = 75, every = 1, amp = 1, glycogenKg = 0 } = {},
): BodyMeasurementPoint[] {
  const out: BodyMeasurementPoint[] = [];
  let w = startKg;
  for (let i = 0; i < days; i++) {
    if (i > 0) w += kgPerWeekAt(i) / 7;
    // Relleno de glucógeno/agua: sube `glycogenKg` en ~10 días y se queda.
    const water = glycogenKg * Math.min(i / 10, 1);
    if (i % every === 0) {
      out.push({
        localDate: addDays(START, i),
        weightKg: kg(Math.round((w + water + noise(i, amp)) * 10) / 10),
        waistCm: null,
        waistProtocol: null,
        bodyFatPct: null,
        bodyFatReliability: null,
      });
    }
  }
  return out;
}

const GOALS: Record<GoalType, { strategy: GoalStrategy; rate: number }> = {
  LEAN_GAIN: { strategy: "LEAN_GAIN", rate: 0.15 },
  MAINTENANCE: { strategy: "MAINTENANCE", rate: 0 },
  RECOMP: { strategy: "RECOMP_MAINTAIN_WEIGHT", rate: 0 },
  FAT_LOSS: { strategy: "FAT_LOSS_MUSCLE_PRESERVATION", rate: -0.5 },
};

function input(
  type: GoalType,
  measurements: BodyMeasurementPoint[],
  dayIndex: number,
  over: Partial<CalorieAdjustmentInput> & { rate?: number } = {},
): CalorieAdjustmentInput {
  const { rate, ...rest } = over;
  return {
    todayLocalDate: addDays(START, dayIndex),
    sex: "MALE",
    ageYears: 31,
    heightCm: 178,
    goal: {
      type,
      strategy: GOALS[type].strategy,
      weeklyRatePct: rate ?? GOALS[type].rate,
      startWeightKg: kg(75),
      targetWeightKg: null,
      startDate: START,
    },
    measurements,
    currentTarget: {
      kcal: 2750,
      proteinG: 135,
      fatG: 68,
      carbsG: 401,
      effectiveFrom: START,
    },
    lastChange: null,
    lastRejectedLocalDate: null,
    ...rest,
  };
}

// 0,15 % de 75 kg ≈ 0,11 kg/semana
const onTarget = () => 0.11;

describe("ganancia: ritmos muy pequeños", () => {
  it("a +0,10 %/semana, al ritmo: 'vas al ritmo', no 'inconcluso'", () => {
    const data = series(120, () => 0.075, { amp: 1 });
    const r = evaluateCalorieAdjustment(
      input("LEAN_GAIN", data, 119, { rate: 0.1 }),
    );
    expect(r.policy).toBe("GAIN");
    expect(r.reasonCode).toBe("ON_TRACK");
    expect(r.action).toBe("HOLD");
    // La ventana es larga (≥ 56 días): solo así se distingue 75 g/semana de 0.
    expect(r.now!.windowDays).toBeGreaterThanOrEqual(56);
    expect(r.explanation).toContain("tendencia de varias semanas");
  });

  it("nunca opina las primeras semanas (estabilización)", () => {
    const data = series(30, onTarget);
    const r = evaluateCalorieAdjustment(input("LEAN_GAIN", data, 29));
    expect(r.reasonCode).toBe("INITIAL_PHASE");
    expect(r.nextEligibleLocalDate).toBe(addDays(START, 14 + 17));
    expect(r.explanation).toContain("glucógeno");
  });

  it("al salir de una definición la estabilización es de 21 días y el relleno de glucógeno no cuenta como ganancia", () => {
    const tracking = trackingStartFor(
      input("LEAN_GAIN", [], 0, { previousGoalType: "FAT_LOSS" }),
    );
    expect(tracking.start).toBe(addDays(START, 21));

    // +1,5 kg de glucógeno los primeros 10 días y después al ritmo.
    const data = series(110, onTarget, { glycogenKg: 1.5 });
    const r = evaluateCalorieAdjustment(
      input("LEAN_GAIN", data, 109, { previousGoalType: "FAT_LOSS" }),
    );
    expect(r.reasonCode).toBe("ON_TRACK");
    expect(r.proposal).toBeNull();
  });

  it("con fluctuaciones de agua grandes (±1 kg) y al ritmo, no ajusta nunca en 6 meses", () => {
    const data = series(182, onTarget, { amp: 2 });
    const adjusts: string[] = [];
    for (let d = 0; d < 182; d++) {
      const r = evaluateCalorieAdjustment(input("LEAN_GAIN", data, d));
      if (r.action === "ADJUST") adjusts.push(addDays(START, d));
    }
    expect(adjusts).toEqual([]);
  });
});

describe("ganancia: desvíos confirmados", () => {
  it("no gana peso: primero avisa y a los 14 días propone subir con un paso proporcional", () => {
    const data = series(120, () => 0);
    let first: number | null = null;
    let adjust: number | null = null;
    for (let d = 30; d < 120; d++) {
      const r = evaluateCalorieAdjustment(input("LEAN_GAIN", data, d));
      if (first === null && r.reasonCode === "SLOW_FIRST_READING") first = d;
      if (adjust === null && r.action === "ADJUST") {
        adjust = d;
        expect(r.reasonCode).toBe("SLOW_CONFIRMED");
        expect(r.proposal!.direction).toBe("UP");
        // Desvío ≈ 0,11 kg/sem ≈ 121 kcal → 60 % ≈ 75 kcal.
        expect(r.proposal!.deltaKcal).toBeGreaterThanOrEqual(50);
        expect(r.proposal!.deltaKcal).toBeLessThanOrEqual(100);
        expect(r.proposal!.proteinG).toBe(135);
        expect(r.explanation).toContain("kcal/día");
      }
    }
    expect(first).not.toBeNull();
    expect(adjust).not.toBeNull();
    expect(adjust! - first!).toBeGreaterThanOrEqual(14);
  });

  it("gana demasiado rápido (0,5 kg/sem): desvío fuerte, confirma a 7 días y propone bajar", () => {
    const data = series(80, () => 0.5);
    const r = evaluateCalorieAdjustment(input("LEAN_GAIN", data, 79));
    expect(r.reasonCode).toBe("FAST_CONFIRMED");
    expect(r.proposal!.direction).toBe("DOWN");
    expect(r.proposal!.deltaKcal).toBe(-150);
    expect(r.now!.pace).toBe("EXCESSIVE");
    expect(r.explanation).toContain("sobre todo grasa");
  });

  it("enfriamiento: no propone nada a menos de 28 días del último cambio", () => {
    const data = series(120, () => 0);
    const r = evaluateCalorieAdjustment(
      input("LEAN_GAIN", data, 119, {
        lastChange: { localDate: addDays(START, 100), direction: "UP" },
      }),
    );
    // La tendencia arranca 7 días después del cambio: aún no hay lectura.
    expect(r.reasonCode).toBe("INITIAL_PHASE");
    expect(r.trackingStartLocalDate).toBe(addDays(START, 107));
    expect(r.explanation).toContain("no mezclar");
  });

  it("antioscilación: no deshace un cambio reciente por un desvío pequeño, sí por uno grande", () => {
    // Subió calorías el día 40. Desde entonces gana algo rápido: ~0,19 kg/sem
    // frente a un objetivo de ~0,11 (desvío ≈ 1,4 bandas), sin ruido para que
    // solo pese el suelo de variabilidad semanal.
    const lastChange = {
      localDate: addDays(START, 40),
      direction: "UP" as const,
    };
    const pequeño = evaluateCalorieAdjustment(
      input(
        "LEAN_GAIN",
        series(130, (i) => (i < 40 ? 0 : 0.195), { amp: 0 }),
        124,
        {
          lastChange,
        },
      ),
    );
    expect(pequeño.reasonCode).toBe("REVERSAL_GUARD");
    expect(pequeño.action).toBe("HOLD");
    expect(pequeño.nextEligibleLocalDate).toBe(addDays(START, 40 + 91));
    expect(pequeño.explanation).toContain("oscilar");

    // Con un desvío claramente mayor (0,35 kg/sem) sí lo corrige.
    const grande = evaluateCalorieAdjustment(
      input(
        "LEAN_GAIN",
        series(130, (i) => (i < 40 ? 0 : 0.35), { amp: 0 }),
        124,
        {
          lastChange,
        },
      ),
    );
    expect(grande.reasonCode).toBe("FAST_CONFIRMED");
    expect(grande.proposal!.direction).toBe("DOWN");
  });

  it("un desvío fuerte que empieza tarde se corrige pronto y con el paso máximo", () => {
    // 60 días al ritmo y después 0,6 kg/sem (deja de controlar lo que come).
    const data = series(160, (i) => (i < 60 ? 0.11 : 0.6));
    let first: { day: number; delta: number; pace: string } | null = null;
    for (let d = 60; d < 160 && first === null; d++) {
      const r = evaluateCalorieAdjustment(input("LEAN_GAIN", data, d));
      if (r.action === "ADJUST") {
        first = { day: d, delta: r.proposal!.deltaKcal, pace: r.now!.pace };
      }
    }
    expect(first).not.toBeNull();
    // En unas 6 semanas desde el cambio de hábitos, no en 3 meses.
    expect(first!.day - 60).toBeLessThanOrEqual(45);
    expect(first!.delta).toBe(-150);
    expect(first!.pace).toBe("EXCESSIVE");
  });

  it("adherencia: si no gana porque come por debajo del objetivo, no sube el objetivo", () => {
    const data = series(120, () => 0);
    const intake = Array.from({ length: 120 }, (_, i) => ({
      localDate: addDays(START, i),
      kcal: 2400,
    }));
    const r = evaluateCalorieAdjustment(
      input("LEAN_GAIN", data, 119, { intake }),
    );
    expect(r.reasonCode).toBe("ADHERENCE_GAP");
    expect(r.action).toBe("HOLD");
    expect(r.adherence!.meanIntakeKcal).toBe(2400);
    expect(r.explanation).toContain("2400 kcal");
  });

  it("'ahora no' silencia la propuesta una semana", () => {
    const data = series(120, () => 0);
    const r = evaluateCalorieAdjustment(
      input("LEAN_GAIN", data, 119, {
        lastRejectedLocalDate: addDays(START, 116),
      }),
    );
    expect(r.reasonCode).toBe("SNOOZED");
    expect(r.nextEligibleLocalDate).toBe(addDays(START, 123));
  });
});

describe("mantenimiento (spec §10: banda ±1 %)", () => {
  it("peso estable: dentro de la banda, en positivo", () => {
    const r = evaluateCalorieAdjustment(
      input(
        "MAINTENANCE",
        series(90, () => 0),
        89,
      ),
    );
    expect(r.reasonCode).toBe("IN_BAND");
    expect(r.now!.anchorKg).toBeGreaterThan(74);
    expect(r.explanation).toContain("banda");
  });

  it("deriva hacia arriba confirmada: propone bajar hacia el centro", () => {
    const r = evaluateCalorieAdjustment(
      input(
        "MAINTENANCE",
        series(110, (i) => (i < 20 ? 0 : 0.2)),
        109,
      ),
    );
    expect(r.reasonCode).toBe("DRIFT_CONFIRMED");
    expect(r.proposal!.direction).toBe("DOWN");
    expect(Math.abs(r.proposal!.deltaKcal)).toBeGreaterThanOrEqual(50);
    expect(Math.abs(r.proposal!.deltaKcal)).toBeLessThanOrEqual(150);
    expect(r.now!.driftKg!).toBeGreaterThan(0.75);
  });

  it("fuera de banda pero ya volviendo: no toca nada", () => {
    const r = evaluateCalorieAdjustment(
      input(
        "MAINTENANCE",
        series(120, (i) => (i < 20 ? 0 : i < 70 ? 0.25 : -0.15), { amp: 0.4 }),
        119,
      ),
    );
    expect(["DRIFT_RETURNING", "IN_BAND", "DRIFTING"]).toContain(r.reasonCode);
    expect(r.action).toBe("HOLD");
  });
});

describe("recomposición (spec §10)", () => {
  it("peso estable: la báscula es lo menos importante", () => {
    const r = evaluateCalorieAdjustment(
      input(
        "RECOMP",
        series(90, () => 0),
        89,
      ),
    );
    expect(r.policy).toBe("RECOMP");
    expect(r.reasonCode).toBe("IN_BAND");
    expect(r.explanation).toContain("cintura");
  });

  it("sube > 0,25 %/sem sin bajar cintura, confirmado: −100", () => {
    const r = evaluateCalorieAdjustment(
      input(
        "RECOMP",
        series(90, () => 0.35),
        89,
      ),
    );
    expect(r.reasonCode).toBe("RECOMP_RISING_CONFIRMED");
    expect(r.proposal!.deltaKcal).toBe(-100);
  });

  it("sube, pero la cintura baja por encima del error: no ajusta", () => {
    const data = series(90, () => 0.35).map((p, i) => ({
      ...p,
      waistCm: i % 14 === 0 ? cm(88 - i * 0.08) : null,
      waistProtocol: i % 14 === 0 ? ("MEAN_OF_THREE" as const) : null,
    }));
    const r = evaluateCalorieAdjustment(input("RECOMP", data, 89));
    expect(r.action).toBe("HOLD");
    expect(r.explanation).toContain("cintura");
  });

  it("baja de peso con rendimiento estable: no sube calorías", () => {
    const r = evaluateCalorieAdjustment(
      input(
        "RECOMP",
        series(90, () => -0.4),
        89,
        {
          performanceTrend: "STABLE",
        },
      ),
    );
    expect(r.reasonCode).toBe("RECOMP_FALLING_PERFORMANCE_OK");
  });

  it("baja de peso y el rendimiento cae, confirmado: +100", () => {
    const r = evaluateCalorieAdjustment(
      input(
        "RECOMP",
        series(90, () => -0.4),
        89,
        {
          performanceTrend: "DECLINING",
        },
      ),
    );
    expect(r.reasonCode).toBe("RECOMP_FALLING_CONFIRMED");
    expect(r.proposal!.deltaKcal).toBe(100);
  });
});

describe("suelo de seguridad en las políticas adaptativas", () => {
  it("nunca propone bajar del suelo", () => {
    const r = evaluateCalorieAdjustment(
      input(
        "LEAN_GAIN",
        series(80, () => 0.5),
        79,
        {
          currentTarget: {
            kcal: 1700,
            proteinG: 135,
            fatG: 60,
            carbsG: 155,
            effectiveFrom: START,
          },
        },
      ),
    );
    expect(r.floorKcal).not.toBeNull();
    if (r.proposal) {
      expect(r.proposal.kcal).toBeGreaterThanOrEqual(r.floorKcal!);
    } else {
      expect(r.reasonCode).toBe("AT_FLOOR");
    }
  });
});
