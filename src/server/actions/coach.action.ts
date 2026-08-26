"use server";

import { AI_CONFIG } from "@/ai/config";
import type { CoachResult } from "@/ai/types";
import {
  coachRequestSchema,
  type CoachRequestInput,
} from "@/core/schemas/coach";
import { requireSession } from "@/server/auth/require-session";
import { askCoach } from "@/server/services/coach.service";

/**
 * Frontera de Coach AI. Todo pasa por Zod antes de llegar al servicio, y el
 * servicio es READ-ONLY: ninguna acción de esta capa escribe en la base de
 * datos ni revalida nada. Si la IA falla, la app sigue igual.
 */

/**
 * Ventana deslizante en memoria. La app no tiene login y se sirve por LAN, así
 * que sin esto cualquiera en la wifi tiene un proxy a OpenAI facturado al
 * dueño. No pretende ser seguridad: es un tope de gasto.
 */
const calls: number[] = [];

function overRateLimit(now: number): boolean {
  const cutoff = now - 60 * 60 * 1000;
  while (calls.length > 0 && calls[0] < cutoff) calls.shift();
  if (calls.length >= AI_CONFIG.maxCallsPerHour) return true;
  calls.push(now);
  return false;
}

export async function askCoachAction(
  input: CoachRequestInput,
): Promise<CoachResult> {
  await requireSession();
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
  if (overRateLimit(Date.now())) {
    return {
      ok: false,
      task: parsed.data.task,
      error: "RATE_LIMIT",
      message: `Has hecho ${AI_CONFIG.maxCallsPerHour} consultas en la última hora. Espera un poco.`,
      fallback: null,
    };
  }

  // Nada que ocurra aquí puede tumbar la pantalla: si algo falla (base de
  // datos, proveedor, lo que sea), el usuario ve un estado controlado.
  try {
    return await askCoach({
      task: parsed.data.task,
      variantId: parsed.data.variantId ?? undefined,
      question: parsed.data.question ?? undefined,
    });
  } catch {
    return {
      ok: false,
      task: parsed.data.task,
      error: "PROVIDER_ERROR",
      message: "El coach no está disponible ahora mismo.",
      fallback: null,
    };
  }
}
