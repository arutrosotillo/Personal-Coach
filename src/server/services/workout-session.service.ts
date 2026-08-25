import { FATIGUE } from "@/core/config/training-config";
import {
  DEFAULT_TIMEZONE,
  isoWeekOf,
  toLocalDate,
  weekIndexSince,
} from "@/core/dates";
import type { LogSetData, SessionFeedbackData } from "@/core/schemas/workout";
import { estimateOneRepMax } from "@/core/training/e1rm";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { wasDeloadRecommended } from "@/server/services/fatigue.service";

/**
 * Servicio de sesiones de entrenamiento (Fase 2A). Sin progresión ni
 * recomendaciones: solo crear/reanudar sesiones, registrar series de forma
 * idempotente, sustituir ejercicios manualmente, finalizar y descartar.
 *
 * Al cerrar una sesión se decide además si fue una DESCARGA ejecutada
 * (`weekKind`), que es lo único que el motor de fatiga necesita para no
 * penalizarte por obedecer su propia recomendación.
 */

/** La sesión ya no estaba en curso: otra pestaña la cerró, o nunca existió. */
export class SessionNotInProgressError extends Error {
  constructor() {
    super("Esa sesión ya no está en curso.");
    this.name = "SessionNotInProgressError";
  }
}

/** Devuelve la sesión activa (IN_PROGRESS) del perfil, si existe. */
export async function getActiveSession(profileId: string) {
  return prisma.workoutSession.findFirst({
    where: {
      status: "IN_PROGRESS",
      mesocycle: { program: { profileId } },
    },
    orderBy: { startedAt: "desc" },
  });
}

/**
 * Empieza (o reanuda) una sesión a partir de una plantilla. Idempotente:
 * si ya hay una sesión activa, la reanuda en vez de crear otra. Si esa sesión
 * activa es de OTRA plantilla, también se devuelve (una activa a la vez).
 * Snapshot: cada TemplateExercise se copia a WorkoutExercise (la edición
 * futura de la plantilla no reescribe el historial).
 */
export async function startOrResumeSession(
  profileId: string,
  templateId: string,
  now: Date = new Date(),
): Promise<{ sessionId: string; resumed: boolean }> {
  const localDate = toLocalDate(now, DEFAULT_TIMEZONE);

  return prisma.$transaction(async (tx) => {
    const active = await tx.workoutSession.findFirst({
      where: { status: "IN_PROGRESS", mesocycle: { program: { profileId } } },
      orderBy: { startedAt: "desc" },
    });
    if (active) return { sessionId: active.id, resumed: true };

    const template = await tx.workoutTemplate.findFirstOrThrow({
      where: {
        id: templateId,
        deletedAt: null,
        mesocycle: {
          program: { profileId, isActive: true, deletedAt: null },
        },
      },
      include: {
        mesocycle: true,
        exercises: {
          orderBy: { ordinal: "asc" },
          include: { exerciseVariant: true },
        },
      },
    });

    // Igual que en `getTodayOverview`: la semana sale de las fechas, no de
    // `currentWeek` (que nadie incrementa y dejaba todas las sesiones en 1).
    const firstSession = await tx.workoutSession.findFirst({
      where: { mesocycleId: template.mesocycleId, status: "COMPLETED" },
      orderBy: { localDate: "asc" },
      select: { localDate: true },
    });
    // Red de seguridad por si una plantilla llegase vacía por otra vía: una
    // sesión de cero ejercicios se puede "completar" sin registrar nada y
    // ensucia el historial y el conteo de semanas.
    if (template.exercises.length === 0) {
      throw new Error(
        "Ese día no tiene ejercicios. Añade alguno antes de entrenarlo.",
      );
    }

    const weekNumber = weekIndexSince(
      firstSession?.localDate ?? localDate,
      localDate,
    );

    const session = await tx.workoutSession.create({
      data: {
        mesocycleId: template.mesocycleId,
        templateId: template.id,
        weekNumber,
        weekKind: "ACCUMULATION",
        status: "IN_PROGRESS",
        localDate,
        startedAt: now,
        exercises: {
          create: template.exercises.map((te) => ({
            exerciseVariantId: te.exerciseVariantId,
            ordinal: te.ordinal,
            plannedSets: te.baseSets,
            repRangeMin: te.repRangeMin,
            repRangeMax: te.repRangeMax,
            targetRir: te.targetRir,
            restSeconds: te.restSeconds,
          })),
        },
      },
    });

    return { sessionId: session.id, resumed: false };
  });
}

/**
 * Registra (upsert) una serie. Idempotente por (workoutExerciseId, setNumber):
 * un doble toque actualiza la misma fila, nunca crea dos "series 2".
 */
