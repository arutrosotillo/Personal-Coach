import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OnboardingData } from "@/core/schemas/onboarding";
import { onboardingSchema } from "@/core/schemas/onboarding";
import type { SyncOpData } from "@/core/schemas/workout";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";

/**
 * La cola offline contra la base de datos de verdad.
 *
 * Lo que se prueba aquí no es "que funcione": es que REPETIR funcione. Una
 * conexión intermitente produce constantemente el mismo caso —la petición
 * llega, la respuesta se pierde, el cliente reintenta— y lo único inaceptable
 * es acabar con dos series, dos sesiones o dos cierres.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const session = await import("@/server/services/workout-session.service");

const ONBOARDING: OnboardingData = onboardingSchema.parse({
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  trainingYears: 3,
  daysPerWeek: 4,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
  strategy: "LEAN_GAIN",
  dailySteps: 8000,
  workActivity: "SEDENTARY",
  balancedProgram: true,
  priorityMuscles: [],
});

let profileId: string;
let templateId: string;

beforeAll(async () => {
  await runSeed(prisma);
  const result = await completeOnboarding(
    await createTestUser(prisma, "owner"),
    ONBOARDING,
    new Date("2026-07-14T10:00:00Z"),
  );
  profileId = result.profileId;
  const program = await prisma.trainingProgram.findUniqueOrThrow({
    where: { id: result.programId },
    include: {
      mesocycles: { include: { templates: { orderBy: { ordinal: "asc" } } } },
    },
  });
  templateId = program.mesocycles[0].templates[0].id;
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

async function cleanupSessions() {
  await prisma.setLog.deleteMany({});
  await prisma.workoutExercise.deleteMany({});
  await prisma.workoutSession.deleteMany({});
}

/** Sesión nueva con sus ejercicios, como la que abriría el usuario. */
async function nuevaSesion() {
  await cleanupSessions();
  const { sessionId } = await session.startOrResumeSession(
    profileId,
    templateId,
    new Date("2026-07-14T11:00:00Z"),
  );
  const exercises = await prisma.workoutExercise.findMany({
    where: { sessionId },
    orderBy: { ordinal: "asc" },
  });
  return { sessionId, exercises };
}

function opSerie(
  seq: number,
  workoutExerciseId: string,
  setNumber: number,
  weightKg: number,
): SyncOpData {
  return {
    key: `SET:${workoutExerciseId}:${setNumber}`,
    seq,
    kind: "LOG_SET",
    payload: {
      workoutExerciseId,
      setNumber,
      setType: "WORKING",
      weightKg,
      reps: 10,
      rir: 2,
    },
  };
}

function opNota(
  seq: number,
  exerciseVariantId: string,
  text: string,
): SyncOpData {
  return {
    key: `NOTE:${exerciseVariantId}`,
    seq,
    kind: "SAVE_EXERCISE_NOTE",
    payload: { exerciseVariantId, text },
  };
}

function opCierre(seq: number, token: string): SyncOpData {
  return {
    key: "FINISH",
    seq,
    kind: "FINISH_SESSION",
    payload: { token, fatigue: 3, perceivedPerformance: 4 },
  };
}

