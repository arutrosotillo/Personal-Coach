import { describe, expect, it } from "vitest";

import type { BodyAnalysis, WeightTrendStatus } from "@/core/body";
import type { GoalType } from "@/core/enums";
import {
  analyzeBodyPerformance,
  type GoalAssessmentCode,
} from "@/core/insights/body-performance";
import type {
  PerformanceAssessment,
  PerformanceTrend,
} from "@/core/insights/performance";

/**
 * La matriz cuerpo × rendimiento × objetivo, celda a celda.
 *
 * Y sobre todo: la invariante que da sentido a B5 — el motor OBSERVA y no
 * diagnostica. Hay un test que recorre TODAS las combinaciones posibles y
 * comprueba que ningún código de salida nombra una causa.
 */

/** `BodyAnalysis` mínimo: solo lo que el motor de insights mira. */
function cuerpo(
  status: WeightTrendStatus,
  goalType: GoalType | null,
  observed: number | null = -0.42,
): BodyAnalysis {
  return {
    todayLocalDate: "2026-09-01",
    analysisStartLocalDate: null,
    engineVersion: "1.0.0",
    weight: {
      status,
      reasonCode: "CONFIDENCE_INTERVAL_BELOW_ZERO",
      confidence: "HIGH",
      windowDays: status === "INSUFFICIENT_DATA" ? null : 28,
      trend: null,
      latestKg: null,
      latestLocalDate: null,
      latestEmaKg: null,
      totalChangeKg: null,
      series: [],
      measurementsInWindow: 28,
    },
    waist: {
      status: "INSUFFICIENT_DATA",
      reasonCode: "NO_MEASUREMENTS",
      confidence: "LOW",
      trend: null,
      fittedChangeCm: null,
      minDetectableChangeCm: 5.4,
      protocol: null,
      latestCm: null,
      latestLocalDate: null,
      measurementsUsed: 0,
    },
    bodyFat: {
      status: "NOT_RECORDED",
      reasonCode: null,
      confidence: "LOW",
      changePp: null,
      minInterpretableChangePp: 2,
      latestPct: null,
      latestReliability: null,
      latestLocalDate: null,
      comparedReliability: null,
      excludedByReliability: 0,
      spanDays: null,
      measurementsUsed: 0,
    },
    goal:
      goalType === null
        ? null
        : {
            goalType,
            strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
            targetPctPerWeek: -0.5,
            targetKgPerWeek: -0.41,
            referenceWeightKg: null,
            expectedDirection: "DOWN",
            observedKgPerWeek: observed,
            ratio: null,
            targetWeightKg: null,
            kgToTargetWeight: null,
          },
  };
}

function rendimiento(
  trend: PerformanceTrend,
  counts: Partial<PerformanceAssessment> = {},
): PerformanceAssessment {
  return {
    trend,
    reasonCode: "MIXED_SIGNALS",
    judged: 6,
    improving: trend === "IMPROVING" ? 4 : 1,
    stable: 4,
    declining: trend === "DECLINING" ? 3 : 0,
    notJudged: 0,
    recentDeload: false,
    variants: [],
    ...counts,
  };
}

function insight(
  status: WeightTrendStatus,
  trend: PerformanceTrend,
  goalType: GoalType | null,
) {
  return analyzeBodyPerformance({
    bodyAnalysis: cuerpo(status, goalType),
    performance: rendimiento(trend),
  });
}

const TODOS_PESO: WeightTrendStatus[] = [
  "INSUFFICIENT_DATA",
  "INCONCLUSIVE",
  "MAINTAINING",
  "LOSING",
  "GAINING",
];
const TODOS_RENDIMIENTO: PerformanceTrend[] = [
  "INSUFFICIENT_DATA",
  "STABLE",
  "IMPROVING",
  "DECLINING",
];
const TODOS_OBJETIVOS: GoalType[] = [
  "FAT_LOSS",
  "LEAN_GAIN",
  "RECOMP",
  "MAINTENANCE",
];

describe("FAT_LOSS", () => {
  it.each([
    ["IMPROVING", "LOSING_PERFORMANCE_UP"],
    ["STABLE", "LOSING_PERFORMANCE_HELD"],
    ["DECLINING", "LOSING_PERFORMANCE_DOWN"],
  ] as const)("perdiendo peso + rendimiento %s", (trend, esperado) => {
    const r = insight("LOSING", trend, "FAT_LOSS");
    expect(r.goalAssessment?.code).toBe(esperado);
    expect(r.worthShowing).toBe(true);
  });

  it("peso quieto + fuerza subiendo es señal de recomposición, aunque el objetivo sea perder", () => {
    const r = insight("MAINTAINING", "IMPROVING", "FAT_LOSS");
    expect(r.goalAssessment?.code).toBe("RECOMP_SIGNAL");
  });

  it("peso quieto sin fuerza subiendo: el peso no se mueve, y ya", () => {
    expect(
      insight("MAINTAINING", "STABLE", "FAT_LOSS").goalAssessment?.code,
    ).toBe("WEIGHT_NOT_MOVING");
    expect(
      insight("MAINTAINING", "DECLINING", "FAT_LOSS").goalAssessment?.code,
    ).toBe("WEIGHT_NOT_MOVING");
  });

  it("subiendo de peso con objetivo de perder va contra el objetivo", () => {
    expect(
      insight("GAINING", "IMPROVING", "FAT_LOSS").goalAssessment?.code,
    ).toBe("MOVING_AGAINST_GOAL");
  });
});

