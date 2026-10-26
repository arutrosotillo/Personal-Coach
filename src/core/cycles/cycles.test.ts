import { describe, expect, it } from "vitest";

import { cm, kg, pctPoints, type BodyMeasurementPoint } from "@/core/body";
import {
  assessComposition,
  planCycleTargets,
  summarizeCycle,
  summarizePerformance,
  trainingVolumeNote,
  type PerformanceSetPoint,
} from "@/core/cycles";
import { addDays } from "@/core/dates";
import type { MaintenanceEstimate } from "@/core/nutrition/energy-balance";

const START = "2026-06-01";

const noise = (i: number, amp = 1) =>
  amp * (0.35 * Math.sin(i * 1.7) + 0.15 * Math.cos(i * 0.9));

function cut(days: number): BodyMeasurementPoint[] {
  return Array.from({ length: days }, (_, i) => ({
    localDate: addDays(START, i),
    weightKg: kg(Math.round((84 - (0.42 / 7) * i + noise(i)) * 10) / 10),
    waistCm: i % 14 === 0 ? cm(94 - i * 0.045) : null,
    waistProtocol: i % 14 === 0 ? ("MEAN_OF_THREE" as const) : null,
    bodyFatPct: null,
    bodyFatReliability: null,
  }));
}

function maintenance(
  over: Partial<MaintenanceEstimate> = {},
): MaintenanceEstimate {
  return {
    engineVersion: "test",
    tdeeKcal: 2600,
    lowKcal: 2275,
    highKcal: 2925,
    seKcal: 165,
    confidence: "MEDIUM",
    basis: "OBSERVED",
    reasonCode: "OBSERVED_DOMINANT",
    observed: null,
    observedUnavailableReason: null,
    prior: null,
    formula: { tdeeKcal: 2800, seKcal: 420, weight: 0.2 },
    observedWeight: 0.8,
    memory: { tdeeKcal: 2560, seKcal: 180 },
    explanation: "",
    notes: [],
    ...over,
  };
}

describe("planCycleTargets", () => {
  it("de definición a volumen limpio: mantenimiento observado + superávit pequeño", () => {
    const plan = planCycleTargets({
      strategy: "LEAN_GAIN",
      weeklyRatePct: 0.15,
      sex: "MALE",
      ageYears: 34,
      heightCm: 178,
      weightKg: 77,
      maintenance: maintenance(),
      previousGoalType: "FAT_LOSS",
      currentKcal: 2150,
    });
    // 77 × 0,15 % × 7.700 / 7 ≈ 127 kcal → 2.600 + 127 → 2.725
    expect(plan.kcal).toBe(2725);
    expect(plan.energyDeltaKcal).toBe(125);
    expect(plan.deltaVsCurrentKcal).toBe(575);
    expect(plan.goalType).toBe("LEAN_GAIN");
    // Proteína y grasa de ganancia (1,8 y 0,9 g/kg); el resto, carbohidratos.
    expect(plan.proteinG).toBe(139);
    expect(plan.fatG).toBe(69);
    expect(plan.carbsG).toBe(Math.round((2725 - 139 * 4 - 69 * 9) / 4));
    expect(plan.explanation.kcal).toContain("2600");
    expect(plan.explanation.expectations.join(" ")).toContain("glucógeno");
    expect(plan.explanation.expectations.join(" ")).toContain(
      "No hay fecha de fin",
    );
  });

  it("ritmos muy pequeños: 0,10 %/semana es un superávit de ~100 kcal", () => {
    const plan = planCycleTargets({
      strategy: "LEAN_GAIN",
      weeklyRatePct: 0.1,
      sex: "MALE",
      ageYears: 34,
      heightCm: 178,
      weightKg: 77,
      maintenance: maintenance(),
      previousGoalType: null,
      currentKcal: null,
    });
    expect(plan.energyDeltaKcal).toBe(75);
    expect(plan.expectedKgPerWeek * 1000).toBeCloseTo(68, 0);
  });

  it("acota el ritmo al rango de la estrategia", () => {
    const plan = planCycleTargets({
      strategy: "LEAN_GAIN",
      weeklyRatePct: 0.6,
      sex: "MALE",
      ageYears: 34,
      heightCm: 178,
      weightKg: 77,
      maintenance: maintenance(),
      previousGoalType: null,
      currentKcal: null,
    });
    expect(plan.weeklyRatePct).toBe(0.25);
    expect(plan.rateClamped).toBe(true);
  });

  it("mantenimiento y recomposición: kcal = mantenimiento estimado", () => {
    for (const strategy of ["MAINTENANCE", "RECOMP_MAINTAIN_WEIGHT"] as const) {
      const plan = planCycleTargets({
        strategy,
        sex: "FEMALE",
        ageYears: 29,
        heightCm: 165,
        weightKg: 60,
        maintenance: maintenance({
          tdeeKcal: 2050,
          lowKcal: 1800,
          highKcal: 2300,
        }),
        previousGoalType: "FAT_LOSS",
        currentKcal: 1725,
      });
      expect(plan.kcal).toBe(2050);
      expect(plan.energyDeltaKcal).toBe(0);
      expect(plan.explanation.kcal).toContain("sin superávit ni déficit");
    }
  });

  it("definición nueva: respeta el tope de déficit y el suelo inviolable", () => {
    const plan = planCycleTargets({
      strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
      weeklyRatePct: -1,
      sex: "FEMALE",
      ageYears: 29,
      heightCm: 160,
      weightKg: 55,
      maintenance: maintenance({
        tdeeKcal: 1600,
        lowKcal: 1350,
        highKcal: 1850,
      }),
      previousGoalType: "MAINTENANCE",
      currentKcal: 1600,
    });
    expect(plan.kcal).toBeGreaterThanOrEqual(1200);
    expect(plan.kcal).toBeGreaterThanOrEqual(plan.floorKcal);
    expect(plan.boundedByMaxDeficit || plan.clampedToFloor).toBe(true);
  });
});

