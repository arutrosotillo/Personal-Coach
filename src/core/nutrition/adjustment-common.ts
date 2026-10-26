import type {
  BodyConfidence,
  BodyGoalInput,
  BodyMeasurementPoint,
} from "@/core/body";
import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import { addDays, diffDays } from "@/core/dates";
import type { GoalType, Sex } from "@/core/enums";
import type { PerformanceTrend } from "@/core/insights";
import {
  summarizeLoggedIntake,
  type IntakeDay,
  type LoggedIntakeSummary,
} from "@/core/nutrition/energy-balance";
import { mifflinStJeor } from "@/core/nutrition/initial-estimate";
import { safetyFloorKcal } from "@/core/nutrition/macros";

/**
 * Tipos y piezas compartidas por todas las políticas del ajuste calórico
 * (`calorie-adjustment.ts` para la definición, `adaptive-calories.ts` para
 * ganancia, mantenimiento y recomposición). Puro.
 */

export type AdjustmentConfig = typeof NUTRITION_CONFIG;

/** v2: políticas por estrategia (docs/CYCLES.md §4). v1 era solo la definición. */
export const CALORIE_ADJUSTMENT_VERSION = "2.0.0";

export type KcalDirection = "UP" | "DOWN";

/** Qué familia de reglas evaluó la situación. */
export type AdjustmentPolicy = "LOSS" | "GAIN" | "MAINTAIN" | "RECOMP" | "NONE";

export interface NutritionTargetSnapshot {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  /** localDate desde el que rige. */
  effectiveFrom: string;
}

export interface CalorieAdjustmentInput {
  todayLocalDate: string;
  sex: Sex;
  ageYears: number;
  heightCm: number;
  /** Objetivo activo. `startDate` abre la fase y acota la tendencia. */
  goal: (BodyGoalInput & { startDate: string }) | null;
  measurements: readonly BodyMeasurementPoint[];
  currentTarget: NutritionTargetSnapshot | null;
  /** Último CAMBIO del objetivo calórico dentro del ciclo (no el de inicio). */
  lastChange: { localDate: string; direction: KcalDirection } | null;
  /** Último "ahora no" a esta sugerencia. */
  lastRejectedLocalDate: string | null;
  /**
   * Ingesta registrada (opcional). Con registro suficiente se activa la regla
   * de adherencia: no se toca un objetivo que no se está comiendo.
   */
  intake?: readonly IntakeDay[];
  /**
   * Tipo del ciclo inmediatamente anterior, si este empezó justo después.
   * Salir de un déficit alarga la estabilización (glucógeno).
   */
  previousGoalType?: GoalType | null;
  /** Tendencia del rendimiento en el gimnasio (recomposición). */
  performanceTrend?: PerformanceTrend | null;
}

export type AdjustmentReasonCode =
  | "NOT_APPLICABLE_GOAL"
  | "NO_TARGET"
  | "INITIAL_PHASE"
  | "INSUFFICIENT_DATA"
  | "UNCONFIRMED_SLOW"
  | "UNCONFIRMED_FAST"
  | "STALLED_FIRST_WEEK"
  | "STALLED_CONFIRMED"
  | "EXCESSIVE_FIRST_WEEK"
  | "EXCESSIVE_CONFIRMED"
  | "SLIGHTLY_SLOW"
  | "ON_TRACK"
  | "SLIGHTLY_FAST"
  | "COOLDOWN"
  | "SNOOZED"
  | "AT_FLOOR"
  // ── Políticas adaptativas (ganancia, mantenimiento, recomposición) ──
  | "ADHERENCE_GAP"
  | "SLOW_FIRST_READING"
  | "SLOW_CONFIRMED"
  | "FAST_FIRST_READING"
  | "FAST_CONFIRMED"
  | "REVERSAL_GUARD"
  | "IN_BAND"
  | "DRIFTING"
  | "DRIFT_RETURNING"
  | "DRIFT_FIRST_READING"
  | "DRIFT_CONFIRMED"
  | "RECOMP_RISING_FIRST_READING"
  | "RECOMP_RISING_CONFIRMED"
  | "RECOMP_FALLING_FIRST_READING"
  | "RECOMP_FALLING_CONFIRMED"
  | "RECOMP_FALLING_PERFORMANCE_OK";

