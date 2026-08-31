import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";

/**
 * Notas personales del banco de ejercicios.
 *
 * Lo que se prueba aquí, y por lo que existe la tabla aparte, es que la nota es
 * DE SU DUEÑO: el catálogo del seed es compartido, así que dos personas pueden
 * anotar el mismo "Press banca" sin verse la nota. Se ataca por donde atacaría
 * alguien de verdad —pasando a mano el id de un ejercicio ajeno— y contra el
 * SERVICE, que es donde vive la comprobación de propiedad.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { saveExerciseNote, ExerciseNotVisibleError } =
  await import("@/server/services/exercise-note.service");
const { createCustomExercise, deleteCustomExercise } =
  await import("@/server/services/custom-exercise.service");
const { listLibrary } =
  await import("@/server/repositories/exercise-library.repo");
const { getExecutionSession } =
  await import("@/server/repositories/workout.repo");
const { startOrResumeSession } =
  await import("@/server/services/workout-session.service");

const BASE = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  trainingYears: 3,
  daysPerWeek: 3,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
  strategy: "LEAN_GAIN",
  dailySteps: 8000,
  workActivity: "SEDENTARY",
  balancedProgram: true,
  priorityMuscles: [],
} as const;

/** Perfil recién onboardado, con su programa listo. */
async function onboard(username: string): Promise<string> {
  const userId = await createTestUser(prisma, username);
  const result = await completeOnboarding(
    userId,
    onboardingSchema.parse(BASE),
    new Date("2026-07-14T10:00:00Z"),
  );
  return result.profileId;
}

/** Ejercicio GLOBAL del seed: el que ven todos. */
let sharedExerciseId: string;
let ana: string;
let bruno: string;

