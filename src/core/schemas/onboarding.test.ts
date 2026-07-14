import { describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";

const VALID_MINIMAL = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  trainingYears: 3,
  daysPerWeek: 4,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "CABLE", "MACHINE"],
  goalType: "FAT_LOSS",
};

describe("onboardingSchema — datos válidos", () => {
  it("acepta el mínimo imprescindible y aplica defaults", () => {
    const r = onboardingSchema.parse(VALID_MINIMAL);
    expect(r.dailySteps).toBe(6000);
    expect(r.workActivity).toBe("SEDENTARY");
    expect(r.priorityMuscles).toEqual([]);
    expect(r.contraindications).toEqual([]);
    expect(r.dietaryPreference).toBe("NONE");
  });

  it("acepta opcionales completos", () => {
    const r = onboardingSchema.parse({
      ...VALID_MINIMAL,
      waistCm: 88,
      weeklyRatePct: -0.5,
      targetWeightKg: 78,
      priorityMuscles: ["DELT_LATERAL", "DORSAL"],
      contraindications: ["KNEE"],
      excludedExerciseNames: ["Sentadilla trasera"],
      sleepHoursTypical: 7,
      mealsPerDay: 4,
    });
    expect(r.waistCm).toBe(88);
    expect(r.contraindications).toEqual(["KNEE"]);
  });
});

describe("onboardingSchema — datos inválidos rechazados con mensaje útil", () => {
  it.each([
    [{ weightKg: 500 }, /30 y 300/],
    [{ weightKg: 20 }, /30 y 300/],
    [{ heightCm: 100 }, /120 y 230/],
    [{ daysPerWeek: 1 }, /Mínimo 2 días/],
    [{ daysPerWeek: 7 }, /Máximo 6 días/],
    [{ minutesPerSession: 15 }, /30 minutos/],
    [{ equipment: [] }, /al menos un tipo/],
    [{ birthDate: "10/03/1992" }, /Fecha inválida/],
    [{ weeklyRatePct: -3 }, /1 %/],
  ])("rechaza %j", (override, message) => {
    const result = onboardingSchema.safeParse({
      ...VALID_MINIMAL,
      ...override,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join(" | ")).toMatch(
        message,
      );
    }
  });

  it("rechaza NaN y valores no numéricos en campos numéricos", () => {
    expect(
      onboardingSchema.safeParse({ ...VALID_MINIMAL, weightKg: NaN }).success,
    ).toBe(false);
    expect(
      onboardingSchema.safeParse({ ...VALID_MINIMAL, weightKg: "84" }).success,
    ).toBe(false);
  });
});
