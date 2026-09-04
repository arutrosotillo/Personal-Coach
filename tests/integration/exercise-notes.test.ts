import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";

/**
 * Notas personales del banco de ejercicios.
 *
 * Dos invariantes, y la tabla existe por la primera:
 *
 *  1. La nota es DE SU DUEÑO. El catálogo del seed es compartido, así que dos
 *     personas pueden anotar el mismo "Press banca" sin verse la nota. Se ataca
 *     por donde atacaría alguien de verdad —pasando a mano el id de un
 *     ejercicio ajeno— y contra el SERVICE, que es donde vive la comprobación.
 *  2. La nota es de UNA VARIANTE. "Con el bloque azul en la espalda" es verdad
 *     en el press inclinado en máquina y mentira con mancuernas; anotar una
 *     variante no puede escribir en la de al lado.
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

/** La nota que la biblioteca muestra para una VARIANTE concreta. */
function notaEnBiblioteca(
  library: Awaited<ReturnType<typeof listLibrary>>,
  variantId: string,
): string | null | undefined {
  return library
    .flatMap((e) => e.variants)
    .find((v) => v.id === variantId)?.note;
}

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

/** Dos VARIANTES del MISMO ejercicio global del seed. */
let bancaBarra: string;
let bancaMaquina: string;
/** Una variante de otro ejercicio distinto, para el aislamiento entre familias. */
let sentadillaBarra: string;
let ana: string;
let bruno: string;

