import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import { FAT_LOSS_VOLUME_FACTOR } from "@/core/config/training-config";
import {
  STRATEGY_TO_GOAL_TYPE,
  type GoalStrategy,
  type GoalType,
  type Sex,
} from "@/core/enums";
import type { MaintenanceEstimate } from "@/core/nutrition/energy-balance";
import { mifflinStJeor } from "@/core/nutrition/initial-estimate";
import {
  computeMacros,
  roundKcal,
  safetyFloorKcal,
} from "@/core/nutrition/macros";

/**
 * Calorías y macros de un ciclo NUEVO (docs/CYCLES.md §2). Puro.
 *
 * A diferencia del onboarding, el punto de partida no es la fórmula: es el
 * mantenimiento estimado con el historial (`estimateMaintenance`), que ya
 * combina lo observado con la fórmula según lo fiable que sea cada cosa. Sobre
 * él se aplica el ritmo pedido con las mismas reglas de seguridad de siempre
 * (déficit ≤ 25 % del gasto, suelo inviolable) y los mismos macros.
 *
 * El plan es una PROPUESTA: no se guarda nada hasta que la persona confirma, y
 * al confirmar el servidor lo recalcula.
 */

export const CYCLE_PLAN_VERSION = "1.0.0";

type NutritionConfig = typeof NUTRITION_CONFIG;

export interface CyclePlanInput {
  strategy: GoalStrategy;
  /** % del peso por semana; si falta, el default de la estrategia. */
  weeklyRatePct?: number;
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  bodyFatPct?: number;
  bodyFatMeasured?: boolean;
  targetWeightKg?: number;
  maintenance: MaintenanceEstimate;
  /** Tipo del ciclo que se cierra justo antes, si lo hay. */
  previousGoalType: GoalType | null;
  /** Objetivo calórico vigente, para decir cuánto cambia. */
  currentKcal: number | null;
}

export interface CyclePlan {
  version: string;
  strategy: GoalStrategy;
  goalType: GoalType;
  weeklyRatePct: number;
  /** El ritmo pedido se salía del rango y se acotó. */
  rateClamped: boolean;
  maintenanceKcal: number;
  /** kcal objetivo − mantenimiento (positivo = superávit). */
  energyDeltaKcal: number;
  boundedByMaxDeficit: boolean;
  floorKcal: number;
  clampedToFloor: boolean;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  macrosLimitedByLowKcal: boolean;
  /** Ritmo real que implica el objetivo tras los límites de seguridad. */
  effectiveWeeklyRatePct: number;
  expectedKgPerWeek: number;
  deltaVsCurrentKcal: number | null;
  explanation: {
    kcal: string;
    macros: string;
    expectations: string[];
  };
}

const kcalFmt = (n: number) => Math.round(n).toLocaleString("es-ES");
const numFmt = (n: number, digits = 2) =>
  n
    .toLocaleString("es-ES", { maximumFractionDigits: digits })
    .replace("-", "−");

