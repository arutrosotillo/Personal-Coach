import { expect, test } from "@playwright/test";

import {
  E2E_DISABLED_PASSWORD,
  E2E_DISABLED_USERNAME,
  E2E_PASSWORD,
  E2E_USERNAME,
} from "./auth-constants";

/**
 * La app no puede quedar pública. Estas pruebas corren SIN sesión guardada:
 * comprueban que la puerta existe y que no se puede rodear.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const RUTAS_PRIVADAS = [
  "/",
  "/train",
  "/train/history",
  "/train/exercises",
  "/program",
  "/program/new",
  "/program/history",
  "/progress",
  "/coach",
  "/science",
  "/settings",
  "/onboarding",
];

test("ninguna ruta privada es accesible sin sesión", async ({ page }) => {
  for (const ruta of RUTAS_PRIVADAS) {
    await page.goto(ruta);
    await expect(page, `${ruta} debería redirigir al login`).toHaveURL(
      /\/login/,
    );
  }
});

test("una ruta inexistente tampoco filtra la app", async ({ page }) => {
  // El 404 se renderiza dentro del AppShell, así que sin sesión no debe verse.
  await page.goto("/no-existe-esta-ruta");
  await expect(page).toHaveURL(/\/login/);
});

test("con contraseña incorrecta no se entra y no se dice por qué", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(E2E_USERNAME);
  await page.getByLabel("Contraseña").fill("no-es-la-buena");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.locator("#login-error")).toHaveText(
    "Usuario o contraseña incorrectos.",
  );
  await expect(page).toHaveURL(/\/login/);
});

test("entrar lleva a la ruta que pedías y la sesión sobrevive a cerrar la pestaña", async ({
  page,
  context,
}) => {
  await page.goto("/program");
  await expect(page).toHaveURL(/\/login\?next=%2Fprogram/);

  await page.getByLabel("Usuario").fill(E2E_USERNAME);
  await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/program$/);

  // Cerrar y reabrir: la cookie persiste, como al volver a la PWA otro día.
  const otra = await context.newPage();
  await otra.goto("/train");
  await expect(otra).toHaveURL(/\/train$/);
  await otra.close();
});

test("la cookie de sesión es httpOnly: el JavaScript de la página no la ve", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(E2E_USERNAME);
  await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/);

  const cookie = (await context.cookies()).find((c) => c.name === "pc_session");
  expect(cookie, "debería existir la cookie de sesión").toBeDefined();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe("Lax");

  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "pc_session",
  );
});

test("cerrar sesión echa fuera de verdad", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(E2E_USERNAME);
  await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/train");
  await expect(page).toHaveURL(/\/login/);
});

test("un usuario que no existe recibe el mismo mensaje que una contraseña mala", async ({
  page,
}) => {
  // Distinguirlos revelaría qué cuentas existen.
  await page.goto("/login");
  await page.getByLabel("Usuario").fill("no-existe-esta-cuenta");
  await page.getByLabel("Contraseña").fill("da-igual-lo-que-ponga");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("#login-error")).toHaveText(
    "Usuario o contraseña incorrectos.",
  );
  await expect(page).toHaveURL(/\/login/);
});

test("una cuenta desactivada no entra, ni con su contraseña correcta", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(E2E_DISABLED_USERNAME);
  await page.getByLabel("Contraseña").fill(E2E_DISABLED_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.locator("#login-error")).toHaveText(
    "Usuario o contraseña incorrectos.",
  );
  await expect(page).toHaveURL(/\/login/);
  // Y tampoco por la puerta de atrás.
  await page.goto("/train");
  await expect(page).toHaveURL(/\/login/);
});

test("un usuario recién creado no ve el historial de otro", async ({
  page,
}) => {
  // `ana` tiene cuenta pero no ha hecho el onboarding. Si las páginas
  // siguieran resolviendo "el primer perfil de la base de datos" —el fallo
  // single-user que se ha corregido—, aquí vería el plan de otro.
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(E2E_USERNAME);
  await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // Sin perfil propio, la app le pide onboarding en vez de enseñarle datos.
  await page.goto("/train");
  await expect(page.getByText(/Aún no hay programa/i)).toBeVisible();
  // Y no aparece nada del plan de nadie más.
  await expect(page.getByRole("heading", { name: "Hoy" })).toHaveCount(0);
});
