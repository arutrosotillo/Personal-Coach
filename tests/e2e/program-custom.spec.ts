import { expect, test } from "@playwright/test";

import { onboard } from "./helpers/onboard";

/**
 * Flujo real F3.1 (móvil): el programa generado permite restaurar; crear un
 * programa MANUAL desde cero, guardarlo, y que NO permita restaurar; luego
 * entrenar con él (mismo motor de sesiones).
 */
test("crear un programa manual y entrenar con él (Casos A y C)", async ({
  page,
}) => {
  await onboard(page);

  // ── Caso C (generado): el editor ofrece "Restaurar plan inicial" ──────────
  await page.goto("/program");
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(
    page.getByRole("button", { name: "Restaurar plan inicial" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hecho" }).click();

  // ── Caso A: crear un programa manual ──────────────────────────────────────
  await page.getByRole("button", { name: "Crear un programa nuevo" }).click();
  await expect(page).toHaveURL(/\/program\/new$/);
  await expect(
    page.getByRole("heading", { name: "Crear mi programa" }),
  ).toBeVisible();

  // Día 1 está abierto: añadir un ejercicio desde la hoja de búsqueda.
  await page.getByRole("button", { name: "+ Añadir ejercicio" }).click();
  await page
    .getByRole("searchbox", { name: "Buscar ejercicio" })
    .fill("Curl con barra");
  await page
    .getByRole("button", { name: /Curl con barra/ })
    .first()
    .click();
  await page.keyboard.press("Escape");

  // Guardar → vuelve a /program con el programa manual activo.
  await page.getByRole("button", { name: /Guardar programa/ }).click();
  await expect(page).toHaveURL(/\/program$/, { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Mi programa" }),
  ).toBeVisible();

  // Caso C (manual): el editor NO ofrece restaurar.
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(
    page.getByRole("button", { name: "Restaurar plan inicial" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Hecho" }).click();

  // ── Entrenar con el programa manual (mismo motor) ─────────────────────────
  await page.goto("/train");
  await page.getByRole("button", { name: "Empezar entrenamiento" }).click();
  await expect(page).toHaveURL(/\/train\/session\//);
  await expect(page.getByText(/Ejercicio 1\//)).toBeVisible();

  await page
    .getByRole("textbox", { name: "Peso (kg)", exact: true })
    .first()
    .fill("30");
  await page.getByRole("button", { name: "Completar" }).first().click();
  await expect(
    page.getByRole("button", { name: "✓ Hecha" }).first(),
  ).toBeVisible();

  // Único ejercicio → Finalizar directamente.
  await page.getByRole("button", { name: "Finalizar" }).click();
  await expect(page.getByText("¿Cómo ha ido?")).toBeVisible();
  await page.getByRole("button", { name: /Guardar y finalizar/i }).click();
  await expect(page).toHaveURL(/\/train$/, { timeout: 15_000 });

  // Aparece en el historial.
  await page.goto("/train/history");
  await expect(page.getByText(/[1-9]\d* series/).first()).toBeVisible();
});
