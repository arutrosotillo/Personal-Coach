import { describe, expect, it } from "vitest";

import {
  estimateInitialTargets,
  mifflinStJeor,
  stepsFactor,
  type InitialEstimateInput,
} from "@/core/nutrition/initial-estimate";

/** Ejemplo canónico de docs/NUTRITION_ENGINE.md §1: 84 kg, 178 cm, 34 años. */
const CANONICAL: InitialEstimateInput = {
  sex: "MALE",
  ageYears: 34,
  heightCm: 178,
  weightKg: 84,
  dailySteps: 8_500,
  workActivity: "SEDENTARY",
  trainingSessionsPerWeek: 4,
  minutesPerSession: 60,
  goalType: "FAT_LOSS",
};

describe("mifflinStJeor", () => {
  it("hombre 84 kg / 178 cm / 34 años → 1788 kcal", () => {
    expect(mifflinStJeor("MALE", 84, 178, 34)).toBe(1788);
  });
  it("mujer resta 166 kcal respecto al hombre", () => {
    expect(
      mifflinStJeor("MALE", 60, 165, 30) - mifflinStJeor("FEMALE", 60, 165, 30),
    ).toBe(166);
  });
});

describe("stepsFactor", () => {
  it.each([
    [3_000, 1.2],
    [8_500, 1.5],
    [12_500, 1.7],
  ])("%i pasos → factor %f", (steps, factor) => {
    expect(stepsFactor(steps)).toBe(factor);
  });
});

describe("estimateInitialTargets — ejemplo canónico verificado", () => {
  const r = estimateInitialTargets(CANONICAL);

  it("TDEE ≈ 2825 con rango de incertidumbre visible", () => {
    expect(r.bmr).toBe(1788);
    expect(r.activityFactor).toBe(1.5);
    expect(r.trainingKcalPerDay).toBe(144);
    expect(r.tdee).toBe(2825);
    expect(r.tdeeRange.low).toBeLessThan(r.tdee);
    expect(r.tdeeRange.high).toBeGreaterThan(r.tdee);
    expect(r.explanations.tdee).toMatch(/punto de partida/);
    expect(r.explanations.tdee).toMatch(/2\.825|2825/);
  });

  it("objetivo −0,5 %/sem → déficit 462 kcal → objetivo 2375", () => {
    expect(r.weeklyRatePct).toBe(-0.5);
    expect(r.dailyDeficitKcal).toBe(462);
    expect(r.kcalTarget).toBe(2375);
    expect(r.clampedToFloor).toBe(false);
  });

  it("macros: 185 P / 67 G / 258 C", () => {
    expect(r.proteinG).toBe(185);
    expect(r.fatG).toBe(67);
    expect(r.carbsG).toBe(258);
    expect(r.explanations.protein).toMatch(/2\.2/);
  });
});

describe("estimateInitialTargets — suelos de seguridad", () => {
  it("NUNCA emite un objetivo por debajo del suelo, aunque el ritmo pedido lo exija", () => {
    const r = estimateInitialTargets({
      ...CANONICAL,
      sex: "FEMALE",
      weightKg: 55,
      heightCm: 158,
      dailySteps: 2_000,
      trainingSessionsPerWeek: 2,
      weeklyRatePct: -1.0,
    });
    expect(r.kcalTarget).toBeGreaterThanOrEqual(r.floorKcal);
    expect(r.floorKcal).toBeGreaterThanOrEqual(1200);
  });

  it("el déficit se acota al 25 % del TDEE", () => {
    const r = estimateInitialTargets({ ...CANONICAL, weeklyRatePct: -1.0 });
    expect(r.dailyDeficitKcal).toBeLessThanOrEqual(Math.round(r.tdee * 0.25));
  });

  it("el ritmo se recorta a los límites del objetivo (pedir −2 %/sem devuelve −1 %)", () => {
    const r = estimateInitialTargets({ ...CANONICAL, weeklyRatePct: -2.0 });
    expect(r.weeklyRatePct).toBe(-1.0);
  });
});

describe("estimateInitialTargets — otros objetivos", () => {
  it("mantenimiento: objetivo = TDEE, sin déficit", () => {
    const r = estimateInitialTargets({ ...CANONICAL, goalType: "MAINTENANCE" });
    expect(r.dailyDeficitKcal).toBe(0);
    expect(r.kcalTarget).toBe(r.tdee);
    expect(r.proteinG).toBe(Math.round(1.8 * 84));
  });

  it("superávit controlado: kcal por encima del TDEE", () => {
    const r = estimateInitialTargets({ ...CANONICAL, goalType: "LEAN_GAIN" });
    expect(r.kcalTarget).toBeGreaterThan(r.tdee);
  });
});
