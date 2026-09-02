import { expect, test } from "@playwright/test";

/**
 * La PWA tiene que poder instalarse desde el icono de Safari. Estas pruebas
 * corren SIN sesión a propósito: iOS descarga el manifiesto y los iconos al
 * añadir a la pantalla de inicio, antes de que exista ninguna sesión. Si
 * respondieran con una redirección al login, el icono saldría roto.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("el manifiesto se sirve sin sesión y declara una app standalone", async ({
  request,
}) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);

  const manifest = await res.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.short_name).toBe("Coach");
  expect(manifest.start_url).toBe("/train");
  expect(manifest.scope).toBe("/");
  // Que el arranque no dé un fogonazo blanco antes de pintar la app.
  expect(manifest.background_color).toBe("#0a0a0a");
  expect(manifest.theme_color).toBe("#0a0a0a");

  const tamanos = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(tamanos).toContain("192x192");
  expect(tamanos).toContain("512x512");
  expect(
    manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable"),
  ).toBe(true);
});

test("todos los iconos declarados existen y son imágenes", async ({
  request,
}) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  const fuentes: string[] = manifest.icons.map((i: { src: string }) => i.src);

  for (const src of [...fuentes, "/apple-touch-icon.png", "/icon.svg"]) {
    const res = await request.get(src);
    expect(res.status(), `${src} debería servirse sin sesión`).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^image\//);
  }
});

test("el service worker se sirve sin sesión y no lo intercepta el proxy", async ({
  request,
}) => {
  // El navegador pide /sw.js fuera del ciclo de navegación y vuelve a pedirlo
  // periódicamente para comprobar si cambió. Si el proxy lo redirigiera al
  // login, el registro fallaría en silencio —o peor, se registraría el HTML del
  // login como service worker— y el modo offline dejaría de existir sin que
  // nadie se enterara.
  const res = await request.get("/sw.js");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/javascript/);

  const body = await res.text();
  // Es el nuestro, no una página de error disfrazada.
  expect(body).toContain("pc-offline-v1");
  // Y no cachea nada privado por accidente: solo el shell del entrenamiento.
  expect(body).toContain("/_next/static");
});

test("el <head> lleva lo que iOS necesita para la pantalla de inicio", async ({
  page,
}) => {
  await page.goto("/login");

  // iOS IGNORA los iconos del manifiesto: sin esta etiqueta pone una captura
  // de la página como icono.
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/apple-touch-icon.png",
  );
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  // El nombre bajo el icono.
  await expect(
    page.locator('meta[name="apple-mobile-web-app-title"]'),
  ).toHaveAttribute("content", "Coach");
  // De estas dos depende que se abra sin barra de direcciones. Next 16 solo
  // emite la estándar, así que la de Apple se añade a mano.
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  await expect(
    page.locator('meta[name="mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  // viewport-fit=cover activa las env(safe-area-inset-*) de la bottom nav.
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/,
  );
  // App privada: fuera de los buscadores.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});
