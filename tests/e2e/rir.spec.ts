import { expect, test } from "@playwright/test";

import { onboard } from "./helpers/onboard";

/**
 * Fase 3.2c — integridad del dato de RIR (móvil).
 *
 * El RIR OBJETIVO (prescripción) y el RIR REGISTRADO (lo que el usuario
 * reporta) son cosas distintas. Este spec comprueba explícitamente que:
 *   1. el objetivo se ve;
 *   2. el registrado empieza SIN registrar (nunca prerrellenado con el objetivo);
 *   3. se puede seleccionar un RIR;
 *   4. se puede seleccionar "No lo sé";
 *   5. al volver se conserva exactamente lo introducido (incluido el "no lo sé").
 */

test("RIR: objetivo visible, valor registrado honesto y persistente", async ({
  page,
}) => {
  await onboard(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empezar entrenamiento" }).click();
  await expect(page.getByText(/Ejercicio 1\//)).toBeVisible();

  // ── 1. El RIR OBJETIVO se muestra, etiquetado como objetivo ──────────────
  await expect(page.getByText(/objetivo \d+ RIR/)).toBeVisible();

  const rirGroup = (setIndex: number) =>
    page.getByRole("group", {
      name: new RegExp(`RIR de la serie ${setIndex + 1}`),
    });
  const rirChip = (setIndex: number, value: number) =>
    rirGroup(setIndex).getByRole("button", {
      name: `RIR ${value}`,
      exact: true,
    });
  const dontKnow = (setIndex: number) =>
    rirGroup(setIndex).getByRole("button", { name: "RIR: no lo sé" });

  // ── 2. El valor REGISTRADO empieza sin registrar ─────────────────────────
  // NADA está seleccionado: ni un número ni "No lo sé". Mostrar "No lo sé" ya
  // marcado se leería como una respuesta dada y empujaría a no registrar.
  for (const value of [0, 1, 2, 3]) {
    await expect(rirChip(0, value)).toHaveAttribute("aria-pressed", "false");
  }
  await expect(dontKnow(0)).toHaveAttribute("aria-pressed", "false");

  // ── 3. Se puede seleccionar un RIR concreto ──────────────────────────────
  await page
    .getByRole("textbox", { name: "Peso (kg)", exact: true })
    .first()
    .fill("50");
  await rirChip(0, 2).click();
  await expect(rirChip(0, 2)).toHaveAttribute("aria-pressed", "true");
  await expect(dontKnow(0)).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Completar" }).first().click();
  await expect(
    page.getByRole("button", { name: "✓ Hecha" }).first(),
  ).toBeVisible();

  // ── 4. "Repetir" copia el PLAN, no el esfuerzo: el RIR sigue sin registrar
  await page
    .getByRole("button", { name: /Repetir/i })
    .first()
    .click();
  await expect(dontKnow(1)).toHaveAttribute("aria-pressed", "false");
  await expect(rirChip(1, 2)).toHaveAttribute("aria-pressed", "false");
  // Y se puede elegir "No lo sé" explícitamente.
  await dontKnow(1).click();
  await expect(dontKnow(1)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Completar" }).first().click();

  // ── 5. Persistencia exacta tras recargar ─────────────────────────────────
  await page.reload();
  await expect(page.getByText(/Ejercicio 1\//)).toBeVisible();
  await expect(rirChip(0, 2)).toHaveAttribute("aria-pressed", "true");
  await expect(dontKnow(1)).toHaveAttribute("aria-pressed", "true");
  await expect(rirChip(1, 2)).toHaveAttribute("aria-pressed", "false");

  // "+ Añadir serie" hereda el plan, nunca el esfuerzo de la serie anterior.
  await page.getByRole("button", { name: /Añadir serie/i }).click();
  await expect(dontKnow(2)).toHaveAttribute("aria-pressed", "false");
  await expect(rirChip(2, 2)).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: /Quitar serie/i }).click();

  // Corregir el RIR de una serie YA completada también se guarda.
  await rirChip(0, 3).click();
  await expect(rirChip(0, 3)).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(rirChip(0, 3)).toHaveAttribute("aria-pressed", "true");

  // ── Cierre: finalizar y comprobar el contexto "última vez" ───────────────
  const remaining = page.getByRole("button", { name: "Completar" });
  for (let guard = 0; guard < 8; guard++) {
    if ((await remaining.count()) === 0) break;
    await remaining.first().click();
  }
  const next = page.getByRole("button", { name: "Siguiente" });
  while (await next.isVisible().catch(() => false)) await next.click();
  await page.getByRole("button", { name: "Finalizar" }).click();
  await expect(page.getByText("¿Cómo ha ido?")).toBeVisible();
  await page.getByRole("button", { name: /Guardar y finalizar/i }).click();
  await expect(page).toHaveURL(/\/train$/, { timeout: 15_000 });

  // La "última vez" muestra el RIR de la serie 1 (3) y NADA para la serie 2,
  // que se registró como "no lo sé": no se inventa un valor.
  await page.getByRole("button", { name: "Repetir" }).click();
  await expect(page.getByText(/Ejercicio 1\//)).toBeVisible();
  const lastTime = page.getByText(/Última vez \(/);
  await expect(lastTime).toContainText("50×");
  await expect(lastTime).toContainText("@3");
  await expect(page.getByText(/últ 50×\d+$/).first()).toBeVisible();

  // Limpieza: la DB e2e es compartida entre specs.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/train$/, { timeout: 15_000 });
});
