"use server";

import { revalidatePath } from "next/cache";

import {
  clearIntakeSchema,
  intakeSchema,
  type IntakeInput,
} from "@/core/schemas/intake";
import { requireProfileId } from "@/server/auth/current-user";
import {
  clearIntake,
  FutureIntakeError,
  saveIntake,
} from "@/server/services/intake.service";

/**
 * Registro de ingesta. Mismo patrón que el resto: validar con Zod → perfil
 * desde la SESIÓN → service → revalidar. Sin id ni perfil en la firma: la fila
 * es (perfil de la sesión, fecha).
 */

export interface IntakeActionResult {
  ok: boolean;
  error?: string;
}

function revalidate() {
  revalidatePath("/");
  revalidatePath("/progress");
}

export async function saveIntakeAction(
  input: IntakeInput,
): Promise<IntakeActionResult> {
  const parsed = intakeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Registro inválido.",
    };
  }
  try {
    const profileId = await requireProfileId();
    await saveIntake(profileId, parsed.data);
    revalidate();
    return { ok: true };
  } catch (error) {
    if (error instanceof FutureIntakeError) {
      return { ok: false, error: error.message };
    }
    console.error("saveIntakeAction", error);
    return { ok: false, error: "No se pudo guardar lo que has comido." };
  }
}

export async function clearIntakeAction(
  localDate: string,
): Promise<IntakeActionResult> {
  const parsed = clearIntakeSchema.safeParse({ localDate });
  if (!parsed.success) return { ok: false, error: "Fecha inválida." };
  try {
    const profileId = await requireProfileId();
    await clearIntake(profileId, parsed.data.localDate);
    revalidate();
    return { ok: true };
  } catch (error) {
    if (error instanceof FutureIntakeError) {
      return { ok: false, error: error.message };
    }
    console.error("clearIntakeAction", error);
    return { ok: false, error: "No se pudo borrar el registro." };
  }
}
