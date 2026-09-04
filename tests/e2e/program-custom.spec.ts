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

  // ── Reactivar un programa archivado (el generado del onboarding) ──────────
  await page.goto("/program/history");
  await expect(
    page.getByRole("heading", { name: "Programas anteriores" }),
  ).toBeVisible();
  // El generado del onboarding está archivado y marcado como "Generado".
  await expect(page.getByText(/Generado/).first()).toBeVisible();
  await page.getByRole("button", { name: "Reactivar" }).first().click();
  await expect(page.getByText(/Tu programa actual se archivará/)).toBeVisible();
  await page.getByRole("button", { name: "Confirmar reactivar" }).click();

  // Vuelve a /program con el generado activo (ofrece "Restaurar plan inicial").
  await expect(page).toHaveURL(/\/program$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(
    page.getByRole("button", { name: "Restaurar plan inicial" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hecho" }).click();

  // Vuelta completa generado → manual: el manual reaparece archivado, se puede
  // reactivar y conserva tanto su origen (sin Restore) como su historial.
  await page.goto("/program/history");
  const manualCard = page
    .getByText("Mi programa", { exact: true })
    .locator("..");
  await manualCard.getByRole("button", { name: "Reactivar" }).click();
  await manualCard.getByRole("button", { name: "Confirmar reactivar" }).click();
  await expect(page).toHaveURL(/\/program$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(
    page.getByRole("button", { name: "Restaurar plan inicial" }),
  ).toHaveCount(0);
  await page.goto("/train/history");
  await expect(page.getByText(/[1-9]\d* series/).first()).toBeVisible();
});

test("crear un ejercicio sin salir del builder y añadirlo al programa", async ({
  page,
}) => {
  // El hueco que motivó esto: descubres a mitad de armar el programa que tu
  // gimnasio tiene algo que el catálogo no cubre, y la única salida era irse a
  // la biblioteca y perder el hilo.
  await onboard(page);
  await page.goto("/program/new");
  await expect(
    page.getByRole("heading", { name: "Crear mi programa" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "+ Añadir ejercicio" }).click();
  // Se busca algo que NO existe: el picker lo dice y ofrece crearlo.
  await page
    .getByRole("searchbox", { name: "Buscar ejercicio" })
    .fill("Prensa Nautilus del gimnasio de abajo");
  await expect(page.getByText(/Sin resultados/)).toBeVisible();

  await page.getByRole("button", { name: "+ Crear ejercicio" }).click();
  await expect(
    page.getByRole("heading", { name: "Nuevo ejercicio" }),
  ).toBeVisible();

  await page
    .getByLabel("Nombre", { exact: true })
    .fill("Prensa Nautilus del gimnasio de abajo");
  // El mismo músculo aparece en "principal" y en "secundarios": el primero del
  // DOM es el principal.
  await page
    .getByRole("button", { name: "Cuádriceps", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Dominante de rodilla", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Máquina", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Añadir a mi banco" }).click();

  // El picker sigue abierto para poder añadir más, igual que al elegir del
  // catálogo; el ejercicio nuevo ya aparece ahí marcado como añadido.
  await expect(page.getByText("✓ añadido")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Hecho" }).click();

  // Y queda en el día EN EL MISMO GESTO: no hay que volver a buscarlo. Con el
  // RIR que le toca por su patrón y material (compuesto guiado → 1), no un
  // literal: es el mismo motor de defaults que el resto del catálogo.
  await expect(
    page.getByRole("button", {
      name: /Prensa Nautilus del gimnasio de abajo — Máquina.*RIR 1/,
    }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Guardar programa/ }).click();
  await expect(page).toHaveURL(/\/program$/, { timeout: 15_000 });
  await expect(
    page.getByText("Prensa Nautilus del gimnasio de abajo").first(),
  ).toBeVisible();

  // Y aparece en la biblioteca, como cualquier otro ejercicio.
  await page.goto("/train/exercises");
  await page
    .getByRole("searchbox", { name: "Buscar ejercicio" })
    .fill("Prensa Nautilus");
  await expect(
    page.getByRole("button", { name: /Prensa Nautilus del gimnasio de abajo/ }),
  ).toBeVisible();
});
