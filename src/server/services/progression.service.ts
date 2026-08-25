import {
  bestSet,
  currentE1rm,
  trend,
  type BestSet,
  type Trend,
} from "@/core/training/history";
import {
  suggestProgression,
  type ProgressionSuggestion,
} from "@/core/training/progression";
import type { ExecutionSession } from "@/server/repositories/workout.repo";
import { getVariantHistory } from "@/server/repositories/workout.repo";

/**
 * Puente lectura → motor (Fase 2B). La sugerencia es EFÍMERA: se calcula al
 * vuelo desde el snapshot de la sesión + la última sesión válida de la variante,
 * y NO se persiste (ni AlgorithmDecision ni Recommendation; eso es F3).
 */

/** Sugerencia de progresión por WorkoutExercise de la sesión en curso. */
export function buildSuggestions(
  session: ExecutionSession,
): Record<string, ProgressionSuggestion> {
  // El día de la SESIÓN EN CURSO es el "hoy" del motor: así la recencia mide
  // desde la fecha real de entrenamiento, no desde el reloj del servidor.
  const todayLocalDate = session.localDate;
  const out: Record<string, ProgressionSuggestion> = {};
  for (const ex of session.exercises) {
    out[ex.id] = suggestProgression({
      prescription: {
        repRangeMin: ex.repRangeMin,
        repRangeMax: ex.repRangeMax,
        targetRir: ex.targetRir,
        loadStepKg: ex.loadStepKg,
        plannedSets: ex.plannedSets,
      },
      history: (ex.lastTime?.exposures ?? []).map((e) => ({
        localDate: e.localDate,
        sets: e.sets.map((s) => ({
          weightKg: s.weightKg,
          reps: s.reps,
          rir: s.rir,
        })),
      })),
      todayLocalDate,
    });
  }
  return out;
}

export interface ExerciseHistorySummary {
  variantId: string;
  sessionCount: number;
  bestSet: BestSet | null;
  currentE1rm: number | null;
  trend: Trend;
}

/**
 * Mini-historial on-demand de una variante (para el drawer del ejercicio):
 * mejor set, e1RM~ actual y tendencia dentro de la ventana. Sin persistir.
 */
export async function getExerciseHistorySummary(
  profileId: string,
  variantId: string,
  sinceLocalDate?: string,
): Promise<ExerciseHistorySummary> {
  const sessions = await getVariantHistory(
    profileId,
    variantId,
    sinceLocalDate,
  );
  return {
    variantId,
    sessionCount: sessions.length,
    bestSet: bestSet(sessions),
    currentE1rm: currentE1rm(sessions),
    trend: trend(sessions),
  };
}