describe("lote de sincronización", () => {
  it("aplica en orden las series que se registraron sin cobertura", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    const we = exercises[0];

    const outcome = await session.applySyncOps(profileId, sessionId, [
      opSerie(1, we.id, 1, 40),
      opSerie(2, we.id, 2, 42.5),
      opSerie(3, we.id, 3, 45),
    ]);

    expect(outcome.results.every((r) => r.ok)).toBe(true);
    const logs = await prisma.setLog.findMany({
      where: { workoutExerciseId: we.id },
      orderBy: { setNumber: "asc" },
    });
    expect(logs.map((l) => l.weightKg)).toEqual([40, 42.5, 45]);
  });

  it("devuelve `key` y `seq` intactos: la cola necesita saber QUÉ confirmó", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    const op = opSerie(7, exercises[0].id, 1, 60);

    const { results } = await session.applySyncOps(profileId, sessionId, [op]);

    expect(results).toEqual([{ key: op.key, seq: 7, ok: true }]);
  });

  it("reenviar EL MISMO lote no duplica nada (la respuesta se perdió)", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    const we = exercises[0];
    const lote = [opSerie(1, we.id, 1, 40), opSerie(2, we.id, 2, 40)];

    await session.applySyncOps(profileId, sessionId, lote);
    const segundo = await session.applySyncOps(profileId, sessionId, lote);

    expect(segundo.results.every((r) => r.ok)).toBe(true);
    expect(
      await prisma.setLog.count({ where: { workoutExerciseId: we.id } }),
    ).toBe(2);
  });

  it("reenviar con OTRO peso corrige la serie en vez de añadir una", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    const we = exercises[0];

    await session.applySyncOps(profileId, sessionId, [
      opSerie(1, we.id, 1, 40),
    ]);
    await session.applySyncOps(profileId, sessionId, [
      opSerie(2, we.id, 1, 47.5),
    ]);

    const logs = await prisma.setLog.findMany({
      where: { workoutExerciseId: we.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].weightKg).toBe(47.5);
  });

  it("se PARA en el primer fallo: lo de detrás no se intenta y sigue pendiente", async () => {
    // El orden importa (el cierre va el último), así que seguir adelante tras
    // un fallo podría escribir una serie en una sesión ya cerrada.
    const { sessionId, exercises } = await nuevaSesion();
    const we = exercises[0];

    const { results } = await session.applySyncOps(profileId, sessionId, [
      opSerie(1, we.id, 1, 40),
      { ...opSerie(2, "no-existe", 1, 40), key: "SET:no-existe:1" },
      opSerie(3, we.id, 2, 40),
    ]);

    expect(results).toHaveLength(2); // la tercera ni se intentó
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, permanent: true });
    expect(
      await prisma.setLog.count({ where: { workoutExerciseId: we.id } }),
    ).toBe(1);
  });

  it("una operación de la sesión de OTRO usuario se rechaza, no se aplica", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    const otro = await completeOnboarding(
      await createTestUser(prisma, `intruso-${Date.now()}`),
      ONBOARDING,
      new Date("2026-07-14T10:00:00Z"),
    );

    const { results } = await session.applySyncOps(otro.profileId, sessionId, [
      opSerie(1, exercises[0].id, 1, 999),
    ]);

    expect(results[0]).toMatchObject({ ok: false, permanent: true });
    expect(await prisma.setLog.count()).toBe(0);
  });

  it("un ejercicio que no es de ESTA sesión se rechaza", async () => {
    // El lote declara a qué sesión pertenece; una operación que apunta fuera no
    // se aplica ni siendo el ejercicio del mismo usuario.
    const primera = await nuevaSesion();
    const ejercicioAjeno = primera.exercises[0].id;
    const segunda = await nuevaSesion();
    expect(segunda.sessionId).not.toBe(primera.sessionId);

    const { results } = await session.applySyncOps(
      profileId,
      segunda.sessionId,
      [opSerie(1, ejercicioAjeno, 1, 40)],
    );

    expect(results[0]).toMatchObject({ ok: false, permanent: true });
    expect(await prisma.setLog.count()).toBe(0);
  });
});

