import { FATIGUE } from "@/core/config/training-config";
import {
  addDays,
  DEFAULT_TIMEZONE,
  toLocalDate,
  weekIndexSince,
} from "@/core/dates";
import type {
  LogSetData,
  SessionFeedbackData,
  SyncOpData,
} from "@/core/schemas/workout";
import { estimateOneRepMax } from "@/core/training/e1rm";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { visibleExerciseWhere } from "@/server/repositories/exercise-library.repo";
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
  try {
    return await createSession(profileId, templateId, now);
  } catch (error) {
    // El índice parcial `WorkoutSession_one_in_progress_per_mesocycle` acaba de
    // impedir la segunda sesión. Leer-y-crear dentro de una transacción NO basta
    // en READ COMMITTED: dos toques seguidos —o el reintento de una petición que
    // se quedó colgada sin cobertura— ven los dos que no hay sesión activa y los
    // dos insertan. La base de datos es el único sitio donde ese invariante se
    // puede sostener de verdad; aquí solo hay que traducirlo a lo que el usuario
    // pidió, que era entrar a entrenar.
    if (!isUniqueViolation(error)) throw error;
    const active = await getActiveSession(profileId);
    if (!active) throw error;
    return { sessionId: active.id, resumed: true };
  }
}

/** ¿Es una violación de índice único de Postgres (P2002)? */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function createSession(
  profileId: string,
  templateId: string,
  now: Date,
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
  const estimated1Rm = estimateOneRepMax(
    data.weightKg,
    data.reps,
    data.rir ?? null,
  );

  // Guarda y escritura en la MISMA transacción, igual que en `deleteSet`.
  // Separadas eran dos viajes: si la sesión se cerraba entre ambos (otra
  // pestaña, o el reintento tardío de una petición que se quedó colgada sin
  // cobertura), la serie se escribía dentro de una sesión ya COMPLETED —después
  // de que `isExecutedDeload` hubiera contado las series— y contaminaba a la
  // vez el veredicto de descarga y el historial que lee la progresión. Con la
  // cola de reintentos esa ventana se abre mucho más a menudo.
  await prisma.$transaction(async (tx) => {
    const we = await tx.workoutExercise.findFirstOrThrow({
      where: {
        id: data.workoutExerciseId,
        session: {
          status: "IN_PROGRESS",
          mesocycle: { program: { profileId } },
        },
      },
      include: { session: true },
    });

    await tx.setLog.upsert({
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
  });
}

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
    // La variante destino se filtra por VISIBILIDAD, no solo por existencia.
    // Sin esto, `listSubstitutionOptions` filtraba bien pero el servicio no, y
    // una llamada fabricada podía meter el ejercicio personalizado de otro
    // usuario —con su nombre— dentro de tu sesión y de tu historial.
    const variant = await tx.exerciseVariant.findFirstOrThrow({
      where: {
        id: newVariantId,
        deletedAt: null,
        exercise: { deletedAt: null, ...visibleExerciseWhere(profileId) },
      },
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

  const { WINDOW_DAYS, EXTENSION_DAYS, COOLDOWN_DAYS } =
    FATIGUE.DELOAD_DETECTION;
  const deloadsEntre = (desde: string, hasta: string) =>
    tx.workoutSession.count({
      where: {
        status: "COMPLETED",
        weekKind: "DELOAD",
        localDate: { gte: desde, lte: hasta },
        mesocycle: { program: { profileId } },
      },
    });

  // 4a · ¿es otra sesión de la MISMA tanda? Hace falta preguntarlo porque el
  // veredicto baja en cuanto recortas: sin esto solo se marcaría la primera
  // sesión de la semana y las otras dos contarían como acortadas.
  //
  // La tanda se mide en SESIONES, no en días: ninguna ventana de días separa
  // "el viernes" de "el lunes siguiente", pero una descarga son como mucho las
  // sesiones que entrenas en una semana. Pasadas esas, hace falta que el motor
  // siga recomendándola.
  const mismaTanda = await deloadsEntre(
    addDays(session.localDate, -WINDOW_DAYS),
    session.localDate,
  );
  const porSemana =
    (
      await tx.trainingProgram.findFirst({
        where: { profileId, isActive: true, deletedAt: null },
        select: { daysPerWeek: true },
      })
    )?.daysPerWeek ?? 3;
  if (mismaTanda > 0 && mismaTanda < porSemana) return true;

  // 4b · Si el motor ya no la recomienda, esto no es una descarga.
  if (!recomendada) return false;

  // 4c · Alargarla mientras SIGUE recomendada, sí. Empezar otra al mes de la
  // anterior, no: eso ya no es descargar, es entrenar siempre a media sesión.
  const reciente = await deloadsEntre(
    addDays(session.localDate, -COOLDOWN_DAYS),
    addDays(session.localDate, -EXTENSION_DAYS),
  );
  return reciente === 0;
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
  token: string | null = null,
): Promise<{ deload: boolean; replayed: boolean }> {
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
  if (!session) {
    const replay = await ownReplay(profileId, sessionId, token);
    if (replay) return replay;
    throw new SessionNotInProgressError();
  }

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
        finishToken: token,
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
  if (count === 0) {
    const replay = await ownReplay(profileId, sessionId, token);
    if (replay) return replay;
    // Carrera real: otra pestaña la cerró entre la lectura y la escritura.
    throw new SessionNotInProgressError();
  }
  return { deload, replayed: false };
}

/**
 * ¿Esta sesión ya la cerré YO, con este mismo token?
 *
 * Es la diferencia entre las dos maneras de encontrarse la sesión cerrada:
 *
 *  - Mi petición llegó, escribió y la respuesta se perdió por el camino. La
 *    cola reintenta con el MISMO token, el token coincide y esto es un éxito:
 *    el feedback está guardado, no hay nada que avisar. Sin esto, una conexión
 *    intermitente —o sea, la normal en un gimnasio— acababa diciendo "esta
 *    valoración no se ha guardado" habiéndose guardado.
 *  - La cerró otra pestaña. El token no coincide (o no hay token), y ahí el
 *    aviso es correcto y necesario: ESE feedback de verdad se ha perdido, y el
 *    feedback es la única entrada del motor de fatiga.
 *
 * `weekKind` sale de la fila ya escrita, así que `isExecutedDeload` se calcula
 * EXACTAMENTE UNA VEZ por sesión: el reintento no vuelve a decidir nada.
 */
async function ownReplay(
  profileId: string,
  sessionId: string,
  token: string | null,
): Promise<{ deload: boolean; replayed: boolean } | null> {
  if (!token) return null;
  const previous = await prisma.workoutSession.findFirst({
    where: {
      id: sessionId,
      status: "COMPLETED",
      finishToken: token,
      mesocycle: { program: { profileId } },
    },
    select: { weekKind: true },
  });
  if (!previous) return null;
  return { deload: previous.weekKind === "DELOAD", replayed: true };
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

/** Resultado de UNA operación del lote. `key`/`seq` vuelven tal cual al cliente. */
export interface SyncOpOutcome {
  key: string;
  seq: number;
  ok: boolean;
  error?: string;
  /**
   * `true` = reintentar no va a arreglarlo nunca. Solo entonces el cliente
   * descarta la operación, y avisando. Un fallo de red no llega hasta aquí.
   */
  permanent?: boolean;
}

export interface SyncOutcome {
  /** SOLO las operaciones intentadas. Las que no, siguen pendientes. */
  results: SyncOpOutcome[];
  /** Presente si el lote incluía el cierre de la sesión. */
  finished?: { deload: boolean; replayed: boolean };
}

/**
 * Qué contarle al usuario cuando algo se descarta para siempre.
 *
 * El cierre merece su propio mensaje: el feedback (fatiga, dolor, motivación)
 * es la ÚNICA entrada del motor de fatiga, así que perderlo hay que decirlo con
 * todas las letras, y hay que dejar claro que las series NO se han perdido.
 */
function mensajePermanente(kind: SyncOpData["kind"]): string {
  if (kind === "FINISH_SESSION") {
    return (
      "Esta sesión ya se había cerrado en otro sitio, así que esta valoración " +
      "no se ha guardado. La sesión y sus series están en tu historial; la " +
      "valoración de aquella vez es la que quedó."
    );
  }
  return "Esa sesión ya no está en curso: ese cambio no se ha podido guardar.";
}

/** Errores que no se arreglan reintentando: el dato o el permiso están mal. */
function isPermanent(error: unknown): boolean {
  if (error instanceof SessionNotInProgressError) return true;
  if (error instanceof SessionAlreadyCompletedError) return true;
  // P2025: `findFirstOrThrow` no encontró nada. En este servicio eso siempre
  // significa "no es tuyo" o "la sesión ya no está en curso", nunca un fallo
  // pasajero de la base de datos.
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}

/**
 * Aplica, EN ORDEN, las escrituras que un cliente sin cobertura dejó pendientes.
 *
 * Tres decisiones que sostienen todo lo demás:
 *
 *  1. **Un solo viaje.** Con la cobertura de un gimnasio, veinte peticiones
 *     secuenciales son veinte ocasiones de cortarse a medias.
 *  2. **Se para en el primer fallo.** No es pereza: el orden importa
 *     (`setPlannedSets` borra las series por encima del nuevo tope) y el cierre
 *     va siempre el último, así que seguir adelante después de un fallo podría
 *     intentar escribir una serie en una sesión ya cerrada. Lo no intentado no
 *     aparece en `results` y el cliente lo conserva.
 *  3. **No relaja NADA de seguridad.** Cada operación pasa por el mismo servicio
 *     y las mismas cláusulas `where` que la ruta online: identidad, propiedad de
 *     la sesión y del ejercicio, estado y payload se vuelven a validar aquí. Lo
 *     que el cliente guardó en el móvil es una petición, no una autorización.
 */
export async function applySyncOps(
  profileId: string,
  sessionId: string,
  ops: SyncOpData[],
  now: Date = new Date(),
): Promise<SyncOutcome> {
  const results: SyncOpOutcome[] = [];
  let finished: SyncOutcome["finished"];

  // Qué ejercicios son de ESTA sesión (y que la sesión es de este perfil). Se
  // consulta sin filtrar por estado a propósito: si la sesión ya está cerrada
  // porque el cierre de este mismo cliente llegó y su respuesta se perdió, el
  // reintento tiene que poder llegar hasta `finishSession` y reconocerse.
  const session = await prisma.workoutSession.findFirst({
    where: { id: sessionId, mesocycle: { program: { profileId } } },
    select: { exercises: { select: { id: true } } },
  });
  if (!session) {
    return {
      results: ops.map((op) => ({
        key: op.key,
        seq: op.seq,
        ok: false,
        permanent: true,
        error: "Esa sesión no existe o no es tuya.",
      })),
    };
  }
  const ownExercises = new Set(session.exercises.map((e) => e.id));

  for (const op of ops) {
    try {
      if (op.kind === "FINISH_SESSION") {
        const { token, ...feedback } = op.payload;
        finished = await finishSession(
          profileId,
          sessionId,
          feedback,
          now,
          token,
        );
      } else if (!ownExercises.has(op.payload.workoutExerciseId)) {
        throw new SessionNotInProgressError();
      } else if (op.kind === "LOG_SET") {
        await logSet(profileId, op.payload);
      } else {
        await setPlannedSets(
          profileId,
          op.payload.workoutExerciseId,
          op.payload.plannedSets,
        );
      }
      results.push({ key: op.key, seq: op.seq, ok: true });
    } catch (error) {
      const permanent = isPermanent(error);
      if (!permanent) console.error("applySyncOps", op.kind, error);
      results.push({
        key: op.key,
        seq: op.seq,
        ok: false,
        permanent,
        error: permanent ? mensajePermanente(op.kind) : "No se pudo guardar.",
      });
      // Ver punto 2: lo que queda detrás depende de esto.
      break;
    }
  }

  return { results, finished };
}
