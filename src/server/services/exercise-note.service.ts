import type { ExerciseNoteInput } from "@/core/schemas/exercise-note";
import { prisma } from "@/server/db";
import { visibleExerciseWhere } from "@/server/repositories/exercise-library.repo";

/**
 * Notas personales del banco de ejercicios.
 *
 * Una nota por persona y ejercicio (`@@unique([profileId, exerciseId])`), así
 * que guardar es un upsert: la nota se edita en sitio y guardarla vacía la
 * borra. No hay historial de notas a propósito.
 */

/** Se intenta anotar un ejercicio que no existe o que es de otra persona. */
export class ExerciseNotVisibleError extends Error {
  constructor() {
    super("Ese ejercicio no existe o no es tuyo.");
    this.name = "ExerciseNotVisibleError";
  }
}

/**
 * Guarda (o borra, si el texto viene vacío) la nota de este perfil sobre este
 * ejercicio. Devuelve el texto que queda guardado, `null` si ya no hay nota.
 *
 * Comprueba la visibilidad ANTES de escribir: el catálogo global es de todos,
 * pero el ejercicio propio de otra persona no. Sin esta guarda, pasar a mano un
 * id ajeno crearía una fila que apunta a un ejercicio que quien la escribe no
 * puede ni ver.
 */
export async function saveExerciseNote(
  profileId: string,
  input: ExerciseNoteInput,
): Promise<{ text: string | null }> {
  const exercise = await prisma.exercise.findFirst({
    where: {
      id: input.exerciseId,
      deletedAt: null,
      ...visibleExerciseWhere(profileId),
    },
    select: { id: true },
  });
  if (!exercise) throw new ExerciseNotVisibleError();

  if (input.text === "") {
    // `deleteMany` y no `delete`: borrar una nota que no existe es el resultado
    // que se pide, no un error.
    await prisma.exerciseNote.deleteMany({
      where: { profileId, exerciseId: exercise.id },
    });
    return { text: null };
  }

  const saved = await prisma.exerciseNote.upsert({
    where: { profileId_exerciseId: { profileId, exerciseId: exercise.id } },
    create: { profileId, exerciseId: exercise.id, text: input.text },
    update: { text: input.text },
    select: { text: true },
  });
  return { text: saved.text };
}
