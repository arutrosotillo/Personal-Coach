import { describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";

/** Mínimo válido: programa equilibrado + estrategia de pérdida de grasa. */
const VALID_MINIMAL = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  trainingYears: 3,
  daysPerWeek: 4,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "CABLE", "MACHINE"],
  strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
  balancedProgram: true,
  priorityMuscles: [],
};

describe("onboardingSchema — datos válidos", () => {
  it("acepta el mínimo (programa equilibrado) y aplica defaults", () => {
    const r = onboardingSchema.parse(VALID_MINIMAL);
    expect(r.dailySteps).toBe(6000);
    expect(r.workActivity).toBe("SEDENTARY");
    expect(r.balancedProgram).toBe(true);
    expect(r.priorityMuscles).toEqual([]);
    expect(r.dietaryPreference).toBe("NONE");
  });

  it("acepta de 1 a 6 prioridades explícitas", () => {
    const r = onboardingSchema.parse({
      ...VALID_MINIMAL,
      balancedProgram: false,
      priorityMuscles: ["DELT_LATERAL", "DORSAL", "PECHO_SUPERIOR"],
      waistCm: 88,
      weeklyRatePct: -0.5,
      targetWeightKg: 78,
      contraindications: ["KNEE"],
    });
    expect(r.priorityMuscles).toHaveLength(3);
    expect(r.contraindications).toEqual(["KNEE"]);
  });
});

describe("onboardingSchema — prioridades (cliente y servidor)", () => {
  it("rechaza combinar 'equilibrado' con grupos prioritarios", () => {
    const r = onboardingSchema.safeParse({
      ...VALID_MINIMAL,
      balancedProgram: true,
      priorityMuscles: ["BICEPS"],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message).join(" ")).toMatch(
        /No puedes combinar/i,
      );
    }
  });

  it("rechaza no elegir ni equilibrado ni grupos", () => {
    const r = onboardingSchema.safeParse({
      ...VALID_MINIMAL,
      balancedProgram: false,
      priorityMuscles: [],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message).join(" ")).toMatch(
        /entre 1 y 6/i,
      );
    }
  });

  it("rechaza más de 6 grupos (validado en el servidor)", () => {
    const r = onboardingSchema.safeParse({
      ...VALID_MINIMAL,
      balancedProgram: false,
      priorityMuscles: [
        "PECHO_SUPERIOR",
        "DORSAL",
        "DELT_LATERAL",
        "DELT_POSTERIOR",
        "BICEPS",
        "TRICEPS",
        "CUADRICEPS",
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("onboardingSchema — recomposición con peso objetivo inferior", () => {
  const recompLowerTarget = {
    ...VALID_MINIMAL,
    strategy: "RECOMP_MAINTAIN_WEIGHT",
    weightKg: 83.5,
    targetWeightKg: 78, // ~6,6 % menos
  };

  it("rechaza terminar sin confirmar el desajuste de peso", () => {
    const r = onboardingSchema.safeParse(recompLowerTarget);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message).join(" ")).toMatch(
        /Perder grasa manteniendo músculo|recomponer sin bajar/i,
      );
    }
  });

  it("acepta si el usuario confirma expresamente", () => {
    const r = onboardingSchema.safeParse({
      ...recompLowerTarget,
      acknowledgedRecompWeightMismatch: true,
    });
    expect(r.success).toBe(true);
  });

  it("no exige confirmación si el peso objetivo no es materialmente inferior", () => {
    const r = onboardingSchema.safeParse({
      ...recompLowerTarget,
      targetWeightKg: 82, // <3 % de diferencia
    });
    expect(r.success).toBe(true);
  });
});

describe("onboardingSchema — datos inválidos rechazados con mensaje útil", () => {
  it.each([
    [{ weightKg: 500 }, /30 y 300/],
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
