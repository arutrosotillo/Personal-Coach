import { describe, expect, it } from "vitest";

import {
  estimateInitialTargets,
  katchMcArdle,
  mifflinStJeor,
  type InitialEstimateInput,
} from "@/core/nutrition/initial-estimate";

/** Perfil de referencia de la auditoría (docs/NUTRITION_ENGINE.md): 83,5 kg. */
const REF: InitialEstimateInput = {
  sex: "MALE",
  ageYears: 34,
  heightCm: 178,
  weightKg: 83.5,
  bodyFatPct: 15, // estimado, NO medido de forma fiable
  bodyFatMeasured: false,
  dailySteps: 10_000,
  workActivity: "SEDENTARY",
  trainingSessionsPerWeek: 4,
  minutesPerSession: 60,
  goalType: "RECOMP",
};

describe("mifflinStJeor / katchMcArdle", () => {
  it("Mifflin: hombre 83,5 / 178 / 34 → 1783 kcal", () => {
    expect(mifflinStJeor("MALE", 83.5, 178, 34)).toBe(1783);
  });
  it("Katch-McArdle usa masa magra", () => {
    // 83,5 kg al 15 % → 70,975 kg magros → 370 + 21,6×70,975 ≈ 1903
    expect(katchMcArdle(83.5, 15)).toBe(1903);
  });
});

describe("estimateInitialTargets — modelo aditivo sin doble conteo", () => {
  it("separa TDEE en base de mantenimiento + pasos + entrenamiento", () => {
    const r = estimateInitialTargets(REF);
    const t = r.trace;
    // BMR 1783 × 1,15 = 2050 ; pasos 10000×0.0005×83.5 ≈ 418 ; entreno ≈ 143
    expect(t.bmr).toBe(1783);
    expect(t.workNeatFactor).toBe(1.15);
    expect(t.stepsKcal).toBe(418);
    expect(t.trainingKcal).toBe(143);
    expect(t.tdee).toBe(2600);
    // La suma de componentes coincide con el TDEE (redondeo aparte).
    expect(
      Math.abs(t.maintenanceBase + t.stepsKcal + t.trainingKcal - t.tdee),
    ).toBeLessThanOrEqual(13);
  });

  it("los pasos y el entrenamiento NO están duplicados en el factor de actividad", () => {
    // El factor NEAT del trabajo (1,15 sedentario) no crece con los pasos:
    // subir los pasos aumenta kcalPasos, no el factor.
    const few = estimateInitialTargets({ ...REF, dailySteps: 2_000 });
    const many = estimateInitialTargets({ ...REF, dailySteps: 14_000 });
    expect(few.trace.workNeatFactor).toBe(many.trace.workNeatFactor);
    expect(many.trace.stepsKcal).toBeGreaterThan(few.trace.stepsKcal);
    // El aumento de TDEE viene solo de los pasos, de forma acotada.
    expect(many.tdee - few.tdee).toBeLessThan(600);
  });

  it("el factor de actividad no es excesivo (TDEE < BMR × 2)", () => {
    const active = estimateInitialTargets({
      ...REF,
      dailySteps: 15_000,
      workActivity: "HIGH",
      trainingSessionsPerWeek: 6,
    });
    expect(active.tdee).toBeLessThan(active.bmr * 2);
  });
});

describe("estimateInitialTargets — % graso no fiable", () => {
  it("NO usa Katch-McArdle si el % graso solo está estimado", () => {
    const r = estimateInitialTargets(REF);
    expect(r.trace.bmrFormula).toBe("MIFFLIN_ST_JEOR");
    expect(r.trace.notes.join(" ")).toMatch(/estimación, no una medición/i);
  });
  it("usa Katch-McArdle solo si el % graso está marcado como medido", () => {
    const r = estimateInitialTargets({ ...REF, bodyFatMeasured: true });
    expect(r.trace.bmrFormula).toBe("KATCH_MCARDLE");
  });
});

describe("estimateInitialTargets — estrategias de objetivo", () => {
  it("recomposición estable: target = mantenimiento, sin déficit", () => {
    const r = estimateInitialTargets({ ...REF, goalType: "RECOMP" });
    expect(r.dailyDeficitKcal).toBe(0);
    expect(r.kcalTarget).toBe(r.tdee);
    expect(r.explanations.kcal).toMatch(/mantenimiento estimado|peso estable/i);
  });

  it("pérdida de grasa con objetivo inferior: aplica déficit conservador", () => {
    const r = estimateInitialTargets({
      ...REF,
      goalType: "FAT_LOSS",
      targetWeightKg: 78,
      weeklyRatePct: -0.5,
    });
    expect(r.dailyDeficitKcal).toBeGreaterThan(0);
    expect(r.kcalTarget).toBeLessThan(r.tdee);
    // Déficit conservador: entre 0,25 y 1 %/sem → ~300–650 kcal.
    expect(r.dailyDeficitKcal).toBeGreaterThanOrEqual(200);
    expect(r.dailyDeficitKcal).toBeLessThanOrEqual(700);
  });

  it("superávit controlado: kcal por encima del mantenimiento", () => {
    const r = estimateInitialTargets({ ...REF, goalType: "LEAN_GAIN" });
    expect(r.kcalTarget).toBeGreaterThan(r.tdee);
    expect(r.dailyDeficitKcal).toBeLessThan(0);
  });
});