describe("LEAN_GAIN", () => {
  it.each([
    ["IMPROVING", "GAINING_PERFORMANCE_UP"],
    ["STABLE", "GAINING_PERFORMANCE_HELD"],
    ["DECLINING", "GAINING_PERFORMANCE_DOWN"],
  ] as const)("ganando peso + rendimiento %s", (trend, esperado) => {
    expect(insight("GAINING", trend, "LEAN_GAIN").goalAssessment?.code).toBe(
      esperado,
    );
  });

  it("peso quieto con objetivo de ganar: el peso no se mueve", () => {
    expect(
      insight("MAINTAINING", "IMPROVING", "LEAN_GAIN").goalAssessment?.code,
    ).toBe("WEIGHT_NOT_MOVING");
  });

  it("bajando de peso con objetivo de ganar va contra el objetivo", () => {
    expect(insight("LOSING", "STABLE", "LEAN_GAIN").goalAssessment?.code).toBe(
      "MOVING_AGAINST_GOAL",
    );
  });
});

describe("MAINTENANCE y RECOMP", () => {
  it.each(["MAINTENANCE", "RECOMP"] as const)(
    "%s: peso estable + fuerza subiendo es recomposición",
    (goalType) => {
      expect(
        insight("MAINTAINING", "IMPROVING", goalType).goalAssessment?.code,
      ).toBe("RECOMP_SIGNAL");
    },
  );

  it.each(["MAINTENANCE", "RECOMP"] as const)(
    "%s: peso estable + rendimiento estable es exactamente lo buscado",
    (goalType) => {
      expect(
        insight("MAINTAINING", "STABLE", goalType).goalAssessment?.code,
      ).toBe("HOLDING_AS_INTENDED");
    },
  );

  it.each(["MAINTENANCE", "RECOMP"] as const)(
    "%s: peso estable + rendimiento cayendo NO produce insight, a propósito",
    (goalType) => {
      // El objetivo no aporta nada a esa lectura, y la caída de rendimiento ya
      // la cuenta el motor de fatiga en la pantalla de entrenar. Repetirla con
      // salsa corporal sería ruido.
      const r = insight("MAINTAINING", "DECLINING", goalType);
      expect(r.goalAssessment).toBeNull();
      expect(r.worthShowing).toBe(false);
      // Pero la OBSERVACIÓN sigue existiendo: el hecho es el hecho.
      expect(r.observation.code).toBe("WEIGHT_HELD_PERFORMANCE_DOWN");
    },
  );

  it.each(["MAINTENANCE", "RECOMP"] as const)(
    "%s: el peso se está yendo",
    (goalType) => {
      expect(insight("LOSING", "STABLE", goalType).goalAssessment?.code).toBe(
        "WEIGHT_DRIFTING",
      );
      expect(insight("GAINING", "STABLE", goalType).goalAssessment?.code).toBe(
        "WEIGHT_DRIFTING",
      );
    },
  );
});

describe("cuando no se puede afirmar nada", () => {
  it.each(TODOS_OBJETIVOS)(
    "cuerpo INSUFFICIENT_DATA no produce valoración (%s)",
    (goalType) => {
      const r = insight("INSUFFICIENT_DATA", "IMPROVING", goalType);
      expect(r.observation.code).toBe("BODY_INSUFFICIENT_DATA");
      expect(r.goalAssessment).toBeNull();
      expect(r.worthShowing).toBe(false);
    },
  );

  it.each(TODOS_OBJETIVOS)("cuerpo INCONCLUSIVE tampoco (%s)", (goalType) => {
    const r = insight("INCONCLUSIVE", "DECLINING", goalType);
    expect(r.observation.code).toBe("BODY_INCONCLUSIVE");
    expect(r.goalAssessment).toBeNull();
    expect(r.worthShowing).toBe(false);
  });

  it.each(TODOS_OBJETIVOS)(
    "rendimiento INSUFFICIENT_DATA tampoco (%s)",
    (goalType) => {
      const r = insight("LOSING", "INSUFFICIENT_DATA", goalType);
      expect(r.observation.code).toBe("PERFORMANCE_INSUFFICIENT_DATA");
      expect(r.goalAssessment).toBeNull();
      expect(r.worthShowing).toBe(false);
    },
  );

  it("sin objetivo activo no hay nada que valorar", () => {
    const r = insight("LOSING", "STABLE", null);
    expect(r.observation.code).toBe("WEIGHT_DOWN_PERFORMANCE_HELD");
    expect(r.goalAssessment).toBeNull();
    expect(r.worthShowing).toBe(false);
  });

  it("el cuerpo manda: sin dirección corporal, el rendimiento no rescata nada", () => {
    // Aunque el entrenamiento tenga una señal clarísima.
    for (const w of ["INSUFFICIENT_DATA", "INCONCLUSIVE"] as const) {
      for (const p of TODOS_RENDIMIENTO) {
        expect(insight(w, p, "FAT_LOSS").goalAssessment).toBeNull();
      }
    }
  });
});

