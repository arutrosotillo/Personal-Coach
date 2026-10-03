import { describe, expect, it } from "vitest";

import { kg, type BodyMeasurementPoint } from "@/core/body";
import { addDays } from "@/core/dates";
import {
  evaluateCalorieAdjustment,
  type CalorieAdjustmentInput,
} from "@/core/nutrition/calorie-adjustment";

// ── Fixtures ────────────────────────────────────────────────────────────────

const START = "2026-06-01";

/** Ruido determinista de ±0,5 kg: nunca `Math.random` en un test de motor. */
const noise = (i: number, amp = 1) =>
  amp * (0.35 * Math.sin(i * 1.7) + 0.15 * Math.cos(i * 0.9));

function point(localDate: string, weight: number): BodyMeasurementPoint {
  return {
    localDate,
    weightKg: kg(Math.round(weight * 10) / 10),
    waistCm: null,
    waistProtocol: null,
    bodyFatPct: null,
    bodyFatReliability: null,
  };
}

/**
 * Serie diaria desde START. `slopeAt(i)` da la pendiente (kg/día) del día i,
 * para poder simular estancamientos y cambios de ritmo.
 */
function series(
  days: number,
  slopeAt: (i: number) => number,
  { startKg = 80, every = 1, noiseAmp = 1 } = {},
): BodyMeasurementPoint[] {
  const out: BodyMeasurementPoint[] = [];
  let w = startKg;
  for (let i = 0; i < days; i++) {
    if (i > 0) w += slopeAt(i);
    if (i % every === 0)
      out.push(point(addDays(START, i), w + noise(i, noiseAmp)));
  }
  return out;
}

function input(
  measurements: BodyMeasurementPoint[],
  today: string,
  overrides: Partial<CalorieAdjustmentInput> = {},
): CalorieAdjustmentInput {
  return {
    todayLocalDate: today,
    sex: "MALE",
    ageYears: 34,
    heightCm: 178,
    goal: {
      type: "FAT_LOSS",
      strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
      weeklyRatePct: -0.5,
      startWeightKg: kg(80),
      targetWeightKg: kg(75),
      startDate: START,
    },
    measurements,
    currentTarget: {
      kcal: 2150,
      proteinG: 179,
      fatG: 65,
      carbsG: 212,
      effectiveFrom: START,
    },
    lastChange: null,
    lastRejectedLocalDate: null,
    ...overrides,
  };
}

/** −0,4 kg/sem (≈ −0,5 % de 80 kg) cuatro semanas y después plano. */
const lossThenFlat = (i: number) => (i < 28 ? -0.4 / 7 : 0);

// ── Tests ───────────────────────────────────────────────────────────────────

