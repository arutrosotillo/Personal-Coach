import { expect, test } from "@playwright/test";

import { onboard } from "./helpers/onboard";

/**
 * Seguimiento corporal de punta a punta, en el navegador y con el perfil móvil
 * que usa la app de verdad.
 *
 * Cubre el camino completo: perfil recién creado que solo tiene la medición
 * del onboarding → anotar el peso desde "Hoy" → verlo en `/progress` →
 * editarlo añadiendo cintura → borrarlo con confirmación.
 *
 * Comparte la base e2e con el resto de specs, por eso hace su propio
 * onboarding: re-ejecutarlo archiva el plan anterior y deja un perfil limpio.
 */

test.describe.configure({ mode: "serial" });

test("un perfil recién creado ve una pantalla útil, no una rota", async ({
  page,
}) => {
  await onboard(page);
  await page.goto("/progress");

  // El peso del onboarding SÍ se enseña: con un dato se puede afirmar el dato.
  await expect(page.getByRole("heading", { name: "Progreso" })).toBeVisible();
  await expect(page.getByText("84,0", { exact: false }).first()).toBeVisible();

  // Y lo que no se puede calcular, se dice sin rodeos, con la salida a mano.
  await expect(
    page.getByText("Aún faltan mediciones para calcular una tendencia."),
  ).toBeVisible();
  await expect(
    page.getByText(/Con unos cuantos pesajes más podré calcular tu tendencia/),
  ).toBeVisible();

  // Sin tendencia, la tarjeta de peso no enseña NINGUNA pendiente. Se acota a
  // esa tarjeta a propósito: el ritmo OBJETIVO sí se enseña en la del objetivo,
  // porque es lo que el usuario pidió, no lo que el motor ha medido.
  const tarjetaPeso = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Aún faltan mediciones" });
  await expect(tarjetaPeso.getByText(/kg\/semana/)).toHaveCount(0);
  // Y el ritmo real se declara ausente en vez de inventarse.
  await expect(page.getByText("Sin tendencia todavía")).toBeVisible();

  // El historial ya tiene la medición del onboarding y se puede tocar.
  await expect(
    page.getByRole("button", { name: /^Editar la medición/ }),
  ).toHaveCount(1);
});

test("anotar el peso del día desde Hoy, y corregirlo", async ({ page }) => {
  await page.goto("/");

  // El onboarding ya dejó el peso de hoy, así que la tarjeta ofrece corregir.
  await expect(page.getByText("Tu peso de hoy")).toBeVisible();
  await page.getByRole("button", { name: "Corregir" }).click();

  const campo = page.locator("#quick-weight");
  await expect(campo).toBeVisible();
  await campo.fill("83,2");
  await page.getByRole("button", { name: "Guardar" }).click();

  // Feedback inmediato y el valor nuevo en su sitio. Se acota a la tarjeta
  // porque el toast también contiene el número.
  await expect(page.getByText(/Peso de hoy guardado/)).toBeVisible();
  const tarjeta = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Tu peso de hoy" });
  await expect(tarjeta.getByText("83,2 kg")).toBeVisible();

  // Y persiste: no es solo estado de React.
  await page.reload();
  await expect(
    page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Tu peso de hoy" })
      .getByText("83,2 kg"),
  ).toBeVisible();
});

test("editar una medición añade cintura sin perder el peso", async ({
  page,
}) => {
  await page.goto("/progress");
  await page
    .getByRole("button", { name: /^Editar la medición/ })
    .first()
    .click();

  // El formulario enseña los tres campos: guardar declara el día entero, así
  // que esconder alguno lo borraría en silencio.
  await expect(page.getByLabel("Peso (kg)")).toHaveValue("83,2");
  await page.getByLabel("Cintura (cm)").fill("88");
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByText(/Medición del .* guardada/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/83,2 kg · cintura 88,0 cm/)).toBeVisible();
});

test("borrar pide confirmación y no borra a la primera", async ({ page }) => {
  await page.goto("/progress");
  const filas = page.getByRole("button", { name: /^Borrar la medición/ });
  await expect(filas).toHaveCount(1);

  await filas.first().click();

  // Primer paso: pregunta, no borra.
  await expect(page.getByText(/¿Borrar la medición del/)).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByText(/¿Borrar la medición del/)).toHaveCount(0);
  await expect(filas).toHaveCount(1);

  // Segundo intento, hasta el final.
  await filas.first().click();
  await page.getByRole("button", { name: "Borrar", exact: true }).click();
  await expect(page.getByText(/borrada/)).toBeVisible();

  await page.reload();
  await expect(
    page.getByText("Todavía no has registrado ninguna medición."),
  ).toBeVisible();
  // Sin ninguna fila, la pantalla ofrece crear la de hoy.
  await expect(
    page.getByRole("button", { name: "Añadir medición de hoy" }),
  ).toBeVisible();
});

