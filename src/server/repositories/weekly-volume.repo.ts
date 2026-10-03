import { addDays } from "@/core/dates";
import type { GoalType, MuscleGroupCode } from "@/core/enums";
import {
  computeWeeklyTargets,
  experienceFromYears,
} from "@/core/program/generate-initial-program";
import {
  computeWeeklyVolume,
  type WeeklyVolumeResult,
} from "@/core/program/weekly-volume";
import { prisma } from "@/server/db";
import { loadCatalog } from "@/server/repositories/catalog.repo";

/**
 * Volumen semanal por músculo, en vivo.
 *
 * Dos lecturas distintas y deliberadamente separadas:
 *   · PLANIFICADO — lo que prescriben las plantillas vigentes de tu programa.
 *     Es lo que harías si cumplieras la semana entera.
 *   · REALIZADO   — las series de trabajo que de verdad registraste en los
 *     últimos 7 días.
 *
 * No se mezclan ni se promedian. Son preguntas diferentes ("¿está bien
 * repartido mi programa?" vs "¿qué he entrenado esta semana?") y juntarlas
 * daría un número que no responde a ninguna de las dos.
 */

/** Ventana de la lectura REALIZADA: una semana natural hacia atrás. */
export const ACTUAL_WINDOW_DAYS = 7;

export interface WeeklyVolumeOverview {
  planned: WeeklyVolumeResult;
  actual: WeeklyVolumeResult;
  /** Sesiones completadas dentro de la ventana (contexto de lo realizado). */
  actualSessions: number;
  windowDays: number;
  /** Días vivos del programa, para leer la frecuencia planificada. */
  daysPerWeek: number;
}

export async function getWeeklyVolume(
  profileId: string,
  todayLocalDate: string,
): Promise<WeeklyVolumeOverview | null> {
  const program = await prisma.trainingProgram.findFirst({
    where: { profileId, isActive: true, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      mesocycles: {
        orderBy: { ordinal: "asc" },
        take: 1,
        include: {
          templates: {
            where: { deletedAt: null },
            include: { exercises: true },
          },
        },
      },
    },
  });
  const mesocycle = program?.mesocycles[0];
  if (!program || !mesocycle) return null;

  const [profile, goal, priorityPref, catalog] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { id: profileId },
      select: { trainingYears: true },
    }),
    prisma.goal.findFirst({
      where: { profileId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: { type: true },
    }),
    prisma.userPreference.findUnique({
      where: { profileId_key: { profileId, key: "priority_muscles" } },
      select: { value: true },
    }),
    // Con el perfil: los ejercicios propios también cuentan volumen.
    loadCatalog(profileId),
  ]);

  const priorityMuscles = Array.isArray(priorityPref?.value)
    ? (priorityPref.value as MuscleGroupCode[])
    : [];

  // Objetivos recalculados con los datos de HOY, no con los del onboarding: si
  // cambiaste de días o de objetivo, el listón se mueve con ellos.
  const targets = computeWeeklyTargets(
    priorityMuscles,
    (goal?.type as GoalType | undefined) ?? "MAINTENANCE",
    experienceFromYears(profile?.trainingYears ?? 2),
    program.daysPerWeek,
  );

  // ── Planificado: las plantillas vivas ────────────────────────────────────
  const planned = computeWeeklyVolume({
    entries: mesocycle.templates.flatMap((t) =>
      t.exercises.map((e) => ({
        variantId: e.exerciseVariantId,
        dayKey: t.id,
        sets: e.baseSets,
      })),
    ),
    catalog,
    targets,
    priorityMuscles,
  });

  // ── Realizado: series WORKING completadas en la ventana ──────────────────
  const since = addDays(todayLocalDate, -(ACTUAL_WINDOW_DAYS - 1));
  const rows = await prisma.setLog.findMany({
    where: {
      setType: "WORKING",
      completed: true,
      reps: { gt: 0 },
      localDate: { gte: since, lte: todayLocalDate },
      workoutExercise: {
        session: {
          status: "COMPLETED",
          mesocycle: { program: { profileId } },
        },
      },
    },
    select: { exerciseVariantId: true, localDate: true },
  });

  // Una fila = una serie. Se agrupan por (variante, día) para que la
  // frecuencia cuente días distintos y no series.
  const counts = new Map<
    string,
    { variantId: string; dayKey: string; sets: number }
  >();
  for (const row of rows) {
    const key = `${row.exerciseVariantId}|${row.localDate}`;
    const current = counts.get(key);
    if (current) current.sets += 1;
    else
      counts.set(key, {
        variantId: row.exerciseVariantId,
        dayKey: row.localDate,
        sets: 1,
      });
  }

  const actual = computeWeeklyVolume({
    entries: [...counts.values()],
    catalog,
    targets,
    priorityMuscles,
  });

  const actualSessions = await prisma.workoutSession.count({
    where: {
      status: "COMPLETED",
      localDate: { gte: since, lte: todayLocalDate },
      mesocycle: { program: { profileId } },
    },
  });

  return {
    planned,
    actual,
    actualSessions,
    windowDays: ACTUAL_WINDOW_DAYS,
    daysPerWeek: program.daysPerWeek,
  };
}