export async function logSet(profileId: string, data: LogSetData) {
  const we = await prisma.workoutExercise.findFirstOrThrow({
    where: {
      id: data.workoutExerciseId,
      session: { status: "IN_PROGRESS", mesocycle: { program: { profileId } } },
    },
    include: { session: true },
  });

  const estimated1Rm = estimateOneRepMax(
    data.weightKg,
    data.reps,
    data.rir ?? null,
  );

  await prisma.setLog.upsert({
    where: {
      workoutExerciseId_setNumber: {
        workoutExerciseId: data.workoutExerciseId,
        setNumber: data.setNumber,
      },
    },
    create: {
      workoutExerciseId: data.workoutExerciseId,
      exerciseVariantId: we.exerciseVariantId,
      localDate: we.session.localDate,
      setNumber: data.setNumber,
      setType: data.setType,
      weightKg: data.weightKg,
      reps: data.reps,
      rir: data.rir ?? null,
      technique: data.technique ?? null,
      notes: data.notes ?? null,
      estimated1Rm,
      completed: true,
    },
    update: {
      setType: data.setType,
      weightKg: data.weightKg,
      reps: data.reps,
      rir: data.rir ?? null,
      technique: data.technique ?? null,
      notes: data.notes ?? null,
      estimated1Rm,
      completed: true,
    },
  });
}

/** Borra una serie registrada (corrección del usuario). */
/**
 * Borra una serie registrada. Si la sesión ya no está en curso NO se borra
 * nada, así que se avisa en vez de devolver "ok": el usuario creería haber
 * corregido un dato que sigue ahí.
 *
 * Borrar una serie que ya no existe (doble toque) NO es un error: el resultado
 * que el usuario quería ya se cumple.
 */
export async function deleteSet(
  profileId: string,
  workoutExerciseId: string,
  setNumber: number,
) {
  const enCurso = await prisma.workoutExercise.count({
    where: {
      id: workoutExerciseId,
      session: {
        status: "IN_PROGRESS",
        mesocycle: { program: { profileId } },
      },
    },
  });
  if (enCurso === 0) throw new SessionNotInProgressError();

  await prisma.setLog.deleteMany({
    where: {
      workoutExerciseId,
      setNumber,
      workoutExercise: {
        session: {
          status: "IN_PROGRESS",
          mesocycle: { program: { profileId } },
        },
      },
    },
  });
}

/** Ajusta el nº de series previstas de un ejercicio (añadir/quitar serie). */
export async function setPlannedSets(
  profileId: string,
  workoutExerciseId: string,
  plannedSets: number,
) {
  const bounded = Math.max(1, Math.min(plannedSets, 20));
  await prisma.$transaction(async (tx) => {
    const exercise = await tx.workoutExercise.findFirstOrThrow({
      where: {
        id: workoutExerciseId,
        session: {
          status: "IN_PROGRESS",
          mesocycle: { program: { profileId } },
        },
      },
      select: { id: true },
    });
    await tx.workoutExercise.update({
      where: { id: exercise.id },
      data: { plannedSets: bounded },
    });
    // Si se reduce, se limpian las series por encima del nuevo tope.
    await tx.setLog.deleteMany({
      where: { workoutExerciseId: exercise.id, setNumber: { gt: bounded } },
    });
  });
}

/**
 * Sustituye manualmente el ejercicio (variante) de un WorkoutExercise. Toma
 * el rango de reps y descanso de la nueva variante y borra las series ya
 * registradas (pertenecían a la variante anterior).
 */
export async function substituteExercise(
  profileId: string,
  workoutExerciseId: string,
  newVariantId: string,
) {
  await prisma.$transaction(async (tx) => {
    const we = await tx.workoutExercise.findFirstOrThrow({
      where: {
        id: workoutExerciseId,
        session: {
          status: "IN_PROGRESS",
          mesocycle: { program: { profileId } },
        },
      },
    });
    if (we.exerciseVariantId === newVariantId) return;
    const variant = await tx.exerciseVariant.findFirstOrThrow({
      where: { id: newVariantId, deletedAt: null },
    });
    await tx.setLog.deleteMany({ where: { workoutExerciseId: we.id } });
    await tx.workoutExercise.update({
      where: { id: we.id },
      data: {
        exerciseVariantId: variant.id,
        repRangeMin: variant.repRangeMin,
        repRangeMax: variant.repRangeMax,
        restSeconds: variant.defaultRestSeconds,
      },
    });
  });
}

