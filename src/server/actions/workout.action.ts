"use server";

import { revalidatePath } from "next/cache";

import { DEFAULT_TIMEZONE, addDays, toLocalDate } from "@/core/dates";
import { syncBatchSchema, type SyncBatchInput } from "@/core/schemas/workout";
import { requireProfileId } from "@/server/auth/current-user";
import {
  getExerciseHistorySummary,
  type ExerciseHistorySummary,
} from "@/server/services/progression.service";
import {
  applySyncOps,
  deleteSet,
  discardSession,
  EmptyTemplateError,
  SessionAlreadyCompletedError,
  SessionNotInProgressError,
  startOrResumeSession,
  substituteExercise,
  type SyncOutcome,
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
    // Este sí es accionable por el usuario: dile qué pasa.
    if (error instanceof EmptyTemplateError) {
      return { ok: false, error: error.message };
    }
    console.error("startSessionAction", error);
    return { ok: false, error: "No se pudo iniciar la sesión." };
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

/**
 * ÚNICA vía de escritura de la sesión en curso: aplica en orden el lote de
 * operaciones que la cola del cliente tenía pendientes.
 *
 * Es una sola acción y no una por gesto porque el cliente ya no escribe cuando
 * el usuario toca: escribe en el móvil y sincroniza cuando puede. Con buena
 * cobertura el lote sale con una sola operación, en el acto, y se comporta
 * igual que antes; sin cobertura, sale con quince media hora después.
 */
export interface SyncResult extends ActionResult {
  outcome?: SyncOutcome;
}

export async function syncWorkoutOpsAction(
  input: SyncBatchInput,
): Promise<SyncResult> {
  const parsed = syncBatchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos",
    };
  }
  let outcome: SyncOutcome;
  try {
    const profileId = await requireProfileId();
    outcome = await applySyncOps(
      profileId,
      parsed.data.sessionId,
      parsed.data.ops,
    );
  } catch (error) {
    // Aquí NO se distingue entre "la base de datos está caída" y cualquier otra
    // cosa: se devuelve un fallo sin más y la cola conserva TODO lo pendiente.
    // Descartar el trabajo de alguien por un error que no entendemos es
    // exactamente lo que esta capa existe para no hacer.
    console.error("syncWorkoutOpsAction", error);
    return { ok: false, error: "No se pudo sincronizar." };
  }
  // FUERA del try: lo que se haya escrito ya está escrito. Si `revalidatePath`
  // fallara dentro, se reportaría un fallo de sincronización habiendo
  // sincronizado, y la cola reintentaría para siempre.
  if (outcome.finished) {
    revalidatePath("/train");
    revalidatePath("/train/history");
  }
  return { ok: true, outcome };
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
    if (error instanceof SessionAlreadyCompletedError) {
      // El usuario confirmó "se perderán N series, no se puede deshacer" y la
      // sesión sigue en el historial contando. Decírselo.
      revalidatePath("/train");
      return {
        ok: false,
        error:
          "Esa sesión ya se había terminado, así que no la he descartado: sigue en tu historial.",
      };
    }
    if (error instanceof SessionNotInProgressError) {
      // Ya estaba descartada: lo que el usuario quería ya se cumple.
      revalidatePath("/train");
      return { ok: true };
    }
    console.error("discardSessionAction", error);
    return { ok: false, error: "No se pudo descartar la sesión." };
  }
}
