import type { ExerciseNoteInput } from "@/core/schemas/exercise-note";
import { prisma } from "@/server/db";
import { visibleExerciseWhere } from "@/server/repositories/exercise-library.repo";

/**
 * Notas personales del banco de ejercicios.
 *
 * Una nota por persona y VARIANTE (`@@unique([profileId, exerciseVariantId])`),
 * así que guardar es un upsert: la nota se edita en sitio y guardarla vacía la
 * borra. No hay historial de notas a propósito.
 *
 * La escritura es ABSOLUTA e IDEMPOTENTE —se manda el texto entero, no un
 * delta—, que es justo lo que necesita la outbox de la sesión para poder
 * reintentar un guardado sin cobertura tantas veces como haga falta sin
 * duplicar ni pisar nada (`src/lib/offline/sync-ops.ts`).
 */

/** Se intenta anotar un ejercicio que no existe o que es de otra persona. */
export class ExerciseNotVisibleError extends Error {
  constructor() {
    super("Ese ejercicio no existe o no es tuyo.");
    this.name = "ExerciseNotVisibleError";
  }
}

/**
 * Guarda (o borra, si el texto viene vacío) la nota de este perfil sobre esta
 * variante. Devuelve el texto que queda guardado, `null` si ya no hay nota.
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
  const variant = await prisma.exerciseVariant.findFirst({
    where: {
      id: input.exerciseVariantId,
      deletedAt: null,
      exercise: { deletedAt: null, ...visibleExerciseWhere(profileId) },
    },
    select: { id: true },
  });
  if (!variant) throw new ExerciseNotVisibleError();

  if (input.text === "") {
    // `deleteMany` y no `delete`: borrar una nota que no existe es el resultado
    // que se pide, no un error.
    await prisma.exerciseNote.deleteMany({
      where: { profileId, exerciseVariantId: variant.id },
    });
    return { text: null };
  }

  const saved = await prisma.exerciseNote.upsert({
    where: {
      profileId_exerciseVariantId: {
        profileId,
        exerciseVariantId: variant.id,
      },
    },
    create: { profileId, exerciseVariantId: variant.id, text: input.text },
    update: { text: input.text },
    select: { text: true },
  });
  return { text: saved.text };
}
