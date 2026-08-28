"use server";

import { revalidatePath } from "next/cache";

import {
  onboardingSchema,
  type OnboardingInput,
} from "@/core/schemas/onboarding";
import { requireUser } from "@/server/auth/current-user";
import { completeOnboarding } from "@/server/services/onboarding.service";

export interface OnboardingActionResult {
  ok: boolean;
  /** Errores de validación por campo (clave = path del campo). */
  fieldErrors?: Record<string, string>;
  error?: string;
}

export async function submitOnboarding(
  input: OnboardingInput,
): Promise<OnboardingActionResult> {
  const { userId } = await requireUser();
  // Frontera de confianza: SIEMPRE se re-valida en el servidor.
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  try {
    await completeOnboarding(userId, parsed.data);
  } catch (error) {
    console.error("Onboarding falló:", error);
    return {
      ok: false,
      error:
        error instanceof Error && error.message.includes("sesión en curso")
          ? error.message
          : "No se pudo crear el plan. No se ha guardado nada; inténtalo de nuevo.",
    };
  }

  revalidatePath("/");
  revalidatePath("/program");
  revalidatePath("/settings");
  return { ok: true };
}
