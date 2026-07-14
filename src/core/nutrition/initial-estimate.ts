import { NUTRITION_CONFIG as CFG } from "@/core/config/nutrition-config";
import type { GoalType, Sex, WorkActivity } from "@/core/enums";

/**
 * Estimación inicial de gasto y objetivo nutricional (docs/NUTRITION_ENGINE.md §1–3).
 * Función pura. El resultado es un PUNTO DE PARTIDA con incertidumbre explícita,
 * no una prescripción: se calibrará con datos reales en 2–4 semanas (motor de F4).
 *
 * Modelo TDEE aditivo para evitar el doble conteo entre pasos, actividad laboral
 * y entrenamiento: TDEE = BMR × factorNEAT(trabajo) + kcalPasos + kcalEntreno.
 */

export const NUTRITION_ESTIMATE_VERSION = "2.0.0";

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
  /** % graso; solo se usa para Katch-McArdle/proteína si está MEDIDO de forma fiable. */
  bodyFatPct?: number;
  bodyFatMeasured?: boolean;
  targetWeightKg?: number;
}

/** Traza completa y tipada del cálculo, para el bloque "Cómo se ha calculado". */
export interface InitialNutritionEstimateTrace {
  bmrFormula: "MIFFLIN_ST_JEOR" | "KATCH_MCARDLE";
  bmr: number;
  workNeatFactor: number;
  maintenanceBase: number; // BMR × factorNEAT (vida diaria + trabajo)
  stepsKcal: number;
  trainingKcal: number;
  tdee: number;
  tdeeUncertaintyPct: number;
  tdeeRange: { low: number; high: number };
  weeklyRatePct: number; // ritmo pedido por el usuario
  rawAdjustmentKcal: number; // déficit/superávit antes de acotar
  maxDeficitKcal: number;
  dailyAdjustmentKcal: number; // tras acotar al 25 % del TDEE (>0 déficit, <0 superávit)
  boundedByMaxDeficit: boolean;
  preFloorKcalTarget: number; // target antes de aplicar el suelo
  floorKcal: number;
  clampedToFloor: boolean;
  appliedAdjustmentKcal: number; // ajuste REAL tras suelo (tdee − target)
  effectiveWeeklyRatePct: number; // ritmo real derivado del ajuste aplicado
  kcalTarget: number;
  macrosLimitedByLowKcal: boolean;
  proteinReferenceWeightKg: number;
  proteinGPerKg: number;
  fatGPerKg: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  notes: string[];
}

