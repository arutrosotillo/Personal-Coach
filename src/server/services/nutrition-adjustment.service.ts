import { Prisma } from "@/generated/prisma/client";

import {
  addDays,
  ageInYears,
  DEFAULT_TIMEZONE,
  diffDays,
  toLocalDate,
} from "@/core/dates";
import { Sex } from "@/core/enums";
import {
  CALORIE_ADJUSTMENT_VERSION,
  evaluateCalorieAdjustment,
  type CalorieAdjustment,
  type CalorieAdjustmentInput,
} from "@/core/nutrition/calorie-adjustment";
import {
  HISTORY_WINDOW_DAYS,
  listMeasurements,
} from "@/server/repositories/body-measurement.repo";
import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import { GoalType } from "@/core/enums";
import { assessPerformance, type PerformanceTrend } from "@/core/insights";
import {
  listAllTargets,
  listGoals,
  type NutritionTargetFull,
} from "@/server/repositories/cycle.repo";
import { listIntake } from "@/server/repositories/intake.repo";
import {
  findLastRejectedCalorieAdjustment,
  persistCalorieAdjustment,
} from "@/server/repositories/nutrition-target.repo";
import {
  energyEstimateRow,
  getCurrentMaintenance,
} from "@/server/services/cycle.service";
import { getTrainingAnalysis } from "@/server/services/fatigue.service";
import {
  getActiveGoal,
  getProfileById,
} from "@/server/repositories/profile.repo";
import { toEngineGoal, toEnginePoints } from "@/server/services/body.service";

/**
 * Ajuste calórico por tendencia de peso: lee, pregunta al motor puro y, cuando
 * el usuario responde, persiste.
 *
 * LEER NO ESCRIBE. La sugerencia se calcula al vuelo en cada visita: no se
 * guarda nada hasta que el usuario acepta o la descarta. En ese momento se
 * RECALCULA en el servidor —nunca se confía en lo que trae el cliente— y se
 * guardan juntas la decisión del motor, la recomendación y, si se aceptó, el
 * nuevo objetivo.
 */

/** La sugerencia que el usuario vio ya no es la que el motor da ahora. */
export class StaleAdjustmentError extends Error {
  constructor() {
    super(
      "La sugerencia ha cambiado desde que abriste la pantalla. Revísala de nuevo.",
    );
    this.name = "StaleAdjustmentError";
  }
}

/** Ingesta registrada que se mira (la ventana más larga del motor + confirmación). */
const INTAKE_WINDOW_DAYS = 120;

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Último CAMBIO de calorías dentro del ciclo activo. El objetivo con el que
 * empezó el ciclo (o el del onboarding) no es un cambio: su arranque ya lo
 * cubre la fase inicial/estabilización.
 */
function lastChangeInCycle(
  targets: readonly NutritionTargetFull[],
  cycleStart: string | null,
): CalorieAdjustmentInput["lastChange"] {
  if (cycleStart === null) return null;
  for (let i = targets.length - 1; i > 0; i--) {
    const t = targets[i];
    if (t.effectiveFrom <= cycleStart) break;
    const prev = targets[i - 1];
    if (t.kcal !== prev.kcal) {
      return {
        localDate: t.effectiveFrom,
        direction: t.kcal > prev.kcal ? "UP" : "DOWN",
      };
    }
  }
  return null;
}

/** Tipo del ciclo inmediatamente anterior, si el activo empezó justo después. */
async function previousGoalTypeFor(
  profileId: string,
  activeStart: string,
): Promise<GoalType | null> {
  const goals = await listGoals(profileId);
  const idx = goals.findIndex(
    (g) => g.status === "ACTIVE" && g.startDate === activeStart,
  );
  if (idx <= 0) return null;
  const prev = goals[idx - 1];
  const prevEnd = prev.endDate ?? addDays(activeStart, -1);
  if (
    diffDays(prevEnd, activeStart) >
    NUTRITION_CONFIG.regimeStart.contiguousCycleDays
  ) {
    return null;
  }
  const type = GoalType.safeParse(prev.type);
  return type.success ? type.data : null;
}

/**
 * Tendencia del rendimiento, solo cuando la política la usa (recomposición):
 * leer el análisis de entrenamiento no es gratis y las demás no lo necesitan.
 */
async function performanceTrendFor(
  profileId: string,
  goalType: string | undefined,
  given: PerformanceTrend | null | undefined,
  now: Date,
): Promise<PerformanceTrend | null> {
  if (given !== undefined) return given;
  if (goalType !== "RECOMP") return null;
  const training = await getTrainingAnalysis(profileId, now).catch(() => null);
  return training ? assessPerformance(training).trend : null;
}

