import { expect, type Page } from "@playwright/test";

import { discardActiveSession } from "./session-cleanup";

/**
 * Completa el onboarding con datos fijos (programa equilibrado, 3 días). El
 * generador es determinista: repetir el onboarding con los mismos datos produce
 * el mismo programa (mismas variantes), lo que permite probar el contexto
 * "última vez" entre dos sesiones.
 *
 * Empieza descartando cualquier sesión en curso: la base E2E es compartida y
 * el onboarding se niega a cambiar de programa mientras haya una abierta.
 */
export async function onboard(page: Page) {
  await discardActiveSession(page);
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Sobre ti" })).toBeVisible();

  await page.getByRole("button", { name: "Hombre" }).click();
  await page.locator("#birthDate").fill("1992-03-10");
  await page.locator("#heightCm").fill("178");
  await page.locator("#weightKg").fill("84");
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.locator("#trainingYears").fill("3");
  await page.getByRole("button", { name: "3 días" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  await page.getByRole("button", { name: "Continuar" }).click(); // equipamiento

  await page.getByRole("button", { name: "Estándar" }).click();
  await page.getByRole("button", { name: "Continuar" }).click(); // objetivo

  await page
    .getByRole("button", { name: /Programa equilibrado, sin prioridad/i })
    .click();
  await page.getByRole("button", { name: "Continuar" }).click(); // prioridades

  await page.locator("#dailySteps").fill("8000");
  await page.getByRole("button", { name: "Continuar" }).click(); // actividad

  await page.getByRole("button", { name: "Continuar" }).click(); // restricciones

  await expect(page.getByRole("heading", { name: "Revisión" })).toBeVisible();
  await page
    .getByRole("button", { name: /Confirmar y crear mi plan/i })
    .click();
  await expect(page.getByRole("heading", { name: "Hoy" })).toBeVisible({
    timeout: 15_000,
  });
}
