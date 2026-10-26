import { expect, test, type Page } from "@playwright/test";

import { onboard } from "./helpers/onboard";
import { discardOpenSession } from "./helpers/session-cleanup";

/**
 * Cambio de gimnasio (móvil): registrar desde `/program` qué ejercicios pasan
 * a otra máquina → la sesión los trata como "máquina nueva" (no como "primera
 * vez") → deshacer.
 *
 * La base E2E es COMPARTIDA y `progression.spec.ts` empieza esperando "Primera
 * vez con este ejercicio": por eso aquí no se TERMINA ninguna sesión (se
 * descarta) y el cambio se deshace siempre al final, también si algo falla.
 */

async function undoAllGymChanges(page: Page) {
  for (let guard = 0; guard < 5; guard++) {
    await page.goto("/program");
    const corregir = page.getByRole("link", { name: /Corregir/ });
    if ((await corregir.count()) === 0) return;
    await corregir.first().click();
    await page.getByRole("button", { name: "Deshacer este cambio" }).click();
    await page.getByRole("button", { name: "Sí, deshacer" }).click();
    await expect(page).toHaveURL(/\/program$/, { timeout: 15_000 });
  }
}

test.afterEach(async ({ page }) => {
  await undoAllGymChanges(page);
});

test("cambio de gimnasio: la misma variante empieza una referencia nueva", async ({
  page,
}) => {
  await onboard(page);

  // ── Registrar el cambio ────────────────────────────────────────────────
  await page.goto("/program");
  await expect(page.getByText("¿Cambias de gimnasio?")).toBeVisible();
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(
    page.getByRole("heading", { name: "Cambio de gimnasio" }),
  ).toBeVisible();
  await expect(
    page.getByText("¿Qué ejercicios cambian de máquina?"),
  ).toBeVisible();
  // Lo que se conserva, dicho antes de tocar nada.
  await expect(
    page.getByText(
      /Tu objetivo, tu programa —series, rangos y RIR— y tu historial/,
    ),
  ).toBeVisible();

  // Las máquinas llegan marcadas y lo libre no: no TODO deja de ser comparable.
  const boxes = page.getByRole("checkbox");
  const total = await boxes.count();
  expect(total).toBeGreaterThan(0);
  const marcadas = await page
    .locator('[role="checkbox"][aria-checked="true"]')
    .count();
  expect(marcadas).toBeLessThan(total);
  await expect(page.getByText(`${marcadas} de ${total}`)).toBeVisible();
  await page.screenshot({
    path: "test-results/gym-change-form.png",
    fullPage: true,
  });

  // Se marcan todos: así el primer ejercicio del día que toque está seguro.
  for (let i = 0; i < total; i++) {
    const box = boxes.nth(i);
    if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
  }
  await expect(page.getByText(`${total} de ${total}`)).toBeVisible();
  await page
    .getByRole("button", { name: "Registrar cambio de gimnasio" })
    .click();

  await expect(page).toHaveURL(/\/program$/, { timeout: 15_000 });
  await expect(
    page.getByText(/Equipamiento nuevo en \d+ ejercicios/),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/gym-change-program.png" });

  // ── En la sesión: "máquina nueva", no "primera vez" ─────────────────────
  await page.goto("/train");
  await expect(
    page.getByText(/máquina nueva: carga a elegir/).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Empezar entrenamiento" }).click();
  await expect(page.getByText(/Ejercicio 1\//)).toBeVisible();
  await expect(page.getByText(/Máquina nueva/).first()).toBeVisible();
  await expect(page.getByText(/desde el/).first()).toBeVisible();
  await expect(page.getByText(/Primera vez con este ejercicio/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Máquina nueva\. Ver por qué/ }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/gym-change-session.png" });
  await discardOpenSession(page);

  // ── Deshacer ────────────────────────────────────────────────────────────
  await page.goto("/program");
  await page.getByRole("link", { name: /Corregir/ }).click();
  await page.getByRole("button", { name: "Deshacer este cambio" }).click();
  await page.getByRole("button", { name: "Sí, deshacer" }).click();
  await expect(page).toHaveURL(/\/program$/, { timeout: 15_000 });
  await expect(page.getByRole("link", { name: /Corregir/ })).toHaveCount(0);
});
