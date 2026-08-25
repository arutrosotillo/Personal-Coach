import { FATIGUE } from "@/core/config/training-config";
import { addDays, DEFAULT_TIMEZONE, toLocalDate } from "@/core/dates";
import {
  analyzeTraining,
  type TrainingAnalysis,
} from "@/core/training/analysis";
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
