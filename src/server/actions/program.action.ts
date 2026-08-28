"use server";

import { revalidatePath } from "next/cache";

import {
  manualProgramSchema,
  type ManualProgramInput,
} from "@/core/schemas/manual-program";
import {
  templateExerciseEditSchema,
  type TemplateExerciseEdit,
} from "@/core/schemas/template-edit";
import { requireProfileId } from "@/server/auth/current-user";
import { createManualProgram } from "@/server/services/manual-program.service";
import {
  addDay,
  addTemplateExercise,
  changeTemplateVariant,
  editTemplateExercise,
  reactivateProgram,
  removeDay,
  removeTemplateExercise,
  renameDay,
  reorderDay,
  reorderTemplateExercise,
  restoreInitialProgram,
} from "@/server/services/program-edit.service";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function fail(context: string, error: unknown): ActionResult {
  console.error(context, error);
  return { ok: false, error: "No se pudo guardar el cambio del programa." };
}

/** Crea un programa manual (archiva el activo previo). Valida Zod → service. */
export async function createManualProgramAction(
  input: ManualProgramInput,
): Promise<ActionResult & { programId?: string }> {
  const parsed = manualProgramSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Programa inválido.",
    };
  }
  try {
    const profileId = await requireProfileId();
    const { programId } = await createManualProgram(profileId, parsed.data);
    revalidatePath("/program");
    revalidatePath("/train");
    return { ok: true, programId };
  } catch (error) {
    console.error("createManualProgramAction", error);
    const message =
      error instanceof Error &&
      (error.message.includes("disponible") ||
        error.message.includes("sesión en curso"))
        ? error.message
        : "No se pudo crear el programa.";
    return { ok: false, error: message };
  }
}

export async function editTemplateExerciseAction(
  templateExerciseId: string,
  edit: TemplateExerciseEdit,
): Promise<ActionResult> {
  try {
    const parsed = templateExerciseEditSchema.safeParse(edit);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Valores inválidos.",
      };
    }
    const profileId = await requireProfileId();
    await editTemplateExercise(profileId, templateExerciseId, parsed.data);
    revalidatePath("/program");
    return { ok: true };
  } catch (error) {
    return fail("editTemplateExerciseAction", error);
  }
}

export async function changeTemplateVariantAction(
  templateExerciseId: string,
  newVariantId: string,
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await changeTemplateVariant(profileId, templateExerciseId, newVariantId);
    revalidatePath("/program");
    return { ok: true };
  } catch (error) {
    return fail("changeTemplateVariantAction", error);
  }
}

export async function reorderTemplateExerciseAction(
  templateExerciseId: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await reorderTemplateExercise(profileId, templateExerciseId, direction);
    revalidatePath("/program");
    return { ok: true };
  } catch (error) {
    return fail("reorderTemplateExerciseAction", error);
  }
}

export async function removeTemplateExerciseAction(
  templateExerciseId: string,
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await removeTemplateExercise(profileId, templateExerciseId);
    revalidatePath("/program");
    return { ok: true };
  } catch (error) {
    return fail("removeTemplateExerciseAction", error);
  }
}

export async function addTemplateExerciseAction(
  templateId: string,
  variantId: string,
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await addTemplateExercise(profileId, templateId, variantId);
    revalidatePath("/program");
    return { ok: true };
  } catch (error) {
    return fail("addTemplateExerciseAction", error);
  }
}

export async function addDayAction(
  name: string,
  firstVariantId: string,
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await addDay(profileId, name, firstVariantId);
    revalidatePath("/program");
    return { ok: true };
  } catch (error) {
    return fail("addDayAction", error);
  }
}

export async function renameDayAction(
  templateId: string,
  name: string,
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await renameDay(profileId, templateId, name);
    revalidatePath("/program");
    return { ok: true };
  } catch (error) {
    return fail("renameDayAction", error);
  }
}

export async function removeDayAction(
  templateId: string,
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await removeDay(profileId, templateId);
    revalidatePath("/program");
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("al menos un día")
        ? error.message
        : "No se pudo eliminar el día.";
    console.error("removeDayAction", error);
    return { ok: false, error: message };
  }
}

export async function reorderDayAction(
  templateId: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await reorderDay(profileId, templateId, direction);
    revalidatePath("/program");
    return { ok: true };
  } catch (error) {
    return fail("reorderDayAction", error);
  }
}

export async function reactivateProgramAction(
  programId: string,
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await reactivateProgram(profileId, programId);
    revalidatePath("/program");
    revalidatePath("/program/history");
    revalidatePath("/train");
    return { ok: true };
  } catch (error) {
    console.error("reactivateProgramAction", error);
    const message =
      error instanceof Error && error.message.includes("sesión en curso")
        ? error.message
        : "No se pudo reactivar el programa.";
    return { ok: false, error: message };
  }
}

export async function restoreInitialProgramAction(): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await restoreInitialProgram(profileId);
    revalidatePath("/program");
    return { ok: true };
  } catch (error) {
    console.error("restoreInitialProgramAction", error);
    const message =
      error instanceof Error && error.message.includes("manual")
        ? error.message
        : "No se pudo restaurar el programa.";
    return { ok: false, error: message };
  }
}
