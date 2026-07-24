"use server";

import { revalidatePath } from "next/cache";

import {
  templateExerciseEditSchema,
  type TemplateExerciseEdit,
} from "@/core/schemas/template-edit";
import { requireProfileId } from "@/server/repositories/profile.repo";
import {
  addTemplateExercise,
  changeTemplateVariant,
  editTemplateExercise,
  removeTemplateExercise,
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

export async function restoreInitialProgramAction(): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await restoreInitialProgram(profileId);
    revalidatePath("/program");
    return { ok: true };
  } catch (error) {
    return fail("restoreInitialProgramAction", error);
  }
}
