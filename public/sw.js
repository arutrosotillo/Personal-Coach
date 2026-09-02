/**
 * Service worker mínimo, escrito a mano (sin `next-pwa` ni `workbox`).
 *
 * Existe para UNA cosa: que recargar —o que iOS mate la app y la vuelvas a
 * abrir— no acabe en la pantalla de error del navegador cuando no hay cobertura.
 * Sin esto, la capa local-first solo protege mientras la pestaña siga viva, y
 * en un iPhone instalado como PWA el sistema desaloja la pestaña él solo en
 * cuanto bloqueas el móvil entre series.
 *
 * Lo que cachea, y nada más:
 *
 *   1. `/_next/static/**` — código de la app. Hasheado por contenido, público e
 *      inmutable: cache-first sin caducidad es exactamente lo correcto.
 *   2. La navegación a `/train` y `/train/session/<id>` — network-first. Solo el
 *      documento HTML, y solo esas dos rutas: son las que hay que poder abrir
 *      dentro de un gimnasio.
 *
 * Ese HTML es privado, y es deliberado: se cachea UNA ruta concreta, en el
 * dispositivo de su dueño, y no contiene ninguna clase de dato que el snapshot
 * de `localStorage` no guarde ya. Se borra entero al cerrar sesión. Y no puede
 * "ganarle" a lo local: para la pantalla de ejecución ese HTML es simplemente
 * una vista MÁS VIEJA del servidor, y `reconcile()` da prioridad a lo local.
 *
 * Lo que NUNCA se cachea: los POST de las server actions, los payloads RSC
 * (`?_rsc=`), las respuestas redirigidas (la del login) y cualquier otra ruta.
 */

const CACHE = "pc-offline-v1";

const STATIC = /^\/_next\/static\//;
/** `/train` y `/train/session/<id>`. Nada más. */
const NAVEGABLE = /^\/train(\/session\/[^/]+)?\/?$/;

self.addEventListener("install", () => {
  // Sin precarga: lo que hay que cachear se cachea al visitarlo por primera vez
  // (con cobertura, que es cuando se entra al gimnasio). Y sin `skipWaiting`: un
  // service worker nuevo NO releva al viejo a mitad de un entrenamiento; espera
  // al siguiente arranque limpio.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// Cerrar sesión borra el HTML cacheado. La cuenta se va del dispositivo entera.
self.addEventListener("message", (event) => {
  if (event.data === "pc:logout") {
    event.waitUntil(caches.delete(CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Las escrituras son POST (server actions): jamás pasan por aquí.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Payload RSC de una navegación de cliente. Cachearlo serviría datos viejos
  // por una vía que la reconciliación no controla.
  if (url.searchParams.has("_rsc")) return;

  if (STATIC.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate" && NAVEGABLE.test(url.pathname)) {
    event.respondWith(networkFirst(request));
  }
});

/** ¿Se puede guardar? Nada opaco, nada redirigido (el redirect al login). */
function cacheable(response) {
  return (
    response && response.ok && !response.redirected && response.type === "basic"
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (cacheable(response)) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (cacheable(response)) {
      // Se guarda por URL sin la query: da igual con qué parámetros se llegara.
      cache.put(new Request(new URL(request.url).pathname), response.clone());
    }
    return response;
  } catch (error) {
    const hit = await cache.match(new URL(request.url).pathname);
    if (hit) return hit;
    throw error;
  }
}
