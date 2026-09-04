import { expect, test } from "@playwright/test";

import { onboard } from "./helpers/onboard";

/**
 * Coach AI y sección Ciencia (móvil).
 *
 * Nota de orden: los specs comparten la base de datos e2e y `onboarding.spec`
 * exige empezar en limpio, así que este fichero se llama `science-coach` para
 * ordenarse DESPUÉS de él.
 *
 * El servidor E2E arranca con `AI_COACH_FAKE=1` y SIN `OPENAI_API_KEY`: nunca
 * se llama a OpenAI, la ruta de éxito usa la respuesta enlatada del proveedor
 * falso. El camino de "clave ausente" no se puede cubrir en el mismo arranque
 * (la variable de entorno es del proceso), así que va en los tests unitarios:
 * `isCoachConfigured()` y `askCoach()` sin proveedor.
 */

test("Ciencia: filosofía, etiquetas de evidencia y bibliografía verificada", async ({
  page,
}) => {
  await page.goto("/science");
  await expect(page.getByRole("heading", { name: "Ciencia" })).toBeVisible();

  // Las tres etiquetas de nivel de evidencia están explicadas.
  await expect(page.getByText("Evidencia fuerte").first()).toBeVisible();
  await expect(page.getByText("Evidencia razonable").first()).toBeVisible();
  await expect(page.getByText("Heurística del sistema").first()).toBeVisible();

  // Secciones de filosofía.
  await expect(
    page.getByRole("heading", { name: "Progressive overload" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "RIR y proximidad al fallo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Volumen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Fatiga y descarga" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coach AI" })).toBeVisible();

  // El ejemplo concreto de progresión aparece.
  await expect(page.getByText(/3×6–8 @1 RIR/).first()).toBeVisible();

  // Bibliografía: al menos una referencia con DOI y enlace clicable.
  await expect(
    page.getByRole("heading", { name: "Bibliografía" }),
  ).toBeVisible();
  await expect(
    page.getByText(/DOI 10\.1007\/s40279-022-01784-y/),
  ).toBeVisible();
  const link = page.getByRole("link", { name: /Abrir referencia/ }).first();
  await expect(link).toHaveAttribute("href", /^https:\/\/doi\.org\//);
  await expect(link).toHaveAttribute("rel", /noopener/);

  // Y el diccionario de reasonCodes del motor.
  await expect(page.getByText("RANGE_CLOSED").first()).toBeVisible();
});

test("Ciencia: se puede navegar en móvil sin scroll a ciegas", async ({
  page,
}) => {
  await page.goto("/science");

  // La página son ~11 pantallas de móvil. Las secciones tenían `id` pero no
  // había un solo enlace que llevara a ellas.
  const indice = page.getByRole("navigation", { name: "Secciones" });
  await expect(indice).toBeVisible();
  const chips = indice.getByRole("link");
  expect(await chips.count()).toBeGreaterThanOrEqual(8);

  // Regla propia del proyecto: cualquier objetivo táctil, ≥44 px.
  for (const chip of await chips.all()) {
    const box = await chip.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  // El chip lleva de verdad a la sección, sin salir de la página.
  await indice.getByRole("link", { name: "Bibliografía" }).click();
  await expect(page).toHaveURL(/#bibliografia$/);
  await expect(
    page.getByRole("heading", { name: "Bibliografía" }),
  ).toBeInViewport();

  // Ningún ítem de la nav inferior corresponde a /science: hace falta salida.
  await page.getByRole("link", { name: /Volver al coach/ }).click();
  await expect(page).toHaveURL(/\/coach$/);
});

test("Coach: resumen semanal, pregunta libre y análisis por ejercicio", async ({
  page,
}) => {
  await onboard(page);

  // La pantalla del coach existe y explica su papel. (El caso "sin sesiones
  // todavía" depende del estado compartido de la DB e2e, así que se cubre en
  // los tests unitarios: `runCoach` devuelve NO_DATA sin llamar al proveedor.)
  await page.goto("/coach");
  await expect(page.getByRole("heading", { name: "Coach" })).toBeVisible();
  await expect(
    page.getByText(/Los motores calculan los números/),
  ).toBeVisible();

  // Registrar una sesión para tener datos.
  await page.goto("/train");
  await page.getByRole("button", { name: "Empezar entrenamiento" }).click();
  await expect(page.getByText(/Ejercicio 1\//)).toBeVisible();
  await page
    .getByRole("textbox", { name: "Peso (kg)", exact: true })
    .first()
    .fill("60");
  const pending = page.getByRole("button", { name: "Completar" });
  for (let guard = 0; guard < 10; guard++) {
    if ((await pending.count()) === 0) break;
    await pending.first().click();
  }

  // Terminar la sesión: hasta que no hay una sesión COMPLETADA, el coach no
  // tiene nada que analizar (y lo dice, en vez de inventar).
  const next = page.getByRole("button", { name: "Siguiente" });
  while (await next.isVisible().catch(() => false)) await next.click();
  await page.getByRole("button", { name: "Finalizar" }).click();
  await expect(page.getByText("¿Cómo ha ido?")).toBeVisible();
  await page.getByRole("button", { name: /Guardar y finalizar/i }).click();
  await expect(page).toHaveURL(/\/train$/, { timeout: 15_000 });

  // Desde el ejercicio: análisis y explicación con AI Coach.
  await page.getByRole("button", { name: "Otra vez" }).first().click();
  await expect(page.getByText(/Ejercicio 1\//)).toBeVisible();
  await page.getByRole("button", { name: "Ver historial" }).click();
  const analyze = page.getByRole("button", { name: /Analizar con AI Coach/ });
  await expect(analyze).toBeVisible();
  await analyze.click();
  await expect(page.getByText(/Semana sólida/)).toBeVisible({
    timeout: 15_000,
  });

  const explain = page.getByRole("button", { name: /¿Por qué hago esto\?/ });
  await expect(explain).toBeVisible();
  await explain.click();
  await expect(page.getByText(/Semana sólida/).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Descartar la sesión abierta para no dejar estado a otros specs.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Descartar sesión" }).click();
  await expect(page).toHaveURL(/\/train$/, { timeout: 15_000 });

  // Resumen semanal bajo demanda.
  await page.goto("/coach");
  await expect(page.getByText(/Resumen semanal/)).toBeVisible();
  await page.getByRole("button", { name: /Generar resumen/ }).click();
  await expect(page.getByText(/Semana sólida/)).toBeVisible({
    timeout: 15_000,
  });
  // Se muestra el coste estimado de la consulta.
  await expect(page.getByText(/tokens/)).toBeVisible();

  // Pregunta libre acotada.
  await page.getByRole("button", { name: "¿Estoy progresando?" }).click();
  await page.getByRole("button", { name: /Preguntar$/ }).click();
  await expect(page.getByText(/Semana sólida/).first()).toBeVisible({
    timeout: 15_000,
  });

  // Estado de recuperación determinista, calculado sin IA.
  await expect(
    page.getByRole("heading", {
      name: /Sin datos suficientes|Fatiga|Recuperación correcta/,
    }),
  ).toBeVisible();

  // Y el enlace a Ciencia.
  await page.getByRole("button", { name: /Ciencia y bibliografía/ }).click();
  await expect(page.getByRole("heading", { name: "Ciencia" })).toBeVisible();
});