describe("trainingVolumeNote", () => {
  it("salir de definición recomienda (sin imponer) recuperar volumen", () => {
    const note = trainingVolumeNote("FAT_LOSS", "LEAN_GAIN");
    expect(note).toContain("15 %");
    expect(note).toContain("sigue igual");
  });
  it("entrar en definición también lo menciona; entre fases no deficitarias, nada", () => {
    expect(trainingVolumeNote("LEAN_GAIN", "FAT_LOSS")).toContain("15 %");
    expect(trainingVolumeNote("LEAN_GAIN", "MAINTENANCE")).toBeNull();
    expect(trainingVolumeNote(null, "LEAN_GAIN")).toBeNull();
  });
});

describe("summarizeCycle", () => {
  const end = addDays(START, 119);
  const summary = summarizeCycle({
    goal: {
      strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
      type: "FAT_LOSS",
      status: "COMPLETED",
      startDate: START,
      weeklyRatePct: -0.5,
      startWeightKg: 84,
      targetWeightKg: 78,
    },
    endLocalDate: end,
    measurements: cut(120),
    targets: [
      {
        effectiveFrom: START,
        kcal: 2150,
        proteinG: 179,
        fatG: 65,
        carbsG: 212,
      },
      {
        effectiveFrom: addDays(START, 70),
        kcal: 2050,
        proteinG: 179,
        fatG: 65,
        carbsG: 187,
      },
    ],
    intake: [],
    performance: null,
    maintenance: maintenance(),
  });

  it("fechas, duración y peso de inicio/cierre por medias de 7 días", () => {
    expect(summary.days).toBe(120);
    expect(summary.weeks).toBeCloseTo(17.1, 1);
    expect(summary.weight.startKg!).toBeCloseTo(83.8, 0);
    expect(summary.weight.endKg!).toBeCloseTo(76.9, 0);
    expect(summary.weight.changeKg!).toBeLessThan(-6);
    expect(summary.weight.ratePerWeekKg!).toBeCloseTo(-0.42, 1);
    expect(summary.weight.ratePctPerWeek!).toBeCloseTo(-0.5, 1);
  });

  it("cintura por encima de su error de medida y objetivos calóricos del periodo", () => {
    expect(summary.waist.status).toBe("DECREASING");
    expect(summary.waist.fittedChangeCm!).toBeLessThan(-3.1);
    expect(summary.nutrition.periods).toHaveLength(2);
    expect(summary.nutrition.periods[0].toLocalDate).toBe(addDays(START, 69));
    // (70 × 2.150 + 50 × 2.050) / 120
    expect(summary.nutrition.meanTargetKcal!).toBeCloseTo(2108.3, 0);
  });

  it("informa si llegó al peso objetivo, sin cerrar nada por ello", () => {
    expect(summary.targetWeightReached).toBe(true);
    expect(summary.status).toBe("COMPLETED");
  });
});

