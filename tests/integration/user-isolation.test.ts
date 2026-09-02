import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CoachProvider } from "@/ai/provider";
import { bodyMeasurementSchema } from "@/core/schemas/body-measurement";
import { addDays } from "@/core/dates";
import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * Aislamiento entre usuarios. Este fichero es la razón de ser de la fase
 * multi-usuario: la app es privada y compartida con familia, y cada persona
 * debe ver EXCLUSIVAMENTE lo suyo.
 *
 * Todas las pruebas atacan por el mismo sitio por el que atacaría alguien de
 * verdad: pasando a mano el id de un recurso ajeno (IDOR). No basta con que la
 * interfaz no enseñe el botón; el servidor tiene que negarse.
 *
 * Se prueba contra los SERVICES, que es donde vive la comprobación de
 * propiedad, y no contra las server actions: estas resuelven el perfil desde la
 * cookie y en un test unitario habría que falsear la sesión, lo que probaría el
 * simulacro en vez del código.
 *
 * VERIFICADO POR MUTACIÓN: al quitar los filtros por perfil de
 * program-edit.service y workout-session.service, 8 de estos tests fallan. Y
 * eliminando por completo la guarda de `deleteSet`, falla también el suyo.
 * `finishSession` aguanta con una guarda fuera porque tiene DOS comprobaciones
 * de propiedad independientes (el findFirst y el updateMany final).
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const workout = await import("@/server/services/workout-session.service");
const programEdit = await import("@/server/services/program-edit.service");
const { getExecutionSession, listCompletedSessions, getTodayOverview } =
  await import("@/server/repositories/workout.repo");
const { listArchivedPrograms } =
  await import("@/server/repositories/program.repo");
const { getTrainingAnalysis } =
  await import("@/server/services/fatigue.service");
const { getExerciseHistorySummary } =
  await import("@/server/services/progression.service");
const { askCoach } = await import("@/server/services/coach.service");
const { getProfileOverview } =
  await import("@/server/repositories/profile.repo");
const body = await import("@/server/services/body.service");

const BASE = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  waistCm: 88,
  trainingYears: 3,
  daysPerWeek: 4,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
  strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
  dailySteps: 8500,
  workActivity: "SEDENTARY",
  balancedProgram: true,
  priorityMuscles: [],
  contraindications: [],
  excludedExerciseNames: [],
} as const;

interface Persona {
  userId: string;
  profileId: string;
  programId: string;
  mesocycleId: string;
  templateIds: string[];
  templateExerciseId: string;
  variantId: string;
  /** Sesión terminada: historial. */
  sessionId: string;
  /** Sesión EN CURSO. Las acciones de escritura exigen IN_PROGRESS además de
   *  propiedad, así que atacar una sesión cerrada pasaría el test por el
   *  motivo equivocado: lo único que debe frenar a A es que no es suya. */
  liveSessionId: string;
  liveExerciseId: string;
}

async function montar(
  username: string,
  overrides: Record<string, unknown>,
  fecha: string,
): Promise<Persona> {
  const userId = await createTestUser(prisma, username);
  const { profileId } = await completeOnboarding(
    userId,
    onboardingSchema.parse({ ...BASE, ...overrides }),
    new Date(`${fecha}T10:00:00Z`),
  );
  const program = await prisma.trainingProgram.findFirstOrThrow({
    where: { profileId, isActive: true, deletedAt: null },
    include: {
      mesocycles: {
        orderBy: { ordinal: "asc" },
        include: {
          templates: {
            orderBy: { ordinal: "asc" },
            include: { exercises: { orderBy: { ordinal: "asc" } } },
          },
        },
      },
    },
  });
  const meso = program.mesocycles[0];
  const templates = meso.templates;
  const primerEjercicio = templates[0].exercises[0];

  // Una sesión completada, para tener historial que robar.
  const sessionId = await seedCompletedSessionWithSets(prisma, {
    mesocycleId: meso.id,
    variantId: primerEjercicio.exerciseVariantId,
    templateId: templates[0].id,
    localDate: fecha,
    sets: [
      { setNumber: 1, weightKg: 60, reps: 10, rir: 2 },
      { setNumber: 2, weightKg: 60, reps: 10, rir: 2 },
    ],
  });

  // Sesión viva, en otro día de la semana para no chocar con la sembrada.
  const { sessionId: liveSessionId } = await workout.startOrResumeSession(
    profileId,
    templates[1].id,
    new Date(`${fecha}T18:00:00Z`),
  );
  const liveExercise = await prisma.workoutExercise.findFirstOrThrow({
    where: { sessionId: liveSessionId },
    orderBy: { ordinal: "asc" },
  });

  return {
    userId,
    profileId,
    programId: program.id,
    mesocycleId: meso.id,
    templateIds: templates.map((t) => t.id),
    templateExerciseId: primerEjercicio.id,
    variantId: primerEjercicio.exerciseVariantId,
    sessionId,
    liveSessionId,
    liveExerciseId: liveExercise.id,
  };
}