test("la pantalla funciona en móvil estrecho y en escritorio", async ({
  page,
}) => {
  // Se vuelve a dejar una medición para tener gráfico y tarjetas.
  await page.goto("/");
  await page.getByRole("button", { name: "Guardar" }).isVisible();
  const campo = page.locator("#quick-weight");
  if (await campo.isVisible()) {
    await campo.fill("83");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(/Peso de hoy guardado/)).toBeVisible();
  }

  for (const viewport of [
    { name: "móvil estrecho", width: 320, height: 640 },
    { name: "escritorio", width: 1440, height: 900 },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/progress");
    await expect(page.getByRole("heading", { name: "Progreso" })).toBeVisible();

    // Nada se sale por el lado: el desbordamiento horizontal es EL fallo
    // clásico de meter un SVG en una tarjeta.
    const desbordamiento = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(desbordamiento, `desborda en ${viewport.name}`).toBeLessThanOrEqual(
      1,
    );
  }
});

test("sin historial de entrenamiento NO se enseña ningún insight", async ({
  page,
}) => {
  // La regla de B5: si el motor no tiene nada defendible que decir, la
  // pantalla no rellena hueco. Este perfil tiene peso pero ninguna sesión, así
  // que el cruce cuerpo × rendimiento no puede afirmar nada.
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Progreso" })).toBeVisible();

  // Ninguna de las frases del cruce puede aparecer.
  for (const frase of [
    /tus cargas suben/i,
    /han ido hacia atrás/i,
    /rendimiento se mantiene/i,
  ]) {
    await expect(page.getByText(frase)).toHaveCount(0);
  }
});

test("check-in: tres tomas, media, y no vuelve a tocar hasta dentro de dos semanas", async ({
  page,
}) => {
  await page.goto("/progress");

  // El perfil solo tiene la cintura del onboarding (o ninguna): toca.
  await page.getByRole("button", { name: /^Hacer el check-in$/ }).click();
  await expect(page.getByText("Cintura, tres veces seguidas")).toBeVisible();

  await page.getByLabel("1.ª toma").fill("91,5");
  await page.getByLabel("2.ª toma").fill("92");
  await page.getByLabel("3.ª toma").fill("91,8");
  // La media se calcula en vivo, para que se vea qué se va a guardar.
  await expect(page.getByText("Media: 91,8 cm")).toBeVisible();

  await page.getByRole("button", { name: "Guardar check-in" }).click();
  await expect(page.getByText("Check-in guardado.")).toBeVisible();

  await page.reload();
  // Ya no toca, y la tarjeta lo dice sin regañar.
  await expect(page.getByText("Próximo check-in")).toBeVisible();
  await expect(page.getByText(/La siguiente, hacia el/)).toBeVisible();
  // Y la media quedó guardada como la cintura del día.
  await expect(page.getByText(/cintura 91,8 cm/)).toBeVisible();
});

test("check-in: tres tomas incoherentes se rechazan en vez de promediarse", async ({
  page,
}) => {
  await page.goto("/progress");
  await page.getByRole("button", { name: /Hacer el check-in/ }).click();

  await page.getByLabel("1.ª toma").fill("88");
  await page.getByLabel("2.ª toma").fill("92");
  await page.getByLabel("3.ª toma").fill("99");
  await page.getByRole("button", { name: "Guardar check-in" }).click();

  await expect(page.getByText(/se diferencian/)).toBeVisible();
});

test("cambiar de fase avisa ANTES y reinicia la tendencia, sin borrar el historial", async ({
  page,
}) => {
  await page.goto("/progress");

  // Cuántos pesajes hay antes de tocar nada.
  const filasAntes = await page
    .getByRole("button", { name: /^Editar la medición/ })
    .count();

  await page.getByRole("button", { name: /Hacer el check-in/ }).click();
  await page.getByRole("button", { name: "Revisar objetivo" }).click();

  // Cambiar solo el peso objetivo NO avisa de fase nueva.
  await page.getByLabel("Peso objetivo (kg)").fill("77");
  await expect(page.getByText(/empieza una fase nueva/)).toHaveCount(0);

  // Cambiar la estrategia SÍ, y el aviso aparece antes de pulsar nada.
  // Por id y no por etiqueta: "Objetivo" también casa con "Peso objetivo".
  await page.locator("#goal-strategy").selectOption("MAINTENANCE");
  await expect(page.getByText(/empieza una fase nueva/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Empezar fase nueva" }),
  ).toBeVisible();

  await page.getByLabel("Ritmo (% peso/semana)").fill("0");
  await page.getByLabel("Peso objetivo (kg)").fill("");
  await page.getByRole("button", { name: "Empezar fase nueva" }).click();
  await expect(page.getByText(/Nueva fase empezada hoy/)).toBeVisible();

  await page.reload();
  // La tendencia se reinicia: es la consecuencia correcta, no un fallo.
  await expect(
    page.getByText("Aún faltan mediciones para calcular una tendencia."),
  ).toBeVisible();
  // La nota de fase NO aparece aquí, y es correcto: solo se enseña cuando el
  // recorte deja fuera mediciones anteriores, y en este perfil no hay ninguna
  // antes de hoy. Explicar un recorte que no recorta nada sería ruido.
  await expect(page.getByText(/Tu fase actual empezó el/)).toHaveCount(0);
  // Y NO se ha borrado nada del historial.
  await expect(
    page.getByRole("button", { name: /^Editar la medición/ }),
  ).toHaveCount(filasAntes);
});
