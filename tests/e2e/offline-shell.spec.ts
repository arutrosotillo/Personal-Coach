import { expect, test, type Page } from "@playwright/test";

import { onboard } from "./helpers/onboard";

/**
 * El service worker: recargar y reabrir la app sin cobertura.
 *
 * Es la única parte de la capa offline que necesita un service worker, y la
 * única que se prueba aquí. La semántica de la cola (no perder, no duplicar,
 * sincronizar al volver) vive en `offline-session.spec.ts`, que corre con el
 * service worker BLOQUEADO porque Playwright no sabe emular la red a través de
 * uno.
 *
 * Eso deja un hueco honesto que conviene tener presente: al cortar la red aquí,
 * las peticiones que salen por el service worker pueden escaparse de la
 * emulación de Playwright. Por eso los asertos de esta spec son sobre lo que sí
 * es comprobable de forma determinista —qué hay en la cache y qué NO— y sobre
 * que la sesión se recupera entera; no sobre lo que llega o deja de llegar al
 * servidor.
 */

const CACHE = "pc-offline-v1";

/** ¿Está esta ruta en la cache del service worker? */
function cacheado(page: Page, path: string) {
  return page.evaluate(
    async ([cache, ruta]) => {
      const c = await caches.open(cache);
      return !!(await c.match(ruta));
    },
    [CACHE, path] as const,
  );
}

/**
 * Deja el service worker instalado Y con el documento de la sesión cacheado.
 *
 * Hacen falta las dos cosas y en este orden: el service worker se registra
 * después de hidratar, así que la PRIMERA carga no pasa por él. La segunda sí,
 * y es la que deja el documento en la cache.
 */
async function conServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(page.getByText(/Ejercicio \d+\//)).toBeVisible();
}

async function empezarDeCero(page: Page) {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/train");
  const reanudar = page.getByRole("button", { name: "Reanudar sesión" });
  if (await reanudar.isVisible().catch(() => false)) {
    await reanudar.click();
    await expect(page).toHaveURL(/\/train\/session\//);
    await descartar(page);
  }
  await onboard(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empezar entrenamiento" }).click();
  await expect(page).toHaveURL(/\/train\/session\//);
}

async function descartar(page: Page) {
  const boton = page.getByRole("button", { name: "Descartar sesión" });
  await expect(boton).toBeEnabled({ timeout: 60_000 });
  await boton.click();
  await expect(page).toHaveURL(/\/train$/, { timeout: 30_000 });
}

async function registrarSerie(page: Page, idx: number, kg: string) {
  await page
    .getByRole("textbox", { name: "Peso (kg)", exact: true })
    .nth(idx)
    .fill(kg);
  await page.getByRole("button", { name: "Completar" }).first().click();
  await expect(
    page.getByRole("button", { name: "✓ Hecha" }).nth(idx),
  ).toBeVisible();
}

test("el service worker se registra solo, sin ninguna variable de entorno", async ({
  page,
}) => {
  // Este servidor es el build de PRODUCCIÓN del puerto 3101 y su `env` en
  // playwright.config.ts NO define ninguna variable para el service worker: ya
  // no existe tal cosa. Si alguien volviera a poner el registro detrás de un
  // flag, este test lo caza aquí en vez de dejar que se manifieste como un
  // timeout confuso en los dos tests largos de abajo.
  await page.goto("/train");
  const registro = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return r.active?.scriptURL ?? null;
  });
  expect(registro).toMatch(/\/sw\.js$/);

  // Y de verdad controla la página tras la siguiente carga (el registro ocurre
  // después de hidratar, así que la PRIMERA carga nunca pasa por él).
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
});

test("recargar y reabrir la app sin cobertura recupera la sesión entera", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await empezarDeCero(page);
  const urlSesion = page.url();
  const rutaSesion = new URL(urlSesion).pathname;
  await conServiceWorker(page);

  // El documento de la sesión queda cacheado: es lo que se sirve cuando la
  // recarga no encuentra red.
  expect(await cacheado(page, rutaSesion)).toBe(true);

  await registrarSerie(page, 0, "40");
  await registrarSerie(page, 1, "42.5");
  await registrarSerie(page, 2, "45");
  await expect(page.locator("header").getByRole("status")).toHaveText(
    /Guardado/,
    { timeout: 30_000 },
  );

  // --- Caso A: recargar sin cobertura ----------------------------------
  await context.setOffline(true);
  // `commit` y no `load`: sin red hay recursos que no llegan nunca, y esperar
  // al `load` sería esperar a eso, no a la app.
  await page.reload({ waitUntil: "commit" });
  await expect(page.getByText(/Ejercicio \d+\//)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "✓ Hecha" })).toHaveCount(3, {
    timeout: 30_000,
  });
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);

  // --- Caso B: cerrar la pestaña y volver a abrirla, sin cobertura ------
  await page.close();
  const reabierta = await context.newPage();
  await context.setOffline(true);
  await reabierta.goto(urlSesion, { waitUntil: "commit" });
  await expect(reabierta.getByText(/Ejercicio \d+\//)).toBeVisible({
    timeout: 30_000,
  });
  await expect(reabierta.getByRole("button", { name: "✓ Hecha" })).toHaveCount(
    3,
    { timeout: 30_000 },
  );

  // Y se puede seguir entrenando donde se dejó.
  await reabierta.getByRole("button", { name: "+ Añadir serie" }).click();
  await registrarSerie(reabierta, 3, "45");

  await context.setOffline(false);
  await expect(reabierta.locator("header").getByRole("status")).toHaveText(
    /Guardado/,
    { timeout: 90_000 },
  );
  await reabierta.reload();
  await expect(reabierta.getByRole("button", { name: "✓ Hecha" })).toHaveCount(
    4,
    { timeout: 30_000 },
  );

  reabierta.on("dialog", (dialog) => void dialog.accept());
  await descartar(reabierta);
});

test("el service worker solo cachea lo del entrenamiento, nada más", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await empezarDeCero(page);
  await conServiceWorker(page);

  // Visitar otras pantallas NO las mete en la cache: cada ruta cacheada es HTML
  // privado guardado en el dispositivo, así que solo entran las dos donde de
  // verdad no hay cobertura.
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: /Progreso/ })).toBeVisible();
  expect(await cacheado(page, "/progress")).toBe(false);
  await page.goto("/settings");
  expect(await cacheado(page, "/settings")).toBe(false);

  // `/train` sí, porque es el `start_url` de la PWA: si iOS mata la app y la
  // reabres sin cobertura, aterrizas justo ahí.
  await page.goto("/train");
  await expect(page.getByRole("heading", { name: "Entrenar" })).toBeVisible();
  expect(await cacheado(page, "/train")).toBe(true);

  await page.getByRole("button", { name: "Reanudar sesión" }).click();
  await expect(page).toHaveURL(/\/train\/session\//);
  await descartar(page);
});