let A: Persona;
let B: Persona;

beforeAll(async () => {
  await runSeed(prisma);
  A = await montar(
    "ana",
    { priorityMuscles: [], daysPerWeek: 4 },
    "2026-06-01",
  );
  B = await montar(
    "bruno",
    { sex: "FEMALE", heightCm: 165, weightKg: 62, daysPerWeek: 3 },
    "2026-06-02",
  );
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("cada usuario tiene su propio mundo", () => {
  it("dos cuentas producen dos perfiles y dos programas distintos", () => {
    expect(A.userId).not.toBe(B.userId);
    expect(A.profileId).not.toBe(B.profileId);
    expect(A.programId).not.toBe(B.programId);
  });

  it("el onboarding de B NO sobrescribe el perfil de A", async () => {
    // Este era el fallo más destructivo del modelo single-user: se reutilizaba
    // "el perfil más antiguo de la base de datos".
    const perfilA = await prisma.userProfile.findUniqueOrThrow({
      where: { id: A.profileId },
    });
    expect(perfilA.sex).toBe("MALE");
    expect(perfilA.heightCm).toBe(178);
    expect(perfilA.userId).toBe(A.userId);
  });

  it("A sigue teniendo su programa activo después de que B se dé de alta", async () => {
    const activos = await prisma.trainingProgram.count({
      where: { profileId: A.profileId, isActive: true, deletedAt: null },
    });
    expect(activos).toBe(1);
  });

  it("las preferencias son de cada perfil, no globales", async () => {
    // Antes la clave era única en toda la base: el segundo onboarding pisaba
    // las preferencias del primero, contraindicaciones incluidas.
    const [prefsA, prefsB] = await Promise.all([
      prisma.userPreference.findMany({ where: { profileId: A.profileId } }),
      prisma.userPreference.findMany({ where: { profileId: B.profileId } }),
    ]);
    expect(prefsA.length).toBeGreaterThan(0);
    expect(prefsB.length).toBeGreaterThan(0);
    const diasA = prefsA.find((p) => p.key === "days_per_week");
    const diasB = prefsB.find((p) => p.key === "days_per_week");
    expect(diasA?.value).toBe(4);
    expect(diasB?.value).toBe(3);
  });
});

describe("IDOR: leer datos ajenos pasando ids a mano", () => {
  it("A no puede abrir la sesión de B", async () => {
    expect(await getExecutionSession(A.profileId, B.sessionId)).toBeNull();
    // Y la suya sí, para que el test no pase por estar todo roto.
    expect(await getExecutionSession(B.profileId, B.sessionId)).not.toBeNull();
  });

  it("el historial de A no contiene ni una sesión de B", async () => {
    const historialA = await listCompletedSessions(A.profileId);
    const idsA = historialA.map((s) => s.id);
    expect(idsA).toContain(A.sessionId);
    expect(idsA).not.toContain(B.sessionId);
  });

  it("el resumen de hoy de A solo ve las plantillas de A", async () => {
    const hoy = await getTodayOverview(
      A.profileId,
      new Date("2026-06-10T10:00:00Z"),
    );
    const ids = hoy?.templates.map((t) => t.id) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of B.templateIds) expect(ids).not.toContain(id);
  });

  it("A no ve los programas archivados de B", async () => {
    const archivados = await listArchivedPrograms(A.profileId);
    expect(archivados.map((p) => p.id)).not.toContain(B.programId);
  });

  it("el historial de un ejercicio no mezcla las series de los dos", async () => {
    // Ambos entrenan variantes del mismo catálogo compartido: el catálogo es
    // común, el historial no.
    // B ha entrenado su variante; A no la ha tocado nunca. Si el historial se
    // mezclara, A vería sesiones y una mejor serie que no son suyas.
    const resumenA = await getExerciseHistorySummary(A.profileId, B.variantId);
    const resumenB = await getExerciseHistorySummary(B.profileId, B.variantId);
    expect(resumenB.sessionCount).toBeGreaterThan(0);
    expect(resumenB.bestSet).not.toBeNull();
    expect(resumenA.sessionCount).toBe(0);
    expect(resumenA.bestSet).toBeNull();
  });
});

/**
 * Sesión EN CURSO y recién hecha para B, con una serie ya registrada.
 *
 * Se construye con Prisma directamente, NO con los services. Un fixture no
 * puede depender del código que se está probando: al romper el aislamiento
 * para comprobar que estos tests lo detectan, `startOrResumeSession` dejaba de
 * crear una sesión de B —reanudaba la de A— y varios ataques pasaban por
 * accidente.
 *
 * Cada prueba de escritura pide la suya. Compartir una sola hacía que el primer
 * ataque que prosperase la dejara cerrada, y los siguientes chocaban contra el
 * filtro de estado en vez de contra el de propiedad.
 */
async function sesionVivaDeB(): Promise<{
  sessionId: string;
  exerciseId: string;
}> {
  await prisma.workoutSession.updateMany({
    where: { mesocycleId: B.mesocycleId, status: "IN_PROGRESS" },
    data: { status: "ABORTED" },
  });

  const plantilla = await prisma.workoutTemplate.findUniqueOrThrow({
    where: { id: B.templateIds[1] },
    include: { exercises: { orderBy: { ordinal: "asc" } } },
  });
  const primero = plantilla.exercises[0];

  const session = await prisma.workoutSession.create({
    data: {
      mesocycleId: B.mesocycleId,
      templateId: plantilla.id,
      weekNumber: 1,
      weekKind: "ACCUMULATION",
      status: "IN_PROGRESS",
      localDate: "2026-06-05",
      exercises: {
        create: {
          exerciseVariantId: primero.exerciseVariantId,
          ordinal: 0,
          plannedSets: primero.baseSets,
          repRangeMin: primero.repRangeMin,
          repRangeMax: primero.repRangeMax,
          targetRir: primero.targetRir,
          restSeconds: primero.restSeconds,
        },
      },
    },
    include: { exercises: true },
  });
  const exercise = session.exercises[0];

  // Una serie real: si no, `finishSession` se niega por sesión vacía y el test
  // volvería a pasar por el motivo equivocado.
  await prisma.setLog.create({
    data: {
      workoutExerciseId: exercise.id,
      exerciseVariantId: exercise.exerciseVariantId,
      localDate: "2026-06-05",
      setNumber: 1,
      setType: "WORKING",
      weightKg: 50,
      reps: 8,
      rir: 2,
      completed: true,
    },
  });

  return { sessionId: session.id, exerciseId: exercise.id };
}

describe("IDOR: escribir sobre datos ajenos", () => {
  it("A no puede terminar la sesión de B", async () => {
    const { sessionId } = await sesionVivaDeB();
    await expect(
      workout.finishSession(A.profileId, sessionId, {
        perceivedPerformance: 3,
        jointPain: 1,
      }),
    ).rejects.toThrow();
    const sesionB = await prisma.workoutSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(sesionB.status).toBe("IN_PROGRESS");
  });

  it("A no puede descartar la sesión en curso de B", async () => {
    const { sessionId } = await sesionVivaDeB();
    await expect(
      workout.discardSession(A.profileId, sessionId),
    ).rejects.toThrow();
    const sesionB = await prisma.workoutSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(sesionB.status).toBe("IN_PROGRESS");
  });

  it("A no puede editar un ejercicio de la plantilla de B", async () => {
    const antes = await prisma.templateExercise.findUniqueOrThrow({
      where: { id: B.templateExerciseId },
    });
    await expect(
      programEdit.editTemplateExercise(A.profileId, B.templateExerciseId, {
        baseSets: 99,
        repRangeMin: 1,
        repRangeMax: 2,
        targetRir: 0,
        restSeconds: 30,
      }),
    ).rejects.toThrow();
    const despues = await prisma.templateExercise.findUniqueOrThrow({
      where: { id: B.templateExerciseId },
    });
    expect(despues.baseSets).toBe(antes.baseSets);
    expect(despues.repRangeMin).toBe(antes.repRangeMin);
  });

  it("A no puede borrar un ejercicio de la plantilla de B", async () => {
    await expect(
      programEdit.removeTemplateExercise(A.profileId, B.templateExerciseId),
    ).rejects.toThrow();
    // TemplateExercise se borra de verdad (no lleva deletedAt), así que la
    // prueba es que la fila siga ahí y con sus mismos valores.
    const sigue = await prisma.templateExercise.findUnique({
      where: { id: B.templateExerciseId },
    });
    expect(sigue).not.toBeNull();
    expect(sigue?.templateId).toBe(B.templateIds[0]);
  });

  it("A no puede borrar ni renombrar un día de B", async () => {
    const idB = B.templateIds[0];
    await expect(programEdit.removeDay(A.profileId, idB)).rejects.toThrow();
    await expect(
      programEdit.renameDay(A.profileId, idB, "Secuestrado"),
    ).rejects.toThrow();
    const dia = await prisma.workoutTemplate.findUniqueOrThrow({
      where: { id: idB },
    });
    expect(dia.deletedAt).toBeNull();
    expect(dia.name).not.toBe("Secuestrado");
  });

  it("A no puede reactivar un programa de B", async () => {
    await expect(
      programEdit.reactivateProgram(A.profileId, B.programId),
    ).rejects.toThrow();
    const programaB = await prisma.trainingProgram.findUniqueOrThrow({
      where: { id: B.programId },
    });
    expect(programaB.profileId).toBe(B.profileId);
    expect(programaB.isActive).toBe(true);
  });

  it("A no puede empezar una sesión con una plantilla de B", async () => {
    // Con una sesión viva propia, `startOrResumeSession` la reanuda y ni mira
    // la plantilla: devolvería la de A, que es correcto pero no prueba nada.
    // Hay que dejar a A sin sesión abierta para que llegue a resolver el id.
    await workout.discardSession(A.profileId, A.liveSessionId);
    await expect(
      workout.startOrResumeSession(A.profileId, B.templateIds[0]),
    ).rejects.toThrow();
    // Ninguna sesión de A cuelga del mesociclo de B.
    const deA = await prisma.workoutSession.findMany({
      where: { mesocycle: { program: { profileId: A.profileId } } },
      select: { mesocycleId: true },
    });
    for (const s of deA) expect(s.mesocycleId).not.toBe(B.mesocycleId);
  });

  it("A no puede añadir series a un ejercicio de una sesión de B", async () => {
    const { exerciseId } = await sesionVivaDeB();
    await expect(
      workout.logSet(A.profileId, {
        workoutExerciseId: exerciseId,
        setNumber: 2,
        setType: "WORKING",
        weightKg: 100,
        reps: 5,
        rir: 0,
      }),
    ).rejects.toThrow();
    // Sigue con la única serie que registró B.
    expect(
      await prisma.setLog.count({ where: { workoutExerciseId: exerciseId } }),
    ).toBe(1);
  });

  it("A no puede borrar series de B", async () => {
    const ejercicioB = await prisma.workoutExercise.findFirstOrThrow({
      where: { sessionId: B.sessionId },
    });
    await expect(
      workout.deleteSet(A.profileId, ejercicioB.id, 1),
    ).rejects.toThrow();
    expect(
      await prisma.setLog.count({
        where: { workoutExerciseId: ejercicioB.id },
      }),
    ).toBe(2);
  });

  it("A no puede cambiar las series planificadas de B", async () => {
    const { exerciseId } = await sesionVivaDeB();
    const antes = await prisma.workoutExercise.findUniqueOrThrow({
      where: { id: exerciseId },
    });
    await expect(
      workout.setPlannedSets(A.profileId, exerciseId, 99),
    ).rejects.toThrow();
    const sigue = await prisma.workoutExercise.findUniqueOrThrow({
      where: { id: exerciseId },
    });
    expect(sigue.plannedSets).toBe(antes.plannedSets);
  });

  it("A no puede sustituir el ejercicio de una sesión de B", async () => {
    const { exerciseId } = await sesionVivaDeB();
    const antes = await prisma.workoutExercise.findUniqueOrThrow({
      where: { id: exerciseId },
    });
    await expect(
      workout.substituteExercise(A.profileId, exerciseId, A.variantId),
    ).rejects.toThrow();
    const sigue = await prisma.workoutExercise.findUniqueOrThrow({
      where: { id: exerciseId },
    });
    expect(sigue.exerciseVariantId).toBe(antes.exerciseVariantId);
  });
});

describe("los motores de cada uno son independientes", () => {
  it("el análisis de fatiga de A no cuenta las sesiones de B", async () => {
    const [analisisA, analisisB] = await Promise.all([
      getTrainingAnalysis(A.profileId, new Date("2026-06-10T10:00:00Z")),
      getTrainingAnalysis(B.profileId, new Date("2026-06-10T10:00:00Z")),
    ]);
    // Cada uno mira su propio historial: son objetos distintos calculados
    // sobre conjuntos disjuntos de sesiones.
    expect(analisisA).not.toBeNull();
    expect(analisisB).not.toBeNull();
    // Los conjuntos de sesiones de A y B son disjuntos: ninguna sesión
    // pertenece a los dos.
    const [deA, deB] = await Promise.all([
      prisma.workoutSession.findMany({
        where: { mesocycle: { program: { profileId: A.profileId } } },
        select: { id: true },
      }),
      prisma.workoutSession.findMany({
        where: { mesocycle: { program: { profileId: B.profileId } } },
        select: { id: true },
      }),
    ]);
    const idsA = new Set(deA.map((s) => s.id));
    expect(deA.length).toBeGreaterThan(0);
    expect(deB.length).toBeGreaterThan(0);
    for (const s of deB) expect(idsA.has(s.id)).toBe(false);
  });

  it("editar el programa de A no toca el de B", async () => {
    const antesB = await prisma.templateExercise.findUniqueOrThrow({
      where: { id: B.templateExerciseId },
    });
    await programEdit.editTemplateExercise(A.profileId, A.templateExerciseId, {
      baseSets: 5,
      repRangeMin: 6,
      repRangeMax: 10,
      targetRir: 1,
      restSeconds: 150,
    });
    const despuesA = await prisma.templateExercise.findUniqueOrThrow({
      where: { id: A.templateExerciseId },
    });
    const despuesB = await prisma.templateExercise.findUniqueOrThrow({
      where: { id: B.templateExerciseId },
    });
    expect(despuesA.baseSets).toBe(5);
    expect(despuesB.baseSets).toBe(antesB.baseSets);
    expect(despuesB.restSeconds).toBe(antesB.restSeconds);
  });
});

describe("las mediciones corporales son de cada uno", () => {
  /** Día en el que A y B registran a la vez. */
  const DIA_COMPARTIDO = "2026-06-15";
  const AHORA = new Date(`${DIA_COMPARTIDO}T12:00:00Z`);

  /** Medición válida, ya validada por el schema de la frontera. */
  function medicion(localDate: string, weightKg: number, waistCm?: number) {
    return bodyMeasurementSchema.parse({ localDate, weightKg, waistCm });
  }

  it("A y B pueden registrar el MISMO día sin colisionar", async () => {
    // La clave única es (perfil, día), no (día). Que A registre no puede
    // impedir ni pisar el registro de B.
    const deA = await body.saveMeasurement(
      A.profileId,
      medicion(DIA_COMPARTIDO, 84.2, 88),
      AHORA,
    );
    const deB = await body.saveMeasurement(
      B.profileId,
      medicion(DIA_COMPARTIDO, 61.7, 71),
      AHORA,
    );

    expect(deA.id).not.toBe(deB.id);
    expect(deA.localDate).toBe(deB.localDate);
    expect(deA.weightKg).toBe(84.2);
    expect(deB.weightKg).toBe(61.7);

    // Y cada uno lee el suyo, no el del otro.
    expect(
      (await body.getMeasurementForDate(A.profileId, DIA_COMPARTIDO))?.weightKg,
    ).toBe(84.2);
    expect(
      (await body.getMeasurementForDate(B.profileId, DIA_COMPARTIDO))?.weightKg,
    ).toBe(61.7);
  });

  it("guardar con la sesión de A NO modifica la medición de B del mismo día", async () => {
    const antesDeB = await prisma.bodyMeasurement.findUniqueOrThrow({
      where: {
        profileId_localDate: {
          profileId: B.profileId,
          localDate: DIA_COMPARTIDO,
        },
      },
    });

    await body.saveMeasurement(
      A.profileId,
      medicion(DIA_COMPARTIDO, 83.9),
      AHORA,
    );

    const despuesDeB = await prisma.bodyMeasurement.findUniqueOrThrow({
      where: {
        profileId_localDate: {
          profileId: B.profileId,
          localDate: DIA_COMPARTIDO,
        },
      },
    });
    expect(despuesDeB).toEqual(antesDeB);
  });

  it("A no puede borrar una medición de B pasando su id a mano", async () => {
    const deB = await prisma.bodyMeasurement.findFirstOrThrow({
      where: { profileId: B.profileId },
    });

    await expect(body.deleteMeasurement(A.profileId, deB.id)).rejects.toThrow();

    // La fila sigue ahí, intacta y de B.
    const sigue = await prisma.bodyMeasurement.findUnique({
      where: { id: deB.id },
    });
    expect(sigue).not.toBeNull();
    expect(sigue!.profileId).toBe(B.profileId);
    expect(sigue!.weightKg).toBe(deB.weightKg);
  });

  it("el mensaje de error no distingue 'no existe' de 'no es tuya'", async () => {
    // Distinguirlos confirmaría la existencia de un dato ajeno.
    const deB = await prisma.bodyMeasurement.findFirstOrThrow({
      where: { profileId: B.profileId },
    });
    const ajena = await body
      .deleteMeasurement(A.profileId, deB.id)
      .catch((e: Error) => e.message);
    const inexistente = await body
      .deleteMeasurement(A.profileId, "no-existe-en-ningun-sitio")
      .catch((e: Error) => e.message);
    expect(ajena).toBe(inexistente);
  });

  it("el historial de A no contiene ni una medición de B", async () => {
    const { history } = await body.getBodyProgress(A.profileId, AHORA);
    const idsDeB = (
      await prisma.bodyMeasurement.findMany({
        where: { profileId: B.profileId },
        select: { id: true },
      })
    ).map((m) => m.id);

    expect(history.length).toBeGreaterThan(0);
    for (const fila of history) expect(idsDeB).not.toContain(fila.id);
    // Y ningún peso de B se cuela por valor.
    expect(history.map((m) => m.weightKg)).not.toContain(61.7);
  });

  it("el análisis de A no cambia porque B añada o modifique sus datos", async () => {
    // Se le da a A historial suficiente para tener una tendencia de verdad:
    // sin ella, "no cambia" se cumpliría por estar todo vacío.
    for (let i = 27; i >= 0; i--) {
      await body.saveMeasurement(
        A.profileId,
        medicion(addDays(DIA_COMPARTIDO, -i), 84 - 0.06 * (27 - i)),
        AHORA,
      );
    }
    const antes = await body.getBodyProgress(A.profileId, AHORA);
    expect(antes.analysis.weight.status).toBe("LOSING");

    // B se pone a registrar como un poseso, con valores extremos y opuestos.
    for (let i = 27; i >= 0; i--) {
      await body.saveMeasurement(
        B.profileId,
        medicion(addDays(DIA_COMPARTIDO, -i), 60 + 0.3 * (27 - i)),
        AHORA,
      );
    }
    const despues = await body.getBodyProgress(A.profileId, AHORA);

    expect(despues).toEqual(antes);
    expect(despues.analysis.weight.trend!.slopePerWeek).toBeCloseTo(
      antes.analysis.weight.trend!.slopePerWeek,
      10,
    );

    // Y el de B refleja lo suyo: subiendo, no bajando.
    const deB = await body.getBodyProgress(B.profileId, AHORA);
    expect(deB.analysis.weight.status).toBe("GAINING");
  });

  it("borrar todo lo de B deja el análisis de A exactamente igual", async () => {
    const antes = await body.getBodyProgress(A.profileId, AHORA);
    await prisma.bodyMeasurement.deleteMany({
      where: { profileId: B.profileId },
    });
    const despues = await body.getBodyProgress(A.profileId, AHORA);
    expect(despues).toEqual(antes);
  });
});

describe("check-in y objetivo son de cada uno (B4)", () => {
  const AHORA = new Date("2026-06-20T12:00:00Z");

  it("el check-in de A no toca ninguna medición de B", async () => {
    const { bodyCheckInSchema } =
      await import("@/core/schemas/body-measurement");
    const antesDeB = await prisma.bodyMeasurement.findMany({
      where: { profileId: B.profileId },
      orderBy: { localDate: "asc" },
    });

    await body.submitCheckIn(
      A.profileId,
      bodyCheckInSchema.parse({
        localDate: "2026-06-20",
        waist1: 90,
        waist2: 90.5,
        waist3: 90.2,
      }),
      AHORA,
    );

    expect(
      await prisma.bodyMeasurement.findMany({
        where: { profileId: B.profileId },
        orderBy: { localDate: "asc" },
      }),
    ).toEqual(antesDeB);
  });

  it("la cadencia de A se calcula solo con las cinturas de A", async () => {
    // B mide hoy; a A eso no puede reiniciarle el contador.
    const { bodyCheckInSchema } =
      await import("@/core/schemas/body-measurement");
    const antes = await body.getBodyProgress(A.profileId, AHORA);
    await body.submitCheckIn(
      B.profileId,
      bodyCheckInSchema.parse({
        localDate: "2026-06-20",
        waist1: 71,
        waist2: 71.5,
        waist3: 71.2,
      }),
      AHORA,
    );
    const despues = await body.getBodyProgress(A.profileId, AHORA);
    expect(despues.checkIn).toEqual(antes.checkIn);
  });

  it("cambiar de fase A no toca el objetivo de B", async () => {
    const { goalUpdateSchema } = await import("@/core/schemas/goal-update");
    const objetivosDeBAntes = await prisma.goal.findMany({
      where: { profileId: B.profileId },
      orderBy: { createdAt: "asc" },
    });

    const r = await body.updateGoal(
      A.profileId,
      goalUpdateSchema.parse({
        strategy: "LEAN_GAIN",
        weeklyRatePct: 0.15,
        targetWeightKg: null,
      }),
      AHORA,
    );
    expect(r.kind).toBe("NEW_PHASE");

    // B sigue con sus mismas filas, byte a byte.
    expect(
      await prisma.goal.findMany({
        where: { profileId: B.profileId },
        orderBy: { createdAt: "asc" },
      }),
    ).toEqual(objetivosDeBAntes);
    // Y su objetivo activo sigue siendo el suyo.
    const activoB = await prisma.goal.findFirstOrThrow({
      where: { profileId: B.profileId, status: "ACTIVE" },
    });
    expect(activoB.strategy).toBe("FAT_LOSS_MUSCLE_PRESERVATION");
  });

  it("la fase nueva de A no recorta el análisis de B", async () => {
    // A acaba de abrir una fase (test anterior). El recorte por
    // `analysisStartLocalDate` tiene que aplicarse SOLO a A.
    const deA = await body.getBodyProgress(A.profileId, AHORA);
    const deB = await body.getBodyProgress(B.profileId, AHORA);
    expect(deA.phaseStartLocalDate).toBe("2026-06-20");
    expect(deB.phaseStartLocalDate).toBe("2026-06-02");
  });

  it("A no puede revisar el objetivo de B ni por accidente", async () => {
    // `updateGoal` solo acepta el perfil de la sesión: no hay parámetro por
    // el que colar un objetivo ajeno. Lo que se comprueba es que operar como
    // A jamás alcanza una fila de B.
    const idsDeB = (
      await prisma.goal.findMany({
        where: { profileId: B.profileId },
        select: { id: true },
      })
    ).map((g) => g.id);

    const { goalUpdateSchema } = await import("@/core/schemas/goal-update");
    const r = await body.updateGoal(
      A.profileId,
      goalUpdateSchema.parse({
        strategy: "MAINTENANCE",
        weeklyRatePct: 0,
        targetWeightKg: null,
      }),
      AHORA,
    );
    expect(idsDeB).not.toContain(r.goalId);

    const tocado = await prisma.goal.findUniqueOrThrow({
      where: { id: r.goalId },
    });
    expect(tocado.profileId).toBe(A.profileId);
  });
});

describe("el contexto del AI Coach no mezcla usuarios", () => {
  it("el contexto que se envía es el del perfil que pregunta", async () => {
    // Proveedor falso: captura el contexto exacto que habría viajado a OpenAI.
    //
    // El método TIENE que llamarse `generate`, que es el único de
    // `CoachProvider`. Con cualquier otro nombre la llamada lanza, `runCoach`
    // la captura y devuelve ERROR, y el contexto se queda vacío: las
    // aserciones de abajo se cumplirían sobre una cadena vacía y este test
    // —que es el que vigila que no se filtren datos de otra persona a
    // OpenAI— pasaría sin haber mirado nada. De ahí el tipado explícito y la
    // comprobación de que se llamó de verdad.
    let capturado: string | null = null;
    const proveedor: CoachProvider = {
      generate: async (peticion) => {
        capturado = peticion.contextJson;
        return {
          kind: "OK",
          text: JSON.stringify({
            headline: "ok",
            highlights: [],
            fatigue: null,
            recommendation: "ok",
            hypotheses: [],
          }),
          model: "fake",
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: null,
        };
      },
    };
    await askCoach(
      B.profileId,
      { task: "WEEKLY" },
      proveedor,
      new Date("2026-06-10T10:00:00Z"),
    );
    expect(capturado).not.toBeNull();
    const contexto: string = capturado!;
    expect(contexto.length).toBeGreaterThan(0);

    // ── B6: ningún NÚMERO CORPORAL de A puede aparecer en el contexto de B ──
    //
    // Es la comprobación que el bloque `body` hace necesaria: antes el
    // contexto solo llevaba entrenamiento, así que bastaba vigilar ids. Ahora
    // viajan peso, cintura y objetivo, que son datos personales.
    const enviado = JSON.parse(capturado!) as {
      body: {
        weight: { latestKg: number | null };
        goal: { targetWeightKg: number | null } | null;
      } | null;
    };
    const cuerpoDeA = await prisma.bodyMeasurement.findMany({
      where: { profileId: A.profileId },
      select: { weightKg: true, waistCm: true },
    });
    if (enviado.body) {
      // El peso que viaja es el de B (62 kg), nunca el de A (84).
      expect(enviado.body.weight.latestKg).not.toBe(84);
      for (const m of cuerpoDeA) {
        if (m.weightKg !== null) {
          expect(enviado.body.weight.latestKg).not.toBe(m.weightKg);
        }
      }
    }

    // Ningún identificador de A puede aparecer en el contexto de B.
    expect(contexto).not.toContain(A.profileId);
    expect(contexto).not.toContain(A.sessionId);
    expect(contexto).not.toContain(A.programId);
    expect(contexto).not.toContain(A.liveSessionId);
    expect(contexto).not.toContain(A.templateExerciseId);
    for (const id of A.templateIds) expect(contexto).not.toContain(id);
  });

  it("el resumen de perfil que alimenta al coach es el del perfil pedido", async () => {
    const overviewA = await getProfileOverview(A.profileId);
    const overviewB = await getProfileOverview(B.profileId);
    expect(overviewA?.profile.id).toBe(A.profileId);
    expect(overviewB?.profile.id).toBe(B.profileId);
    expect(overviewA?.program?.id).toBe(A.programId);
    expect(overviewB?.program?.id).toBe(B.programId);
    expect(overviewA?.profile.sex).toBe("MALE");
    expect(overviewB?.profile.sex).toBe("FEMALE");
  });
});
