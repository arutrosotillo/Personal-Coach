import { expect, type Page } from "@playwright/test";

/**
 * Deja la cuenta sin ninguna sesión de entrenamiento en curso.
 *
 * Existe porque la base E2E es COMPARTIDA por todas las specs y
 * `completeOnboarding` se niega a cambiar de programa mientras haya una sesión
 * IN_PROGRESS. Sin esto, una sola spec que se deje una sesión abierta —por un
 * fallo suyo o por un `confirm()` que no se aceptó— tumba en cascada a todas
 * las que vengan detrás con "Finaliza o descarta la sesión en curso antes de
 * cambiar de programa", y el informe señala a la spec equivocada.
 *
 * Se llama al empezar el onboarding, que es el punto por el que pasan todas.
 */
export async function discardActiveSession(page: Page) {
  await page.goto("/train");
  const reanudar = page.getByRole("button", { name: "Reanudar sesión" });
  if (!(await reanudar.isVisible().catch(() => false))) return;
  await reanudar.click();
  await expect(page).toHaveURL(/\/train\/session\//);
  await discardOpenSession(page);
}

/** Descarta la sesión que ya está abierta en pantalla. */
export async function discardOpenSession(page: Page) {
  const boton = page.getByRole("button", { name: "Descartar sesión" });
  // Descartar necesita servidor: el botón está deshabilitado si no responde.
  await expect(boton).toBeEnabled({ timeout: 30_000 });
  await waitForToasts(page);
  page.once("dialog", (d) => void d.accept());
  await boton.click();
  await expect(page).toHaveURL(/\/train$/, { timeout: 30_000 });
}

/**
 * Espera a que no quede ningún toast en pantalla antes de pulsar algo.
 *
 * Los toasts salen en `position="top-center"`, justo encima de la cabecera de
 * la sesión donde vive "✕ Descartar", así que tapan el botón durante sus
 * cuatro segundos. Y no basta con reintentar el clic: sonner PAUSA el
 * temporizador de cierre mientras el puntero está sobre el toast, y el puntero
 * de Playwright se queda ahí en cuanto intenta pulsar debajo. El toast no se
 * cierra nunca, el clic no llega nunca, y el test agota su tiempo.
 *
 * Por eso se espera ANTES de mover el ratón: sin puntero encima, el toast
 * caduca solo.
 */
export async function waitForToasts(page: Page) {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 15_000,
  });
}
