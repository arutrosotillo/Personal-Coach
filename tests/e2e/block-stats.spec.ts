import { expect, test } from "@playwright/test";

import { onboard } from "./helpers/onboard";

/**
 * Estadísticas del bloque y RIR en rango (móvil). La base E2E es COMPARTIDA: aquí
 * no se termina ninguna sesión, y lo que se edita se deja como estaba.
 */

test("las estadísticas del bloque se abren desde el programa, sin inventar datos", async ({
  page,
}) => {
  await onboard(page);
  await page.goto("/program");
  await page.getByText("Estadísticas del bloque").click();
  await expect(page).toHaveURL(/\/program\/stats\//);
  await expect(page.getByText("En curso")).toBeVisible();
  await page.getByText("Estructura del programa").click();
  await expect(page.getByText(/RIR \d/).first()).toBeVisible();

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByText("Volver").click();
  await expect(page).toHaveURL(/\/program$/);
});

test("un programa ajeno o inexistente no existe", async ({ page }) => {
  await onboard(page);
  const res = await page.goto("/program/stats/no-existe");
  expect(res?.status()).toBe(404);
});

test("el RIR en rango se edita y se enseña como rango", async ({ page }) => {
  await onboard(page);
  await page.goto("/program");
  await page.getByRole("button", { name: "Editar" }).click();

  // El RIR del primer ejercicio es del catálogo: se sube para que quepa el rango.
  const rir = page.getByRole("group", { name: "RIR" }).first();
  const original = Number(await rir.locator("span[aria-live]").textContent());
  await rir.getByRole("button", { name: "Aumentar RIR" }).click();

  const fila = page
    .locator("div.space-y-3")
    .filter({ has: page.getByRole("group", { name: "RIR" }) })
    .first();
  await fila.getByRole("checkbox", { name: /RIR en rango/ }).check();
  await expect(
    fila.getByRole("checkbox", { name: /Rango: RIR/ }),
  ).toBeChecked();
  await fila.getByRole("button", { name: "Guardar" }).click();
  await expect(fila.getByRole("button", { name: "Guardar" })).toBeDisabled({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Hecho" }).click();
  await expect(
    page.getByText(`RIR ${original}–${original + 1}`).first(),
  ).toBeVisible();

  // Se deja como estaba: la base es compartida.
  await page.getByRole("button", { name: "Editar" }).click();
  const filaOtra = page
    .locator("div.space-y-3")
    .filter({ has: page.getByRole("group", { name: "RIR" }) })
    .first();
  await filaOtra.getByRole("checkbox", { name: /Rango: RIR/ }).uncheck();
  await filaOtra.getByRole("button", { name: "Reducir RIR" }).click();
  await filaOtra.getByRole("button", { name: "Guardar" }).click();
  await expect(filaOtra.getByRole("button", { name: "Guardar" })).toBeDisabled({
    timeout: 15_000,
  });
});
