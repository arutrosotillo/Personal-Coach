"use server";

import { revalidatePath } from "next/cache";

import {
  calorieAdjustmentAnswerSchema,
  type CalorieAdjustmentAnswerInput,
} from "@/core/schemas/calorie-adjustment";
import { requireProfileId } from "@/server/auth/current-user";
import {
  resolveCalorieAdjustment,
  StaleAdjustmentError,
} from "@/server/services/nutrition-adjustment.service";

/**
 * Aceptar o descartar el ajuste calórico sugerido. Validar con Zod → perfil
 * desde la SESIÓN → service (que recalcula) → revalidar.
 */
export async function answerCalorieAdjustmentAction(
  input: CalorieAdjustmentAnswerInput,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = calorieAdjustmentAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Respuesta inválida." };
  }
  try {
    const profileId = await requireProfileId();
    await resolveCalorieAdjustment(profileId, parsed.data);
    revalidatePath("/progress");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    if (error instanceof StaleAdjustmentError) {
      revalidatePath("/progress");
      return { ok: false, error: error.message };
    }
    console.error("answerCalorieAdjustmentAction", error);
    return { ok: false, error: "No se pudo guardar tu respuesta." };
  }
}
