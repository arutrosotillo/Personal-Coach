import { expect, test } from "@playwright/test";

import { onboard } from "./helpers/onboard";

/**
 * Notas personales del banco (perfil móvil): apuntar la señal técnica desde la
 * biblioteca, verla EN LA SESIÓN —que es donde se lee, justo antes de la
 * serie—, editarla sin salir de ahí y borrarla guardándola vacía.
 *
 * Se comprueba tras recargar en cada paso: lo que se prueba es que la nota está
 * guardada de verdad, no que el estado de React la recuerde.
 */
test("nota de ejercicio: se apunta, se lee en la sesión, se edita y se borra", async ({
  page,
}) => {
  await onboard(page);

  // Empezar la sesión para saber qué ejercicio toca hoy: la nota se anota en
  // ese, y así se puede comprobar que aparece en la pantalla de ejecución.
  await page.goto("/train");
  await page.getByRole("button", { name: "Empezar entrenamiento" }).click();
  await expect(page).toHaveURL(/\/train\/session\//);
  const sessionUrl = page.url();
  const exerciseName = (
    await page.getByRole("heading", { level: 1 }).textContent()
  )?.trim();
  expect(exerciseName).toBeTruthy();

  // Apuntarla desde la biblioteca.
  await page.goto("/train/exercises");
  await page
    .getByRole("searchbox", { name: "Buscar ejercicio" })
    .fill(exerciseName as string);
  await page
    .getByRole("button", { name: new RegExp(exerciseName as string) })
    .first()
    .click();
  await page.getByRole("button", { name: "+ Añadir nota" }).first().click();
  await page
    .getByRole("textbox", { name: `Nota sobre ${exerciseName}` })
    .fill("Piernas encogidas, no estiradas");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Piernas encogidas, no estiradas")).toBeVisible();

  // Sobrevive a la recarga: está en la base, no en el estado del componente.
  await page.reload();
  await page
    .getByRole("searchbox", { name: "Buscar ejercicio" })
    .fill(exerciseName as string);
  await page
    .getByRole("button", { name: new RegExp(exerciseName as string) })
    .first()
    .click();
  await expect(page.getByText("Piernas encogidas, no estiradas")).toBeVisible();

  // Y se lee en la sesión, junto al ejercicio.
  await page.goto(sessionUrl);
  await expect(page.getByText("Mi nota")).toBeVisible();
  await expect(page.getByText("Piernas encogidas, no estiradas")).toBeVisible();

  // Editarla desde la propia sesión, sin salir.
  await page
    .getByRole("button", { name: `Editar mi nota sobre ${exerciseName}` })
    .click();
  await page
    .getByRole("textbox", { name: `Nota sobre ${exerciseName}` })
    .fill("Omóplatos retraídos");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Omóplatos retraídos")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Omóplatos retraídos")).toBeVisible();

  // Guardarla vacía la borra.
  await page
    .getByRole("button", { name: `Editar mi nota sobre ${exerciseName}` })
    .click();
  await page
    .getByRole("textbox", { name: `Nota sobre ${exerciseName}` })
    .fill("");
  await expect(page.getByText("Vacía = borrar la nota")).toBeVisible();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(
    page.getByRole("button", { name: "+ Añadir nota" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "+ Añadir nota" }),
  ).toBeVisible();
});
