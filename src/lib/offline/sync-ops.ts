import { SYNC } from "@/lib/offline/sync-config";

/**
 * Outbox de la sesión de entrenamiento: las escrituras que todavía no ha
 * confirmado el servidor.
 *
 * Es COALESCENTE POR CLAVE, no un registro de eventos, y eso no es una
 * simplificación: es una consecuencia de cómo escribe ya el servidor. Las tres
 * mutaciones de una sesión son ABSOLUTAS e IDEMPOTENTES —`logSet` es un upsert
 * por (workoutExerciseId, setNumber), `setPlannedSets` escribe un número, no un
 * delta, y cerrar la sesión es una transición de estado—, así que una operación
 * pendiente queda descrita por su ÚLTIMO payload. Corregir el RIR de la serie 2
 * cuatro veces sin cobertura deja UNA operación, no cuatro.
 *
 * Todo este módulo es puro: sin `Date.now()`, sin almacenamiento, sin red. El
 * reloj entra como parámetro para que los tests puedan mentirle.
 */

/** Serie concreta. Misma clave natural que el `@@unique` de `SetLog`. */
export function setOpKey(workoutExerciseId: string, setNumber: number): string {
  return `SET:${workoutExerciseId}:${setNumber}`;
}

/** Nº de series previstas de un ejercicio (añadir/quitar serie). */
export function plannedOpKey(workoutExerciseId: string): string {
  return `PLANNED:${workoutExerciseId}`;
}

/** Cierre de la sesión. Uno como mucho, por eso la clave es constante. */
export const FINISH_OP_KEY = "FINISH";

export interface LogSetOpPayload {
  workoutExerciseId: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  rir: number | null;
}

export interface PlannedSetsOpPayload {
  workoutExerciseId: string;
  plannedSets: number;
}

export interface FinishOpPayload {
  /**
   * Token de idempotencia generado UNA vez al pulsar "Guardar y finalizar" y
   * repetido en cada reintento: es lo que permite al servidor distinguir "soy
   * yo otra vez, la respuesta se perdió" de "otra pestaña cerró la sesión".
   */
  token: string;
  perceivedPerformance?: number;
  pump?: number;
  jointPain?: number;
  fatigue?: number;
  motivation?: number;
  notes?: string;
}

export type OpBody =
  | { kind: "LOG_SET"; payload: LogSetOpPayload }
  | { kind: "SET_PLANNED_SETS"; payload: PlannedSetsOpPayload }
  | { kind: "FINISH_SESSION"; payload: FinishOpPayload };

export type PendingOp = OpBody & {
  key: string;
  /**
   * Orden de llegada. Sirve para dos cosas: mantener el FIFO y, al confirmar,
   * saber si la operación que responde el servidor sigue siendo la misma que se
   * envió (si el usuario la reeditó mientras volaba, el `seq` ya no coincide y
   * NO se borra).
   */
  seq: number;
};

export interface Outbox {
  ops: PendingOp[];
  nextSeq: number;
  /** Fallos de TRANSPORTE seguidos (no llegó respuesta). Alimenta el backoff. */
  failedAttempts: number;
}

export function emptyOutbox(): Outbox {
  return { ops: [], nextSeq: 1, failedAttempts: 0 };
}

/**
 * Encola una operación. Si ya había una con la misma clave, la SUSTITUYE y la
 * mueve al final.
 *
 * Mover al final no es un detalle: conserva el orden real en el que el usuario
 * hizo las cosas, y ese orden importa. `setPlannedSets` borra los `SetLog` por
 * encima del nuevo tope, así que "quito la serie 4" seguido de "registro la
 * serie 3" y el orden inverso no son lo mismo.
 */
export function enqueue(outbox: Outbox, key: string, body: OpBody): Outbox {
  return {
    ops: [
      ...outbox.ops.filter((op) => op.key !== key),
      { ...body, key, seq: outbox.nextSeq },
    ],
    nextSeq: outbox.nextSeq + 1,
    failedAttempts: outbox.failedAttempts,
  };
}

