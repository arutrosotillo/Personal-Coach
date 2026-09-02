"use server";

import { revalidatePath } from "next/cache";

import type { GoalChangeKind } from "@/core/body";
import {
  bodyCheckInSchema,
  bodyMeasurementSchema,
  deleteBodyMeasurementSchema,
  quickWeightSchema,
  type BodyCheckInInput,
  type BodyMeasurementInput,
  type QuickWeightInput,
} from "@/core/schemas/body-measurement";
import {
  goalUpdateSchema,
  type GoalUpdateInput,
} from "@/core/schemas/goal-update";
import { requireProfileId } from "@/server/auth/current-user";
import {
  deleteMeasurement,
  FutureMeasurementError,
  MeasurementNotFoundError,
  NoActiveGoalError,
  saveMeasurement,
  saveWeight,
  submitCheckIn,
  updateGoal,
} from "@/server/services/body.service";

/**
 * Acciones del seguimiento corporal. Mismo patrón que el resto: validar con
 * Zod → resolver el perfil desde la SESIÓN → service → revalidar.
 *
 * El `profileId` sale siempre de `requireProfileId()`, que lo deriva de la
 * cookie. Ninguna de estas firmas lo acepta como argumento, ni directa ni
 * indirectamente: no hay forma de que un cliente elija sobre qué perfil
 * escribe.
 */

export interface BodyActionResult {
  ok: boolean;
  error?: string;
}

/** Las pantallas donde se ve una medición. */
function revalidateBodyPages() {
  revalidatePath("/progress");
  revalidatePath("/");
}

/**
 * Guarda la medición de un día (crea o actualiza).
 *
 * No recibe id: la medición se identifica por su FECHA, y el perfil lo pone el
 * servidor. Es lo que hace que esta escritura no tenga superficie IDOR.
 */
export async function saveBodyMeasurementAction(
  input: BodyMeasurementInput,
): Promise<BodyActionResult & { localDate?: string }> {
  const parsed = bodyMeasurementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Medición inválida.",
    };
  }
  try {
    const profileId = await requireProfileId();
    const saved = await saveMeasurement(profileId, parsed.data);
    revalidateBodyPages();
    return { ok: true, localDate: saved.localDate };
  } catch (error) {
    // Errores esperables: mensaje útil para quien rellena el formulario.
    if (error instanceof FutureMeasurementError) {
      return { ok: false, error: error.message };
    }
    console.error("saveBodyMeasurementAction", error);
    return { ok: false, error: "No se pudo guardar la medición." };
  }
}

/**
 * Entrada rápida de peso desde "Hoy". Toca EXCLUSIVAMENTE el peso: la cintura
 * y el % graso de ese mismo día se quedan como estaban.
 */
export async function saveQuickWeightAction(
  input: QuickWeightInput,
): Promise<BodyActionResult & { weightKg?: number }> {
  const parsed = quickWeightSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Peso inválido.",
    };
  }
  try {
    const profileId = await requireProfileId();
    const saved = await saveWeight(profileId, parsed.data);
    revalidateBodyPages();
    return { ok: true, weightKg: saved.weightKg ?? undefined };
  } catch (error) {
    if (error instanceof FutureMeasurementError) {
      return { ok: false, error: error.message };
    }
    console.error("saveQuickWeightAction", error);
    return { ok: false, error: "No se pudo guardar el peso." };
  }
}

/**
 * Borra una medición propia.
 *
 * ÚNICA acción que acepta un id del cliente. La propiedad se comprueba en el
 * service, dentro de la misma consulta que borra, y el mensaje de error es el
 * mismo tanto si la medición no existe como si es de otra persona: distinguir
 * los dos casos confirmaría la existencia de un dato ajeno.
 */
export async function deleteBodyMeasurementAction(
  id: string,
): Promise<BodyActionResult> {
  const parsed = deleteBodyMeasurementSchema.safeParse({ id });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Medición inválida.",
    };
  }
  try {
    const profileId = await requireProfileId();
    await deleteMeasurement(profileId, parsed.data.id);
    revalidateBodyPages();
    return { ok: true };
  } catch (error) {
    if (error instanceof MeasurementNotFoundError) {
      return { ok: false, error: error.message };
    }
    console.error("deleteBodyMeasurementAction", error);
    return { ok: false, error: "No se pudo borrar la medición." };
  }
}

/**
 * Guarda un check-in corporal (cintura de tres tomas + opcionales).
 *
 * Como el resto: sin `profileId` en la firma, sin id del cliente. Se identifica
 * por fecha y el perfil sale de la cookie.
 */
export async function submitCheckInAction(
  input: BodyCheckInInput,
): Promise<BodyActionResult & { waistCm?: number }> {
  const parsed = bodyCheckInSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check-in inválido.",
    };
  }
  try {
    const profileId = await requireProfileId();
    const saved = await submitCheckIn(profileId, parsed.data);
    revalidateBodyPages();
    return { ok: true, waistCm: saved.waistCm ?? undefined };
  } catch (error) {
    if (error instanceof FutureMeasurementError) {
      return { ok: false, error: error.message };
    }
    console.error("submitCheckInAction", error);
    return { ok: false, error: "No se pudo guardar el check-in." };
  }
}

/**
 * Revisa el objetivo. Devuelve QUÉ pasó para que la interfaz lo diga con
 * precisión: corregir el objetivo actual y empezar una fase nueva son cosas
 * distintas y tienen consecuencias distintas sobre la tendencia.
 */
export async function updateGoalAction(
  input: GoalUpdateInput,
): Promise<BodyActionResult & { kind?: GoalChangeKind }> {
  const parsed = goalUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Objetivo inválido.",
    };
  }
  try {
    const profileId = await requireProfileId();
    const result = await updateGoal(profileId, parsed.data);
    revalidateBodyPages();
    revalidatePath("/settings");
    return { ok: true, kind: result.kind };
  } catch (error) {
    if (error instanceof NoActiveGoalError) {
      return { ok: false, error: error.message };
    }
    console.error("updateGoalAction", error);
    return { ok: false, error: "No se pudo guardar el objetivo." };
  }
}
