import { describe, expect, it } from "vitest";

import { SYNC } from "@/lib/offline/sync-config";
import {
  backoffMs,
  emptyOutbox,
  enqueue,
  FINISH_OP_KEY,
  hasPendingFinish,
  isDegraded,
  markTransportFailure,
  noteOpKey,
  pendingCount,
  pendingNoteVariantIds,
  pendingSetNumbers,
  plannedOpKey,
  setOpKey,
  settle,
  type Outbox,
  type OpResult,
} from "@/lib/offline/sync-ops";

function conSerie(
  outbox: Outbox,
  weId: string,
  setNumber: number,
  weightKg: number,
): Outbox {
  return enqueue(outbox, setOpKey(weId, setNumber), {
    kind: "LOG_SET",
    payload: { workoutExerciseId: weId, setNumber, weightKg, reps: 10, rir: 2 },
  });
}

describe("outbox: coalescencia", () => {
  it("corregir cuatro veces la misma serie deja UNA operación con el último dato", () => {
    let outbox = emptyOutbox();
    for (const kg of [40, 42.5, 45, 47.5])
      outbox = conSerie(outbox, "we1", 2, kg);

    expect(pendingCount(outbox)).toBe(1);
    const op = outbox.ops[0];
    expect(op.kind).toBe("LOG_SET");
    expect(op.kind === "LOG_SET" && op.payload.weightKg).toBe(47.5);
  });

  it("series distintas del mismo ejercicio son operaciones distintas", () => {
    let outbox = conSerie(emptyOutbox(), "we1", 1, 40);
    outbox = conSerie(outbox, "we1", 2, 40);
    expect(pendingCount(outbox)).toBe(2);
    expect([...pendingSetNumbers(outbox, "we1")].sort()).toEqual([1, 2]);
    expect(pendingSetNumbers(outbox, "we2").size).toBe(0);
  });

  it("reencolar mueve la operación al FINAL: el orden es el del usuario", () => {
    // Importa porque `setPlannedSets` borra las series por encima del tope:
    // "quito la serie 4" y luego "corrijo la serie 2" no es lo mismo al revés.
    let outbox = conSerie(emptyOutbox(), "we1", 2, 40);
    outbox = enqueue(outbox, plannedOpKey("we1"), {
      kind: "SET_PLANNED_SETS",
      payload: { workoutExerciseId: "we1", plannedSets: 3 },
    });
    outbox = conSerie(outbox, "we1", 2, 45);

    expect(outbox.ops.map((o) => o.kind)).toEqual([
      "SET_PLANNED_SETS",
      "LOG_SET",
    ]);
  });
});

describe("outbox: confirmación del servidor", () => {
  const ok = (key: string, seq: number): OpResult => ({ key, seq, ok: true });

  it("solo borra lo que el servidor confirmó", () => {
    let outbox = conSerie(emptyOutbox(), "we1", 1, 40);
    outbox = conSerie(outbox, "we1", 2, 40);
    const [primera, segunda] = outbox.ops;

    const { outbox: next } = settle(outbox, [ok(primera.key, primera.seq)]);

    expect(pendingCount(next)).toBe(1);
    expect(next.ops[0].key).toBe(segunda.key);
  });

  it("un fallo TRANSITORIO no borra nada: la serie sigue pendiente", () => {
    const outbox = conSerie(emptyOutbox(), "we1", 1, 40);
    const op = outbox.ops[0];

    const { outbox: next, dropped } = settle(outbox, [
      { key: op.key, seq: op.seq, ok: false, error: "No se pudo guardar." },
    ]);

    expect(pendingCount(next)).toBe(1);
    expect(dropped).toHaveLength(0);
    // Y el backoff crece: si no, se reintentaría en bucle a toda velocidad.
    expect(next.failedAttempts).toBe(1);
  });

  it("un fallo PERMANENTE descarta la operación y la reporta para avisar", () => {
    const outbox = conSerie(emptyOutbox(), "we1", 1, 40);
    const op = outbox.ops[0];

    const { outbox: next, dropped } = settle(outbox, [
      {
        key: op.key,
        seq: op.seq,
        ok: false,
        permanent: true,
        error:
          "Esa sesión ya no está en curso: ese cambio no se ha podido guardar.",
      },
    ]);

    expect(pendingCount(next)).toBe(0);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].error).toMatch(/ya no está en curso/);
  });

  it("NO borra una operación que el usuario reeditó mientras el lote volaba", () => {
    // Este es el caso que pierde datos si se compara solo por clave: la
    // respuesta confirma el 40 kg, pero en la cola ya hay un 45 kg sin enviar.
    const enviada = conSerie(emptyOutbox(), "we1", 1, 40).ops[0];
    const outbox = conSerie(
      conSerie(emptyOutbox(), "we1", 1, 40),
      "we1",
      1,
      45,
    );

    const { outbox: next } = settle(outbox, [ok(enviada.key, enviada.seq)]);

    expect(pendingCount(next)).toBe(1);
    const op = next.ops[0];
    expect(op.kind === "LOG_SET" && op.payload.weightKg).toBe(45);
  });

  it("confirmarlo todo pone el contador de fallos a cero", () => {
    let outbox = markTransportFailure(
      markTransportFailure(conSerie(emptyOutbox(), "we1", 1, 40)),
    );
    expect(outbox.failedAttempts).toBe(2);
    const op = outbox.ops[0];
    outbox = settle(outbox, [ok(op.key, op.seq)]).outbox;
    expect(outbox.failedAttempts).toBe(0);
    expect(pendingCount(outbox)).toBe(0);
  });
});

