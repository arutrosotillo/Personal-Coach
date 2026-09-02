import { SYNC } from "@/lib/offline/sync-config";
import type { SessionSnapshot } from "@/lib/offline/session-snapshot";

/**
 * Persistencia local del snapshot de la sesión.
 *
 * Es `localStorage` y no IndexedDB por una razón concreta: es SÍNCRONO. Cuando
 * iOS mata la PWA —lo hace solo, al bloquear el móvil entre series— no hay
 * ninguna transacción a medio confirmar que se pierda: cuando `setItem` vuelve,
 * el dato está escrito. El volumen es pequeño (el catálogo de sustitución, que
 * es lo único grande del payload de la sesión, se queda fuera a propósito).
 *
 * Nada de lo que se guarda aquí es una fuente de autoridad: el servidor vuelve
 * a validar identidad, propiedad y payload en cada operación. Esto es un
 * cuaderno, no una credencial.
 */

export interface SnapshotStore {
  read(sessionId: string): SessionSnapshot | null;
  write(snapshot: SessionSnapshot): void;
  clear(sessionId: string): void;
  /**
   * Borra todas las sesiones guardadas MENOS una. Solo hay una sesión activa a
   * la vez, así que cualquier otra es de un entrenamiento ya terminado que
   * nadie va a volver a leer: sin esto, cada sesión dejaría su cuaderno en el
   * navegador para siempre.
   */
  keepOnly(sessionId: string): void;
  /** Borra TODAS las sesiones guardadas. Se llama al cerrar sesión. */
  clearAll(): void;
}

function keyFor(sessionId: string): string {
  return `${SYNC.STORAGE_PREFIX}${sessionId}`;
}

/**
 * Todas las operaciones son a prueba de fallos. `localStorage` lanza en modo
 * privado de Safari, con la cuota llena o con las cookies de terceros
 * bloqueadas dentro de un iframe. Ninguna de esas cosas puede impedirte
 * terminar el entrenamiento: si el cuaderno no se puede escribir, la sesión
 * sigue funcionando exactamente como antes de que existiera esta capa.
 */
export function createSnapshotStore(storage: Storage | null): SnapshotStore {
  return {
    read(sessionId) {
      if (!storage) return null;
      try {
        const raw = storage.getItem(keyFor(sessionId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<SessionSnapshot>;
        // Formato de otra versión: se ignora en vez de intentar migrarlo.
        // Perder un borrador al desplegar es molesto; leerlo mal y pintar
        // series que no son es peor.
        if (parsed?.version !== SYNC.SNAPSHOT_VERSION) return null;
        if (parsed.sessionId !== sessionId) return null;
        if (!parsed.rows || !parsed.outbox) return null;
        return parsed as SessionSnapshot;
      } catch {
        return null;
      }
    },

    write(snapshot) {
      if (!storage) return;
      try {
        storage.setItem(keyFor(snapshot.sessionId), JSON.stringify(snapshot));
      } catch {
        // Cuota llena o almacenamiento no disponible. Se descarta el snapshot,
        // NO las operaciones pendientes: siguen en memoria y se sincronizan en
        // cuanto vuelva la cobertura. Solo se pierde el poder recargar.
      }
    },

    clear(sessionId) {
      if (!storage) return;
      try {
        storage.removeItem(keyFor(sessionId));
      } catch {
        /* nada que hacer */
      }
    },

    keepOnly(sessionId) {
      removeMatching(storage, (key) => key !== keyFor(sessionId));
    },

    clearAll() {
      removeMatching(storage, () => true);
    },
  };
}

/** Borra las claves nuestras que cumplan `predicado`. Nunca toca nada más. */
function removeMatching(
  storage: Storage | null,
  predicado: (key: string) => boolean,
): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(SYNC.STORAGE_PREFIX) && predicado(key))
        keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* nada que hacer */
  }
}

/** Acceso a `window.localStorage` que no explota en el servidor ni en Safari. */
export function browserStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const storage = window.localStorage;
    // Safari en privado expone el objeto pero lanza al escribir: mejor saberlo
    // ahora que a mitad de la primera serie.
    const probe = `${SYNC.STORAGE_PREFIX}probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
