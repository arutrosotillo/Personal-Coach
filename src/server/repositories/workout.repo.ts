import { prisma } from "@/server/db";

/** Sets de la última sesión COMPLETADA de una variante, antes de una sesión dada. */
async function lastComparableSets(
  exerciseVariantId: string,
  excludeSessionId: string,
) {
  const last = await prisma.setLog.findMany({
    where: {
      exerciseVariantId,
      workoutExercise: {
        sessionId: { not: excludeSessionId },
        session: { status: "COMPLETED" },
      },
    },
    orderBy: [{ completedAt: "desc" }],
    take: 1,
    select: { workoutExerciseId: true, localDate: true },
  });
  if (last.length === 0) return null;
  const sets = await prisma.setLog.findMany({
    where: { workoutExerciseId: last[0].workoutExerciseId },
    orderBy: { setNumber: "asc" },
    select: { setNumber: true, weightKg: true, reps: true, rir: true },
  });
  return { localDate: last[0].localDate, sets };
}

export interface ExecutionExercise {
  id: string;
  ordinal: number;
  exerciseName: string;
  variantId: string;
  variantName: string;
  equipment: string;
  plannedSets: number;
  repRangeMin: number;
  repRangeMax: number;
  targetRir: number;
  restSeconds: number;
  loadStepKg: number;
  setLogs: Array<{
    setNumber: number;
    weightKg: number;
    reps: number;
    rir: number | null;
  }>;
  lastTime: {
    localDate: string;
    sets: Array<{
      setNumber: number;
      weightKg: number;
      reps: number;
      rir: number | null;
    }>;
  } | null;
}

export interface ExecutionSession {
  id: string;
  templateName: string;
  weekNumber: number;
  localDate: string;
  status: string;
  exercises: ExecutionExercise[];
}

/** Datos completos para la pantalla de ejecución, incluida la "última vez". */
export async function getExecutionSession(
  profileId: string,
  sessionId: string,
): Promise<ExecutionSession | null> {
  const session = await prisma.workoutSession.findFirst({
    where: { id: sessionId, mesocycle: { program: { profileId } } },
    include: {
      template: true,
      exercises: {
        orderBy: { ordinal: "asc" },
        include: {
          exerciseVariant: { include: { exercise: true } },
          setLogs: { orderBy: { setNumber: "asc" } },
        },
      },
    },
  });
  if (!session) return null;

  const exercises: ExecutionExercise[] = [];
  for (const we of session.exercises) {
    exercises.push({
      id: we.id,
      ordinal: we.ordinal,
      exerciseName: we.exerciseVariant.exercise.name,
      variantId: we.exerciseVariantId,
      variantName: we.exerciseVariant.name,
      equipment: we.exerciseVariant.equipment,
      plannedSets: we.plannedSets,
      repRangeMin: we.repRangeMin,
      repRangeMax: we.repRangeMax,
      targetRir: we.targetRir,
      restSeconds: we.restSeconds,
      loadStepKg: we.exerciseVariant.loadStepKg,
      setLogs: we.setLogs.map((s) => ({
        setNumber: s.setNumber,
        weightKg: s.weightKg,
        reps: s.reps,
        rir: s.rir,
      })),
      lastTime: await lastComparableSets(we.exerciseVariantId, session.id),
    });
  }

  return {
    id: session.id,
    templateName: session.template?.name ?? "Sesión",
    weekNumber: session.weekNumber,
    localDate: session.localDate,
    status: session.status,
    exercises,
  };
}

/** Plantillas de la semana actual + qué se ha completado (pantalla "hoy"). */
export async function getTodayOverview(profileId: string) {
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
            orderBy: { ordinal: "asc" },
            include: { _count: { select: { exercises: true } } },
          },
        },
      },
    },
  });
  const mesocycle = program?.mesocycles[0];
  if (!program || !mesocycle) return null;

  const weekNumber = Math.max(mesocycle.currentWeek, 1);
  const completedThisWeek = await prisma.workoutSession.findMany({
    where: { mesocycleId: mesocycle.id, weekNumber, status: "COMPLETED" },
    select: { templateId: true },
  });
  const doneTemplateIds = new Set(completedThisWeek.map((s) => s.templateId));

  const active = await getActiveSessionSummary(profileId);

  const templates = mesocycle.templates.map((t) => ({
    id: t.id,
    name: t.name,
    ordinal: t.ordinal,
    exerciseCount: t._count.exercises,
    done: doneTemplateIds.has(t.id),
  }));

  return {
    programName: program.name,
    weekNumber,
    weeksPlanned: mesocycle.weeksPlanned,
    templates,
    active,
  };
}

async function getActiveSessionSummary(profileId: string) {
  const s = await prisma.workoutSession.findFirst({
    where: { status: "IN_PROGRESS", mesocycle: { program: { profileId } } },
    orderBy: { startedAt: "desc" },
    include: {
      template: true,
      exercises: { include: { _count: { select: { setLogs: true } } } },
    },
  });
  if (!s) return null;
  const totalSets = s.exercises.reduce((a, e) => a + e.plannedSets, 0);
  const doneSets = s.exercises.reduce((a, e) => a + e._count.setLogs, 0);
  return {
    id: s.id,
    templateName: s.template?.name ?? "Sesión",
    doneSets,
    totalSets,
  };
}

/** Historial de sesiones completadas (excluye descartadas/ABORTED). */
export async function listCompletedSessions(profileId: string) {
  const sessions = await prisma.workoutSession.findMany({
    where: { status: "COMPLETED", mesocycle: { program: { profileId } } },
    orderBy: { finishedAt: "desc" },
    include: {
      template: true,
      exercises: { include: { _count: { select: { setLogs: true } } } },
    },
  });
  return sessions.map((s) => ({
    id: s.id,
    templateName: s.template?.name ?? "Sesión",
    localDate: s.localDate,
    weekNumber: s.weekNumber,
    durationMin:
      s.startedAt && s.finishedAt
        ? Math.round((s.finishedAt.getTime() - s.startedAt.getTime()) / 60000)
        : null,
    totalSets: s.exercises.reduce((a, e) => a + e._count.setLogs, 0),
  }));
}