describe("evaluateCalorieAdjustment", () => {
  it("datos reales con pesajes espaciados: no opina (R1)", () => {
    const raw: [string, number][] = [
      ["2026-08-31", 81.2],
      ["2026-09-02", 81],
      ["2026-09-07", 80.6],
      ["2026-09-08", 80.4],
      ["2026-09-09", 79.9],
      ["2026-09-10", 80.3],
      ["2026-09-15", 79.6],
      ["2026-09-17", 79.7],
      ["2026-09-22", 78.7],
      ["2026-09-24", 78.7],
      ["2026-09-26", 78.8],
    ];
    const r = evaluateCalorieAdjustment(
      input(
        raw.map(([d, w]) => point(d, w)),
        "2026-10-03",
        {
          goal: { ...input([], START).goal!, startDate: "2026-08-31" },
        },
      ),
    );
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("INSUFFICIENT_DATA");
    expect(r.ruleId).toBe("R1");
    expect(r.proposal).toBeNull();
  });

  it("las dos primeras semanas no se ajusta (R4a)", () => {
    const r = evaluateCalorieAdjustment(
      input(
        series(10, () => 0),
        addDays(START, 10),
      ),
    );
    expect(r.reasonCode).toBe("INITIAL_PHASE");
    expect(r.daysOnPhase).toBe(10);
    expect(r.nextEligibleLocalDate).toBe(addDays(START, 14));
  });

  it("al ritmo del objetivo: mantener (R6)", () => {
    const r = evaluateCalorieAdjustment(
      input(
        series(42, () => -0.4 / 7),
        addDays(START, 41),
      ),
    );
    expect(r.reasonCode).toBe("ON_TRACK");
    expect(r.action).toBe("HOLD");
    expect(r.now!.ratio).toBeGreaterThan(0.6);
    expect(r.now!.ratio).toBeLessThan(1.4);
    expect(r.explanation).toContain("kg/semana");
  });

  it("estancado dos lecturas seguidas: propone −100 kcal desde los carbohidratos (R7b)", () => {
    const today = addDays(START, 69);
    const r = evaluateCalorieAdjustment(input(series(70, lossThenFlat), today));

    expect(r.reasonCode).toBe("STALLED_CONFIRMED");
    expect(r.ruleId).toBe("R7b");
    expect(r.action).toBe("ADJUST");
    expect(r.proposal).toEqual({
      kcal: 2050,
      proteinG: 179,
      fatG: 65,
      carbsG: 187,
      deltaKcal: -100,
      direction: "DOWN",
      clampedToFloor: false,
    });
    expect(r.now!.pace).toBe("STALLED");
    expect(r.weekAgo!.pace).toBe("STALLED");
    // Nunca confianza alta: la ingesta no se mide.
    expect(r.confidence).not.toBe("HIGH");
    expect(r.explanation).toContain("2150 kcal");
    expect(r.explanation).toContain("Antes de aceptar");
  });

  it("nunca por una sola semana: el primer día estancado solo avisa", () => {
    const data = series(80, lossThenFlat);
    let firstStalled: string | null = null;
    let firstAdjust: string | null = null;
    for (let d = 14; d < 80; d++) {
      const today = addDays(START, d);
      const r = evaluateCalorieAdjustment(input(data, today));
      if (firstStalled === null && r.now?.pace === "STALLED") {
        firstStalled = today;
        expect(r.reasonCode).toBe("STALLED_FIRST_WEEK");
        expect(r.action).toBe("HOLD");
      }
      if (firstAdjust === null && r.action === "ADJUST") firstAdjust = today;
    }
    expect(firstStalled).not.toBeNull();
    expect(firstAdjust).not.toBeNull();
    expect(firstAdjust! >= addDays(firstStalled!, 7)).toBe(true);
  });

  it("ratio bajo pero con margen que aún admite el objetivo: no se ajusta (R1b)", () => {
    // Pesajes cada 2 días y con mucho ruido (±4 kg): el intervalo es ancho.
    const data = series(60, lossThenFlat, { every: 2, noiseAmp: 8 });
    const r = evaluateCalorieAdjustment(input(data, addDays(START, 57)));
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("UNCONFIRMED_SLOW");
    // El ratio es bajo, pero el mejor caso del intervalo supera el objetivo.
    expect(r.now!.ratio).toBeLessThan(0.5);
    expect(r.now!.fastestPlausibleRatio).toBeGreaterThan(1);
    expect(r.proposal).toBeNull();
  });

  it("enfriamiento: misma dirección hace menos de 14 días (R3)", () => {
    const today = addDays(START, 69);
    const r = evaluateCalorieAdjustment(
      input(series(70, lossThenFlat), today, {
        lastChange: { localDate: addDays(today, -10), direction: "DOWN" },
      }),
    );
    expect(r.reasonCode).toBe("COOLDOWN");
    expect(r.nextEligibleLocalDate).toBe(addDays(today, 4));
  });

  it("enfriamiento: dirección contraria solo exige 7 días", () => {
    const today = addDays(START, 69);
    const r = evaluateCalorieAdjustment(
      input(series(70, lossThenFlat), today, {
        lastChange: { localDate: addDays(today, -10), direction: "UP" },
      }),
    );
    expect(r.reasonCode).toBe("STALLED_CONFIRMED");
    expect(r.proposal!.kcal).toBe(2050);
  });

  it("tras un 'ahora no' espera una semana", () => {
    const today = addDays(START, 69);
    const r = evaluateCalorieAdjustment(
      input(series(70, lossThenFlat), today, {
        lastRejectedLocalDate: addDays(today, -3),
      }),
    );
    expect(r.reasonCode).toBe("SNOOZED");
    expect(r.nextEligibleLocalDate).toBe(addDays(today, 4));
  });

  it("en el suelo de seguridad no propone bajar (R0)", () => {
    const today = addDays(START, 69);
    const r = evaluateCalorieAdjustment(
      input(series(70, lossThenFlat), today, {
        currentTarget: {
          kcal: 1625,
          proteinG: 170,
          fatG: 50,
          carbsG: 120,
          effectiveFrom: START,
        },
      }),
    );
    // BMR Mifflin sobre el peso suavizado actual (~78,4 kg, 178 cm, 34 a, H)
    // ≈ 1.732 → ×0,9 = 1.559 → redondeado hacia arriba a 1.575.
    expect(r.floorKcal).toBe(1575);
    expect(r.action).toBe("ADJUST");
    expect(r.proposal!.kcal).toBe(1575);
    expect(r.proposal!.clampedToFloor).toBe(true);

    const atFloor = evaluateCalorieAdjustment(
      input(series(70, lossThenFlat), today, {
        currentTarget: {
          kcal: 1575,
          proteinG: 170,
          fatG: 50,
          carbsG: 117,
          effectiveFrom: START,
        },
      }),
    );
    expect(atFloor.reasonCode).toBe("AT_FLOOR");
    expect(atFloor.proposal).toBeNull();
  });

  it("pérdida excesiva confirmada: propone +100 kcal (R5)", () => {
    // −1,2 kg/sem a 80 kg: más que max(0,8 kg = 1 % del peso, 1,5 × 0,4).
    const r = evaluateCalorieAdjustment(
      input(
        series(50, () => -1.2 / 7, { noiseAmp: 0.5 }),
        addDays(START, 49),
      ),
    );
    expect(r.reasonCode).toBe("EXCESSIVE_CONFIRMED");
    expect(r.proposal!.kcal).toBe(2250);
    expect(r.proposal!.direction).toBe("UP");
    expect(r.proposal!.carbsG).toBe(237);
  });

  it("objetivo de mantenimiento: no aplica", () => {
    const r = evaluateCalorieAdjustment(
      input(
        series(50, () => 0),
        addDays(START, 49),
        {
          goal: {
            ...input([], START).goal!,
            type: "MAINTENANCE",
            strategy: "MAINTENANCE",
            weeklyRatePct: 0,
          },
        },
      ),
    );
    expect(r.reasonCode).toBe("NOT_APPLICABLE_GOAL");
  });

  it("volumen estancado: propone subir (simétrico)", () => {
    const r = evaluateCalorieAdjustment(
      input(
        series(70, (i) => (i < 28 ? 0.15 / 7 : -0.05 / 7), { noiseAmp: 0.3 }),
        addDays(START, 69),
        {
          goal: {
            ...input([], START).goal!,
            type: "LEAN_GAIN",
            strategy: "LEAN_GAIN",
            weeklyRatePct: 0.25,
          },
        },
      ),
    );
    expect(r.reasonCode).toBe("STALLED_CONFIRMED");
    expect(r.proposal!.direction).toBe("UP");
    expect(r.proposal!.kcal).toBe(2250);
  });
});
