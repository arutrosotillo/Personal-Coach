import { describe, expect, it } from "vitest";

import type { SessionSnapshot } from "@/lib/offline/session-snapshot";
import { createSnapshotStore } from "@/lib/offline/session-storage";
import { SYNC } from "@/lib/offline/sync-config";
import { emptyOutbox } from "@/lib/offline/sync-ops";

/** `localStorage` de mentira: el entorno de los tests unitarios es node. */
class MemoriaStorage implements Storage {
  private data = new Map<string, string>();
  /** Si es `true`, escribir lanza (cuota llena, Safari en privado). */
  llena = false;

  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.llena) throw new Error("QuotaExceededError");
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

function snapshot(sessionId = "s1"): SessionSnapshot {
  return {
    version: SYNC.SNAPSHOT_VERSION,
    sessionId,
    rows: {
      we1: [{ weight: "60", reps: 8, rir: 2, rirAnswered: true, done: true }],
    },
    notes: {},
    variantByExercise: { we1: "v1" },
    current: 0,
    restEndsAt: null,
    finishedLocally: false,
    outbox: emptyOutbox(),
    savedAt: 1,
  };
}

describe("almacén del snapshot", () => {
  it("guarda y recupera exactamente lo mismo", () => {
    const store = createSnapshotStore(new MemoriaStorage());
    store.write(snapshot());
    expect(store.read("s1")).toEqual(snapshot());
  });

  it("no devuelve el snapshot de otra sesión", () => {
    const store = createSnapshotStore(new MemoriaStorage());
    store.write(snapshot("s1"));
    expect(store.read("s2")).toBeNull();
  });

  it("ignora un formato de otra versión en vez de intentar interpretarlo", () => {
    // Perder un borrador al desplegar es molesto; pintar series equivocadas es
    // peor.
    const storage = new MemoriaStorage();
    storage.setItem(
      `${SYNC.STORAGE_PREFIX}s1`,
      JSON.stringify({ ...snapshot(), version: SYNC.SNAPSHOT_VERSION + 1 }),
    );
    expect(createSnapshotStore(storage).read("s1")).toBeNull();
  });

  it("ignora un valor corrupto sin lanzar", () => {
    const storage = new MemoriaStorage();
    storage.setItem(`${SYNC.STORAGE_PREFIX}s1`, "{no es json");
    expect(createSnapshotStore(storage).read("s1")).toBeNull();
  });

  it("con la cuota llena no rompe: simplemente no hay cuaderno", () => {
    const storage = new MemoriaStorage();
    storage.llena = true;
    const store = createSnapshotStore(storage);
    expect(() => store.write(snapshot())).not.toThrow();
    expect(store.read("s1")).toBeNull();
  });

  it("sin almacenamiento (Safari en privado) todo es un no-op silencioso", () => {
    const store = createSnapshotStore(null);
    expect(() => store.write(snapshot())).not.toThrow();
    expect(store.read("s1")).toBeNull();
    expect(() => store.clearAll()).not.toThrow();
  });

  it("al cerrar sesión borra TODAS las sesiones y nada más", () => {
    const storage = new MemoriaStorage();
    const store = createSnapshotStore(storage);
    store.write(snapshot("s1"));
    store.write(snapshot("s2"));
    storage.setItem("ajeno", "no me toques");

    store.clearAll();

    expect(store.read("s1")).toBeNull();
    expect(store.read("s2")).toBeNull();
    expect(storage.getItem("ajeno")).toBe("no me toques");
  });
});

describe("limpieza", () => {
  it("`keepOnly` conserva la sesión activa y tira las terminadas", () => {
    // Solo hay una sesión activa a la vez: sin esto, cada entrenamiento
    // terminado dejaría su cuaderno en el navegador para siempre.
    const storage = new MemoriaStorage();
    const store = createSnapshotStore(storage);
    store.write(snapshot("vieja-1"));
    store.write(snapshot("vieja-2"));
    store.write(snapshot("activa"));
    storage.setItem("ajeno", "no me toques");

    store.keepOnly("activa");

    expect(store.read("activa")).not.toBeNull();
    expect(store.read("vieja-1")).toBeNull();
    expect(store.read("vieja-2")).toBeNull();
    expect(storage.getItem("ajeno")).toBe("no me toques");
  });
});