beforeAll(async () => {
  await runSeed(prisma);
  const exercise = await prisma.exercise.findFirstOrThrow({
    where: { name: "Press banca" },
    select: { id: true },
  });
  sharedExerciseId = exercise.id;
  ana = await onboard("ana");
  bruno = await onboard("bruno");
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("notas personales de ejercicio", () => {
  it("guarda la nota y la devuelve recortada", async () => {
    const saved = await saveExerciseNote(ana, {
      exerciseId: sharedExerciseId,
      text: "Piernas encogidas, no estiradas.",
    });
    expect(saved.text).toBe("Piernas encogidas, no estiradas.");

    const rows = await prisma.exerciseNote.findMany({
      where: { exerciseId: sharedExerciseId, profileId: ana },
    });
    expect(rows).toHaveLength(1);
  });

  it("guardar otra vez EDITA la nota, no acumula una segunda", async () => {
    await saveExerciseNote(ana, {
      exerciseId: sharedExerciseId,
      text: "Piernas encogidas.",
    });
    const saved = await saveExerciseNote(ana, {
      exerciseId: sharedExerciseId,
      text: "Piernas encogidas y omóplatos retraídos.",
    });
    expect(saved.text).toBe("Piernas encogidas y omóplatos retraídos.");

    const rows = await prisma.exerciseNote.findMany({
      where: { exerciseId: sharedExerciseId, profileId: ana },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe("Piernas encogidas y omóplatos retraídos.");
  });

  it("el catálogo es compartido pero la nota NO: cada uno ve la suya", async () => {
    await saveExerciseNote(ana, {
      exerciseId: sharedExerciseId,
      text: "Piernas encogidas.",
    });
    await saveExerciseNote(bruno, {
      exerciseId: sharedExerciseId,
      text: "Bajar más despacio.",
    });

    const deAna = await listLibrary(ana);
    const deBruno = await listLibrary(bruno);
    expect(deAna.find((e) => e.id === sharedExerciseId)?.note).toBe(
      "Piernas encogidas.",
    );
    expect(deBruno.find((e) => e.id === sharedExerciseId)?.note).toBe(
      "Bajar más despacio.",
    );
  });

  it("guardar el texto vacío borra la nota, y volver a borrarla no falla", async () => {
    await saveExerciseNote(bruno, {
      exerciseId: sharedExerciseId,
      text: "Nota que se va.",
    });
    const borrada = await saveExerciseNote(bruno, {
      exerciseId: sharedExerciseId,
      text: "",
    });
    expect(borrada.text).toBeNull();
    expect(
      await prisma.exerciseNote.count({
        where: { exerciseId: sharedExerciseId, profileId: bruno },
      }),
    ).toBe(0);

    // Idempotente: borrar lo que ya no está es el resultado que se pedía.
    const otraVez = await saveExerciseNote(bruno, {
      exerciseId: sharedExerciseId,
      text: "",
    });
    expect(otraVez.text).toBeNull();

    // La de Ana sigue donde estaba: borrar la propia no toca la ajena.
    const deAna = await listLibrary(ana);
    expect(deAna.find((e) => e.id === sharedExerciseId)?.note).not.toBeNull();
  });

  it("no se puede anotar el ejercicio propio de otra persona", async () => {
    const { exerciseId } = await createCustomExercise(ana, {
      name: "Máquina rara del gimnasio de Ana",
      movementPattern: "ISOLATION",
      systemicFatigue: 1,
      instructions: "",
      primaryMuscle: "BICEPS",
      secondaryMuscles: [],
      variantName: "Máquina",
      equipment: "MACHINE",
      loadStepKg: 2.5,
      repRangeMin: 8,
      repRangeMax: 12,
      restSeconds: 90,
      contraindications: [],
    });

    await expect(
      saveExerciseNote(bruno, { exerciseId, text: "Nota intrusa" }),
    ).rejects.toBeInstanceOf(ExerciseNotVisibleError);
    expect(await prisma.exerciseNote.count({ where: { exerciseId } })).toBe(0);

    // El dueño sí puede.
    const suya = await saveExerciseNote(ana, {
      exerciseId,
      text: "El asiento en el 4.",
    });
    expect(suya.text).toBe("El asiento en el 4.");
  });

  it("no se puede anotar un ejercicio que no existe", async () => {
    await expect(
      saveExerciseNote(ana, { exerciseId: "no-existe", text: "x" }),
    ).rejects.toBeInstanceOf(ExerciseNotVisibleError);
  });

  it("borrar un ejercicio propio se lleva su nota por cascada", async () => {
    const { exerciseId } = await createCustomExercise(ana, {
      name: "Ejercicio efímero de Ana",
      movementPattern: "ISOLATION",
      systemicFatigue: 1,
      instructions: "",
      primaryMuscle: "TRICEPS",
      secondaryMuscles: [],
      variantName: "Polea",
      equipment: "CABLE",
      loadStepKg: 2.5,
      repRangeMin: 10,
      repRangeMax: 15,
      restSeconds: 60,
      contraindications: [],
    });
    await saveExerciseNote(ana, { exerciseId, text: "Codos pegados." });

    await deleteCustomExercise(ana, exerciseId);
    expect(await prisma.exerciseNote.count({ where: { exerciseId } })).toBe(0);
  });

  it("la sesión en curso trae la nota de quien entrena, no la del vecino", async () => {
    // Un ejercicio cualquiera de la primera plantilla de Ana.
    const template = await prisma.workoutTemplate.findFirstOrThrow({
      where: { mesocycle: { program: { profileId: ana } } },
      orderBy: { ordinal: "asc" },
      include: {
        exercises: {
          orderBy: { ordinal: "asc" },
          include: { exerciseVariant: true },
        },
      },
    });
    const first = template.exercises[0];
    if (!first) throw new Error("La plantilla de Ana salió sin ejercicios.");
    const exerciseId = first.exerciseVariant.exerciseId;

    await saveExerciseNote(ana, { exerciseId, text: "Sin rebotar abajo." });
    await saveExerciseNote(bruno, { exerciseId, text: "Nota de Bruno." });

    const { sessionId } = await startOrResumeSession(ana, template.id);
    const session = await getExecutionSession(ana, sessionId);
    const inSession = session?.exercises.find(
      (e) => e.exerciseId === exerciseId,
    );
    expect(inSession?.note).toBe("Sin rebotar abajo.");
  });
});
