import type { BlockSessionInput } from "@/core/training/block-stats";
import { prisma } from "@/server/db";

/**
 * Lecturas de un bloque de entrenamiento, para sus estadísticas. El dueño se
 * comprueba en la propia consulta: pasar el id de un programa ajeno devuelve lo
 * mismo que uno que no existe.
 */

export interface BlockStructureExercise {
  ordinal: number;
  exerciseName: string;
  variantName: string;
  baseSets: number;
  repRangeMin: number;
  repRangeMax: number;
  targetRir: number;
  targetRirMin: number | null;
  restSeconds: number;
}

export interface BlockStructureDay {
  name: string;
  ordinal: number;
  exercises: BlockStructureExercise[];
}

export interface BlockProgram {
  id: string;
  name: string;
  daysPerWeek: number;
  isActive: boolean;
  description: string | null;
  mesocycleIds: string[];
  /** Plantillas tal y como quedaron: la estructura del programa. */
  days: BlockStructureDay[];
}

export async function getBlockProgram(
  profileId: string,
  programId: string,
): Promise<BlockProgram | null> {
  const program = await prisma.trainingProgram.findFirst({
    where: { id: programId, profileId, deletedAt: null },
    include: {
      mesocycles: {
        orderBy: { ordinal: "asc" },
        include: {
          templates: {
            where: { deletedAt: null },
            orderBy: { ordinal: "asc" },
            include: {
              exercises: {
                orderBy: { ordinal: "asc" },
                include: {
                  exerciseVariant: {
                    select: {
                      name: true,
                      exercise: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!program) return null;

  return {
    id: program.id,
    name: program.name,
    daysPerWeek: program.daysPerWeek,
    isActive: program.isActive,
    description: program.description,
    mesocycleIds: program.mesocycles.map((m) => m.id),
    days: program.mesocycles.flatMap((m) =>
      m.templates.map((t) => ({
        name: t.name,
        ordinal: t.ordinal,
        exercises: t.exercises.map((te) => ({
          ordinal: te.ordinal,
          exerciseName: te.exerciseVariant.exercise.name,
          variantName: te.exerciseVariant.name,
          baseSets: te.baseSets,
          repRangeMin: te.repRangeMin,
          repRangeMax: te.repRangeMax,
          targetRir: te.targetRir,
          targetRirMin: te.targetRirMin,
          restSeconds: te.restSeconds,
        })),
      })),
    ),
  };
}

/** Sesiones COMPLETADAS del bloque, solo con sus series de trabajo. */
export async function listBlockSessions(
  mesocycleIds: readonly string[],
): Promise<BlockSessionInput[]> {
  const sessions = await prisma.workoutSession.findMany({
    where: { mesocycleId: { in: [...mesocycleIds] }, status: "COMPLETED" },
    orderBy: { localDate: "asc" },
    include: {
      exercises: {
        orderBy: { ordinal: "asc" },
        include: {
          exerciseVariant: {
            select: {
              name: true,
              equipment: true,
              exercise: { select: { name: true, movementPattern: true } },
            },
          },
          setLogs: {
            where: { setType: "WORKING", completed: true, reps: { gt: 0 } },
            orderBy: { setNumber: "asc" },
          },
        },
      },
    },
  });

  return sessions.map((s) => ({
    id: s.id,
    localDate: s.localDate,
    deload: s.weekKind === "DELOAD",
    perceivedPerformance: s.perceivedPerformance,
    fatigue: s.fatigue,
    jointPain: s.jointPain,
    motivation: s.motivation,
    durationMin:
      s.startedAt && s.finishedAt
        ? Math.round((s.finishedAt.getTime() - s.startedAt.getTime()) / 60000)
        : null,
    exercises: s.exercises.map((we) => ({
      variantId: we.exerciseVariantId,
      exerciseName: we.exerciseVariant.exercise.name,
      variantName: we.exerciseVariant.name,
      equipment: we.exerciseVariant.equipment,
      movementPattern: we.exerciseVariant.exercise.movementPattern,
      ordinal: we.ordinal,
      plannedSets: we.plannedSets,
      targetRir: we.targetRir,
      sets: we.setLogs.map((l) => ({
        weightKg: l.weightKg,
        reps: l.reps,
        rir: l.rir,
        estimated1Rm: l.estimated1Rm,
      })),
    })),
  }));
}
