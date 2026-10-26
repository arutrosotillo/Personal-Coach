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
import { DEFAULT_TIMEZONE, toLocalDate } from "@/core/dates";
import { loadSegmentOn, splitBySegment } from "@/core/training/equipment";
import { applyRecoveryVeto, type RecoveryVeto } from "@/core/training/veto";
import { listEquipmentChangePoints } from "@/server/repositories/equipment-change.repo";
import type { ExecutionSession } from "@/server/repositories/workout.repo";
import { getVariantHistory } from "@/server/repositories/workout.repo";

/**
 * Puente lectura → motor (Fase 2B). La sugerencia es EFÍMERA: se calcula al
 * vuelo desde el snapshot de la sesión + la última sesión válida de la variante,
 * y NO se persiste (ni AlgorithmDecision ni Recommendation; eso es F3).
 */

/**
 * Sugerencia de progresión por WorkoutExercise de la sesión en curso.
 *
 * `veto` llega del motor de fatiga (dolor articular o descarga recomendada) y
 * suspende las subidas de carga. Sin él, esta pantalla podía decir "sube a
 * 85 kg" mientras la tarjeta de recuperación decía "retira el ejercicio que te
 * duele" — COACH_PHILOSOPHY §2 da precedencia a la salud.
 */
export function buildSuggestions(
  session: ExecutionSession,
  veto: RecoveryVeto | null = null,
): Record<string, ProgressionSuggestion> {
  // El día de la SESIÓN EN CURSO es el "hoy" del motor: así la recencia mide
  // desde la fecha real de entrenamiento, no desde el reloj del servidor.
  const todayLocalDate = session.localDate;
  const out: Record<string, ProgressionSuggestion> = {};
  for (const ex of session.exercises) {
    const suggestion = suggestProgression({
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
      equipmentChange: ex.equipmentChange
        ? { sinceLocalDate: ex.equipmentChange.sinceLocalDate }
        : null,
    });
    out[ex.id] = applyRecoveryVeto(suggestion, veto);
  }
  return out;
}

export interface ExerciseHistorySummary {
  variantId: string;
  sessionCount: number;
  bestSet: BestSet | null;
  currentE1rm: number | null;
  trend: Trend;
  /**
   * Cambio de equipamiento vigente: todo lo de arriba es SOLO del tramo con
   * la máquina nueva, y lo de antes va aquí, aparte y sin tendencia que lo
   * cruce con lo nuevo. `null` si no hay cambio.
   */
  equipmentChange: {
    sinceLocalDate: string;
    previous: { sessionCount: number; bestSet: BestSet | null };
  } | null;
}

/**
 * Mini-historial on-demand de una variante (para el drawer del ejercicio):
 * mejor set, e1RM~ actual y tendencia dentro de la ventana. Sin persistir.
 *
 * Con un cambio de equipamiento, la tendencia y el e1RM actual se calculan
 * solo con la máquina nueva: una línea de 100 kg a 65 kg entre dos máquinas
 * diría "bajando" de algo que no ha bajado. El historial anterior se sigue
 * enseñando, en su propio bloque.
 */
export async function getExerciseHistorySummary(
  profileId: string,
  variantId: string,
  sinceLocalDate?: string,
  now: Date = new Date(),
): Promise<ExerciseHistorySummary> {
  const todayLocalDate = toLocalDate(now, DEFAULT_TIMEZONE);
  const [sessions, changes] = await Promise.all([
    getVariantHistory(profileId, variantId, sinceLocalDate),
    listEquipmentChangePoints(profileId, [variantId]),
  ]);
  const segment = loadSegmentOn(changes, variantId, todayLocalDate);
  const { comparable, previous } = splitBySegment(sessions, segment);
  return {
    variantId,
    sessionCount: comparable.length,
    bestSet: bestSet(comparable),
    currentE1rm: currentE1rm(comparable),
    trend: trend(comparable),
    equipmentChange: segment.since
      ? {
          sinceLocalDate: segment.since,
          previous: {
            sessionCount: previous.length,
            bestSet: bestSet(previous),
          },
        }
      : null,
  };
}
