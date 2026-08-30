"use server";

import { revalidatePath } from "next/cache";

import {
  customExerciseSchema,
  type CustomExerciseInput,
} from "@/core/schemas/custom-exercise";
import { requireProfileId } from "@/server/auth/current-user";
import {
  createCustomExercise,
  deleteCustomExercise,
  DuplicateExerciseNameError,
  ExerciseInUseError,
} from "@/server/services/custom-exercise.service";

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
): Promise<ExerciseActionResult & { exerciseId?: string; variantId?: string }> {
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
    return { ok: true, ...created };
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
