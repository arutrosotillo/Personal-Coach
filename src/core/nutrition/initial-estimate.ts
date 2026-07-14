import { NUTRITION_CONFIG as CFG } from "@/core/config/nutrition-config";
import type { GoalType, Sex, WorkActivity } from "@/core/enums";

/**
 * Estimación inicial de gasto y objetivo nutricional (docs/NUTRITION_ENGINE.md §1–3).
 * Función pura: se usa en el onboarding (F1) y como semilla del motor dinámico (F4).
 * El resultado es un punto de partida con incertidumbre explícita, no una verdad.
 */

export const NUTRITION_ESTIMATE_VERSION = "1.0.0";

export interface InitialEstimateInput {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  dailySteps: number;
  workActivity: WorkActivity;
  trainingSessionsPerWeek: number;
  minutesPerSession: number;
  goalType: GoalType;
  /** % peso/semana; si no se indica, default del objetivo. */
  weeklyRatePct?: number;
}

export interface InitialEstimate {
  bmr: number;
  activityFactor: number;
  trainingKcalPerDay: number;
  tdee: number;
  tdeeRange: { low: number; high: number };
  weeklyRatePct: number;
  dailyDeficitKcal: number; // negativo en superávit
  kcalTarget: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  floorKcal: number;
  clampedToFloor: boolean;
  explanations: {
    tdee: string;
    kcal: string;
    protein: string;
    fat: string;
    carbs: string;
  };
}

function round25(kcal: number): number {
  return Math.round(kcal / CFG.kcalRounding) * CFG.kcalRounding;
}

export function mifflinStJeor(sex: Sex, weightKg: number, heightCm: number, ageYears: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return Math.round(sex === "MALE" ? base + 5 : base - 161);
}

export function stepsFactor(dailySteps: number): number {
  const row = CFG.stepsFactorTable.find((r) => dailySteps >= r.minSteps);
  return row ? row.factor : 1.2;
}

export function estimateInitialTargets(input: InitialEstimateInput): InitialEstimate {
  const bmr = mifflinStJeor(input.sex, input.weightKg, input.heightCm, input.ageYears);

  const activityFactor = Math.min(
    stepsFactor(input.dailySteps) + CFG.workActivityAdjustment[input.workActivity],
    CFG.maxActivityFactor,
  );

  const kcalPerSession = CFG.strengthKcalPerKgPerMin * input.weightKg * input.minutesPerSession;
  const trainingKcalPerDay = Math.round((kcalPerSession * input.trainingSessionsPerWeek) / 7);

  const tdee = round25(bmr * activityFactor + trainingKcalPerDay);
  const tdeeRange = {
    low: round25(tdee * (1 - CFG.tdeeUncertaintyPct)),
    high: round25(tdee * (1 + CFG.tdeeUncertaintyPct)),
  };

  const rateCfg = CFG.weeklyRatePct[input.goalType];
  const weeklyRatePct = clamp(input.weeklyRatePct ?? rateCfg.default, rateCfg.min, rateCfg.max);

  // Déficit diario derivado del ritmo (negativo si superávit). El "+ 0" evita -0.
  const dailyDeficitKcal =
    Math.round((input.weightKg * (-weeklyRatePct / 100) * CFG.kcalPerKgBodyweight) / 7) + 0;

  const floorKcal = Math.max(
    Math.round(bmr * CFG.minKcalBmrFactor),
    CFG.minKcalAbsolute[input.sex],
  );
  const maxDeficit = Math.round(tdee * CFG.maxDeficitPctOfTdee);
  const boundedDeficit = Math.min(dailyDeficitKcal, maxDeficit);

  let kcalTarget = round25(tdee - boundedDeficit);
  const clampedToFloor = kcalTarget < floorKcal;
  if (clampedToFloor) kcalTarget = round25(floorKcal + CFG.kcalRounding / 2);

  const proteinG = Math.round(CFG.proteinGPerKg[input.goalType] * input.weightKg);
  const fatG = Math.max(
    Math.round(CFG.fatGPerKg[input.goalType] * input.weightKg),
    CFG.minFatGAbsolute,
  );
  const carbsG = Math.max(Math.round((kcalTarget - proteinG * 4 - fatG * 9) / 4), 0);

  const fmtEs = (n: number) => n.toLocaleString("es-ES");

  return {
    bmr,
    activityFactor,
    trainingKcalPerDay,
    tdee,
    tdeeRange,
    weeklyRatePct,
    dailyDeficitKcal: boundedDeficit,
    kcalTarget,
    proteinG,
    fatG,
    carbsG,
    floorKcal,
    clampedToFloor,
    explanations: {
      tdee: `Gasto estimado ~${fmtEs(tdee)} kcal/día (rango ${fmtEs(tdeeRange.low)}–${fmtEs(tdeeRange.high)}). Es un punto de partida: tus datos reales de peso e ingesta lo corregirán en 2–4 semanas.`,
      kcal: clampedToFloor
        ? `Objetivo ajustado al suelo de seguridad (${fmtEs(kcalTarget)} kcal): el ritmo pedido exigía menos calorías de las recomendables.`
        : `Objetivo ${fmtEs(kcalTarget)} kcal/día: gasto estimado ${fmtEs(tdee)} con un ajuste de ${boundedDeficit >= 0 ? "−" : "+"}${fmtEs(Math.abs(boundedDeficit))} kcal para un ritmo de ${weeklyRatePct.toLocaleString("es-ES")} % de tu peso por semana.`,
      protein: `${proteinG} g de proteína = ${CFG.proteinGPerKg[input.goalType]} g/kg: el rango con mejor evidencia para conservar músculo con tu objetivo.`,
      fat: `${fatG} g de grasa (≥ ${CFG.minFatGPerKg} g/kg): mínimo necesario para función hormonal y absorción de vitaminas.`,
      carbs: `${carbsG} g de carbohidratos: todas las calorías restantes; alimentan tus entrenamientos.`,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
