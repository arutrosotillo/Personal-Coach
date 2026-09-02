import { afterEach, describe, expect, it, vi } from "vitest";

import { clearOfflineData } from "@/lib/offline/clear-local";
import { SYNC } from "@/lib/offline/sync-config";

/**
 * Cerrar sesión tiene que llevarse del dispositivo TODO lo que la sesión de
 * entrenamiento dejó ahí: los cuadernos de `localStorage` y el HTML que el
 * service worker guardó en su cache.
 *
 * Importa más ahora que el service worker va siempre en producción: antes un
 * despliegue sin el flag no cacheaba nada y esto era casi teórico. Ya no lo es.
 * En un móvil compartido, la siguiente persona que entre no puede encontrarse
 * el entrenamiento de la anterior.
 */

/** `localStorage` de mentira: el entorno de los tests unitarios es node. */
class MemoriaStorage implements Storage {
  private data = new Map<string, string>();
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
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

function montar(controlador: { postMessage: (m: string) => void } | null) {
  const storage = new MemoriaStorage();
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("navigator", { serviceWorker: { controller: controlador } });
  return storage;
}

afterEach(() => vi.unstubAllGlobals());

describe("cerrar sesión limpia el dispositivo", () => {
  it("borra los cuadernos de sesión y NADA que no sea nuestro", () => {
    const enviados: string[] = [];
    const storage = montar({ postMessage: (m) => enviados.push(m) });
    storage.setItem(`${SYNC.STORAGE_PREFIX}s1`, '{"a":1}');
    storage.setItem(`${SYNC.STORAGE_PREFIX}s2`, '{"b":2}');
    storage.setItem("tema-preferido", "dark");

    clearOfflineData();

    expect(storage.getItem(`${SYNC.STORAGE_PREFIX}s1`)).toBeNull();
    expect(storage.getItem(`${SYNC.STORAGE_PREFIX}s2`)).toBeNull();
    // Una clave ajena no se toca: esto borra lo de la cuenta, no el navegador.
    expect(storage.getItem("tema-preferido")).toBe("dark");
  });

  it("le pide al service worker que tire su cache", () => {
    const enviados: string[] = [];
    montar({ postMessage: (m) => enviados.push(m) });

    clearOfflineData();

    // El propio `sw.js` escucha este mensaje y hace `caches.delete(CACHE)`.
    expect(enviados).toEqual(["pc:logout"]);
  });

  it("sin service worker controlando la página, no revienta", () => {
    const storage = montar(null);
    storage.setItem(`${SYNC.STORAGE_PREFIX}s1`, '{"a":1}');

    expect(() => clearOfflineData()).not.toThrow();
    expect(storage.getItem(`${SYNC.STORAGE_PREFIX}s1`)).toBeNull();
  });
});