beforeAll(async () => {
  await runSeed(prisma);
  const banca = await prisma.exercise.findFirstOrThrow({
    where: { name: "Press banca" },
    include: { variants: true },
  });
  bancaBarra = banca.variants.find((v) => v.equipment === "BARBELL")!.id;
  bancaMaquina = banca.variants.find((v) => v.equipment === "MACHINE")!.id;
  const sentadilla = await prisma.exercise.findFirstOrThrow({
    where: { name: "Sentadilla trasera" },
    include: { variants: true },
  });
  sentadillaBarra = sentadilla.variants.find(
    (v) => v.equipment === "BARBELL",
  )!.id;
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
      exerciseVariantId: bancaBarra,
      text: "Piernas encogidas, no estiradas.",
    });
    expect(saved.text).toBe("Piernas encogidas, no estiradas.");

    const rows = await prisma.exerciseNote.findMany({
      where: { exerciseVariantId: bancaBarra, profileId: ana },
    });
    expect(rows).toHaveLength(1);
  });

  it("guardar otra vez EDITA la nota, no acumula una segunda", async () => {
    await saveExerciseNote(ana, {
      exerciseVariantId: bancaBarra,
      text: "Piernas encogidas.",
    });
    const saved = await saveExerciseNote(ana, {
      exerciseVariantId: bancaBarra,
      text: "Piernas encogidas y omóplatos retraídos.",
    });
    expect(saved.text).toBe("Piernas encogidas y omóplatos retraídos.");

    const rows = await prisma.exerciseNote.findMany({
      where: { exerciseVariantId: bancaBarra, profileId: ana },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe("Piernas encogidas y omóplatos retraídos.");
  });

  it("el catálogo es compartido pero la nota NO: cada uno ve la suya", async () => {
    await saveExerciseNote(ana, {
      exerciseVariantId: bancaBarra,
      text: "Piernas encogidas.",
    });
    await saveExerciseNote(bruno, {
      exerciseVariantId: bancaBarra,
      text: "Bajar más despacio.",
    });

    expect(notaEnBiblioteca(await listLibrary(ana), bancaBarra)).toBe(
      "Piernas encogidas.",
    );
    expect(notaEnBiblioteca(await listLibrary(bruno), bancaBarra)).toBe(
      "Bajar más despacio.",
    );
  });

  it("guardar el texto vacío borra la nota, y volver a borrarla no falla", async () => {
    await saveExerciseNote(bruno, {
      exerciseVariantId: bancaBarra,
      text: "Nota que se va.",
    });
    const borrada = await saveExerciseNote(bruno, {
      exerciseVariantId: bancaBarra,
      text: "",
    });
    expect(borrada.text).toBeNull();
    expect(
      await prisma.exerciseNote.count({
        where: { exerciseVariantId: bancaBarra, profileId: bruno },
      }),
    ).toBe(0);

    // Idempotente: borrar lo que ya no está es el resultado que se pedía.
    const otraVez = await saveExerciseNote(bruno, {
      exerciseVariantId: bancaBarra,
      text: "",
    });
    expect(otraVez.text).toBeNull();

    // La de Ana sigue donde estaba: borrar la propia no toca la ajena.
    expect(notaEnBiblioteca(await listLibrary(ana), bancaBarra)).not.toBeNull();
  });

  it("dos VARIANTES del mismo ejercicio son dos notas distintas", async () => {
    // El caso real: "con el bloque azul en la espalda" es una señal del montaje
    // de UNA máquina. Con la nota colgando del ejercicio, aparecía tal cual en
    // el press con mancuernas, donde no significa nada.
    await saveExerciseNote(ana, {
      exerciseVariantId: bancaMaquina,
      text: "Con el bloque azul en la espalda.",
    });
    await saveExerciseNote(ana, {
      exerciseVariantId: bancaBarra,
      text: "Omóplatos retraídos y pies firmes.",
    });

    const biblioteca = await listLibrary(ana);
    expect(notaEnBiblioteca(biblioteca, bancaMaquina)).toBe(
      "Con el bloque azul en la espalda.",
    );
    expect(notaEnBiblioteca(biblioteca, bancaBarra)).toBe(
      "Omóplatos retraídos y pies firmes.",
    );

    // Y borrar una no toca la otra.
    await saveExerciseNote(ana, {
      exerciseVariantId: bancaMaquina,
      text: "",
    });
    const despues = await listLibrary(ana);
    expect(notaEnBiblioteca(despues, bancaMaquina)).toBeNull();
    expect(notaEnBiblioteca(despues, bancaBarra)).toBe(
      "Omóplatos retraídos y pies firmes.",
    );
  });

  it("ejercicios distintos no comparten nota aunque se parezcan", async () => {
    await saveExerciseNote(ana, {
      exerciseVariantId: sentadillaBarra,
      text: "Abrir un poco más los pies y bajar controlado.",
    });
    const biblioteca = await listLibrary(ana);
    expect(notaEnBiblioteca(biblioteca, sentadillaBarra)).toBe(
      "Abrir un poco más los pies y bajar controlado.",
    );
    // La misma nota NO puede haber aterrizado en ninguna otra variante.
    const conEsaNota = biblioteca
      .flatMap((e) => e.variants)
      .filter((v) => v.note?.startsWith("Abrir un poco más"));
    expect(conEsaNota.map((v) => v.id)).toEqual([sentadillaBarra]);
  });

  it("no se puede anotar el ejercicio propio de otra persona", async () => {
    const { variantId } = await createCustomExercise(ana, {
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
      saveExerciseNote(bruno, {
        exerciseVariantId: variantId,
        text: "Nota intrusa",
      }),
    ).rejects.toBeInstanceOf(ExerciseNotVisibleError);
    expect(
      await prisma.exerciseNote.count({
        where: { exerciseVariantId: variantId },
      }),
    ).toBe(0);

    // El dueño sí puede.
    const suya = await saveExerciseNote(ana, {
      exerciseVariantId: variantId,
      text: "El asiento en el 4.",
    });
    expect(suya.text).toBe("El asiento en el 4.");
  });

  it("no se puede anotar un ejercicio que no existe", async () => {
    await expect(
      saveExerciseNote(ana, { exerciseVariantId: "no-existe", text: "x" }),
    ).rejects.toBeInstanceOf(ExerciseNotVisibleError);
  });

  it("borrar un ejercicio propio se lleva su nota por cascada", async () => {
    const { exerciseId, variantId } = await createCustomExercise(ana, {
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
    await saveExerciseNote(ana, {
      exerciseVariantId: variantId,
      text: "Codos pegados.",
    });

    await deleteCustomExercise(ana, exerciseId);
    expect(
      await prisma.exerciseNote.count({
        where: { exerciseVariantId: variantId },
      }),
    ).toBe(0);
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
    const variantId = first.exerciseVariantId;

    await saveExerciseNote(ana, {
      exerciseVariantId: variantId,
      text: "Sin rebotar abajo.",
    });
    await saveExerciseNote(bruno, {
      exerciseVariantId: variantId,
      text: "Nota de Bruno.",
    });

    const { sessionId } = await startOrResumeSession(ana, template.id);
    const session = await getExecutionSession(ana, sessionId);
    const inSession = session?.exercises.find((e) => e.variantId === variantId);
    expect(inSession?.note).toBe("Sin rebotar abajo.");
  });
});