describe("estimateInitialTargets — actividad laboral y entrenamientos", () => {
  it("actividad laboral activa aumenta el TDEE frente a sedentaria", () => {
    const sed = estimateInitialTargets({ ...REF, workActivity: "SEDENTARY" });
    const high = estimateInitialTargets({ ...REF, workActivity: "HIGH" });
    expect(high.tdee).toBeGreaterThan(sed.tdee);
  });

  it("entrenar suma kcal frente a no entrenar", () => {
    const none = estimateInitialTargets({ ...REF, trainingSessionsPerWeek: 0 });
    const some = estimateInitialTargets({ ...REF, trainingSessionsPerWeek: 5 });
    expect(none.trace.trainingKcal).toBe(0);
    expect(some.trace.trainingKcal).toBeGreaterThan(0);
    expect(some.tdee).toBeGreaterThan(none.tdee);
  });
});

describe("estimateInitialTargets — suelos y coherencia", () => {
  it("NUNCA emite un objetivo por debajo del suelo de seguridad", () => {
    const r = estimateInitialTargets({
      ...REF,
      sex: "FEMALE",
      weightKg: 52,
      heightCm: 158,
      dailySteps: 2_000,
      trainingSessionsPerWeek: 2,
      goalType: "FAT_LOSS",
      weeklyRatePct: -1.0,
    });
    expect(r.kcalTarget).toBeGreaterThanOrEqual(r.floorKcal);
    expect(r.floorKcal).toBeGreaterThanOrEqual(1200);
  });

  it("el déficit se acota al 25 % del TDEE", () => {
    const r = estimateInitialTargets({
      ...REF,
      goalType: "FAT_LOSS",
      weeklyRatePct: -1.0,
    });
    expect(r.dailyDeficitKcal).toBeLessThanOrEqual(Math.round(r.tdee * 0.25));
  });

  it("el target cae dentro del rango de incertidumbre + ajuste esperado", () => {
    const r = estimateInitialTargets({ ...REF, goalType: "FAT_LOSS" });
    // El objetivo es TDEE menos un déficit: nunca por encima del TDEE, ni
    // por debajo de (rango bajo − déficit máximo).
    expect(r.kcalTarget).toBeLessThanOrEqual(r.tdee);
    expect(r.kcalTarget).toBeGreaterThanOrEqual(r.floorKcal);
  });

  it("coherencia proteína/grasa/carbohidratos con el target", () => {
    const r = estimateInitialTargets(REF);
    const kcalFromMacros = r.proteinG * 4 + r.fatG * 9 + r.carbsG * 4;
    // Los macros reconstruyen el target con un margen de redondeo pequeño.
    expect(Math.abs(kcalFromMacros - r.kcalTarget)).toBeLessThanOrEqual(10);
    expect(r.proteinG).toBe(Math.round(2.2 * 83.5));
    expect(r.carbsG).toBeGreaterThan(0);
  });

  it("respeta el mínimo de carbohidratos bajando primero grasa y luego proteína", () => {
    // Perfil pequeño en déficit fuerte: sin fallback los carbos caerían bajo 100 g.
    const r = estimateInitialTargets({
      ...REF,
      sex: "FEMALE",
      weightKg: 55,
      heightCm: 160,
      goalType: "FAT_LOSS",
      weeklyRatePct: -0.75,
    });
    // O bien alcanza el mínimo de carbohidratos, o avisa de que no caben.
    expect(r.carbsG >= 100 || r.trace.macrosLimitedByLowKcal).toBe(true);
    // La suma de macros nunca supera el target (coherencia).
    expect(r.proteinG * 4 + r.fatG * 9 + r.carbsG * 4).toBeLessThanOrEqual(
      r.kcalTarget + 10,
    );
  });

  it("cuando el déficit se acota, muestra el ritmo REAL, no el pedido", () => {
    const r = estimateInitialTargets({
      ...REF,
      weightKg: 120,
      goalType: "FAT_LOSS",
      weeklyRatePct: -1.0,
    });
    if (r.trace.boundedByMaxDeficit || r.trace.clampedToFloor) {
      expect(Math.abs(r.trace.effectiveWeeklyRatePct)).toBeLessThanOrEqual(
        Math.abs(r.trace.weeklyRatePct) + 0.01,
      );
      // El ajuste aplicado coincide con tdee − target.
      expect(r.trace.appliedAdjustmentKcal).toBe(
        r.trace.tdee - r.trace.kcalTarget,
      );
    }
  });

  it("la traza guarda los valores pre-tope para auditoría", () => {
    const r = estimateInitialTargets({
      ...REF,
      weightKg: 120,
      goalType: "FAT_LOSS",
      weeklyRatePct: -1.0,
    });
    expect(r.trace.rawAdjustmentKcal).toBeGreaterThan(0);
    expect(r.trace.maxDeficitKcal).toBeGreaterThan(0);
    expect(typeof r.trace.preFloorKcalTarget).toBe("number");
  });
});
