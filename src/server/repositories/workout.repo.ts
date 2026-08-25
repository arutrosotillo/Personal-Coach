import { PROGRESSION } from "@/core/config/training-config";
import {
  DEFAULT_TIMEZONE,
  isoWeekOf,
  toLocalDate,
  weekIndexSince,
} from "@/core/dates";
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
 * Contexto histórico de una variante: la última exposición (contexto "última
 * vez", que va al cliente) y las últimas `PROGRESSION.HISTORY_WINDOW`
 * exposiciones de la MÁS ANTIGUA a la MÁS RECIENTE (memoria mínima del motor,
 * solo servidor).
 *
 * Una sesión aporta como mucho UNA exposición. Si la misma variante aparece
 * dos veces el mismo día (p. ej. serie principal + back-off), se toma la de
 * menor `ordinal`: es lo comparable entre sesiones, y mezclar ambas daría un
 * peso de referencia sin sentido.
 */
export interface LastComparable {
  localDate: string;
  sets: VariantExposureRow[];
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
      workoutExercise: {
        select: { sessionId: true, id: true, ordinal: true },
      },
    },
  });

  // Agrupa por variante → sesión → workoutExercise, conservando el orden de la
  // query (sesión más reciente primero).
  interface Slot extends VariantExposure {
    ordinal: number;
  }
  const byVariant = new Map<string, Map<string, Map<string, Slot>>>();
  for (const r of rows) {
    const { sessionId, id: weId, ordinal } = r.workoutExercise;
    let sessions = byVariant.get(r.exerciseVariantId);
    if (!sessions) {
      sessions = new Map();
      byVariant.set(r.exerciseVariantId, sessions);
    }
    let slots = sessions.get(sessionId);
    if (!slots) {
      slots = new Map<string, Slot>();
      sessions.set(sessionId, slots);
    }
    let slot = slots.get(weId);
    if (!slot) {
      slot = { localDate: r.localDate, ordinal, sets: [] };
      slots.set(weId, slot);
    }
    slot.sets.push({
      setNumber: r.setNumber,
      weightKg: r.weightKg,
      reps: r.reps,
      rir: r.rir,
    });
  }

  for (const [variantId, sessions] of byVariant) {
    // Una exposición por sesión: la del `ordinal` más bajo (trabajo principal).
    const ordered: VariantExposure[] = [];
    for (const slots of sessions.values()) {
      const chosen = [...slots.values()].sort(
        (a, b) => a.ordinal - b.ordinal,
      )[0];
      if (!chosen) continue;
      chosen.sets.sort((a, b) => a.setNumber - b.setNumber);
      ordered.push({ localDate: chosen.localDate, sets: chosen.sets });
    }
    const last = ordered[0];
    if (!last) continue;
    // De la más antigua a la más reciente, acotado a la ventana del motor.
    const exposures = ordered.slice(0, PROGRESSION.HISTORY_WINDOW).reverse();
    result.set(variantId, {
      localDate: last.localDate,
      sets: last.sets,
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

/** Vista de la sesión SIN los datos que solo necesita el servidor. */
export type ClientExecutionExercise = Omit<ExecutionExercise, "lastTime"> & {
  lastTime: Omit<LastComparable, "exposures"> | null;
};
export type ClientExecutionSession = Omit<ExecutionSession, "exercises"> & {
  exercises: ClientExecutionExercise[];
};

/**
 * Quita del payload lo que el cliente no usa: las exposiciones históricas solo
 * alimentan al motor de progresión, que corre en el servidor.
 */
export function toClientSession(
  session: ExecutionSession,
): ClientExecutionSession {
  return {
    ...session,
    exercises: session.exercises.map((exercise) => ({
      ...exercise,
      lastTime: exercise.lastTime
        ? {
            localDate: exercise.lastTime.localDate,
            sets: exercise.lastTime.sets,
          }
        : null,
    })),
  };
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
export async function getTodayOverview(
  profileId: string,
  now: Date = new Date(),
) {
  const todayLocalDate = toLocalDate(now, DEFAULT_TIMEZONE);
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

  // La semana se deriva de las FECHAS. `Mesocycle.currentWeek` no lo incrementa
  // nadie, así que valía 1 para siempre: la app decía "Semana 1 de 6" el día 60
  // y, peor, contaba como "hechas esta semana" TODAS las sesiones de la
  // historia (todas se guardaban con `weekNumber: 1`). A partir del octavo día
  // eso dejaba "¡Semana completada!" fijo en pantalla y "Hoy toca" no volvía a
  // proponer nada nunca más.
  const first = await prisma.workoutSession.findFirst({
    where: { mesocycleId: mesocycle.id, status: "COMPLETED" },
    orderBy: { localDate: "asc" },
    select: { localDate: true },
  });
  const weekNumber = weekIndexSince(
    first?.localDate ?? todayLocalDate,
    todayLocalDate,
  );
  const completedThisWeek = await prisma.workoutSession.findMany({
    where: {
      mesocycleId: mesocycle.id,
      status: "COMPLETED",
      localDate: { gte: isoWeekOf(todayLocalDate).weekStartDate },
    },
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
    /** Sesión de descarga: menos series a propósito, no un día flojo. */
    deload: s.weekKind === "DELOAD",
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
