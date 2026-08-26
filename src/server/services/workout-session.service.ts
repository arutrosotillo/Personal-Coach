import { FATIGUE } from "@/core/config/training-config";
import {
  addDays,
  DEFAULT_TIMEZONE,
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
/** La plantilla se quedó sin ejercicios: no hay nada que entrenar. */
export class EmptyTemplateError extends Error {
  constructor() {
    super("Ese día no tiene ejercicios. Añade alguno antes de entrenarlo.");
    this.name = "EmptyTemplateError";
  }
}

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
      throw new EmptyTemplateError();
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
  // Guarda y borrado en la MISMA transacción: separados, si la sesión se
  // cerraba entre ambos la guarda pasaba, el borrado no tocaba nada y el
  // usuario recibía "ok" con la serie todavía ahí.
  await prisma.$transaction(async (tx) => {
    const enCurso = await tx.workoutExercise.count({
      where: {
        id: workoutExerciseId,
        session: {
          status: "IN_PROGRESS",
          mesocycle: { program: { profileId } },
        },
      },
    });
    if (enCurso === 0) throw new SessionNotInProgressError();
    await tx.setLog.deleteMany({
      where: { workoutExerciseId, setNumber },
    });
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
 * Hacen falta CUATRO cosas, y cada una tapa una forma distinta de colarse:
 *
 *   1. que el motor recomendara descarga cuando entraste al gimnasio (se
 *      consulta antes de marcar la sesión completada, así que no se cuenta a
 *      sí misma);
 *   2. que hayas pasado por la sesión ENTERA, no que te largaras: series en al
 *      menos la mitad de los ejercicios. Sin esto, una serie de dieciocho —con
 *      fatiga 5/5, el perfil de quien abandona— se registraba como descarga;
 *   3. que de verdad hayas recortado (`MAX_FRACTION` de lo prescrito);
 *   4. que no vengas de otra descarga reciente. Una descarga es UNA semana, no
 *      un régimen: sin este freno, quien entrena siempre a media sesión se
 *      auto-certificaba indefinidamente y la señal de sesiones acortadas —la
 *      que debería estar sonando— desaparecía para siempre.
 *
 * El denominador sale del SNAPSHOT de la sesión, no de la plantilla viva:
 * `max(plannedSets, baseSets)` sobre los ejercicios que la sesión tenía al
 * arrancar. Con la plantilla viva fallaba en los dos sentidos — quien hace la
 * descarga recortando series en `/program` no se detectaba (acababa de bajar el
 * denominador), y quien entrenaba completo y luego AÑADÍA ejercicios al día
 * veía su sesión completa registrada como descarga.
 */
async function isExecutedDeload(
  tx: Prisma.TransactionClient,
  session: { id: string; localDate: string },
  profileId: string,
  recomendada: boolean,
): Promise<boolean> {
  const ejercicios = await tx.workoutExercise.findMany({
    where: { sessionId: session.id },
    select: {
      plannedSets: true,
      exerciseVariantId: true,
      _count: {
        select: {
          setLogs: {
            where: { setType: "WORKING", completed: true, reps: { gt: 0 } },
          },
        },
      },
    },
  });
  if (ejercicios.length === 0) return false;

  // 2 · ¿pasaste por la sesión, o te fuiste?
  const conSeries = ejercicios.filter((e) => e._count.setLogs > 0).length;
  const minimoEjercicios = Math.ceil(
    ejercicios.length * FATIGUE.DELOAD_DETECTION.MIN_EXERCISE_FRACTION,
  );
  if (conSeries < minimoEjercicios) return false;

  // 3 · ¿recortaste? La referencia es "lo que este día es NORMALMENTE para ti":
  // el mayor volumen previsto entre la propia sesión, la plantilla actual y las
  // últimas veces que entrenaste ese mismo día.
  //
  // Hacen falta las tres. Solo con la sesión, "− Quitar serie" baja el
  // denominador y sales al 100 %. Solo con la plantilla, quien hace la descarga
  // recortando series en `/program` ANTES de entrenar tampoco se detecta
  // (acaba de bajar el denominador él mismo). El histórico de ese día es lo
  // único inmune a las dos cosas — y si algún día reduces tu programa de
  // verdad, en pocas semanas esa referencia baja sola y deja de contar como
  // descarga, que es justo lo correcto: ese pasa a ser tu volumen normal.
  const { templateId } = await tx.workoutSession.findUniqueOrThrow({
    where: { id: session.id },
    select: { templateId: true },
  });
  const base = templateId
    ? await tx.templateExercise.findMany({
        where: { templateId },
        select: { exerciseVariantId: true, baseSets: true },
      })
    : [];
  const baseByVariant = new Map(
    base.map((b) => [b.exerciseVariantId, b.baseSets]),
  );
  const enLaSesion = ejercicios.reduce(
    (t, e) =>
      t + Math.max(e.plannedSets, baseByVariant.get(e.exerciseVariantId) ?? 0),
    0,
  );
  const previas = templateId
    ? await tx.workoutSession.findMany({
        where: {
          templateId,
          status: "COMPLETED",
          weekKind: "ACCUMULATION",
          localDate: { lt: session.localDate },
          mesocycle: { program: { profileId } },
        },
        orderBy: { localDate: "desc" },
        take: 4,
        select: { exercises: { select: { plannedSets: true } } },
      })
    : [];
  const habitual = previas.map((x) =>
    x.exercises.reduce((t, e) => t + e.plannedSets, 0),
  );
  const prescritas = Math.max(enLaSesion, ...habitual, 0);
  const registradas = ejercicios.reduce((t, e) => t + e._count.setLogs, 0);
  if (prescritas === 0) return false;
  if (registradas / prescritas > FATIGUE.DELOAD_DETECTION.MAX_FRACTION) {
    return false;
  }

  const { WINDOW_DAYS, COOLDOWN_DAYS } = FATIGUE.DELOAD_DETECTION;
  const desde = addDays(session.localDate, -WINDOW_DAYS);

  // 4 · ¿vienes de otra descarga reciente? Entonces esto no es una descarga:
  // es tu forma habitual de entrenar.
  const anteriores = await tx.workoutSession.count({
    where: {
      status: "COMPLETED",
      weekKind: "DELOAD",
      localDate: { gte: addDays(session.localDate, -COOLDOWN_DAYS), lt: desde },
      mesocycle: { program: { profileId } },
    },
  });
  if (anteriores > 0) return false;

  // Una descarga son varias sesiones seguidas. Si ya hay una marcada en la
  // ventana, el resto de la tanda también cuenta: si no, solo se marcaría la
  // primera, porque al recortar el veredicto baja y deja de recomendarla.
  const enCurso = await tx.workoutSession.count({
    where: {
      status: "COMPLETED",
      weekKind: "DELOAD",
      localDate: { gte: desde, lte: session.localDate },
      mesocycle: { program: { profileId } },
    },
  });
  return enCurso > 0 || recomendada;
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

  // El veredicto del motor se consulta FUERA de la transacción: son varias
  // lecturas y solo mira sesiones COMPLETED, así que esta —que sigue en
  // curso— no puede alterarlo mientras tanto.
  const recomendada = await wasDeloadRecommended(profileId, session.localDate);

  // El recuento de series y la escritura sí van JUNTOS. Separados, todo lo que
  // se registrara entre ambos quedaba fuera de la decisión: una sesión al
  // 167 % del volumen podía acabar grabada como descarga ejecutada, que es
  // justo lo que le dice al motor de fatiga "obedeció, no le penalices".
  const { count, deload } = await prisma.$transaction(async (tx) => {
    // Si algo falla decidiendo esto, la sesión se cierra igual: no saber si
    // fue una descarga no puede impedirte terminar el entrenamiento ni
    // perderte el feedback.
    const deload = await isExecutedDeload(
      tx,
      session,
      profileId,
      recomendada,
    ).catch((e) => {
      if (process.env.DELOAD_DEBUG === "1")
        console.error("isExecutedDeload:", e);
      return false;
    });
    const { count } = await tx.workoutSession.updateMany({
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
    return { count, deload };
  });
  // Carrera real: otra pestaña la cerró entre la lectura y la escritura.
  if (count === 0) throw new SessionNotInProgressError();
  return { deload };
}

/** Descarta una sesión (ABORTED). Queda fuera del historial y las estadísticas. */
/**
 * Descarta la sesión. Lanza si ya no estaba en curso (ver `finishSession`).
 *
 * Descartar una que YA estaba descartada es idempotente y no es un error. Pero
 * una sesión COMPLETADA es otra cosa: el usuario ha confirmado un diálogo que
 * dice "se perderán N series, no se puede deshacer", y la sesión sigue en el
 * historial alimentando volumen y fatiga. Ahí hay que decírselo.
 */
export class SessionAlreadyCompletedError extends Error {
  constructor() {
    super("Esa sesión ya estaba terminada y sigue en tu historial.");
    this.name = "SessionAlreadyCompletedError";
  }
}

export async function discardSession(profileId: string, sessionId: string) {
  const { count } = await prisma.workoutSession.updateMany({
    where: {
      id: sessionId,
      status: "IN_PROGRESS",
      mesocycle: { program: { profileId } },
    },
    data: { status: "ABORTED" },
  });
  if (count > 0) return;
  const actual = await prisma.workoutSession.findFirst({
    where: { id: sessionId, mesocycle: { program: { profileId } } },
    select: { status: true },
  });
  if (actual?.status === "COMPLETED") throw new SessionAlreadyCompletedError();
  if (actual?.status === "ABORTED") return; // ya estaba descartada: idempotente
  throw new SessionNotInProgressError();
}
