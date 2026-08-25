"use server";

import { revalidatePath } from "next/cache";

import { DEFAULT_TIMEZONE, addDays, toLocalDate } from "@/core/dates";
import {
  logSetSchema,
  sessionFeedbackSchema,
  type LogSetInput,
  type SessionFeedbackData,
} from "@/core/schemas/workout";
import { requireProfileId } from "@/server/repositories/profile.repo";
import {
  getExerciseHistorySummary,
  type ExerciseHistorySummary,
} from "@/server/services/progression.service";
import {
  deleteSet,
  discardSession,
  finishSession,
  logSet,
  SessionNotInProgressError,
  setPlannedSets,
  startOrResumeSession,
  substituteExercise,
} from "@/server/services/workout-session.service";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Ventana del mini-historial: ~8 semanas para responder "¿progreso reciente?". */
const HISTORY_WINDOW_DAYS = 56;

/** Mini-historial on-demand de una variante (drawer del ejercicio). */
export async function getExerciseHistoryAction(
  variantId: string,
): Promise<
  { ok: true; summary: ExerciseHistorySummary } | { ok: false; error: string }
> {
  try {
    const profileId = await requireProfileId();
    const since = addDays(
      toLocalDate(new Date(), DEFAULT_TIMEZONE),
      -HISTORY_WINDOW_DAYS,
    );
    const summary = await getExerciseHistorySummary(
      profileId,
      variantId,
      since,
    );
    return { ok: true, summary };
  } catch (error) {
    console.error("getExerciseHistoryAction", error);
    return { ok: false, error: "No se pudo cargar el historial." };
  }
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
    if (error instanceof SessionNotInProgressError) {
      return {
        ok: false,
        error: "Esa sesión ya no está en curso: no he podido borrar la serie.",
      };
    }
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
    // Si la sesión ya no estaba en curso, el feedback NO se ha guardado. Antes
    // se devolvía `ok` igualmente y el dato (fatiga, dolor, motivación) se
    // perdía sin que nadie se enterara. Reintentar no sirve: hay que decirlo.
    if (error instanceof SessionNotInProgressError) {
      return {
        ok: false,
        error:
          "Esta sesión ya se había cerrado en otro sitio, así que no he podido guardar tu valoración. Ábrela desde el historial si quieres revisarla.",
      };
    }
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
    if (error instanceof SessionNotInProgressError) {
      // Ya no está en curso: el resultado que el usuario quería (que no siga
      // abierta) ya se cumple, así que no es un error para él.
      revalidatePath("/train");
      return { ok: true };
    }
    console.error("discardSessionAction", error);
    return { ok: false, error: "No se pudo descartar la sesión." };
  }
}
