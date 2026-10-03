import { Prisma } from "@/generated/prisma/client";

import {
  addDays,
  ageInYears,
  DEFAULT_TIMEZONE,
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
import {
  findLastRejectedCalorieAdjustment,
  listLatestTargets,
  persistCalorieAdjustment,
} from "@/server/repositories/nutrition-target.repo";
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

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function buildInput(
  profileId: string,
  todayLocalDate: string,
): Promise<CalorieAdjustmentInput | null> {
  const [profile, goalRow, records, targets, lastRejected] = await Promise.all([
    getProfileById(profileId),
    getActiveGoal(profileId),
    listMeasurements(
      profileId,
      addDays(todayLocalDate, -HISTORY_WINDOW_DAYS),
      todayLocalDate,
    ),
    listLatestTargets(profileId),
    findLastRejectedCalorieAdjustment(profileId),
  ]);
  if (!profile) return null;
  const sex = Sex.safeParse(profile.sex);
  if (!sex.success) return null;

  const goal = toEngineGoal(goalRow);
  const [current, previous] = targets;

  return {
    todayLocalDate,
    sex: sex.data,
    ageYears: ageInYears(profile.birthDate, todayLocalDate),
    heightCm: profile.heightCm,
    goal: goal && goalRow ? { ...goal, startDate: goalRow.startDate } : null,
    measurements: toEnginePoints(records),
    currentTarget: current ?? null,
    // El primer objetivo es el del onboarding: no es un "cambio" y su
    // enfriamiento ya lo cubre la fase inicial.
    lastChange:
      current && previous && current.kcal !== previous.kcal
        ? {
            localDate: current.effectiveFrom,
            direction: current.kcal > previous.kcal ? "UP" : "DOWN",
          }
        : null,
    lastRejectedLocalDate: lastRejected,
  };
}

/** Lo que el motor diría hoy para este perfil. `null` sin perfil válido. */
export async function getCalorieAdjustment(
  profileId: string,
  now: Date = new Date(),
): Promise<CalorieAdjustment | null> {
  const input = await buildInput(profileId, toLocalDate(now, DEFAULT_TIMEZONE));
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
): Promise<CalorieAdjustment> {
  const localDate = toLocalDate(now, DEFAULT_TIMEZONE);
  const input = await buildInput(profileId, localDate);
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

  await persistCalorieAdjustment({
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