describe("outbox: reintentos", () => {
  it("un fallo de transporte no pierde nada y hace crecer la espera", () => {
    const outbox = markTransportFailure(conSerie(emptyOutbox(), "we1", 1, 40));
    expect(pendingCount(outbox)).toBe(1);
    expect(backoffMs(outbox.failedAttempts)).toBe(SYNC.BACKOFF_BASE_MS);
  });

  it("el backoff es exponencial pero tiene techo", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(4_000);
    expect(backoffMs(3)).toBe(8_000);
    expect(backoffMs(50)).toBe(SYNC.BACKOFF_MAX_MS);
  });

  it("solo se considera 'algo va mal' tras insistir mucho rato", () => {
    let outbox = conSerie(emptyOutbox(), "we1", 1, 40);
    for (let i = 0; i < SYNC.DEGRADED_AFTER_ATTEMPTS - 1; i++) {
      outbox = markTransportFailure(outbox);
      expect(isDegraded(outbox)).toBe(false);
    }
    expect(isDegraded(markTransportFailure(outbox))).toBe(true);
  });
});

describe("outbox: cierre de la sesión", () => {
  it("volver a finalizar reutiliza el hueco, no encola dos cierres", () => {
    let outbox = enqueue(emptyOutbox(), FINISH_OP_KEY, {
      kind: "FINISH_SESSION",
      payload: { token: "tok-1", fatigue: 3 },
    });
    outbox = enqueue(outbox, FINISH_OP_KEY, {
      kind: "FINISH_SESSION",
      payload: { token: "tok-1", fatigue: 5 },
    });

    expect(pendingCount(outbox)).toBe(1);
    expect(hasPendingFinish(outbox)).toBe(true);
    const op = outbox.ops[0];
    expect(op.kind === "FINISH_SESSION" && op.payload.fatigue).toBe(5);
  });

  it("el cierre queda el ÚLTIMO, detrás de las series", () => {
    // El servidor rechaza escribir series en una sesión ya cerrada, así que el
    // orden no es cosmético.
    let outbox = enqueue(emptyOutbox(), FINISH_OP_KEY, {
      kind: "FINISH_SESSION",
      payload: { token: "tok-1" },
    });
    outbox = conSerie(outbox, "we1", 3, 60);
    outbox = enqueue(outbox, FINISH_OP_KEY, {
      kind: "FINISH_SESSION",
      payload: { token: "tok-1" },
    });

    expect(outbox.ops.map((o) => o.kind)).toEqual([
      "LOG_SET",
      "FINISH_SESSION",
    ]);
  });
});

/**
 * Notas de ejercicio en la outbox (F3.2d).
 *
 * La nota se escribía llamando a la server action y esperando: sin cobertura,
 * la llamada fallaba, salía un toast de error y el texto se quedaba SOLO en el
 * estado de React. Cerrar la app lo perdía. Ahora va por la misma cola que las
 * series, y estos tests protegen las propiedades que hacen que eso sea seguro.
 */