/** Resultado que devuelve el servidor para UNA operación del lote. */
export interface OpResult {
  key: string;
  seq: number;
  ok: boolean;
  /** Mensaje para el usuario. Solo se muestra si `permanent`. */
  error?: string;
  /**
   * `true` = reintentar no va a arreglarlo nunca (payload inválido, la sesión
   * ya no es tuya, la cerró otra pestaña). Solo entonces se descarta la
   * operación, y avisando. Un fallo de red NUNCA es permanente.
   */
  permanent?: boolean;
}

export interface SettleResult {
  outbox: Outbox;
  /** Operaciones descartadas por error permanente: hay que contárselo a alguien. */
  dropped: OpResult[];
}

/**
 * Aplica lo que respondió el servidor.
 *
 * Una operación solo se borra si el servidor la confirmó (o si la rechazó de
 * forma definitiva). Un fallo de red la deja intacta: perder una serie por un
 * corte de cobertura es exactamente lo que esta capa existe para evitar.
 *
 * El `seq` se compara además de la clave. Si el usuario corrigió esa misma
 * serie mientras el lote volaba, la operación de la cola ya es OTRA —lleva el
 * dato nuevo— y borrarla perdería la corrección.
 */
export function settle(outbox: Outbox, results: OpResult[]): SettleResult {
  const bySeq = new Map(results.map((r) => [`${r.key}#${r.seq}`, r]));
  const dropped: OpResult[] = [];
  const ops = outbox.ops.filter((op) => {
    const result = bySeq.get(`${op.key}#${op.seq}`);
    if (!result) return true; // no se envió, o se reeditó mientras volaba
    if (result.ok) return false;
    if (result.permanent) {
      dropped.push(result);
      return false;
    }
    return true;
  });
  // El contador de fallos solo se pone a cero si TODO lo intentado salió bien.
  // Si alguna operación falló de forma transitoria —el servidor respondió, pero
  // no pudo escribir—, el backoff tiene que seguir creciendo: sin esto, una
  // operación que falla siempre y responde rápido se reintentaría en bucle a
  // toda velocidad, porque "hubo respuesta" bastaba para reiniciar la espera.
  const allOk = results.every((r) => r.ok);
  return {
    outbox: {
      ...outbox,
      ops,
      failedAttempts: allOk ? 0 : outbox.failedAttempts + 1,
    },
    dropped,
  };
}

/** El lote no llegó a responder (offline, timeout, 5xx). Nada se pierde. */
export function markTransportFailure(outbox: Outbox): Outbox {
  return { ...outbox, failedAttempts: outbox.failedAttempts + 1 };
}

/** Espera antes del siguiente intento. Exponencial con techo. */
export function backoffMs(failedAttempts: number): number {
  if (failedAttempts <= 0) return 0;
  const raw = SYNC.BACKOFF_BASE_MS * 2 ** (failedAttempts - 1);
  return Math.min(raw, SYNC.BACKOFF_MAX_MS);
}

/** ¿Llevamos tanto rato fallando que ya no es "el gimnasio no tiene cobertura"? */
export function isDegraded(outbox: Outbox): boolean {
  return outbox.failedAttempts >= SYNC.DEGRADED_AFTER_ATTEMPTS;
}

export function pendingCount(outbox: Outbox): number {
  return outbox.ops.length;
}

/** ¿Hay un cierre de sesión esperando a que vuelva la cobertura? */
export function hasPendingFinish(outbox: Outbox): boolean {
  return outbox.ops.some((op) => op.key === FINISH_OP_KEY);
}

/** Series con escritura pendiente, por ejercicio. Lo usa la reconciliación. */
export function pendingSetNumbers(
  outbox: Outbox,
  workoutExerciseId: string,
): Set<number> {
  const out = new Set<number>();
  for (const op of outbox.ops) {
    if (op.kind !== "LOG_SET") continue;
    if (op.payload.workoutExerciseId !== workoutExerciseId) continue;
    out.add(op.payload.setNumber);
  }
  return out;
}

export function hasPendingPlanned(
  outbox: Outbox,
  workoutExerciseId: string,
): boolean {
  return outbox.ops.some((op) => op.key === plannedOpKey(workoutExerciseId));
}
