import {
  BLOCK_STATS,
  FATIGUE_ENGINE_VERSION,
} from "@/core/config/training-config";
import { addDays } from "@/core/dates";
import { analyzeTraining } from "@/core/training/analysis";
import {
  computeBlockStats,
  type BlockStats,
} from "@/core/training/block-stats";
import type { DeloadDecision } from "@/core/training/fatigue";
import {
  getBlockProgram,
  listBlockSessions,
  type BlockProgram,
} from "@/server/repositories/block-stats.repo";
import { loadCatalog } from "@/server/repositories/catalog.repo";
import { listEquipmentChangePoints } from "@/server/repositories/equipment-change.repo";
import { getTrainingContext } from "@/server/repositories/training-context.repo";
import { DEFAULT_WINDOW_DAYS } from "@/server/services/fatigue.service";

/**
 * Estadísticas de un bloque: lo registrado (`computeBlockStats`) más la tendencia
 * de fatiga, RECONSTRUIDA con el motor de hoy.
 *
 * La evaluación de fatiga es efímera y no se guardó nunca, así que lo que vio el
 * motor en su día no se puede leer: se puede volver a calcular con los mismos
 * hechos. No es lo mismo, y la pantalla lo dice.
 */

export interface FatigueTimelinePoint {
  week: number;
  /** Último día de esa semana dentro del bloque: la fecha que "vio" el motor. */
  localDate: string;
  score: number;
  objectiveScore: number;
  decision: DeloadDecision;
  jointPainLevel: "NONE" | "WATCH" | "ACTION";
  exercisesTracked: number;
}

export interface BlockFatigueTimeline {
  engineVersion: string;
  points: FatigueTimelinePoint[];
}

export interface BlockStatsView {
  program: BlockProgram;
  /** `null` si el bloque no se llegó a entrenar. */
  stats: BlockStats | null;
  fatigue: BlockFatigueTimeline | null;
}

async function fatigueAt(
  profileId: string,
  week: number,
  localDate: string,
): Promise<FatigueTimelinePoint> {
  const context = await getTrainingContext(
    profileId,
    addDays(localDate, -DEFAULT_WINDOW_DAYS),
    localDate,
  );
  const { fatigue } = analyzeTraining(context);
  return {
    week,
    localDate,
    score: fatigue.score,
    objectiveScore: fatigue.objectiveScore,
    decision: fatigue.decision,
    jointPainLevel: fatigue.jointPain.level,
    exercisesTracked: fatigue.numbers.exercisesTracked,
  };
}

async function buildFatigueTimeline(
  profileId: string,
  stats: BlockStats,
): Promise<BlockFatigueTimeline | null> {
  // Una tendencia de fatiga es información complementaria: si no se puede
  // reconstruir, el resto de las estadísticas se enseña igual.
  try {
    const weeks = stats.adherence.weeks.slice(
      -BLOCK_STATS.MAX_FATIGUE_TIMELINE_WEEKS,
    );
    const points = await Promise.all(
      weeks.map(({ week, weekStartDate }) => {
        const weekEnd = addDays(weekStartDate, 6);
        return fatigueAt(
          profileId,
          week,
          weekEnd < stats.endLocalDate ? weekEnd : stats.endLocalDate,
        );
      }),
    );
    return { engineVersion: FATIGUE_ENGINE_VERSION, points };
  } catch {
    return null;
  }
}

/** `null` si el programa no existe o no es de este perfil. */
export async function getBlockStatsView(
  profileId: string,
  programId: string,
): Promise<BlockStatsView | null> {
  const program = await getBlockProgram(profileId, programId);
  if (!program) return null;

  const [sessions, catalog, equipmentChanges] = await Promise.all([
    listBlockSessions(program.mesocycleIds),
    loadCatalog(profileId),
    listEquipmentChangePoints(profileId),
  ]);
  const stats = computeBlockStats({
    daysPerWeek: program.daysPerWeek,
    sessions,
    catalog,
    equipmentChanges,
  });
  return {
    program,
    stats,
    fatigue: stats ? await buildFatigueTimeline(profileId, stats) : null,
  };
}