/** Finaliza la sesión y guarda el feedback (no modifica el programa en F2A). */
/**
 * ¿Esta sesión es una DESCARGA ejecutada?
 *
 * Hacen falta las DOS cosas, y por eso no basta con mirar los datos:
 *
 *   1. que el motor estuviera recomendando una descarga cuando entraste al
 *      gimnasio (se consulta ANTES de marcar la sesión como completada, así
 *      que esta sesión no se cuenta a sí misma); y
 *   2. que de verdad hayas recortado — series registradas por debajo del
 *      `COMPLETION_LOW` de lo que ese día prescribe la PLANTILLA.
 *
 * Se compara contra la plantilla y no contra `plannedSets` de la sesión porque
 * "− Quitar serie" baja las previstas: quien recorta así saldría al 100 % de
 * cumplimiento y nunca se detectaría el recorte.
 *
 * Exigir las dos condiciones es lo que impide que una sesión suelta y floja se
 * disfrace de descarga: sin recomendación previa, un día corto es un día corto.
 *
 * [HEURÍSTICA]: el umbral de "recortada" reutiliza `COMPLETION_LOW` (70 %), que
 * es el mismo que define una sesión acortada en el motor de fatiga. La
 * prescripción es la mitad de las series, así que hay margen de sobra.
 */
async function isExecutedDeload(
  tx: Prisma.TransactionClient,
  session: {
    id: string;
    templateId: string | null;
    localDate: string;
    mesocycleId: string;
  },
  profileId: string,
): Promise<boolean> {
  const logged = await tx.setLog.count({
    where: {
      setType: "WORKING",
      completed: true,
      workoutExercise: { sessionId: session.id },
    },
  });
  if (logged === 0) return false;

  const plantilla = session.templateId
    ? await tx.templateExercise.aggregate({
        where: { templateId: session.templateId },
        _sum: { baseSets: true },
      })
    : null;
  const prescritas = plantilla?._sum.baseSets ?? 0;
  if (prescritas === 0) return false;
  if (logged / prescritas >= FATIGUE.COMPLETION_LOW) return false;

  // Una descarga son varias sesiones. Si ya hay una marcada esta semana ISO, el
  // resto de la semana también cuenta: si no, solo se marcaría la primera
  // (al recortar, el veredicto de fatiga baja y deja de recomendar descarga).
  const desdeElLunes = isoWeekOf(session.localDate).weekStartDate;
  const yaEnDescarga = await tx.workoutSession.count({
    where: {
      status: "COMPLETED",
      weekKind: "DELOAD",
      localDate: { gte: desdeElLunes, lte: session.localDate },
      mesocycle: { program: { profileId } },
    },
  });
  if (yaEnDescarga > 0) return true;

  return wasDeloadRecommended(profileId, session.localDate);
}

/**
 * Cierra la sesión. Lanza si ya no estaba en curso: la UI dice "guardado", así
 * que tiene que haberse guardado. Antes usaba `updateMany` sin mirar el
 * resultado, y una pestaña vieja (o un reintento tras un timeout) devolvía
 * "ok" habiendo perdido el feedback en silencio — y el feedback es la ÚNICA
 * entrada del motor de fatiga.
 */
export async function finishSession(
  profileId: string,
  sessionId: string,
  feedback: SessionFeedbackData,
  now: Date = new Date(),
) {
  const session = await prisma.workoutSession.findFirst({
    where: {
      id: sessionId,
      status: "IN_PROGRESS",
      mesocycle: { program: { profileId } },
    },
    select: {
      id: true,
      templateId: true,
      localDate: true,
      mesocycleId: true,
    },
  });
  if (!session) throw new SessionNotInProgressError();

  // Se decide FUERA de la transacción porque consulta el motor de fatiga
  // (varias lecturas); dentro alargaría el bloqueo de escritura de SQLite.
  const deload = await isExecutedDeload(prisma, session, profileId);

  const { count } = await prisma.workoutSession.updateMany({
    where: {
      id: sessionId,
      status: "IN_PROGRESS",
      mesocycle: { program: { profileId } },
    },
    data: {
      status: "COMPLETED",
      weekKind: deload ? "DELOAD" : "ACCUMULATION",
      finishedAt: now,
      perceivedPerformance: feedback.perceivedPerformance ?? null,
      pump: feedback.pump ?? null,
      jointPain: feedback.jointPain ?? null,
      fatigue: feedback.fatigue ?? null,
      motivation: feedback.motivation ?? null,
      notes: feedback.notes ?? null,
    },
  });
  // Carrera real: otra pestaña la cerró entre la lectura y la escritura.
  if (count === 0) throw new SessionNotInProgressError();
  return { deload };
}

/** Descarta una sesión (ABORTED). Queda fuera del historial y las estadísticas. */
/** Descarta la sesión. Lanza si ya no estaba en curso (ver `finishSession`). */
export async function discardSession(profileId: string, sessionId: string) {
  const { count } = await prisma.workoutSession.updateMany({
    where: {
      id: sessionId,
      status: "IN_PROGRESS",
      mesocycle: { program: { profileId } },
    },
    data: { status: "ABORTED" },
  });
  if (count === 0) throw new SessionNotInProgressError();
}
