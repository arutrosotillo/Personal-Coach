"use server";

import { revalidatePath } from "next/cache";

import {
  logSetSchema,
  sessionFeedbackSchema,
  type LogSetInput,
  type SessionFeedbackData,
} from "@/core/schemas/workout";
import { requireProfileId } from "@/server/repositories/profile.repo";
import {
  deleteSet,
  discardSession,
  finishSession,
  logSet,
  setPlannedSets,
  startOrResumeSession,
  substituteExercise,
} from "@/server/services/workout-session.service";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function startSessionAction(
  templateId: string,
): Promise<ActionResult & { sessionId?: string }> {
  try {
    const profileId = await requireProfileId();
    const { sessionId } = await startOrResumeSession(profileId, templateId);
    revalidatePath("/train");
    return { ok: true, sessionId };
  } catch (error) {
    console.error("startSessionAction", error);
    return { ok: false, error: "No se pudo iniciar la sesión." };
  }
}

export async function logSetAction(input: LogSetInput): Promise<ActionResult> {
  const parsed = logSetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }
  try {
    const profileId = await requireProfileId();
    await logSet(profileId, parsed.data);
    return { ok: true };
  } catch (error) {
    console.error("logSetAction", error);
    return { ok: false, error: "No se pudo guardar la serie." };
  }
}

export async function deleteSetAction(
  workoutExerciseId: string,
  setNumber: number,
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await deleteSet(profileId, workoutExerciseId, setNumber);
    return { ok: true };
  } catch (error) {
    console.error("deleteSetAction", error);
    return { ok: false, error: "No se pudo borrar la serie." };
  }
}

export async function setPlannedSetsAction(
  workoutExerciseId: string,
  plannedSets: number,
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await setPlannedSets(profileId, workoutExerciseId, plannedSets);
    return { ok: true };
  } catch (error) {
    console.error("setPlannedSetsAction", error);
    return { ok: false, error: "No se pudo ajustar las series." };
  }
}

export async function substituteExerciseAction(
  workoutExerciseId: string,
  newVariantId: string,
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await substituteExercise(profileId, workoutExerciseId, newVariantId);
    return { ok: true };
  } catch (error) {
    console.error("substituteExerciseAction", error);
    return { ok: false, error: "No se pudo sustituir el ejercicio." };
  }
}

export async function finishSessionAction(
  sessionId: string,
  feedback: SessionFeedbackData,
): Promise<ActionResult> {
  const parsed = sessionFeedbackSchema.safeParse(feedback);
  if (!parsed.success) return { ok: false, error: "Feedback inválido" };
  try {
    const profileId = await requireProfileId();
    await finishSession(profileId, sessionId, parsed.data);
    revalidatePath("/train");
    revalidatePath("/train/history");
    return { ok: true };
  } catch (error) {
    console.error("finishSessionAction", error);
    return { ok: false, error: "No se pudo finalizar la sesión." };
  }
}

export async function discardSessionAction(
  sessionId: string,
): Promise<ActionResult> {
  try {
    const profileId = await requireProfileId();
    await discardSession(profileId, sessionId);
    revalidatePath("/train");
    return { ok: true };
  } catch (error) {
    console.error("discardSessionAction", error);
    return { ok: false, error: "No se pudo descartar la sesión." };
  }
}
