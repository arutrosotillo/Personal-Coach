import { FATIGUE } from "@/core/config/training-config";
import { addDays, DEFAULT_TIMEZONE, toLocalDate } from "@/core/dates";
import {
  analyzeTraining,
  recoveryVeto,
  type TrainingAnalysis,
} from "@/core/training/analysis";
import type { RecoveryVeto } from "@/core/training/veto";
import { getTrainingContext } from "@/server/repositories/training-context.repo";

/**
 * Puente lectura → motores de progresión y fatiga (Fase 3.3). La evaluación es
 * EFÍMERA: se calcula al vuelo y no se persiste. Nada de lo que devuelve
 * modifica el programa: es una recomendación que el usuario acepta o ignora.
 */

/** Ventana por defecto: la del motor de fatiga, con margen para tendencias. */
export const DEFAULT_WINDOW_DAYS = Math.max(FATIGUE.WINDOW_DAYS, 28);

export async function getTrainingAnalysis(
  profileId: string,
  now: Date = new Date(),
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<TrainingAnalysis> {
  const today = toLocalDate(now, DEFAULT_TIMEZONE);
  const context = await getTrainingContext(
    profileId,
    addDays(today, -windowDays),
    today,
  );
  return analyzeTraining(context);
}

/**
 * Veto de recuperación vigente para una fecha concreta (la de la sesión que se
 * está entrenando, no la del reloj). Lo consume la pantalla de sesión para no
 * proponer subidas mientras hay dolor o una descarga recomendada.
 *
 * Devuelve `null` ante cualquier problema: un fallo leyendo el contexto no
 * puede impedirte entrenar.
 */
export async function getRecoveryVeto(
  profileId: string,
  onLocalDate: string,
): Promise<RecoveryVeto | null> {
  try {
    const context = await getTrainingContext(
      profileId,
      addDays(onLocalDate, -DEFAULT_WINDOW_DAYS),
      onLocalDate,
    );
    return recoveryVeto(analyzeTraining(context).fatigue);
  } catch {
    return null;
  }
}