/** Lectura de la tendencia en un día concreto, en las unidades del objetivo. */
export interface PaceReading {
  localDate: string;
  observedKgPerWeek: number;
  ciLowKgPerWeek: number;
  ciHighKgPerWeek: number;
  targetKgPerWeek: number;
  /** observado / objetivo: 1 = justo al ritmo; 0 = parado; <0 = al revés. 0 si el objetivo es 0. */
  ratio: number;
  /** El ratio más FAVORABLE que admite el intervalo de confianza. */
  fastestPlausibleRatio: number;
  /** El ratio más DESFAVORABLE que admite el intervalo de confianza. */
  slowestPlausibleRatio: number;
  windowDays: number;
  measurements: number;
  confidence: BodyConfidence;
  pace:
    | "STALLED"
    | "UNCONFIRMED_SLOW"
    | "SLOW"
    | "ON_TRACK"
    | "FAST"
    | "UNCONFIRMED_FAST"
    | "EXCESSIVE"
    // Mantenimiento y recomposición: el peso respecto a su banda.
    | "IN_BAND"
    | "ABOVE_BAND"
    | "BELOW_BAND"
    | "RISING"
    | "FALLING";
  /** Mantenimiento: peso de referencia y desvío respecto a él. */
  anchorKg?: number;
  driftKg?: number;
}

export interface ProposedTarget {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  deltaKcal: number;
  direction: KcalDirection;
  /** El paso se recortó para no bajar del suelo de seguridad. */
  clampedToFloor: boolean;
}

/** Lo que dice el registro de ingesta frente al objetivo, si lo hay. */
export interface AdherenceReading {
  loggedDays: number;
  coverage: number;
  meanIntakeKcal: number;
  targetKcal: number;
  /** (comido − objetivo) / objetivo. */
  deviationFraction: number;
}

export interface CalorieAdjustment {
  engineVersion: string;
  policy: AdjustmentPolicy;
  ruleId: string;
  reasonCode: AdjustmentReasonCode;
  /** `ADJUST` solo cuando hay propuesta que aceptar. */
  action: "ADJUST" | "HOLD";
  confidence: BodyConfidence;
  title: string;
  explanation: string;
  proposal: ProposedTarget | null;
  currentKcal: number | null;
  floorKcal: number | null;
  daysOnPhase: number | null;
  now: PaceReading | null;
  weekAgo: PaceReading | null;
  /** Por qué no hay lectura, cuando no la hay (motivo del motor corporal). */
  insufficientDataReason: string | null;
  /** Fecha a partir de la cual volverá a poder proponer algo, si aplica. */
  nextEligibleLocalDate: string | null;
  /** Primer día que entra en la tendencia (políticas adaptativas). */
  trackingStartLocalDate: string | null;
  adherence: AdherenceReading | null;
}

/** Por qué no hay lectura de tendencia, en palabras (motivo del motor corporal). */
export const INSUFFICIENT_REASON: Record<string, string> = {
  NO_MEASUREMENTS: "Aún no hay pesajes en esta fase.",
  TOO_FEW_MEASUREMENTS: "Faltan pesajes para calcular una tendencia fiable.",
  SPAN_TOO_SHORT:
    "Los pesajes cubren todavía muy pocos días para calcular una tendencia.",
  SPARSE_MEASUREMENTS: "Los pesajes están demasiado espaciados.",
};

// ── Formato es-ES (la explicación lleva los números usados) ─────────────────