async function buildInput(
  profileId: string,
  todayLocalDate: string,
  performanceTrend: PerformanceTrend | null | undefined,
  now: Date,
): Promise<CalorieAdjustmentInput | null> {
  const [profile, goalRow, records, targets, lastRejected, intake] =
    await Promise.all([
      getProfileById(profileId),
      getActiveGoal(profileId),
      listMeasurements(
        profileId,
        addDays(todayLocalDate, -HISTORY_WINDOW_DAYS),
        todayLocalDate,
      ),
      listAllTargets(profileId),
      findLastRejectedCalorieAdjustment(profileId),
      listIntake(
        profileId,
        addDays(todayLocalDate, -INTAKE_WINDOW_DAYS),
        todayLocalDate,
      ),
    ]);
  if (!profile) return null;
  const sex = Sex.safeParse(profile.sex);
  if (!sex.success) return null;

  const goal = toEngineGoal(goalRow);
  const inForce = targets.filter((t) => t.effectiveFrom <= todayLocalDate);
  const current = inForce.at(-1);

  return {
    todayLocalDate,
    sex: sex.data,
    ageYears: ageInYears(profile.birthDate, todayLocalDate),
    heightCm: profile.heightCm,
    goal: goal && goalRow ? { ...goal, startDate: goalRow.startDate } : null,
    measurements: toEnginePoints(records),
    currentTarget: current
      ? {
          kcal: current.kcal,
          proteinG: current.proteinG,
          fatG: current.fatG,
          carbsG: current.carbsG,
          effectiveFrom: current.effectiveFrom,
        }
      : null,
    lastChange: lastChangeInCycle(inForce, goalRow?.startDate ?? null),
    lastRejectedLocalDate: lastRejected,
    intake: intake.map((d) => ({
      localDate: d.localDate,
      kcal: d.kcal,
      proteinG: d.proteinG,
    })),
    previousGoalType: goalRow
      ? await previousGoalTypeFor(profileId, goalRow.startDate)
      : null,
    performanceTrend: await performanceTrendFor(
      profileId,
      goalRow?.type,
      performanceTrend,
      now,
    ),
  };
}

/**
 * Lo que el motor diría hoy para este perfil. `null` sin perfil válido.
 *
 * `performanceTrend` solo lo usa la recomposición (subir calorías si bajas de
 * peso Y el rendimiento cae). Quien ya tiene el análisis de entrenamiento lo
 * pasa; si no, se lee aquí cuando hace falta.
 */
export async function getCalorieAdjustment(
  profileId: string,
  now: Date = new Date(),
  performanceTrend?: PerformanceTrend | null,
): Promise<CalorieAdjustment | null> {
  const input = await buildInput(
    profileId,
    toLocalDate(now, DEFAULT_TIMEZONE),
    performanceTrend,
    now,
  );
  return input ? evaluateCalorieAdjustment(input) : null;
}

/**
 * Acepta o descarta la sugerencia vigente.
 *
 * `expectedKcal` es lo que el usuario VIO. Solo sirve de guarda: si el motor,
 * recalculado ahora, ya no propone ese número (llegó un pesaje nuevo, cambió el
 * objetivo…), no se aplica nada y se pide revisar.
 */
export async function resolveCalorieAdjustment(
  profileId: string,
  answer: { accept: boolean; expectedKcal: number },
  now: Date = new Date(),
  performanceTrend?: PerformanceTrend | null,
): Promise<CalorieAdjustment> {
  const localDate = toLocalDate(now, DEFAULT_TIMEZONE);
  const input = await buildInput(profileId, localDate, performanceTrend, now);
  if (!input) throw new StaleAdjustmentError();
  const result = evaluateCalorieAdjustment(input);
  if (
    result.action !== "ADJUST" ||
    result.proposal === null ||
    result.proposal.kcal !== answer.expectedKcal
  ) {
    throw new StaleAdjustmentError();
  }
  const proposal = result.proposal;
  // La estimación del mantenimiento con la que se decidió, congelada: es parte
  // de la memoria metabólica (se puede comparar con las siguientes).
  const current = await getCurrentMaintenance(profileId, now);

  await persistCalorieAdjustment({
    estimate: energyEstimateRow(
      profileId,
      current.goalId,
      localDate,
      "ADJUSTMENT",
      current.maintenance,
      current.weightKg,
      current.isDeficit,
    ),
    profileId,
    localDate,
    now,
    accepted: answer.accept,
    decision: {
      algorithmVersion: CALORIE_ADJUSTMENT_VERSION,
      ruleId: result.ruleId,
      inputSnapshot: toJson(input),
      output: toJson(result),
      explanation: result.explanation,
    },
    recommendation: {
      title: result.title,
      body: result.explanation,
      payload: toJson({
        fromKcal: result.currentKcal,
        toKcal: proposal.kcal,
        deltaKcal: proposal.deltaKcal,
        reasonCode: result.reasonCode,
        confidence: result.confidence,
      }),
    },
    target: answer.accept
      ? {
          kcal: proposal.kcal,
          proteinG: proposal.proteinG,
          fatG: proposal.fatG,
          carbsG: proposal.carbsG,
        }
      : null,
  });

  return result;
}
