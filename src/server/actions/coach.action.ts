"use server";

import { AI_CONFIG } from "@/ai/config";
import type { CoachResult } from "@/ai/types";
import {
  coachRequestSchema,
  type CoachRequestInput,
} from "@/core/schemas/coach";
import { requireProfileId, requireUser } from "@/server/auth/current-user";
import { askCoach } from "@/server/services/coach.service";

/**
 * Frontera de Coach AI. Todo pasa por Zod antes de llegar al servicio, y el
 * servicio es READ-ONLY: ninguna acción de esta capa escribe en la base de
 * datos ni revalida nada. Si la IA falla, la app sigue igual.
 */

/**
 * Ventana deslizante en memoria, POR USUARIO. Es un tope de gasto, no una
 * medida de seguridad: la clave de OpenAI la paga el dueño del servidor y sin
 * esto una pestaña abierta puede dispararla.
 *
 * Antes el contador era único para toda la app. Con varias cuentas eso
 * significaba que un familiar consumiendo su hora dejaba al resto sin coach.
 */
const callsByUser = new Map<string, number[]>();

function overRateLimit(userId: string, now: number): boolean {
  const cutoff = now - 60 * 60 * 1000;
  const calls = callsByUser.get(userId) ?? [];
  while (calls.length > 0 && calls[0] < cutoff) calls.shift();
  if (calls.length >= AI_CONFIG.maxCallsPerHour) {
    callsByUser.set(userId, calls);
    return true;
  }
  calls.push(now);
  callsByUser.set(userId, calls);
  return false;
}

export async function askCoachAction(
  input: CoachRequestInput,
): Promise<CoachResult> {
  const { userId } = await requireUser();
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
  if (overRateLimit(userId, Date.now())) {
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
    // El perfil se resuelve aquí dentro: un usuario recién creado que aún no ha
    // hecho el onboarding debe ver el mensaje de "todavía no hay perfil", no
    // una pantalla rota.
    const profileId = await requireProfileId();
    return await askCoach(profileId, {
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