export interface InitialEstimate {
  bmr: number;
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
  trace: InitialNutritionEstimateTrace;
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

export function mifflinStJeor(
  sex: Sex,
  weightKg: number,
  heightCm: number,
  ageYears: number,
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return Math.round(sex === "MALE" ? base + 5 : base - 161);
}

/** Katch-McArdle: requiere % graso medido de forma fiable. */
export function katchMcArdle(weightKg: number, bodyFatPct: number): number {
  const leanMassKg = weightKg * (1 - bodyFatPct / 100);
  return Math.round(370 + 21.6 * leanMassKg);
}

export function estimateInitialTargets(
  input: InitialEstimateInput,
): InitialEstimate {
  const notes: string[] = [];

  // ── BMR ── Mifflin-St Jeor por defecto. Katch-McArdle solo con % graso MEDIDO.
  let bmrFormula: InitialNutritionEstimateTrace["bmrFormula"] =
    "MIFFLIN_ST_JEOR";
  let bmr = mifflinStJeor(
    input.sex,
    input.weightKg,
    input.heightCm,
    input.ageYears,
  );
  if (input.bodyFatMeasured && typeof input.bodyFatPct === "number") {
    bmrFormula = "KATCH_MCARDLE";
    bmr = katchMcArdle(input.weightKg, input.bodyFatPct);
    notes.push(
      `Katch-McArdle aplicado con % graso medido (${input.bodyFatPct} %).`,
    );
  } else if (typeof input.bodyFatPct === "number") {
    notes.push(
      "Se usa Mifflin-St Jeor: el % graso indicado es una estimación, no una medición fiable (báscula/visual no bastan).",
    );
  }

  // ── TDEE aditivo (sin doble conteo) ──
  const workNeatFactor = CFG.workNeatFactor[input.workActivity];
  const maintenanceBase = bmr * workNeatFactor;
  const stepsKcal = Math.round(
    input.dailySteps * CFG.kcalPerStepPerKg * input.weightKg,
  );
  const kcalPerSession =
    CFG.strengthKcalPerKgPerMin * input.weightKg * input.minutesPerSession;
  const trainingKcal = Math.round(
    (kcalPerSession * input.trainingSessionsPerWeek) / 7,
  );
  const tdee = round25(maintenanceBase + stepsKcal + trainingKcal);
  const tdeeRange = {
    low: round25(tdee * (1 - CFG.tdeeUncertaintyPct)),
    high: round25(tdee * (1 + CFG.tdeeUncertaintyPct)),
  };

  // ── Ajuste según objetivo (separado del TDEE) ──
  const rateCfg = CFG.weeklyRatePct[input.goalType];
  const weeklyRatePct = clamp(
    input.weeklyRatePct ?? rateCfg.default,
    rateCfg.min,
    rateCfg.max,
  );
  // Déficit (>0) o superávit (<0) diario derivado del ritmo. "+0" evita -0.
  const rawAdjustment =
    Math.round(
      (input.weightKg * (-weeklyRatePct / 100) * CFG.kcalPerKgBodyweight) / 7,
    ) + 0;
  const maxDeficit = Math.round(tdee * CFG.maxDeficitPctOfTdee);
  const boundedByMaxDeficit = rawAdjustment > maxDeficit;
  const dailyAdjustmentKcal = boundedByMaxDeficit ? maxDeficit : rawAdjustment;
  if (boundedByMaxDeficit) {
    notes.push(
      `Déficit acotado al ${Math.round(CFG.maxDeficitPctOfTdee * 100)} % del gasto por seguridad.`,
    );
  }

  // ── Suelo de seguridad ──
  const floorKcal = Math.max(
    Math.round(bmr * CFG.minKcalBmrFactor),
    CFG.minKcalAbsolute[input.sex],
  );
  const preFloorKcalTarget = round25(tdee - dailyAdjustmentKcal);
  let kcalTarget = preFloorKcalTarget;
  const clampedToFloor = kcalTarget < floorKcal;
  if (clampedToFloor) {
    kcalTarget = round25(floorKcal + CFG.kcalRounding / 2);
    notes.push(
      "Objetivo ajustado al suelo de seguridad: el ritmo pedido exigía menos calorías de las recomendables.",
    );
  }
  // Ajuste y ritmo REALES tras el suelo (pueden diferir de lo pedido).
  const appliedAdjustmentKcal = tdee - kcalTarget;
  const effectiveWeeklyRatePct =
    Math.round(
      (-(appliedAdjustmentKcal * 7) /
        (input.weightKg * CFG.kcalPerKgBodyweight)) *
        100 *
        100,
    ) / 100;
  if (
    (boundedByMaxDeficit || clampedToFloor) &&
    Math.abs(appliedAdjustmentKcal - rawAdjustment) > CFG.kcalRounding
  ) {
    notes.push(
      `Ritmo real aplicado ${effectiveWeeklyRatePct.toLocaleString("es-ES")} %/semana (más suave que el pedido por seguridad).`,
    );
  }

  // ── Macros ──
  // Peso de referencia para proteína: objetivo/estimación magra si el % graso
  // MEDIDO es alto; si no, el peso actual.
  const highBf = CFG.highBodyFatPctForProteinRef[input.sex];
  const proteinReferenceWeightKg =
    input.bodyFatMeasured &&
    typeof input.bodyFatPct === "number" &&
    input.bodyFatPct > highBf
      ? (input.targetWeightKg ??
        Math.round(input.weightKg * (1 - input.bodyFatPct / 100) * 1.3))
      : input.weightKg;

  const proteinGPerKg = CFG.proteinGPerKg[input.goalType];
  const fatGPerKg = CFG.fatGPerKg[input.goalType];
  const proteinFloorG = Math.round(1.8 * proteinReferenceWeightKg);
  const fatFloorG = Math.max(
    Math.round(CFG.minFatGPerKg * input.weightKg),
    CFG.minFatGAbsolute,
  );

  // Cascada para respetar el mínimo de carbohidratos: bajar grasa → proteína.
  let proteinG = Math.round(proteinGPerKg * proteinReferenceWeightKg);
  let fatG = Math.max(
    Math.round(fatGPerKg * input.weightKg),
    CFG.minFatGAbsolute,
  );
  const carbsFrom = () =>
    Math.round((kcalTarget - proteinG * 4 - fatG * 9) / 4);
  let carbsG = carbsFrom();
  if (carbsG < CFG.minCarbsG && fatG > fatFloorG) {
    fatG = fatFloorG;
    carbsG = carbsFrom();
  }
  if (carbsG < CFG.minCarbsG && proteinG > proteinFloorG) {
    proteinG = proteinFloorG;
    carbsG = carbsFrom();
  }
  const macrosLimitedByLowKcal = carbsG < CFG.minCarbsG;
  if (macrosLimitedByLowKcal) {
    notes.push(
      "Con estas calorías no caben los mínimos de macronutrientes: el objetivo es muy bajo. Considera un ritmo más suave o pierde grasa más despacio.",
    );
  }
  carbsG = Math.max(carbsG, 0);

  const trace: InitialNutritionEstimateTrace = {
    bmrFormula,
    bmr,
    workNeatFactor,
    maintenanceBase: Math.round(maintenanceBase),
    stepsKcal,
    trainingKcal,
    tdee,
    tdeeUncertaintyPct: CFG.tdeeUncertaintyPct,
    tdeeRange,
    weeklyRatePct,
    rawAdjustmentKcal: rawAdjustment,
    maxDeficitKcal: maxDeficit,
    dailyAdjustmentKcal,
    boundedByMaxDeficit,
    preFloorKcalTarget,
    floorKcal,
    clampedToFloor,
    appliedAdjustmentKcal,
    effectiveWeeklyRatePct,
    kcalTarget,
    macrosLimitedByLowKcal,
    proteinReferenceWeightKg,
    proteinGPerKg,
    fatGPerKg,
    proteinG,
    fatG,
    carbsG,
    notes,
  };

  const fmtEs = (n: number) => n.toLocaleString("es-ES");

  return {
    bmr,
    tdee,
    tdeeRange,
    weeklyRatePct,
    // Ajuste REAL aplicado tras el suelo (lo que verá el usuario).
    dailyDeficitKcal: appliedAdjustmentKcal,
    kcalTarget,
    proteinG,
    fatG,
    carbsG,
    floorKcal,
    clampedToFloor,
    trace,
    explanations: {
      tdee: `Gasto estimado ~${fmtEs(tdee)} kcal/día (rango ${fmtEs(tdeeRange.low)}–${fmtEs(tdeeRange.high)}). Es un punto de partida: tus datos reales de peso e ingesta lo corregirán en 2–4 semanas.`,
      kcal: clampedToFloor
        ? `Objetivo ajustado al suelo de seguridad (${fmtEs(kcalTarget)} kcal): el ritmo pedido exigía menos calorías de las recomendables.`
        : appliedAdjustmentKcal === 0
          ? `Objetivo ${fmtEs(kcalTarget)} kcal/día: igual al mantenimiento estimado (peso estable).`
          : `Objetivo ${fmtEs(kcalTarget)} kcal/día: gasto estimado ${fmtEs(tdee)} con un ${appliedAdjustmentKcal > 0 ? "déficit" : "superávit"} de ${fmtEs(Math.abs(appliedAdjustmentKcal))} kcal para un ritmo de ${effectiveWeeklyRatePct.toLocaleString("es-ES")} % de tu peso por semana.`,
      protein: `${proteinG} g de proteína = ${proteinGPerKg} g/kg: el rango con mejor evidencia para conservar músculo con tu objetivo.`,
      fat: `${fatG} g de grasa (≥ ${CFG.minFatGPerKg} g/kg): mínimo necesario para función hormonal y absorción de vitaminas.`,
      carbs: `${carbsG} g de carbohidratos: todas las calorías restantes; alimentan tus entrenamientos.`,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