describe("summarizePerformance", () => {
  const p = (
    variantId: string,
    day: number,
    e1rmKg: number,
  ): PerformanceSetPoint => ({
    variantId,
    exerciseName: variantId,
    variantName: `${variantId} — barra`,
    localDate: addDays(START, day),
    e1rmKg,
  });

  it("compara el mejor e1RM de las primeras y las últimas 3 semanas, por variante", () => {
    const r = summarizePerformance(
      [
        p("sentadilla", 2, 120),
        p("sentadilla", 9, 122),
        p("sentadilla", 110, 130),
        p("press", 3, 90),
        p("press", 112, 90.5),
        p("remo", 4, 80),
        p("remo", 115, 74),
        p("curl", 100, 40), // solo al final: no se compara
      ],
      START,
      addDays(START, 119),
    );
    expect(r!.comparedVariants).toBe(3);
    expect(r!.improved).toBe(1);
    expect(r!.stable).toBe(1);
    expect(r!.declined).toBe(1);
    expect(r!.highlights[0].exerciseName).toBe("sentadilla");
    expect(r!.highlights[0].changePct).toBeCloseTo(6.56, 1);
  });

  it("sin variantes comunes o ciclo demasiado corto: null", () => {
    expect(
      summarizePerformance([p("a", 1, 100)], START, addDays(START, 60)),
    ).toBeNull();
    expect(
      summarizePerformance([p("a", 1, 100)], START, addDays(START, 10)),
    ).toBeNull();
  });
});

describe("assessComposition (fase de ganancia)", () => {
  function bulk(
    waistRise: number,
    bf: [number, number] | null,
    reliability: "MEASURED" | "ESTIMATED" = "ESTIMATED",
  ) {
    return Array.from({ length: 140 }, (_, i): BodyMeasurementPoint => ({
      localDate: addDays(START, i),
      weightKg: kg(75 + (0.15 / 7) * i + noise(i, 0.5)),
      waistCm: i % 14 === 0 ? cm(82 + (waistRise * i) / 139) : null,
      waistProtocol: i % 14 === 0 ? "MEAN_OF_THREE" : null,
      bodyFatPct:
        bf && (i === 0 || i === 139)
          ? pctPoints(i === 0 ? bf[0] : bf[1])
          : null,
      bodyFatReliability: bf && (i === 0 || i === 139) ? reliability : null,
    }));
  }
  const base = {
    goalType: "LEAN_GAIN" as const,
    todayLocalDate: addDays(START, 139),
    cycleStartLocalDate: START,
    pace: null,
    performanceTrend: "IMPROVING" as const,
    bodyFatCeilingPct: null,
    startWeightKg: 75,
  };

  it("sin señales: NONE", () => {
    const r = assessComposition({ ...base, measurements: bulk(0.5, null) });
    expect(r!.level).toBe("NONE");
    expect(r!.options).toEqual([]);
  });

  it("solo una señal (cintura): vigila, no sugiere cambiar", () => {
    const r = assessComposition({ ...base, measurements: bulk(5, null) });
    expect(r!.level).toBe("WATCH");
    expect(r!.signals.map((s) => s.code)).toEqual(["WAIST_RISING"]);
  });

  it("cintura + % graso medido subiendo: sugiere revisar, con opciones y sin actuar", () => {
    const r = assessComposition({
      ...base,
      measurements: bulk(5, [14, 17], "MEASURED"),
    });
    expect(r!.level).toBe("SUGGEST_REVIEW");
    expect(r!.options.join(" ")).toContain("minidefinición");
    expect(r!.explanation).toContain("la decisión es tuya");
  });

  it("una lectura ESTIMADA por encima de la preferencia no es un límite rígido", () => {
    const r = assessComposition({
      ...base,
      bodyFatCeilingPct: 15,
      measurements: bulk(0.5, [14.5, 16]),
    });
    expect(r!.level).toBe("NONE");
    expect(r!.signals.map((s) => s.code)).toEqual([
      "ABOVE_BODY_FAT_PREFERENCE",
    ]);
    expect(r!.signals[0].weight).toBe(0.5);
  });

  it("solo aplica a fases de ganancia", () => {
    expect(
      assessComposition({
        ...base,
        goalType: "MAINTENANCE",
        measurements: bulk(5, null),
      }),
    ).toBeNull();
  });
});
