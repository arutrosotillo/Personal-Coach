import { expect, test, type Page } from "@playwright/test";

/**
 * Flujo de ejecución de F2A (perfil móvil): onboarding mínimo → empezar sesión
 * → registrar series (guardado inmediato) → reanudar tras recargar (persistencia
 * real, no estado de React) → finalizar con feedback → aparece en el historial.
 * Comparte la DB e2e con el resto de specs, por eso hace su propio onboarding.
 */

async function onboard(page: Page) {
  // Directamente al asistente: esta spec comparte la DB e2e y puede haber un
  // perfil de otra spec; re-ejecutar el onboarding archiva el plan anterior.
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Sobre ti" })).toBeVisible();

  // Perfil
  await page.getByRole("button", { name: "Hombre" }).click();
  await page.locator("#birthDate").fill("1992-03-10");
  await page.locator("#heightCm").fill("178");
  await page.locator("#weightKg").fill("84");
  await page.getByRole("button", { name: "Continuar" }).click();

  // Experiencia (3 días para una semana corta)
  await page.locator("#trainingYears").fill("3");
  await page.getByRole("button", { name: "3 días" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  // Equipamiento (defaults)
  await page.getByRole("button", { name: "Continuar" }).click();

  // Objetivo (ritmo estándar)
  await page.getByRole("button", { name: "Estándar" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  // Prioridades: activar "programa equilibrado" (sin elegir ninguna prioridad)
  await page
    .getByRole("button", { name: /Programa equilibrado, sin prioridad/i })
    .click();
  await page.getByRole("button", { name: "Continuar" }).click();

  // Actividad
  await page.locator("#dailySteps").fill("8000");
  await page.getByRole("button", { name: "Continuar" }).click();

  // Restricciones (ninguna)
  await page.getByRole("button", { name: "Continuar" }).click();

  // Revisión → crear
  await expect(page.getByRole("heading", { name: "Revisión" })).toBeVisible();
  await page
    .getByRole("button", { name: /Confirmar y crear mi plan/i })
    .click();
  await expect(page.getByRole("heading", { name: "Hoy" })).toBeVisible({
    timeout: 15_000,
  });
}

test("ejecutar una sesión: registrar, reanudar tras recarga y finalizar", async ({
  page,
}) => {
  await onboard(page);

  // Ir a Entrenar y empezar la sesión de hoy
  await page.goto("/train");
  await expect(page.getByRole("heading", { name: "Entrenar" })).toBeVisible();
  await page.getByRole("button", { name: "Empezar entrenamiento" }).click();

  // Pantalla de ejecución
  await expect(page).toHaveURL(/\/train\/session\//);
  await expect(page.getByText(/Ejercicio 1\//)).toBeVisible();

  // Registrar la primera serie: introducir peso y completar
  await page
    .getByRole("textbox", { name: "Peso (kg)", exact: true })
    .first()
    .fill("40");
  await page.getByRole("button", { name: "Completar" }).first().click();
  // Queda marcada como hecha y el contador avanza
  await expect(
    page.getByRole("button", { name: "✓ Hecha" }).first(),
  ).toBeVisible();
  await expect(page.getByText(/·\s*1\/\d+ series/)).toBeVisible();

  // Persistencia real: recargar la pantalla de ejecución mantiene la serie hecha
  await page.reload();
  await expect(
    page.getByRole("button", { name: "✓ Hecha" }).first(),
  ).toBeVisible();

  // Volver a Entrenar → hay sesión en curso reanudable
  await page.goto("/train");
  await expect(page.getByText("Sesión en curso")).toBeVisible();
  await page.getByRole("button", { name: "Reanudar sesión" }).click();
  await expect(page).toHaveURL(/\/train\/session\//);
  // La serie sigue registrada tras reanudar (viene del servidor)
  await expect(
    page.getByRole("button", { name: "✓ Hecha" }).first(),
  ).toBeVisible();

  // Ir al último ejercicio para poder finalizar
  const next = page.getByRole("button", { name: "Siguiente" });
  while (await next.isVisible().catch(() => false)) {
    await next.click();
  }
  await page.getByRole("button", { name: "Finalizar" }).click();

  // Feedback → guardar y finalizar
  await expect(page.getByText("¿Cómo ha ido?")).toBeVisible();
  await page.getByRole("button", { name: /Guardar y finalizar/i }).click();

  // De vuelta en Entrenar, y la sesión aparece en el historial
  await expect(page).toHaveURL(/\/train$/, { timeout: 15_000 });
  await page.goto("/train/history");
  await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible();
  await expect(page.getByText(/1 series|[1-9]\d* series/)).toBeVisible();
});
