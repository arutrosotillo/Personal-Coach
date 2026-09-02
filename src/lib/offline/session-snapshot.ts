import {
  emptyOutbox,
  hasPendingPlanned,
  pendingSetNumbers,
  type Outbox,
} from "@/lib/offline/sync-ops";

/**
 * Snapshot local de una sesión en curso y su reconciliación con el servidor.
 *
 * Puro: sin `Date.now()`, sin `localStorage`, sin React. El adaptador de
 * almacenamiento vive en `session-storage.ts` y el pegamento en el hook.
 */

export interface RowState {
  weight: string;
  reps: number;
  /**
   * RIR REALMENTE registrado por el usuario. `null` = "no lo sé" / sin
   * registrar. NUNCA se prerrellena con `targetRir`: el objetivo es una
   * prescripción, no un dato reportado, y confundirlos contamina el historial
   * y sesga al motor de progresión (docs/TRAINING_ENGINE_FINAL_AUDIT.md §2.6).
   */
  rir: number | null;
  /**
   * ¿El usuario ha contestado al RIR (un número o "no lo sé")? Distingue
   * "todavía no lo he tocado" de "he dicho que no lo sé". Ambos persisten
   * igual (`rir: null`); es solo para no mostrar una respuesta que nadie dio.
   */
  rirAnswered: boolean;
  done: boolean;
}

export type RowsMap = Record<string, RowState[]>;

/** Lo que la reconciliación necesita saber de un ejercicio del servidor. */
export interface ServerExerciseView {
  id: string;
  variantId: string;
  plannedSets: number;
  repRangeMin: number;
  setLogs: Array<{
    setNumber: number;
    weightKg: number;
    reps: number;
    rir: number | null;
  }>;
  lastTime: {
    sets: Array<{ setNumber: number; weightKg: number; reps: number }>;
  } | null;
}

export interface SessionSnapshot {
  version: number;
  sessionId: string;
  rows: RowsMap;
  /**
   * `variantId` de cada ejercicio en el momento de guardar. Sustituir un
   * ejercicio CONSERVA el id del `WorkoutExercise` pero borra sus series; sin
   * esta huella, el snapshot las resucitaría al reconciliar.
   */
  variantByExercise: Record<string, string>;
  current: number;
  /** Época en ms en la que termina el descanso, para reanudarlo tras recargar. */
  restEndsAt: number | null;
  /** El usuario ya pulsó "Guardar y finalizar", con o sin cobertura. */
  finishedLocally: boolean;
  outbox: Outbox;
  savedAt: number;
}

/** Estado inicial de las filas a partir de los datos del servidor. */
export function initRows(exercises: ServerExerciseView[]): RowsMap {
  const map: RowsMap = {};
  for (const ex of exercises) {
    const rows: RowState[] = [];
    for (let n = 1; n <= ex.plannedSets; n++) {
      const logged = ex.setLogs.find((s) => s.setNumber === n);
      const last =
        ex.lastTime?.sets.find((s) => s.setNumber === n) ??
        ex.lastTime?.sets[ex.lastTime.sets.length - 1];
      rows.push({
        weight:
          logged?.weightKg?.toString() ??
          (last ? last.weightKg.toString() : ""),
        reps: logged?.reps ?? last?.reps ?? ex.repRangeMin,
        rir: logged?.rir ?? null,
        rirAnswered: !!logged,
        done: !!logged,
      });
    }
    map[ex.id] = rows;
  }
  return map;
}

export interface ReconciledState {
  rows: RowsMap;
  current: number;
  restEndsAt: number | null;
  finishedLocally: boolean;
  outbox: Outbox;
  /** `true` si se ha recuperado trabajo local que el servidor todavía no tiene. */
  recovered: boolean;
}

