"use server";

import { revalidatePath } from "next/cache";

import {
  customExerciseSchema,
  type CustomExerciseInput,
} from "@/core/schemas/custom-exercise";
import {
  exerciseNoteSchema,
  type ExerciseNoteInput,
} from "@/core/schemas/exercise-note";
import { requireProfileId } from "@/server/auth/current-user";
import {
  getBuilderVariant,
  type BuilderVariant,
} from "@/server/repositories/builder-catalog.repo";
import {
  createCustomExercise,
  deleteCustomExercise,
  DuplicateExerciseNameError,
  ExerciseInUseError,
} from "@/server/services/custom-exercise.service";
import {
  ExerciseNotVisibleError,
  saveExerciseNote,
} from "@/server/services/exercise-note.service";

export interface ExerciseActionResult {
  ok: boolean;
  error?: string;
}

/** Las páginas donde aparece un ejercicio del banco. */
function revalidateExercisePages() {
  revalidatePath("/train/exercises");
  revalidatePath("/program");
  revalidatePath("/program/new");
}

/**
 * Crea un ejercicio propio. Valida Zod → service, como el resto de acciones.
 *
 * Los errores esperables (nombre repetido) se devuelven con su mensaje: son
 * información útil para quien rellena el formulario, no un fallo del sistema.
 */
export async function createCustomExerciseAction(
  input: CustomExerciseInput,
): Promise<
  ExerciseActionResult & {
    exerciseId?: string;
    variantId?: string;
    /**
     * La fila lista para el picker del builder. Se devuelve aquí para que
     * crear un ejercicio y añadirlo al programa sea UN gesto: sin ella el
     * cliente tendría que recomponerla —incluido el RIR por defecto— y habría
     * dos implementaciones del mismo cálculo.
     */
    builderVariant?: BuilderVariant;
  }
> {
  const parsed = customExerciseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Ejercicio inválido.",
    };
  }
  try {
    const profileId = await requireProfileId();
    const created = await createCustomExercise(profileId, parsed.data);
    revalidateExercisePages();
    const builderVariant =
      (await getBuilderVariant(profileId, created.variantId)) ?? undefined;
    return { ok: true, ...created, builderVariant };
  } catch (error) {
    if (error instanceof DuplicateExerciseNameError) {
      return { ok: false, error: error.message };
    }
    console.error("createCustomExerciseAction", error);
    return { ok: false, error: "No se pudo crear el ejercicio." };
  }
}

/** Borra un ejercicio propio que no esté en uso. */
export async function deleteCustomExerciseAction(
  exerciseId: string,
): Promise<ExerciseActionResult> {
  try {
    const profileId = await requireProfileId();
    await deleteCustomExercise(profileId, exerciseId);
    revalidateExercisePages();
    return { ok: true };
  } catch (error) {
    if (error instanceof ExerciseInUseError) {
      return { ok: false, error: error.message };
    }
    console.error("deleteCustomExerciseAction", error);
    return { ok: false, error: "No se pudo borrar el ejercicio." };
  }
}

/**
 * Guarda la nota personal de una variante de ejercicio. Texto vacío = borrarla.
 *
 * Es la ruta ONLINE (biblioteca). Desde la sesión de entrenamiento la nota va
 * por la outbox (`syncWorkoutOpsAction`), que llama al MISMO servicio: la
 * validación y la guarda de propiedad son idénticas por las dos vías.
 *
 * Devuelve el texto guardado para que la interfaz pinte exactamente lo que hay
 * en la base (recortado por Zod), no lo que se tecleó.
 */
export async function saveExerciseNoteAction(
  input: ExerciseNoteInput,
): Promise<ExerciseActionResult & { text?: string | null }> {
  const parsed = exerciseNoteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Nota inválida.",
    };
  }
  try {
    const profileId = await requireProfileId();
    const { text } = await saveExerciseNote(profileId, parsed.data);
    revalidateExercisePages();
    return { ok: true, text };
  } catch (error) {
    if (error instanceof ExerciseNotVisibleError) {
      return { ok: false, error: error.message };
    }
    console.error("saveExerciseNoteAction", error);
    return { ok: false, error: "No se pudo guardar la nota." };
  }
}
