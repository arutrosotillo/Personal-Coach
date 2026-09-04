import { expect, test, type Page } from "@playwright/test";

import { onboard } from "./helpers/onboard";

/**
 * Notas personales del banco (perfil móvil).
 *
 * La nota es de la VARIANTE que estás haciendo, no del movimiento: "con el
 * bloque azul en la espalda" es verdad en el press inclinado en máquina y
 * mentira con mancuernas. Aquí se prueba el recorrido completo —apuntarla en la
 * sesión, que es donde se lee; verla en la biblioteca; editarla; borrarla— y,
 * sobre todo, que no aparece en la variante de al lado.
 *
 * Se comprueba tras recargar en cada paso: lo que se prueba es que la nota está
 * guardada de verdad, no que el estado de React la recuerde.
 */

/** Nombre del ejercicio y de la variante que toca ahora mismo en la sesión. */
async function ejercicioActual(page: Page): Promise<string> {
  const nombre = (
    await page.getByRole("heading", { level: 1 }).textContent()
  )?.trim();
  if (!nombre) throw new Error("La sesión no muestra ningún ejercicio.");
  return nombre;
}

/** La etiqueta accesible del editor incluye ejercicio y variante. */
function editorDe(page: Page) {
  return page.getByRole("textbox", { name: /^Nota sobre / });
}

test("nota de ejercicio: se apunta en la sesión, se lee, se edita y se borra", async ({
  page,
}) => {
  await onboard(page);

  await page.goto("/train");
  await page.getByRole("button", { name: "Empezar entrenamiento" }).click();
  await expect(page).toHaveURL(/\/train\/session\//);
  const sessionUrl = page.url();
  const primerEjercicio = await ejercicioActual(page);

  // Apuntarla donde de verdad se escribe: en medio de la serie.
  await page.getByRole("button", { name: "+ Añadir nota" }).first().click();
  await editorDe(page).fill("Asiento en el 4, agarre neutro");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Asiento en el 4, agarre neutro")).toBeVisible();
  // Guardar es local-first: la nota se pinta sin esperar al servidor. Antes de
  // recargar hay que dejar que el lote llegue, o se comprobaría otra cosa.
  await expect(page.locator("header").getByRole("status")).toHaveText(
    /Guardado/,
    { timeout: 30_000 },
  );

  // Sobrevive a la recarga: está en la base, no en el estado del componente.
  await page.reload();
  await expect(page.getByText("Mi nota")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Asiento en el 4, agarre neutro")).toBeVisible();

  // No se ha derramado sobre los demás ejercicios de la sesión.
  await page.getByRole("button", { name: "Siguiente" }).click();
  const segundoEjercicio = await ejercicioActual(page);
  expect(segundoEjercicio).not.toBe(primerEjercicio);
  await expect(page.getByText("Asiento en el 4, agarre neutro")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Añadir nota" })).toBeVisible();
  await page.getByRole("button", { name: "Anterior", exact: true }).click();

  // Editarla sin salir de la sesión.
  await page
    .getByRole("button", { name: /^Editar mi nota sobre / })
    .first()
    .click();
  await editorDe(page).fill("Asiento en el 4, agarre neutro y codos pegados");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(
    page.getByText("Asiento en el 4, agarre neutro y codos pegados"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Asiento en el 4, agarre neutro y codos pegados"),
  ).toBeVisible({ timeout: 30_000 });

  // Y se ve también en la biblioteca, colgando de SU variante.
  await page.goto("/train/exercises");
  await page
    .getByRole("searchbox", { name: "Buscar ejercicio" })
    .fill(primerEjercicio);
  await page
    .getByRole("button", { name: new RegExp(primerEjercicio) })
    .first()
    .click();
  await expect(
    page.getByText("Asiento en el 4, agarre neutro y codos pegados"),
  ).toBeVisible();

  // Guardarla vacía la borra.
  await page.goto(sessionUrl);
  await page
    .getByRole("button", { name: /^Editar mi nota sobre / })
    .first()
    .click();
  await editorDe(page).fill("");
  await expect(page.getByText("Vacía = borrar la nota")).toBeVisible();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(
    page.getByRole("button", { name: "+ Añadir nota" }).first(),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("button", { name: "+ Añadir nota" }).first(),
  ).toBeVisible({ timeout: 30_000 });
});