/**
 * Funde lo que dice el servidor con lo que quedó guardado en este dispositivo.
 *
 * POLÍTICA DE CONFLICTOS, en una frase: **si el servidor tiene confirmada esa
 * serie y no hay nada pendiente sobre ella, manda el servidor; en cualquier
 * otro caso, manda lo local.**
 *
 * De ahí salen las tres garantías que importan:
 *
 *  - Un dato pendiente NUNCA lo pisa el servidor (es el caso que da miedo).
 *  - Un borrador —peso y reps tecleados en una serie sin completar— sobrevive a
 *    una recarga, aunque por diseño nunca viaje al servidor.
 *  - Unos datos del servidor VIEJOS tampoco pisan lo local. Esto no es
 *    teórico: con el service worker, recargar sin cobertura sirve el HTML
 *    cacheado de la última vez que sí hubo, y ese HTML no conoce las series de
 *    los últimos veinte minutos.
 *
 * Y una regla sobre CUÁNTAS filas tiene un ejercicio, que es más fina de lo que
 * parece. Manda el servidor, con dos excepciones: si hay un cambio de series sin
 * enviar, manda lo local; y nunca se recorta por debajo de la última serie que
 * localmente está COMPLETADA, porque eso sí sería borrar un dato de la pantalla.
 *
 * Quedarse siempre con el máximo, que es lo primero que uno escribe, está mal:
 * resucitaba la fila que el usuario acababa de quitar con "− Quitar serie" en
 * cuanto recargaba.
 */
export function reconcile(
  exercises: ServerExerciseView[],
  snapshot: SessionSnapshot | null,
  sessionId: string,
): ReconciledState {
  const base = initRows(exercises);
  if (!snapshot || snapshot.sessionId !== sessionId) {
    return {
      rows: base,
      current: 0,
      restEndsAt: null,
      finishedLocally: false,
      outbox: emptyOutbox(),
      recovered: false,
    };
  }

  const outbox = snapshot.outbox;
  const rows: RowsMap = {};
  let recovered = snapshot.finishedLocally || outbox.ops.length > 0;

  for (const ex of exercises) {
    const serverRows = base[ex.id] ?? [];
    const localRows = snapshot.rows[ex.id];
    // Sustitución: el ejercicio de la pantalla ya no es el del snapshot y sus
    // series se borraron en el servidor. Lo local no vale para nada.
    const substituted =
      snapshot.variantByExercise[ex.id] !== undefined &&
      snapshot.variantByExercise[ex.id] !== ex.variantId;
    // Un array vacío se trata como "no hay nada guardado": si no, un snapshot
    // corrupto dejaría el ejercicio sin ninguna fila en pantalla.
    if (!localRows || localRows.length === 0 || substituted) {
      rows[ex.id] = serverRows;
      continue;
    }

    const pending = pendingSetNumbers(outbox, ex.id);
    const length = hasPendingPlanned(outbox, ex.id)
      ? localRows.length
      : Math.max(serverRows.length, lastDoneIndex(localRows) + 1);
    const merged: RowState[] = [];
    for (let i = 0; i < length; i++) {
      const local = localRows[i];
      const server = serverRows[i];
      if (!local) {
        merged.push(server);
        continue;
      }
      if (!server) {
        merged.push(local);
        recovered = true;
        continue;
      }
      // El servidor solo manda sobre una serie que ya tiene confirmada y sobre
      // la que nadie está esperando escribir.
      if (server.done && !pending.has(i + 1)) {
        merged.push(server);
        continue;
      }
      merged.push(local);
      if (local.done && !server.done) recovered = true;
    }
    rows[ex.id] = merged;
    if (hasPendingPlanned(outbox, ex.id)) recovered = true;
  }

  return {
    rows,
    current: clampIndex(snapshot.current, exercises.length),
    restEndsAt: snapshot.restEndsAt,
    finishedLocally: snapshot.finishedLocally,
    outbox,
    recovered,
  };
}

/** Índice de la última serie marcada como hecha, o -1 si no hay ninguna. */
function lastDoneIndex(rows: RowState[]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.done) return i;
  }
  return -1;
}

function clampIndex(value: number, length: number): number {
  if (!Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, Math.max(0, length - 1));
}

/** Huella `workoutExerciseId → variantId` para detectar sustituciones. */
export function variantMap(
  exercises: ServerExerciseView[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ex of exercises) out[ex.id] = ex.variantId;
  return out;
}