describe("invariante: observación y valoración no se mezclan", () => {
  it("la observación existe SIEMPRE, aunque no haya valoración", () => {
    for (const w of TODOS_PESO) {
      for (const p of TODOS_RENDIMIENTO) {
        for (const g of [...TODOS_OBJETIVOS, null]) {
          const r = insight(w, p, g);
          expect(r.observation.code).toBeTruthy();
          expect(r.observation.weight).toBe(w);
          expect(r.observation.performance).toBe(p);
        }
      }
    }
  });

  it("la observación NO depende del objetivo: el objetivo cambia el significado, no el dato", () => {
    for (const w of TODOS_PESO) {
      for (const p of TODOS_RENDIMIENTO) {
        const codigos = new Set(
          [...TODOS_OBJETIVOS, null].map(
            (g) => insight(w, p, g).observation.code,
          ),
        );
        expect(codigos.size).toBe(1);
      }
    }
  });

  it("worthShowing equivale exactamente a tener valoración", () => {
    for (const w of TODOS_PESO) {
      for (const p of TODOS_RENDIMIENTO) {
        for (const g of [...TODOS_OBJETIVOS, null]) {
          const r = insight(w, p, g);
          expect(r.worthShowing).toBe(r.goalAssessment !== null);
        }
      }
    }
  });
});

describe("invariante: ningún código del motor nombra una CAUSA", () => {
  it("recorriendo las 100 combinaciones, nada suena a diagnóstico", () => {
    // Este es EL test de B5. Peso y cargas no permiten distinguir entre un
    // déficit agresivo, dormir mal, una semana de trabajo horrible o nada en
    // particular. Un código llamado `EXCESSIVE_DEFICIT` sería una mentira
    // codificada, y colarlo sería facilísimo.
    const prohibidos =
      /DEFICIT|SURPLUS|MUSCLE_LOSS|FAT_GAIN|RECOVERY|SLEEP|PROTEIN|VOLUME|OVERTRAIN|UNDEREAT|CALORIE/i;

    const vistos = new Set<string>();
    for (const w of TODOS_PESO) {
      for (const p of TODOS_RENDIMIENTO) {
        for (const g of [...TODOS_OBJETIVOS, null]) {
          const r = insight(w, p, g);
          vistos.add(r.observation.code);
          if (r.goalAssessment) vistos.add(r.goalAssessment.code);
        }
      }
    }

    expect(vistos.size).toBeGreaterThan(10);
    for (const codigo of vistos) {
      expect(codigo, `"${codigo}" suena a causa`).not.toMatch(prohibidos);
    }
  });

  it("los códigos de valoración describen las dos señales, no su relación causal", () => {
    // Nombres como `LOSING_PERFORMANCE_DOWN` dicen QUÉ pasa. Ninguno dice POR
    // QUÉ, y ese es el punto.
    const causales: GoalAssessmentCode[] = [];
    for (const w of TODOS_PESO) {
      for (const p of TODOS_RENDIMIENTO) {
        for (const g of TODOS_OBJETIVOS) {
          const code = insight(w, p, g).goalAssessment?.code;
          if (code && /BECAUSE|CAUSED|DUE_TO/i.test(code)) causales.push(code);
        }
      }
    }
    expect(causales).toEqual([]);
  });
});

describe("los números viajan calculados, no se recalculan", () => {
  it("la pendiente solo se expone cuando el motor corporal la respalda", () => {
    // `observedKgPerWeek` ya es `null` en INCONCLUSIVE por diseño de B1: aquí
    // simplemente se propaga, sin rescatarla de `trend`.
    const conTendencia = analyzeBodyPerformance({
      bodyAnalysis: cuerpo("LOSING", "FAT_LOSS", -0.42),
      performance: rendimiento("STABLE"),
    });
    expect(conTendencia.numbers.weightSlopeKgPerWeek).toBe(-0.42);

    const sinTendencia = analyzeBodyPerformance({
      bodyAnalysis: cuerpo("INCONCLUSIVE", "FAT_LOSS", null),
      performance: rendimiento("STABLE"),
    });
    expect(sinTendencia.numbers.weightSlopeKgPerWeek).toBeNull();
  });

  it("los recuentos de variantes se propagan tal cual", () => {
    const r = analyzeBodyPerformance({
      bodyAnalysis: cuerpo("LOSING", "FAT_LOSS"),
      performance: rendimiento("DECLINING", {
        judged: 9,
        improving: 1,
        stable: 5,
        declining: 3,
      }),
    });
    expect(r.numbers.judgedVariants).toBe(9);
    expect(r.numbers.declining).toBe(3);
    expect(r.numbers.improving).toBe(1);
    expect(r.numbers.weightWindowDays).toBe(28);
  });
});
