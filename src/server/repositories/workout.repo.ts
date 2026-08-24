import { PROGRESSION } from "@/core/config/training-config";
import { prisma } from "@/server/db";

export interface VariantExposureRow {
  setNumber: number;
  weightKg: number;
  reps: number;
  rir: number | null;
}

export interface VariantExposure {
  localDate: string;
  sets: VariantExposureRow[];
}

/**
 * Contexto histórico de una variante para la pantalla de ejecución y el motor
 * de progresión: la última exposición (contexto "última vez") y las últimas
 * `PROGRESSION.HISTORY_WINDOW` exposiciones, de la MÁS ANTIGUA a la MÁS
 * RECIENTE (el motor necesita memoria mínima, no solo la última sesión).
 */
export interface LastComparable {
  localDate: string;
  sets: VariantExposureRow[];
  /** Nº de sesiones válidas de la variante en el historial (para la confianza). */
  comparableSessions: number;
  exposures: VariantExposure[];
}

/**
 * Para cada variante, los sets de TRABAJO (WORKING, completados) de sus últimas
 * sesiones COMPLETED anteriores a `excludeSessionId`. Una sola query + agrupación
 * en memoria (evita el N+1 de pedir el historial por ejercicio). Ignora WARMUP
 * y sesiones no completadas: es el contexto "última vez" y la base del motor de
 * progresión, que nunca deben contar calentamientos.
 */
async function recentWorkingSetsForVariants(
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

  // Agrupa por variante → sesión, conservando el orden de la query (más
  // reciente primero). Una variante repetida en la misma sesión cuenta como
  // UNA exposición, no dos.
  const byVariant = new Map<string, Map<string, VariantExposure>>();
  for (const r of rows) {
    const sessionId = r.workoutExercise.sessionId;
    let sessions = byVariant.get(r.exerciseVariantId);
    if (!sessions) {
      sessions = new Map<string, VariantExposure>();
      byVariant.set(r.exerciseVariantId, sessions);
    }
    let exposure = sessions.get(sessionId);
    if (!exposure) {
      exposure = { localDate: r.localDate, sets: [] };
      sessions.set(sessionId, exposure);
    }
    exposure.sets.push({
      setNumber: r.setNumber,
      weightKg: r.weightKg,
      reps: r.reps,
      rir: r.rir,
    });
  }

  for (const [variantId, sessions] of byVariant) {
    const ordered = [...sessions.values()];
    for (const exposure of ordered) {
      exposure.sets.sort((a, b) => a.setNumber - b.setNumber);
    }
    const last = ordered[0];
    if (!last) continue;
    // De la más antigua a la más reciente, acotado a la ventana del motor.
    const exposures = ordered.slice(0, PROGRESSION.HISTORY_WINDOW).reverse();
    result.set(variantId, {
      localDate: last.localDate,
      sets: last.sets,
      comparableSessions: ordered.length,
      exposures,
    });
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

  const lastByVariant = await recentWorkingSetsForVariants(
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
