import { expect, test } from "@playwright/test";

/**
 * Flujo principal de F1: usuario nuevo → onboarding completo → dashboard
 * con objetivo y programa → recarga → los datos persisten.
 */
test("onboarding completo crea el plan y persiste tras recargar", async ({
  page,
}) => {
  await page.goto("/");

  // Estado vacío → CTA de onboarding
  await page.getByRole("button", { name: /Empezar — crear mi plan/i }).click();
  await expect(page.getByRole("heading", { name: "Sobre ti" })).toBeVisible();

  // Paso 1 — Perfil básico
  await page.getByRole("button", { name: "Hombre" }).click();
  await page.locator("#birthDate").fill("1992-03-10");
  await page.locator("#heightCm").fill("178");
  await page.locator("#weightKg").fill("84");
  await page.locator("#waistCm").fill("88");
  await page.getByRole("button", { name: "Continuar" }).click();

  // Paso 2 — Experiencia (días y minutos tienen defaults; años es obligatorio)
  await expect(
    page.getByRole("heading", { name: "Tu experiencia" }),
  ).toBeVisible();
  await page.locator("#trainingYears").fill("3");
  await page.getByRole("button", { name: "5 días" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  // Paso 3 — Equipamiento (defaults razonables ya marcados)
  await expect(
    page.getByRole("heading", { name: "Tu equipamiento" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();

  // Paso 4 — Objetivo (FAT_LOSS por defecto; elegimos ritmo estándar)
  await expect(
    page.getByRole("heading", { name: "Tu objetivo" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Estándar" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  // Paso 5 — Prioridades (opcional)
  await expect(
    page.getByRole("heading", { name: "Prioridades musculares" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bíceps" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  // Paso 6 — Actividad
  await expect(
    page.getByRole("heading", { name: "Actividad y nutrición" }),
  ).toBeVisible();
  await page.locator("#dailySteps").fill("8500");
  await page.getByRole("button", { name: "Continuar" }).click();

  // Paso 7 — Restricciones (rodilla como molestia)
  await expect(
    page.getByRole("heading", { name: "Molestias y exclusiones" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rodilla" }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  // Paso 8 — Revisión: muestra qué se creará
  await expect(page.getByRole("heading", { name: "Revisión" })).toBeVisible();
  await expect(page.getByText(/kcal\/día/).first()).toBeVisible();
  await expect(
    page.getByText(/Torso\/Pierna \+ especialización/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Confirmar y crear mi plan/i })
    .click();

  // Dashboard con el plan creado
  await expect(page.getByRole("heading", { name: "Hoy" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Perder grasa")).toBeVisible();
  await expect(page.getByText(/g proteína/)).toBeVisible();
  await expect(page.getByText(/5 días\/semana/)).toBeVisible();

  // Persistencia tras recarga
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hoy" })).toBeVisible();
  await expect(page.getByText("Perder grasa")).toBeVisible();

  // El programa respeta la restricción y está completo
  await page.goto("/program");
  await expect(page.getByText(/Día 1 —/)).toBeVisible();
  await expect(page.getByText("Sentadilla trasera")).toHaveCount(0); // contraindicada por rodilla
});
