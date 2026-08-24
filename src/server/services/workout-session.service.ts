import { DEFAULT_TIMEZONE, toLocalDate } from "@/core/dates";
import type { LogSetData, SessionFeedbackData } from "@/core/schemas/workout";
import { estimateOneRepMax } from "@/core/training/e1rm";
import { prisma } from "@/server/db";

/**
 * Servicio de sesiones de entrenamiento (Fase 2A). Sin progresión ni
 * recomendaciones: solo crear/reanudar sesiones, registrar series de forma
 * idempotente, sustituir ejercicios manualmente, finalizar y descartar.
 */

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

    const weekNumber = Math.max(template.mesocycle.currentWeek, 1);

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
export async function deleteSet(
  profileId: string,
  workoutExerciseId: string,
  setNumber: number,
) {
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
export async function finishSession(
  profileId: string,
  sessionId: string,
  feedback: SessionFeedbackData,
  now: Date = new Date(),
) {
  await prisma.workoutSession.updateMany({
    where: {
      id: sessionId,
      status: "IN_PROGRESS",
      mesocycle: { program: { profileId } },
    },
    data: {
      status: "COMPLETED",
      finishedAt: now,
      perceivedPerformance: feedback.perceivedPerformance ?? null,
      pump: feedback.pump ?? null,
      jointPain: feedback.jointPain ?? null,
      fatigue: feedback.fatigue ?? null,
      motivation: feedback.motivation ?? null,
      notes: feedback.notes ?? null,
    },
  });
}

/** Descarta una sesión (ABORTED). Queda fuera del historial y las estadísticas. */
export async function discardSession(profileId: string, sessionId: string) {
  await prisma.workoutSession.updateMany({
    where: {
      id: sessionId,
      status: "IN_PROGRESS",
      mesocycle: { program: { profileId } },
    },
    data: { status: "ABORTED" },
  });
}
