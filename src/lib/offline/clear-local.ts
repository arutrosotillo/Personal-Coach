import {
  browserStorage,
  createSnapshotStore,
} from "@/lib/offline/session-storage";

/**
 * Borra del dispositivo TODO lo de la cuenta que se va: los snapshots de sesión
 * y el HTML cacheado por el service worker.
 *
 * Es lo que impide que, en un móvil compartido, la siguiente persona que entre
 * se encuentre el entrenamiento de la anterior. Nada de esto era una
 * credencial —el servidor revalida identidad y propiedad en cada operación—,
 * pero sí son sus datos.
 */
export function clearOfflineData(): void {
  createSnapshotStore(browserStorage()).clearAll();
  try {
    navigator.serviceWorker?.controller?.postMessage("pc:logout");
  } catch {
    /* sin service worker no hay nada que borrar */
  }
}
