import { describe, expect, it } from "vitest";

import {
  initRows,
  reconcile,
  variantMap,
  type RowState,
  type SessionSnapshot,
  type ServerExerciseView,
} from "@/lib/offline/session-snapshot";
import { SYNC } from "@/lib/offline/sync-config";
import {
  emptyOutbox,
  enqueue,
  plannedOpKey,
  setOpKey,
  type Outbox,
} from "@/lib/offline/sync-ops";

const SESION = "sesion-1";

function ejercicio(
  overrides: Partial<ServerExerciseView> = {},
): ServerExerciseView {
  return {
    id: "we1",
    variantId: "var-press-banca",
    plannedSets: 3,
    repRangeMin: 8,
    setLogs: [],
    lastTime: null,
    ...overrides,
  };
}

function fila(overrides: Partial<RowState> = {}): RowState {
  return {
    weight: "",
    reps: 8,
    rir: null,
    rirAnswered: false,
    done: false,
    ...overrides,
  };
}

function snapshot(
  rows: Record<string, RowState[]>,
  outbox: Outbox = emptyOutbox(),
  overrides: Partial<SessionSnapshot> = {},
): SessionSnapshot {
  return {
    version: SYNC.SNAPSHOT_VERSION,
    sessionId: SESION,
    rows,
    variantByExercise: { we1: "var-press-banca" },
    current: 0,
    restEndsAt: null,
    finishedLocally: false,
    outbox,
    savedAt: 0,
    ...overrides,
  };
}

describe("initRows", () => {
  it("prerrellena con la última vez pero NUNCA con el RIR de entonces", () => {
    const rows = initRows([
      ejercicio({
        lastTime: { sets: [{ setNumber: 1, weightKg: 60, reps: 10 }] },
      }),
    ]);
    expect(rows.we1[0].weight).toBe("60");
    expect(rows.we1[0].reps).toBe(10);
    // El esfuerzo es un dato de HOY: se registra a mano o se queda sin registrar.
    expect(rows.we1[0].rir).toBeNull();
    expect(rows.we1[0].rirAnswered).toBe(false);
    expect(rows.we1[0].done).toBe(false);
  });

  it("marca como hechas las series que el servidor ya tiene", () => {
    const rows = initRows([
      ejercicio({
        setLogs: [{ setNumber: 2, weightKg: 80, reps: 9, rir: 1 }],
      }),
    ]);
    expect(rows.we1[1]).toMatchObject({
      weight: "80",
      reps: 9,
      rir: 1,
      done: true,
    });
    expect(rows.we1[0].done).toBe(false);
  });
});

describe("reconcile: sin nada guardado", () => {
  it("usa el servidor tal cual y no dice haber recuperado nada", () => {
    const server = [
      ejercicio({ setLogs: [{ setNumber: 1, weightKg: 50, reps: 8, rir: 2 }] }),
    ];
    const out = reconcile(server, null, SESION);
    expect(out.rows.we1[0].done).toBe(true);
    expect(out.recovered).toBe(false);
    expect(out.outbox.ops).toHaveLength(0);
  });

  it("ignora el snapshot de OTRA sesión", () => {
    const guardado = snapshot(
      { we1: [fila({ weight: "999", done: true })] },
      emptyOutbox(),
      {
        sessionId: "otra-sesion",
      },
    );
    const out = reconcile([ejercicio()], guardado, SESION);
    expect(out.rows.we1[0].weight).toBe("");
    expect(out.recovered).toBe(false);
  });
});

