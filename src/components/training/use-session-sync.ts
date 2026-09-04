"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { NotesMap, RowsMap } from "@/lib/offline/session-snapshot";
import {
  browserStorage,
  createSnapshotStore,
} from "@/lib/offline/session-storage";
import { SYNC } from "@/lib/offline/sync-config";
import {
  backoffMs,
  emptyOutbox,
  enqueue,
  FINISH_OP_KEY,
  isDegraded,
  markTransportFailure,
  noteOpKey,
  pendingCount,
  pendingNoteVariantIds,
  plannedOpKey,
  settle,
  setOpKey,
  type FinishOpPayload,
  type LogSetOpPayload,
  type Outbox,
  type PlannedSetsOpPayload,
  type SaveNoteOpPayload,
} from "@/lib/offline/sync-ops";
import { syncWorkoutOpsAction } from "@/server/actions/workout.action";

/**
 * El motor local-first de la sesión de entrenamiento.
 *
 * Lo que hace en una frase: el usuario escribe en el móvil y el servidor se
 * entera cuando puede. Nada de lo que ve en pantalla depende de que una
 * escritura haya llegado, y nada pendiente se descarta jamás por un fallo de
 * red.
 *
 * Lo que NO hace, a propósito: bloquear la interfaz. No hay `useTransition`
 * aquí. El `pending` compartido que había antes desactivaba TODOS los botones
 * "Completar" mientras volaba una escritura, así que con la cobertura de un
 * gimnasio la lista entera se congelaba veinte segundos por serie.
 */

export type SyncPhase =
  /** Todo lo registrado está en el servidor. */
  | "saved"
  /** Hay un lote en vuelo ahora mismo. */
  | "syncing"
  /** Hay cambios guardados solo en el móvil. Lo normal en un sótano. */
  | "offline"
  /** Llevamos demasiado rato fallando: esto ya no parece el gimnasio. */
  | "degraded";

export interface SessionSync {
  phase: SyncPhase;
  pending: number;
  /**
   * ¿Respondió el servidor la última vez que se le habló? Es la ÚNICA señal de
   * conectividad que se usa para decidir algo. `navigator.onLine` solo dice que
   * hay una interfaz de red levantada: dentro de un gimnasio con una barra de
   * cobertura vale `true` mientras nada llega a ninguna parte.
   */
  reachable: boolean;
  /** El usuario ya pulsó "Guardar y finalizar" (con o sin cobertura). */
  finishedLocally: boolean;
  /** Variantes con la nota escrita aquí y todavía no confirmada por el servidor. */
  pendingNotes: Set<string>;
  queueSet: (payload: LogSetOpPayload) => void;
  queuePlanned: (payload: PlannedSetsOpPayload) => void;
  /** Guarda la nota de una variante. Local al instante, servidor cuando pueda. */
  queueNote: (payload: SaveNoteOpPayload) => void;
  queueFinish: (feedback: Omit<FinishOpPayload, "token">) => void;
}