describe("cierre idempotente", () => {
  it("las series y luego el cierre, en un solo lote", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    const we = exercises[0];

    const outcome = await session.applySyncOps(profileId, sessionId, [
      opSerie(1, we.id, 1, 40),
      opSerie(2, we.id, 2, 40),
      opCierre(3, "token-abc12345"),
    ]);

    expect(outcome.results.every((r) => r.ok)).toBe(true);
    expect(outcome.finished).toMatchObject({ replayed: false });
    const cerrada = await prisma.workoutSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(cerrada.status).toBe("COMPLETED");
    expect(cerrada.fatigue).toBe(3);
    expect(cerrada.finishToken).toBe("token-abc12345");
  });

  it("reintentar el cierre con el MISMO token es un ÉXITO, no un error", async () => {
    // Este es el caso real: la petición llegó, escribió y la respuesta se
    // perdió. Antes el reintento decía "esta valoración no se ha guardado"
    // habiéndose guardado.
    const { sessionId } = await nuevaSesion();

    const primero = await session.finishSession(
      profileId,
      sessionId,
      { fatigue: 4 },
      new Date("2026-07-14T12:00:00Z"),
      "token-repetido-1",
    );
    const segundo = await session.finishSession(
      profileId,
      sessionId,
      { fatigue: 4 },
      new Date("2026-07-14T12:05:00Z"),
      "token-repetido-1",
    );

    expect(primero.replayed).toBe(false);
    expect(segundo.replayed).toBe(true);
    expect(segundo.deload).toBe(primero.deload);
    // Y la sesión se cerró UNA vez: el segundo intento no reescribió la hora.
    const cerrada = await prisma.workoutSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(cerrada.finishedAt?.toISOString()).toBe("2026-07-14T12:00:00.000Z");
    expect(cerrada.fatigue).toBe(4);
  });

  it("cerrar con OTRO token una sesión ya cerrada sigue avisando", async () => {
    // Aquí no hay reintento: la cerró otra pestaña, y ESE feedback sí se ha
    // perdido de verdad. El feedback es la única entrada del motor de fatiga.
    const { sessionId } = await nuevaSesion();
    await session.finishSession(
      profileId,
      sessionId,
      { fatigue: 2 },
      new Date("2026-07-14T12:00:00Z"),
      "token-de-la-otra-pestana",
    );

    await expect(
      session.finishSession(
        profileId,
        sessionId,
        { fatigue: 5 },
        new Date("2026-07-14T12:10:00Z"),
        "token-mio",
      ),
    ).rejects.toThrow(session.SessionNotInProgressError);
    const cerrada = await prisma.workoutSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(cerrada.fatigue).toBe(2);
  });

  it("sin token, cerrar dos veces sigue siendo un error (comportamiento previo)", async () => {
    const { sessionId } = await nuevaSesion();
    await session.finishSession(profileId, sessionId, {});
    await expect(
      session.finishSession(profileId, sessionId, {}),
    ).rejects.toThrow(session.SessionNotInProgressError);
  });

  it("reenviar el lote entero tras un cierre confirmado no duplica series ni sesiones", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    const we = exercises[0];
    const lote = [
      opSerie(1, we.id, 1, 40),
      opSerie(2, we.id, 2, 40),
      opCierre(3, "token-lote-completo"),
    ];

    await session.applySyncOps(profileId, sessionId, lote);
    const repetido = await session.applySyncOps(profileId, sessionId, lote);

    // Las series ya no se pueden reescribir (la sesión está cerrada) y el lote
    // se para ahí; el cliente descarta esas operaciones avisando, porque el
    // dato YA está guardado. Lo que no pasa nunca es duplicar.
    expect(repetido.results[0]).toMatchObject({ ok: false, permanent: true });
    expect(
      await prisma.setLog.count({ where: { workoutExerciseId: we.id } }),
    ).toBe(2);
    expect(await prisma.workoutSession.count()).toBe(1);
  });
});

describe("invariantes de la base de datos", () => {
  it("no permite dos sesiones en curso: el doble toque reanuda, no duplica", async () => {
    // Sin el índice parcial, dos llamadas concurrentes —un doble toque, o el
    // reintento de una petición que se quedó colgada— creaban DOS sesiones
    // IN_PROGRESS con sus ejercicios duplicados, y la huérfana bloqueaba
    // después cambiar de programa.
    await cleanupSessions();

    const resultados = await Promise.all([
      session.startOrResumeSession(profileId, templateId),
      session.startOrResumeSession(profileId, templateId),
      session.startOrResumeSession(profileId, templateId),
    ]);

    const ids = new Set(resultados.map((r) => r.sessionId));
    expect(ids.size).toBe(1);
    expect(
      await prisma.workoutSession.count({ where: { status: "IN_PROGRESS" } }),
    ).toBe(1);
  });

  it("una serie no puede colarse en una sesión que se acaba de cerrar", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    await session.finishSession(profileId, sessionId, {});

    await expect(
      session.logSet(profileId, {
        workoutExerciseId: exercises[0].id,
        setNumber: 1,
        setType: "WORKING",
        weightKg: 40,
        reps: 10,
        rir: 2,
      }),
    ).rejects.toThrow();
    expect(await prisma.setLog.count()).toBe(0);
  });
});

