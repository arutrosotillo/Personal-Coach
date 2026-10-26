"use server";

import { revalidatePath } from "next/cache";

import {
  gymChangeCreateSchema,
  gymChangeSchema,
  type GymChangeCreateInput,
  type GymChangeInput,
} from "@/core/schemas/gym-change";
import { requireProfileId } from "@/server/auth/current-user";
import {
  deleteGymChange,
  GymChangeError,
  registerGymChange,
  updateGymChange,
} from "@/server/services/equipment-change.service";

export interface GymChangeActionResult {
  ok: boolean;
  error?: string;
  eventId?: string;
}

/**
 * Lo que cambia con un cambio de gimnasio: las sugerencias de la sesión y de
 * `/train`, la tarjeta de recuperación, el historial y el resumen del ciclo.
 */
function revalidateTraining() {
  revalidatePath("/program");
  revalidatePath("/train");
  revalidatePath("/progress");
  revalidatePath("/coach");
  revalidatePath("/");
}

function fail(context: string, error: unknown): GymChangeActionResult {
  if (error instanceof GymChangeError)
    return { ok: false, error: error.message };
  console.error(context, error);
  return { ok: false, error: "No se pudo guardar el cambio de gimnasio." };
}

/** Registra un cambio de gimnasio. Valida Zod → service → revalidate. */
export async function registerGymChangeAction(
  input: GymChangeCreateInput,
): Promise<GymChangeActionResult> {
  const parsed = gymChangeCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  try {
    const profileId = await requireProfileId();
    const { eventId } = await registerGymChange(profileId, parsed.data);
    revalidateTraining();
    return { ok: true, eventId };
  } catch (error) {
    return fail("registerGymChangeAction", error);
  }
}

export async function updateGymChangeAction(
  eventId: string,
  input: GymChangeInput,
): Promise<GymChangeActionResult> {
  const parsed = gymChangeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  try {
    const profileId = await requireProfileId();
    await updateGymChange(profileId, eventId, parsed.data);
    revalidateTraining();
    return { ok: true, eventId };
  } catch (error) {
    return fail("updateGymChangeAction", error);
  }
}

export async function deleteGymChangeAction(
  eventId: string,
): Promise<GymChangeActionResult> {
  try {
    const profileId = await requireProfileId();
    await deleteGymChange(profileId, eventId);
    revalidateTraining();
    return { ok: true };
  } catch (error) {
    return fail("deleteGymChangeAction", error);
  }
}
