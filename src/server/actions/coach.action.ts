"use server";

import { isCoachConfigured } from "@/ai/config";
import type { CoachResult } from "@/ai/types";
import {
  coachRequestSchema,
  type CoachRequestInput,
} from "@/core/schemas/coach";
import { askCoach } from "@/server/services/coach.service";

/**
 * Frontera de Coach AI. Todo pasa por Zod antes de llegar al servicio, y el
 * servicio es READ-ONLY: ninguna acción de esta capa escribe en la base de
 * datos ni revalida nada. Si la IA falla, la app sigue igual.
 */

export async function coachConfiguredAction(): Promise<boolean> {
  return isCoachConfigured();
}

export async function askCoachAction(
  input: CoachRequestInput,
): Promise<CoachResult> {
  const parsed = coachRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      task: "ASK",
      error: "NO_DATA",
      message:
        parsed.error.issues[0]?.message ?? "Petición no válida para el coach.",
      fallback: null,
    };
  }
  return askCoach({
    task: parsed.data.task,
    variantId: parsed.data.variantId ?? undefined,
    question: parsed.data.question ?? undefined,
  });
}