/**
 * Notas escritas sin cobertura (F3.2d).
 *
 * Antes de esto la nota no pasaba por la cola: se llamaba a la server action y
 * se esperaba. Sin cobertura salía un toast de error y el texto solo vivía en
 * el estado de React, así que cerrar la app lo perdía. Aquí se prueba la parte
 * de servidor de la solución, que es la que hace segura la de cliente.
 */
describe("notas de ejercicio en el lote offline", () => {
  it("una nota escrita sin cobertura se guarda al volver la conexión", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    const we = exercises[0];

    const outcome = await session.applySyncOps(profileId, sessionId, [
      opSerie(1, we.id, 1, 40),
      opNota(2, we.exerciseVariantId, "Asiento en el 4, agarre neutro."),
    ]);

    expect(outcome.results.every((r) => r.ok)).toBe(true);
    const nota = await prisma.exerciseNote.findFirst({
      where: { profileId, exerciseVariantId: we.exerciseVariantId },
    });
    expect(nota?.text).toBe("Asiento en el 4, agarre neutro.");
  });

  it("reenviar el mismo lote no duplica la nota ni la multiplica", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    const we = exercises[0];
    const ops = [opNota(1, we.exerciseVariantId, "Codos pegados.")];

    await session.applySyncOps(profileId, sessionId, ops);
    await session.applySyncOps(profileId, sessionId, ops);
    await session.applySyncOps(profileId, sessionId, ops);

    expect(
      await prisma.exerciseNote.count({
        where: { profileId, exerciseVariantId: we.exerciseVariantId },
      }),
    ).toBe(1);
  });

  it("la última reescritura gana: la cola manda el texto completo", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    const we = exercises[0];

    await session.applySyncOps(profileId, sessionId, [
      opNota(1, we.exerciseVariantId, "primera versión"),
    ]);
    await session.applySyncOps(profileId, sessionId, [
      opNota(2, we.exerciseVariantId, "versión corregida sin cobertura"),
    ]);

    const nota = await prisma.exerciseNote.findFirst({
      where: { profileId, exerciseVariantId: we.exerciseVariantId },
    });
    expect(nota?.text).toBe("versión corregida sin cobertura");
  });

  it("borrar la nota sin cobertura también viaja (texto vacío)", async () => {
    const { sessionId, exercises } = await nuevaSesion();
    const we = exercises[0];

    await session.applySyncOps(profileId, sessionId, [
      opNota(1, we.exerciseVariantId, "una nota"),
    ]);
    await session.applySyncOps(profileId, sessionId, [
      opNota(2, we.exerciseVariantId, ""),
    ]);

    expect(
      await prisma.exerciseNote.count({
        where: { profileId, exerciseVariantId: we.exerciseVariantId },
      }),
    ).toBe(0);
  });

  it("una nota escrita tras el cierre se guarda igual: no es dato de la sesión", async () => {
    // Se puede finalizar sin cobertura y anotar algo después; el lote llega
    // entero cuando vuelve la conexión, con el cierre por delante. La nota es
    // del banco de ejercicios, así que no exige que la sesión siga en curso.
    const { sessionId, exercises } = await nuevaSesion();
    const we = exercises[0];

    const outcome = await session.applySyncOps(profileId, sessionId, [
      opSerie(1, we.id, 1, 40),
      opCierre(2, "tok-nota"),
      opNota(3, we.exerciseVariantId, "Se me olvidó: subir el asiento."),
    ]);

    expect(outcome.results.map((r) => r.ok)).toEqual([true, true, true]);
    const nota = await prisma.exerciseNote.findFirst({
      where: { profileId, exerciseVariantId: we.exerciseVariantId },
    });
    expect(nota?.text).toBe("Se me olvidó: subir el asiento.");
  });

  it("una nota sobre un ejercicio que no es visible se rechaza para siempre", async () => {
    // Descartarla es lo correcto: reintentar no va a arreglarlo. Pero tiene que
    // avisar, que es lo que hace `permanent`.
    const { sessionId } = await nuevaSesion();

    const outcome = await session.applySyncOps(profileId, sessionId, [
      opNota(1, "variante-que-no-existe", "nota fantasma"),
    ]);
    expect(outcome.results[0].ok).toBe(false);
    expect(outcome.results[0].permanent).toBe(true);
  });
});