function conNota(outbox: Outbox, variantId: string, text: string): Outbox {
  return enqueue(outbox, noteOpKey(variantId), {
    kind: "SAVE_EXERCISE_NOTE",
    payload: { exerciseVariantId: variantId, text },
  });
}

describe("outbox: notas de ejercicio", () => {
  it("reescribir la nota seis veces sin cobertura deja UNA operación", () => {
    // Es lo mismo que ya pasaba con el RIR de una serie: la escritura es
    // absoluta (texto completo), así que la última describe a todas.
    let outbox = emptyOutbox();
    for (const texto of ["a", "ab", "abc", "abcd", "abcde", "asiento en el 4"])
      outbox = conNota(outbox, "v1", texto);

    expect(pendingCount(outbox)).toBe(1);
    const op = outbox.ops[0];
    expect(op.kind).toBe("SAVE_EXERCISE_NOTE");
    expect(op.kind === "SAVE_EXERCISE_NOTE" && op.payload.text).toBe(
      "asiento en el 4",
    );
  });

  it("dos variantes distintas son dos notas distintas en la cola", () => {
    let outbox = conNota(emptyOutbox(), "v-maquina", "bloque azul detrás");
    outbox = conNota(outbox, "v-mancuernas", "no bloquear el codo");

    expect(pendingCount(outbox)).toBe(2);
    expect([...pendingNoteVariantIds(outbox)].sort()).toEqual([
      "v-mancuernas",
      "v-maquina",
    ]);
  });

  it("borrar la nota es una operación más (texto vacío), no una ausencia", () => {
    // Sin esto, borrar sin cobertura no se sincronizaría nunca: la cola no
    // tendría nada que mandar y el servidor conservaría el texto viejo.
    let outbox = conNota(emptyOutbox(), "v1", "algo");
    outbox = conNota(outbox, "v1", "");

    expect(pendingCount(outbox)).toBe(1);
    const op = outbox.ops[0];
    expect(op.kind === "SAVE_EXERCISE_NOTE" && op.payload.text).toBe("");
  });

  it("un fallo de red NO descarta la nota; el servidor confirmándola, sí", () => {
    let outbox = conNota(emptyOutbox(), "v1", "asiento en el 4");
    const enviada = outbox.ops[0];

    outbox = markTransportFailure(outbox);
    expect(pendingCount(outbox)).toBe(1);

    const ok: OpResult = { key: enviada.key, seq: enviada.seq, ok: true };
    expect(pendingCount(settle(outbox, [ok]).outbox)).toBe(0);
  });

  it("reeditar la nota mientras el lote vuela no pierde la corrección", () => {
    // Misma garantía que las series: se compara `seq`, no solo la clave.
    let outbox = conNota(emptyOutbox(), "v1", "primera");
    const enviada = outbox.ops[0];
    outbox = conNota(outbox, "v1", "corregida mientras volaba");

    const ok: OpResult = { key: enviada.key, seq: enviada.seq, ok: true };
    const despues = settle(outbox, [ok]).outbox;
    expect(pendingCount(despues)).toBe(1);
    const op = despues.ops[0];
    expect(op.kind === "SAVE_EXERCISE_NOTE" && op.payload.text).toBe(
      "corregida mientras volaba",
    );
  });

  it("una nota escrita después de finalizar sigue en la cola detrás del cierre", () => {
    // Se puede pulsar "Guardar y finalizar" sin cobertura y anotar algo después,
    // mientras el cierre sigue pendiente. La nota queda detrás y eso es
    // correcto: a diferencia de una serie, guardarla NO exige que la sesión
    // siga en curso (es del banco de ejercicios, no de la sesión), así que el
    // servidor la aplica igual cuando llegue el lote entero.
    let outbox = enqueue(emptyOutbox(), FINISH_OP_KEY, {
      kind: "FINISH_SESSION",
      payload: { token: "tok-1" },
    });
    outbox = conNota(outbox, "v1", "una nota de última hora");

    expect(outbox.ops.map((o) => o.kind)).toEqual([
      "FINISH_SESSION",
      "SAVE_EXERCISE_NOTE",
    ]);
  });
});
