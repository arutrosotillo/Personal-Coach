import { expect, test, type Page } from "@playwright/test";

import { onboard } from "./helpers/onboard";
import { discardOpenSession } from "./helpers/session-cleanup";

/**
 * Flujo real de 2B (móvil): sesión 1 → registrar el primer ejercicio (usando
 * "repetir" para copiar la serie anterior) → finalizar. Sesión 2 (mismo
 * programa determinista) → "última vez" por serie visible, badge de sugerencia,
 * "aplicar" rellena la carga, y el mini-historial muestra datos.
 */

async function weightBox(page: Page) {
  return page.getByRole("textbox", { name: "Peso (kg)", exact: true }).first();
}

/** Registra todas las series del ejercicio actual: la 1ª con peso `w`, las
 * siguientes copiando con "repetir". */
async function logCurrentExercise(page: Page, w: string) {
  await (await weightBox(page)).fill(w);
  await page.getByRole("button", { name: "Completar" }).first().click();
  await expect(
    page.getByRole("button", { name: "✓ Hecha" }).first(),
  ).toBeVisible();

  for (let guard = 0; guard < 8; guard++) {
    const pending = page.getByRole("button", { name: "Completar" });
    if ((await pending.count()) === 0) break;
    const repeat = page.getByRole("button", { name: /Repetir/i });
    if ((await repeat.count()) > 0) await repeat.first().click();
    await pending.first().click();
  }
}

async function finishSession(page: Page) {
  const next = page.getByRole("button", { name: "Siguiente" });
  while (await next.isVisible().catch(() => false)) {
    await next.click();
  }
  await page.getByRole("button", { name: "Finalizar" }).click();
  await expect(page.getByText("¿Cómo ha ido?")).toBeVisible();
  await page.getByRole("button", { name: /Guardar y finalizar/i }).click();
  await expect(page).toHaveURL(/\/train$/, { timeout: 15_000 });
}

test("progresión: la sesión anterior alimenta el contexto de la siguiente", async ({
  page,
}) => {
  // ── Sesión 1 ────────────────────────────────────────────────────────────
  await onboard(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empezar entrenamiento" }).click();
  await expect(page.getByText(/Ejercicio 1\//)).toBeVisible();

  // Primera vez: no hay contexto ni sugerencia de subida.
  await expect(page.getByText(/Primera vez con este ejercicio/)).toBeVisible();
  const exerciseName = await page.locator("h1").first().innerText();

  await logCurrentExercise(page, "50");
  await finishSession(page);

  // ── Sesión 2 (repetir la misma plantilla) ────────────────────────────────
  await page.getByRole("button", { name: "Otra vez" }).first().click();
  await expect(page.getByText(/Ejercicio 1\//)).toBeVisible();

  // Mismo primer ejercicio (generador determinista) y contexto "última vez".
  await expect(page.locator("h1").first()).toHaveText(
    new RegExp(exerciseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  await expect(page.getByText(/Última vez \(/)).toBeVisible();
  await expect(page.getByText(/últ 50×/).first()).toBeVisible();

  // Badge de sugerencia visible (Sube/Prueba/Baja/Mantén) y "Aplicar" rellena
  // TODAS las series pendientes con la carga y los objetivos por serie.
  const apply = page.getByRole("button", {
    name: /Rellenar las series pendientes/,
  });
  await expect(apply).toBeVisible();
  // Cambiamos el peso a otro valor y comprobamos que "Aplicar" lo restablece a 50.
  await (await weightBox(page)).fill("30");
  await apply.click();
  await expect(await weightBox(page)).toHaveValue("50");

  // Mini-historial del ejercicio: "Ver historial" abre el resumen.
  await page.getByRole("button", { name: "Ver historial" }).click();
  await expect(page.getByText("Mejor set")).toBeVisible();
  await expect(page.getByText("Tendencia")).toBeVisible();

  // Limpieza: cerrar el drawer y descartar la sesión en curso para no dejar
  // una sesión activa a otras specs (la DB e2e es compartida).
  await page.keyboard.press("Escape");
  await discardOpenSession(page);
});