export const kcalFmt = (n: number) => Math.round(n).toLocaleString("es-ES");
/** Con el menos tipográfico (U+2212), como el resto de `/progress`. */
export const kgFmt = (n: number) =>
  n
    .toLocaleString("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace("-", "−");
export const pctFmt = (n: number) =>
  Math.round(n * 100).toLocaleString("es-ES") + " %";

export function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** El suelo de seguridad, redondeado hacia arriba al paso de 25 kcal. */
export function floorFor(
  input: CalorieAdjustmentInput,
  weightKg: number,
  config: AdjustmentConfig,
) {
  const bmr = mifflinStJeor(
    input.sex,
    weightKg,
    input.heightCm,
    input.ageYears,
  );
  return ceilTo(safetyFloorKcal(input.sex, bmr, config), config.kcalRounding);
}

/**
 * Macros del nuevo objetivo: la proteína y la grasa NO se tocan (protegen el
 * músculo y la salud hormonal); el cambio sale entero de los carbohidratos
 * (spec §3: carbohidratos = resto). Solo si los carbohidratos bajaran del
 * mínimo se recorta la grasa hasta su suelo.
 */
export function rebalanceMacros(
  current: NutritionTargetSnapshot,
  kcal: number,
  weightKg: number,
  config: AdjustmentConfig,
) {
  const proteinG = current.proteinG;
  let fatG = current.fatG;
  const carbsFor = () => Math.round((kcal - proteinG * 4 - fatG * 9) / 4);
  let carbsG = carbsFor();
  if (carbsG < config.minCarbsG) {
    const fatFloor = Math.max(
      Math.round(config.minFatGPerKg * weightKg),
      config.minFatGAbsolute,
    );
    fatG = Math.min(
      fatG,
      Math.max(
        fatFloor,
        fatG - Math.ceil(((config.minCarbsG - carbsG) * 4) / 9),
      ),
    );
    carbsG = carbsFor();
  }
  return { proteinG, fatG, carbsG: Math.max(carbsG, 0) };
}

/**
 * Registro de ingesta frente al objetivo en una ventana. `null` si no hay
 * registro suficiente para juzgar: sin datos no se presume mala adherencia.
 */
export function readAdherence(
  input: CalorieAdjustmentInput,
  from: string,
  to: string,
  config: AdjustmentConfig,
): AdherenceReading | null {
  if (!input.intake || input.intake.length === 0) return null;
  if (input.currentTarget === null) return null;
  const summary: LoggedIntakeSummary = summarizeLoggedIntake(
    input.intake,
    from,
    to,
    config,
  );
  if (!summary.sufficient || summary.meanKcal === null) return null;
  const targetKcal = input.currentTarget.kcal;
  return {
    loggedDays: summary.usedDays,
    coverage: summary.coverage,
    meanIntakeKcal: summary.meanKcal,
    targetKcal,
    deviationFraction: (summary.meanKcal - targetKcal) / targetKcal,
  };
}

/**
 * ¿La adherencia explica el desvío? Si quieres subir calorías porque no
 * ganas peso pero ya comes por debajo del objetivo (o bajarlas porque no
 * pierdes y comes por encima), cambiar el número no arregla nada.
 */
export function adherenceExplains(
  adherence: AdherenceReading | null,
  direction: KcalDirection,
  config: AdjustmentConfig,
): boolean {
  if (adherence === null) return false;
  const tol = config.calorieAdjustment.adherenceToleranceFraction;
  return direction === "UP"
    ? adherence.deviationFraction < -tol
    : adherence.deviationFraction > tol;
}

export function adherenceText(adherence: AdherenceReading): string {
  return `Según tu registro (${adherence.loggedDays} días) estás comiendo de media ${kcalFmt(adherence.meanIntakeKcal)} kcal frente a un objetivo de ${kcalFmt(adherence.targetKcal)} (${adherence.deviationFraction > 0 ? "+" : "−"}${Math.round(Math.abs(adherence.deviationFraction) * 100)} %).`;
}

/** Días transcurridos y siguiente fecha válida tras un enfriamiento. */
export function cooldownUntil(
  fromLocalDate: string,
  days: number,
  today: string,
): { since: number; until: string; active: boolean } {
  const since = diffDays(fromLocalDate, today);
  return { since, until: addDays(fromLocalDate, days), active: since < days };
}
