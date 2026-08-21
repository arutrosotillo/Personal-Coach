import { prisma } from "@/server/db";

export interface LastComparable {
  localDate: string;
  sets: Array<{
    setNumber: number;
    weightKg: number;
    reps: number;
    rir: number | null;
  }>;
  /** Nº de sesiones válidas de la variante en el historial (para la confianza). */
  comparableSessions: number;
}

/**
 * Para cada variante, los sets de TRABAJO (WORKING, completados) de su última
 * sesión COMPLETED anterior a `excludeSessionId`. Una sola query + agrupación en
 * memoria (evita el N+1 de pedir la última sesión por ejercicio). Ignora WARMUP
 * y sesiones no completadas: es el contexto "última vez" y la base del motor de
 * progresión, que nunca deben contar calentamientos.
 */
async function lastWorkingSetsForVariants(
  profileId: string,
  variantIds: string[],
  excludeSessionId: string,
): Promise<Map<string, LastComparable>> {
  const result = new Map<string, LastComparable>();
  if (variantIds.length === 0) return result;

  // Todos los sets WORKING de sesiones COMPLETED del perfil (salvo la actual)
  // para estas variantes, del día más reciente al más antiguo. Se ordena por
  // `localDate` (día del usuario; el feature entero se ancla a él, no a la marca
  // de auditoría `completedAt`), con desempates estables.
  const rows = await prisma.setLog.findMany({
    where: {
      exerciseVariantId: { in: variantIds },
      setType: "WORKING",
      completed: true,
      reps: { gt: 0 },
      workoutExercise: {
        sessionId: { not: excludeSessionId },
        session: {
          status: "COMPLETED",
          mesocycle: { program: { profileId } },
        },
      },
    },
    orderBy: [
      { localDate: "desc" },
      { completedAt: "desc" },
      { setNumber: "asc" },
    ],
    select: {
      exerciseVariantId: true,
      localDate: true,
      setNumber: true,
      weightKg: true,
      reps: true,
      rir: true,
      workoutExercise: { select: { sessionId: true } },
    },
  });

  // Por variante: la sesión (sessionId) más reciente = "última vez", y el nº de
  // sesiones distintas = sesiones comparables (por sessionId, NO por
  // workoutExercise: una variante repetida en la misma sesión cuenta una vez).
  const chosenSessionId = new Map<string, string>();
  const sessionsByVariant = new Map<string, Set<string>>();
  for (const r of rows) {
    const sessionId = r.workoutExercise.sessionId;
    if (!chosenSessionId.has(r.exerciseVariantId)) {
      chosenSessionId.set(r.exerciseVariantId, sessionId);
    }
    const set = sessionsByVariant.get(r.exerciseVariantId) ?? new Set<string>();
    set.add(sessionId);
    sessionsByVariant.set(r.exerciseVariantId, set);
  }
  for (const r of rows) {
    if (
      r.workoutExercise.sessionId !== chosenSessionId.get(r.exerciseVariantId)
    )
      continue;
    const entry = result.get(r.exerciseVariantId) ?? {
      localDate: r.localDate,
      sets: [],
      comparableSessions: sessionsByVariant.get(r.exerciseVariantId)?.size ?? 1,
    };
    entry.sets.push({
      setNumber: r.setNumber,
      weightKg: r.weightKg,
      reps: r.reps,
      rir: r.rir,
    });
    result.set(r.exerciseVariantId, entry);
  }
  // Orden estable por número de serie dentro de cada variante.
  for (const entry of result.values()) {
    entry.sets.sort((a, b) => a.setNumber - b.setNumber);
  }
  return result;
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
  lastTime: LastComparable | null;
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

  const lastByVariant = await lastWorkingSetsForVariants(
    profileId,
    session.exercises.map((we) => we.exerciseVariantId),
    session.id,
  );

  const exercises: ExecutionExercise[] = session.exercises.map((we) => ({
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
    lastTime: lastByVariant.get(we.exerciseVariantId) ?? null,
  }));

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

export interface VariantHistorySession {
  localDate: string;
  sets: Array<{
    weightKg: number;
    reps: number;
    rir: number | null;
    estimated1Rm: number | null;
  }>;
}

/**
 * Historial de TRABAJO de una variante (sesiones COMPLETED del perfil), de la
 * más antigua a la más reciente y opcionalmente desde `sinceLocalDate`. Base
 * on-demand del mini-historial: mejor set, e1RM~ y tendencia se calculan en
 * `src/core/training/history.ts` a partir de esto. Sin persistir agregados.
 */
export async function getVariantHistory(
  profileId: string,
  variantId: string,
  sinceLocalDate?: string,
): Promise<VariantHistorySession[]> {
  const rows = await prisma.setLog.findMany({
    where: {
      exerciseVariantId: variantId,
      setType: "WORKING",
      completed: true,
      reps: { gt: 0 },
      ...(sinceLocalDate ? { localDate: { gte: sinceLocalDate } } : {}),
      workoutExercise: {
        session: {
          status: "COMPLETED",
          mesocycle: { program: { profileId } },
        },
      },
    },
    orderBy: [
      { localDate: "asc" },
      { completedAt: "asc" },
      { setNumber: "asc" },
    ],
    select: {
      localDate: true,
      weightKg: true,
      reps: true,
      rir: true,
      estimated1Rm: true,
      workoutExercise: { select: { sessionId: true } },
    },
  });

  // Agrupa por SESIÓN (sessionId): una variante repetida en la misma sesión es
  // una sola entrada de historial, no dos.
  const bySession = new Map<string, VariantHistorySession>();
  const order: string[] = [];
  for (const r of rows) {
    const sessionId = r.workoutExercise.sessionId;
    let entry = bySession.get(sessionId);
    if (!entry) {
      entry = { localDate: r.localDate, sets: [] };
      bySession.set(sessionId, entry);
      order.push(sessionId);
    }
    entry.sets.push({
      weightKg: r.weightKg,
      reps: r.reps,
      rir: r.rir,
      estimated1Rm: r.estimated1Rm,
    });
  }
  return order.map((id) => bySession.get(id)!);
}