describe("reconcile: conflictos", () => {
  it("una serie PENDIENTE gana al valor viejo del servidor", () => {
    // El caso que da miedo: la corrección local todavía no ha salido y el
    // servidor sigue teniendo el dato anterior.
    const server = [
      ejercicio({ setLogs: [{ setNumber: 1, weightKg: 50, reps: 8, rir: 2 }] }),
    ];
    const outbox = enqueue(emptyOutbox(), setOpKey("we1", 1), {
      kind: "LOG_SET",
      payload: {
        workoutExerciseId: "we1",
        setNumber: 1,
        weightKg: 60,
        reps: 8,
        rir: 1,
      },
    });
    const guardado = snapshot(
      {
        we1: [
          fila({
            weight: "60",
            reps: 8,
            rir: 1,
            rirAnswered: true,
            done: true,
          }),
        ],
      },
      outbox,
    );

    const out = reconcile(server, guardado, SESION);
    expect(out.rows.we1[0].weight).toBe("60");
    expect(out.rows.we1[0].rir).toBe(1);
    expect(out.recovered).toBe(true);
  });

  it("una serie CONFIRMADA y sin nada pendiente la manda el servidor", () => {
    const server = [
      ejercicio({ setLogs: [{ setNumber: 1, weightKg: 50, reps: 8, rir: 2 }] }),
    ];
    const guardado = snapshot({
      we1: [
        fila({ weight: "45", reps: 8, rir: 3, rirAnswered: true, done: true }),
      ],
    });

    const out = reconcile(server, guardado, SESION);
    expect(out.rows.we1[0].weight).toBe("50");
    expect(out.rows.we1[0].rir).toBe(2);
  });

  it("unos datos VIEJOS del servidor no borran una serie ya hecha", () => {
    // Con el service worker, recargar sin cobertura sirve el HTML de la última
    // vez que sí había: ese HTML no conoce las últimas veinte series.
    const server = [ejercicio()]; // sin setLogs: la vista es anterior
    const guardado = snapshot({
      we1: [fila({ weight: "70", reps: 8, done: true }), fila(), fila()],
    });

    const out = reconcile(server, guardado, SESION);
    expect(out.rows.we1[0].done).toBe(true);
    expect(out.rows.we1[0].weight).toBe("70");
    expect(out.recovered).toBe(true);
  });

  it("conserva el borrador de una serie sin completar", () => {
    // Peso y reps tecleados sin darle a "Completar" no viajan al servidor por
    // diseño, pero tienen que sobrevivir a una recarga.
    const guardado = snapshot({
      we1: [fila({ weight: "82.5", reps: 6 }), fila(), fila()],
    });
    const out = reconcile([ejercicio()], guardado, SESION);
    expect(out.rows.we1[0].weight).toBe("82.5");
    expect(out.rows.we1[0].reps).toBe(6);
    // Un borrador no es trabajo pendiente de enviar: no dispara el aviso.
    expect(out.recovered).toBe(false);
  });

  it("quitar una serie ya sincronizada NO la resucita al recargar", () => {
    // Con la regla ingenua de "quédate con el máximo", "− Quitar serie" seguido
    // de una recarga devolvía la fila que el usuario acababa de quitar.
    const guardado = snapshot({
      we1: [fila({ done: true }), fila({ done: true }), fila()],
    });
    const out = reconcile([ejercicio({ plannedSets: 2 })], guardado, SESION);
    expect(out.rows.we1).toHaveLength(2);
  });

  it("pero un servidor VIEJO tampoco borra una serie que ya está hecha", () => {
    const guardado = snapshot({
      we1: [
        fila({ done: true }),
        fila({ done: true }),
        fila({ weight: "60", done: true }),
      ],
    });
    const out = reconcile([ejercicio({ plannedSets: 2 })], guardado, SESION);
    expect(out.rows.we1).toHaveLength(3);
    expect(out.rows.we1[2].weight).toBe("60");
    expect(out.recovered).toBe(true);
  });

  it("con un cambio de series SIN ENVIAR manda lo local", () => {
    const guardado = snapshot(
      {
        we1: [
          fila({ done: true }),
          fila({ done: true }),
          fila(),
          fila({ weight: "40" }),
        ],
      },
      enqueue(emptyOutbox(), plannedOpKey("we1"), {
        kind: "SET_PLANNED_SETS",
        payload: { workoutExerciseId: "we1", plannedSets: 4 },
      }),
    );
    const out = reconcile([ejercicio({ plannedSets: 3 })], guardado, SESION);
    expect(out.rows.we1).toHaveLength(4);
    expect(out.rows.we1[3].weight).toBe("40");
    expect(out.recovered).toBe(true);
  });

  it("tras SUSTITUIR el ejercicio descarta lo local: esas series ya no existen", () => {
    // `substituteExercise` conserva el id del WorkoutExercise pero borra sus
    // SetLog. Sin esta guarda, el snapshot las resucitaba bajo otro ejercicio.
    const guardado = snapshot({
      we1: [fila({ weight: "100", done: true }), fila(), fila()],
    });
    const out = reconcile(
      [ejercicio({ variantId: "var-press-inclinado" })],
      guardado,
      SESION,
    );
    expect(out.rows.we1[0].done).toBe(false);
    expect(out.rows.we1[0].weight).toBe("");
  });
});

describe("reconcile: estado de pantalla", () => {
  it("recupera ejercicio actual, descanso y cierre pendiente", () => {
    const guardado = snapshot(
      { we1: [fila(), fila(), fila()] },
      emptyOutbox(),
      {
        current: 1,
        restEndsAt: 1_700_000_000_000,
        finishedLocally: true,
      },
    );
    const out = reconcile(
      [ejercicio({ id: "we0" }), ejercicio()],
      guardado,
      SESION,
    );
    expect(out.current).toBe(1);
    expect(out.restEndsAt).toBe(1_700_000_000_000);
    expect(out.finishedLocally).toBe(true);
    expect(out.recovered).toBe(true);
  });

  it("acota el ejercicio actual si la sesión ha encogido", () => {
    const guardado = snapshot({ we1: [fila()] }, emptyOutbox(), { current: 7 });
    expect(reconcile([ejercicio()], guardado, SESION).current).toBe(0);
  });
});

describe("variantMap", () => {
  it("indexa la variante por ejercicio de la sesión", () => {
    expect(
      variantMap([ejercicio(), ejercicio({ id: "we2", variantId: "v2" })]),
    ).toEqual({
      we1: "var-press-banca",
      we2: "v2",
    });
  });
});

describe("reconcile: snapshots imposibles", () => {
  it("un ejercicio sin filas guardadas cae al servidor, no a una pantalla vacía", () => {
    const guardado = snapshot({ we1: [] });
    const out = reconcile([ejercicio({ plannedSets: 3 })], guardado, SESION);
    expect(out.rows.we1).toHaveLength(3);
  });

  it("un ejercicio que el snapshot no conoce usa el servidor", () => {
    const guardado = snapshot({ otro: [fila({ done: true })] });
    const out = reconcile([ejercicio()], guardado, SESION);
    expect(out.rows.we1).toHaveLength(3);
    expect(out.rows.we1[0].done).toBe(false);
  });
});
