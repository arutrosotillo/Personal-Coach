"use server";

import { revalidatePath } from "next/cache";

import {
  cycleCloseSchema,
  cyclePlanSchema,
  cycleStartSchema,
  type CycleCloseInput,
  type CyclePlanRequestInput,
  type CycleStartInput,
} from "@/core/schemas/cycle";
import { requireProfileId } from "@/server/auth/current-user";
import {
  closeCycle,
  CloseOutcomeRequiredError,
  CycleNotFoundError,
  MissingProfileDataError,
  previewCyclePlan,
  StaleCycleError,
  StalePlanError,
  startCycle,
  type CyclePlanPreview,
} from "@/server/services/cycle.service";

/**
 * Acciones de ciclos. Validar con Zod → perfil desde la SESIÓN → service →
 * revalidar. Cerrar y empezar son decisiones explícitas de la persona: estas
 * son las únicas vías para cambiar de ciclo, y ninguna se llama sola.
 */

export interface CycleActionResult {
  ok: boolean;
  error?: string;
  /** El plan cambió (llegó un dato nuevo): hay que enseñarlo antes de confirmar. */
  stalePlan?: boolean;
}

function revalidateCyclePages() {
  revalidatePath("/");
  revalidatePath("/progress");
  revalidatePath("/progress/cycle");
  revalidatePath("/progress/cycles");
  revalidatePath("/program");
  revalidatePath("/settings");
}

function expectedErrors(error: unknown): CycleActionResult | null {
  if (error instanceof StalePlanError) {
    return { ok: false, error: error.message, stalePlan: true };
  }
  if (
    error instanceof StaleCycleError ||
    error instanceof CycleNotFoundError ||
    error instanceof CloseOutcomeRequiredError ||
    error instanceof MissingProfileDataError
  ) {
    return { ok: false, error: error.message };
  }
  return null;
}

/** Calcula el plan de un ciclo nuevo. No guarda nada. */
export async function previewCyclePlanAction(
  input: CyclePlanRequestInput,
): Promise<CycleActionResult & { preview?: CyclePlanPreview }> {
  const parsed = cyclePlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  try {
    const profileId = await requireProfileId();
    return {
      ok: true,
      preview: await previewCyclePlan(profileId, parsed.data),
    };
  } catch (error) {
    const known = expectedErrors(error);
    if (known) return known;
    console.error("previewCyclePlanAction", error);
    return { ok: false, error: "No se pudo calcular la propuesta." };
  }
}

export async function startCycleAction(
  input: CycleStartInput,
): Promise<CycleActionResult & { goalId?: string; duplicate?: boolean }> {
  const parsed = cycleStartSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  try {
    const profileId = await requireProfileId();
    const result = await startCycle(profileId, parsed.data);
    revalidateCyclePages();
    return { ok: true, goalId: result.goalId, duplicate: result.duplicate };
  } catch (error) {
    const known = expectedErrors(error);
    if (known) return known;
    console.error("startCycleAction", error);
    return {
      ok: false,
      error: "No se pudo empezar el ciclo. No se ha cambiado nada.",
    };
  }
}

export async function closeCycleAction(
  input: CycleCloseInput,
): Promise<CycleActionResult & { alreadyClosed?: boolean }> {
  const parsed = cycleCloseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  try {
    const profileId = await requireProfileId();
    const result = await closeCycle(profileId, parsed.data);
    revalidateCyclePages();
    return { ok: true, alreadyClosed: result.alreadyClosed };
  } catch (error) {
    const known = expectedErrors(error);
    if (known) return known;
    console.error("closeCycleAction", error);
    return {
      ok: false,
      error: "No se pudo cerrar el ciclo. No se ha cambiado nada.",
    };
  }
}