/** Token de idempotencia del cierre. `randomUUID` no existe en contextos no seguros. */
function newToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function useSessionSync(options: {
  sessionId: string;
  /**
   * Lo que había guardado en este móvil, o `null` mientras todavía no se ha
   * leído. Llega DESPUÉS del primer render a propósito: el servidor no puede
   * saber qué hay en el `localStorage` de nadie, así que leerlo durante el
   * render provocaba un error de hidratación en cada recarga sin cobertura.
   */
  restored: { outbox: Outbox; finishedLocally: boolean } | null;
  /** Estado de pantalla que hay que poder recuperar tras recargar. */
  rows: RowsMap;
  notes: NotesMap;
  variantByExercise: Record<string, string>;
  current: number;
  restEndsAt: number | null;
  /** Se llama UNA vez, cuando el cierre llega de verdad al servidor. */
  onFinishSynced: (result: { deload: boolean }) => void;
}): SessionSync {
  const {
    sessionId,
    restored,
    rows,
    notes,
    variantByExercise,
    current,
    restEndsAt,
    onFinishSynced,
  } = options;

  const [outbox, setOutbox] = useState<Outbox>(emptyOutbox);
  const [finishedLocally, setFinishedLocally] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [reachable, setReachable] = useState(true);
  /** El cierre ya está en el servidor: deja de haber nada que guardar aquí. */
  const [archived, setArchived] = useState(false);

  // El almacén se crea una vez. `useState` con inicializador perezoso y no
  // `useRef`: el compilador de React prohíbe leer una ref durante el render.
  const [store] = useState(() => createSnapshotStore(browserStorage()));
  /** Un solo lote en vuelo. Solo se lee dentro de callbacks, nunca al renderizar. */
  const flushingRef = useRef(false);
  const finishRef = useRef(onFinishSynced);

  const adoptedRef = useRef(false);

  useEffect(() => {
    finishRef.current = onFinishSynced;
  }, [onFinishSynced]);

  // Adopta la cola recuperada del móvil, una sola vez.
  useEffect(() => {
    if (adoptedRef.current || !restored) return;
    adoptedRef.current = true;
    setOutbox(restored.outbox);
    setFinishedLocally(restored.finishedLocally);
  }, [restored]);

  // ---------------------------------------------------------------- snapshot
  //
  // Se escribe en CADA cambio, sin debounce. Hubo uno de 300 ms y era una
  // ventana real de pérdida de datos: entre tocar "Completar" y volcar el
  // cuaderno, ni el servidor ni el móvil tenían esa serie. Un `pagehide`
  // tapaba el caso de recargar, pero iOS mata la PWA sin avisar y ahí no hay
  // ningún evento que valga. `localStorage` es síncrono y esto son unos pocos
  // kilobytes: cuando `setItem` vuelve, está escrito, y punto.
  useEffect(() => {
    // Antes de haber leído el cuaderno no se escribe en él: se borraría lo
    // guardado con el estado que acaba de venir del servidor. Y después de que
    // el cierre esté confirmado tampoco: ya no hay sesión que recuperar y
    // dejarlo ahí solo acumularía basura en el navegador.
    if (!restored || archived) return;
    store.write({
      version: SYNC.SNAPSHOT_VERSION,
      sessionId,
      rows,
      notes,
      variantByExercise,
      current,
      restEndsAt,
      finishedLocally,
      outbox,
      savedAt: Date.now(),
    });
  }, [
    store,
    restored,
    archived,
    sessionId,
    rows,
    notes,
    variantByExercise,
    current,
    restEndsAt,
    finishedLocally,
    outbox,
  ]);

  // ------------------------------------------------------------------- flush
  const flush = useCallback(
    async (current: Outbox) => {
      if (flushingRef.current) return; // un solo lote en vuelo: nunca dos
      const ops = current.ops;
      if (ops.length === 0) return;
      flushingRef.current = true;
      setFlushing(true);
      try {
        const outcome = await withTimeout(
          syncWorkoutOpsAction({
            sessionId,
            ops: ops.map(({ key, seq, kind, payload }) => ({
              key,
              seq,
              kind,
              payload,
            })) as Parameters<typeof syncWorkoutOpsAction>[0]["ops"],
          }),
        );
        if (!outcome.ok || !outcome.outcome) {
          setOutbox(markTransportFailure);
          setReachable(false);
          return;
        }
        setReachable(true);
        const results = outcome.outcome.results;
        setOutbox((prev) => settle(prev, results).outbox);
        for (const drop of results.filter((r) => r.permanent)) {
          // Un error PERMANENTE es lo único que descarta trabajo del usuario, y
          // nunca en silencio.
          toast.error(drop.error ?? "Un cambio no se ha podido guardar.", {
            duration: 8000,
          });
        }
        if (outcome.outcome.finished) {
          setArchived(true);
          store.clear(sessionId);
          finishRef.current({ deload: outcome.outcome.finished.deload });
        }
      } catch {
        // Sin red, timeout, o el servidor cayó a mitad. Nada se pierde.
        setOutbox(markTransportFailure);
        setReachable(false);
      } finally {
        flushingRef.current = false;
        setFlushing(false);
      }
    },
    [sessionId, store],
  );

  // Intentar en cuanto haya algo que mandar, y reintentar con backoff mientras
  // siga habiéndolo. El temporizador se reprograma solo cada vez que cambia la
  // cola, así que en cuanto se vacía deja de existir.
  useEffect(() => {
    if (outbox.ops.length === 0) return;
    const wait = backoffMs(outbox.failedAttempts);
    const timer = setTimeout(() => void flush(outbox), wait);
    return () => clearTimeout(timer);
  }, [outbox, flush]);

  // Disparadores de reconexión. `online` y `visibilitychange` NO se creen: solo
  // provocan un intento, y quien decide si hay conexión es la respuesta del
  // servidor. Volver a la app tras bloquear el móvil es, en la práctica, el
  // momento en el que vuelve la cobertura.
  useEffect(() => {
    if (outbox.ops.length === 0) return;
    const retry = () => void flush(outbox);
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [outbox, flush]);

  // ------------------------------------------------------------------ encolar
  const queueSet = useCallback((payload: LogSetOpPayload) => {
    setOutbox((prev) =>
      enqueue(prev, setOpKey(payload.workoutExerciseId, payload.setNumber), {
        kind: "LOG_SET",
        payload,
      }),
    );
  }, []);

  const queuePlanned = useCallback((payload: PlannedSetsOpPayload) => {
    setOutbox((prev) =>
      enqueue(prev, plannedOpKey(payload.workoutExerciseId), {
        kind: "SET_PLANNED_SETS",
        payload,
      }),
    );
  }, []);

  const queueNote = useCallback((payload: SaveNoteOpPayload) => {
    setOutbox((prev) =>
      enqueue(prev, noteOpKey(payload.exerciseVariantId), {
        kind: "SAVE_EXERCISE_NOTE",
        payload,
      }),
    );
  }, []);

  const queueFinish = useCallback(
    (feedback: Omit<FinishOpPayload, "token">) => {
      setFinishedLocally(true);
      setOutbox((prev) =>
        enqueue(prev, FINISH_OP_KEY, {
          kind: "FINISH_SESSION",
          // El token se genera UNA vez. Si el usuario corrige el feedback y
          // vuelve a darle, se reutiliza el de la operación que ya estaba en la
          // cola: son el mismo cierre, no dos.
          payload: {
            ...feedback,
            token: existingToken(prev) ?? newToken(),
          },
        }),
      );
    },
    [],
  );

  const pending = pendingCount(outbox);
  const phase: SyncPhase =
    pending === 0
      ? "saved"
      : isDegraded(outbox)
        ? "degraded"
        : flushing
          ? "syncing"
          : reachable
            ? "syncing"
            : "offline";

  return {
    phase,
    pending,
    reachable,
    finishedLocally,
    pendingNotes: pendingNoteVariantIds(outbox),
    queueSet,
    queuePlanned,
    queueNote,
    queueFinish,
  };
}

function existingToken(outbox: Outbox): string | null {
  const op = outbox.ops.find((o) => o.kind === "FINISH_SESSION");
  return op?.kind === "FINISH_SESSION" ? op.payload.token : null;
}

/**
 * Corta un lote que se ha quedado colgado. Con cobertura mala una petición
 * puede no fallar NUNCA, y sin este tope la cola se queda esperando detrás de
 * ella para siempre. Cortar es seguro: si llegó al servidor igualmente, el
 * reintento es idempotente (upsert por serie, token en el cierre).
 */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("sync-timeout")),
      SYNC.BATCH_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