export function planCycleTargets(
  input: CyclePlanInput,
  config: NutritionConfig = NUTRITION_CONFIG,
): CyclePlan {
  const goalType = STRATEGY_TO_GOAL_TYPE[input.strategy];
  const range = config.weeklyRatePct[goalType];
  const requested = input.weeklyRatePct ?? range.default;
  const weeklyRatePct = Math.min(Math.max(requested, range.min), range.max);
  const rateClamped = weeklyRatePct !== requested;

  const maintenanceKcal = input.maintenance.tdeeKcal;
  // Superávit (+) o déficit (−) diario derivado del ritmo.
  const rawDelta =
    (input.weightKg * (weeklyRatePct / 100) * config.kcalPerKgBodyweight) / 7;
  const maxDeficit = maintenanceKcal * config.maxDeficitPctOfTdee;
  const boundedByMaxDeficit = rawDelta < -maxDeficit;
  const delta = boundedByMaxDeficit ? -maxDeficit : rawDelta;

  const bmr = mifflinStJeor(
    input.sex,
    input.weightKg,
    input.heightCm,
    input.ageYears,
  );
  const floorKcal = safetyFloorKcal(input.sex, bmr, config);
  let kcal = roundKcal(maintenanceKcal + delta, config);
  const clampedToFloor = kcal < floorKcal;
  if (clampedToFloor) {
    kcal = Math.ceil(floorKcal / config.kcalRounding) * config.kcalRounding;
  }

  const energyDeltaKcal = kcal - maintenanceKcal;
  const expectedKgPerWeek = (energyDeltaKcal * 7) / config.kcalPerKgBodyweight;
  const effectiveWeeklyRatePct =
    Math.round((expectedKgPerWeek / input.weightKg) * 100 * 100) / 100;

  const macros = computeMacros(
    {
      kcalTarget: kcal,
      weightKg: input.weightKg,
      goalType,
      sex: input.sex,
      bodyFatPct: input.bodyFatPct,
      bodyFatMeasured: input.bodyFatMeasured,
      targetWeightKg: input.targetWeightKg,
    },
    config,
  );

  // ── Explicación ──
  const m = input.maintenance;
  const deltaTxt =
    energyDeltaKcal === 0
      ? "sin superávit ni déficit"
      : `${energyDeltaKcal > 0 ? "+" : "−"}${kcalFmt(Math.abs(energyDeltaKcal))} kcal de ${energyDeltaKcal > 0 ? "superávit" : "déficit"}`;
  const kcalTxt =
    `${kcalFmt(kcal)} kcal/día = tu mantenimiento estimado (${kcalFmt(maintenanceKcal)}, probablemente entre ${kcalFmt(m.lowKcal)} y ${kcalFmt(m.highKcal)}) ${deltaTxt}` +
    (weeklyRatePct === 0
      ? "."
      : `, para un ritmo de ${numFmt(effectiveWeeklyRatePct)} % de tu peso por semana (unos ${numFmt(expectedKgPerWeek * 1000, 0)} g/semana).`) +
    (boundedByMaxDeficit
      ? ` El déficit se ha acotado al ${Math.round(config.maxDeficitPctOfTdee * 100)} % de tu gasto por seguridad.`
      : "") +
    (clampedToFloor
      ? ` Se ha subido a tu mínimo de seguridad (${kcalFmt(floorKcal)} kcal).`
      : "");
  const macrosTxt = `${macros.proteinG} g de proteína (${macros.proteinGPerKg} g/kg), ${macros.fatG} g de grasa y ${macros.carbsG} g de carbohidratos, que se llevan todo lo que queda.`;

  const expectations: string[] = [];
  if (input.previousGoalType === "FAT_LOSS" && goalType !== "FAT_LOSS") {
    expectations.push(
      "Las primeras 2–3 semanas es normal subir 1–2 kg de golpe: es glucógeno, agua y contenido intestinal al comer más, no grasa ni músculo. El motor no los usa para ajustar nada.",
    );
  }
  if (goalType === "LEAN_GAIN") {
    expectations.push(
      `A este ritmo la báscula apenas se moverá de una semana a otra (${numFmt(expectedKgPerWeek * 1000, 0)} g/semana caben dentro del ruido diario). Lo que cuenta es la tendencia de varias semanas, y la app la sigue por ti.`,
    );
    expectations.push(
      "No hay fecha de fin: puedes estar meses o años en esta fase. La app te avisará si la cintura o el ritmo sugieren que estás acumulando demasiada grasa, pero nunca cambiará de fase sola.",
    );
  }
  if (goalType === "FAT_LOSS") {
    expectations.push(
      "Las dos primeras semanas la báscula bajará más de lo previsto por agua y glucógeno: no cuenta como grasa y no se usa para ajustar.",
    );
  }
  if (goalType === "MAINTENANCE" || goalType === "RECOMP") {
    expectations.push(
      goalType === "RECOMP"
        ? "En una recomposición el peso apenas cambia: lo que cuenta es la cintura y el rendimiento."
        : "En mantenimiento tu peso puede moverse ±1 % sin que haya nada que corregir.",
    );
  }
  if (m.confidence === "LOW") {
    expectations.push(
      "La estimación del mantenimiento todavía es poco precisa: en unas semanas de pesajes el ajuste adaptativo corregirá el objetivo si hace falta.",
    );
  }

  return {
    version: CYCLE_PLAN_VERSION,
    strategy: input.strategy,
    goalType,
    weeklyRatePct,
    rateClamped,
    maintenanceKcal,
    energyDeltaKcal,
    boundedByMaxDeficit,
    floorKcal,
    clampedToFloor,
    kcal,
    proteinG: macros.proteinG,
    fatG: macros.fatG,
    carbsG: macros.carbsG,
    macrosLimitedByLowKcal: macros.macrosLimitedByLowKcal,
    effectiveWeeklyRatePct,
    expectedKgPerWeek,
    deltaVsCurrentKcal:
      input.currentKcal === null ? null : kcal - input.currentKcal,
    explanation: { kcal: kcalTxt, macros: macrosTxt, expectations },
  };
}

/**
 * ¿Merece la pena revisar el volumen de entrenamiento al cambiar de fase?
 * Solo una RECOMENDACIÓN opcional: el programa no se toca.
 *
 * El generador reduce el volumen objetivo al 85 % en déficit
 * (`FAT_LOSS_VOLUME_FACTOR`). El contador de volumen de /program ya usa el
 * objetivo vigente, así que el cambio de listón se ve allí solo.
 */
export function trainingVolumeNote(
  previous: GoalType | null,
  next: GoalType,
): string | null {
  const pct = Math.round((1 - FAT_LOSS_VOLUME_FACTOR) * 100);
  if (previous === "FAT_LOSS" && next !== "FAT_LOSS") {
    return `En definición tu volumen objetivo estaba rebajado un ${pct} %. Al salir puedes recuperarlo poco a poco —una serie más en los grupos que el contador de volumen de Programa marque por debajo—. Tu rutina actual sigue igual si no la cambias tú, y tus marcas e historial se conservan.`;
  }
  if (previous !== null && previous !== "FAT_LOSS" && next === "FAT_LOSS") {
    return `En definición el volumen objetivo baja un ${pct} %: si notas que no te recuperas entre sesiones, quita una serie en los grupos que vayan por encima en el contador de volumen de Programa. Tu rutina sigue igual si no la cambias tú.`;
  }
  return null;
}
