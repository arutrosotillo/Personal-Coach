import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import type { GoalType, Sex } from "@/core/enums";

/**
 * Macros y suelo de seguridad a partir de un objetivo calórico ya decidido
 * (docs/NUTRITION_ENGINE.md §2–3). Funciones puras, compartidas por la
 * estimación inicial del onboarding y por el plan de un ciclo nuevo: que las
 * dos pantallas no puedan dar macros distintos para el mismo caso.
 */

type NutritionConfig = typeof NUTRITION_CONFIG;

export function roundKcal(
  kcal: number,
  config: NutritionConfig = NUTRITION_CONFIG,
): number {
  return Math.round(kcal / config.kcalRounding) * config.kcalRounding;
}

/**
 * Suelo duro: `max(BMR × 0,9, 1.500 H / 1.200 M)`. Inviolable (CLAUDE.md §4).
 * Sin redondear: quien lo aplica decide hacia dónde.
 */
export function safetyFloorKcal(
  sex: Sex,
  bmr: number,
  config: NutritionConfig = NUTRITION_CONFIG,
): number {
  return Math.max(
    Math.round(bmr * config.minKcalBmrFactor),
    config.minKcalAbsolute[sex],
  );
}

export interface MacroInput {
  kcalTarget: number;
  weightKg: number;
  goalType: GoalType;
  sex: Sex;
  /** Solo se usa si está MEDIDO de forma fiable. */
  bodyFatPct?: number;
  bodyFatMeasured?: boolean;
  targetWeightKg?: number;
}

export interface Macros {
  proteinG: number;
  fatG: number;
  carbsG: number;
  proteinReferenceWeightKg: number;
  proteinGPerKg: number;
  fatGPerKg: number;
  /** Con estas calorías no caben los mínimos de macronutrientes. */
  macrosLimitedByLowKcal: boolean;
}

/**
 * Proteína y grasa por kg según objetivo; carbohidratos = resto. Si los
 * carbohidratos bajaran del mínimo, cascada: grasa a su suelo → proteína a
 * 1,8 g/kg → si aún no cabe, las kcal son demasiado bajas.
 */
export function computeMacros(
  input: MacroInput,
  config: NutritionConfig = NUTRITION_CONFIG,
): Macros {
  // Peso de referencia para proteína: objetivo/estimación magra si el % graso
  // MEDIDO es alto; si no, el peso actual.
  const highBf = config.highBodyFatPctForProteinRef[input.sex];
  const proteinReferenceWeightKg =
    input.bodyFatMeasured &&
    typeof input.bodyFatPct === "number" &&
    input.bodyFatPct > highBf
      ? (input.targetWeightKg ??
        Math.round(input.weightKg * (1 - input.bodyFatPct / 100) * 1.3))
      : input.weightKg;

  const proteinGPerKg = config.proteinGPerKg[input.goalType];
  const fatGPerKg = config.fatGPerKg[input.goalType];
  const proteinFloorG = Math.round(1.8 * proteinReferenceWeightKg);
  const fatFloorG = Math.max(
    Math.round(config.minFatGPerKg * input.weightKg),
    config.minFatGAbsolute,
  );

  let proteinG = Math.round(proteinGPerKg * proteinReferenceWeightKg);
  let fatG = Math.max(
    Math.round(fatGPerKg * input.weightKg),
    config.minFatGAbsolute,
  );
  const carbsFrom = () =>
    Math.round((input.kcalTarget - proteinG * 4 - fatG * 9) / 4);
  let carbsG = carbsFrom();
  if (carbsG < config.minCarbsG && fatG > fatFloorG) {
    fatG = fatFloorG;
    carbsG = carbsFrom();
  }
  if (carbsG < config.minCarbsG && proteinG > proteinFloorG) {
    proteinG = proteinFloorG;
    carbsG = carbsFrom();
  }
  const macrosLimitedByLowKcal = carbsG < config.minCarbsG;

  return {
    proteinG,
    fatG,
    carbsG: Math.max(carbsG, 0),
    proteinReferenceWeightKg,
    proteinGPerKg,
    fatGPerKg,
    macrosLimitedByLowKcal,
  };
}
