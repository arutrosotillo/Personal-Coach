import { expect, test, type Page } from "@playwright/test";

import { discardActiveSession } from "./helpers/session-cleanup";

/**
 * Flujo de ejecución de F2A (perfil móvil): onboarding mínimo → empezar sesión
 * → registrar series (guardado inmediato) → reanudar tras recargar (persistencia
 * real, no estado de React) → finalizar con feedback → aparece en el historial.
 * Comparte la DB e2e con el resto de specs, por eso hace su propio onboarding.
 */

async function onboard(page: Page) {
  // Directamente al asistente: esta spec comparte la DB e2e y puede haber un
  // perfil de otra spec; re-ejecutar el onboarding archiva el plan anterior.
  // Antes hay que descartar cualquier sesión en curso: con una abierta, el
  // onboarding se niega a cambiar de programa.
  await discardActiveSession(page);
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

  // Registrar la primera serie: introducir peso y completar.
  // Antes se teclea una coma: el teclado decimal del iPhone en es-ES no ofrece
  // punto, y "62,5" tiene que entrar como 62,5 kg en vez de obligar a redondear.
  const peso = page
    .getByRole("textbox", { name: "Peso (kg)", exact: true })
    .first();
  await peso.fill("62,5");
  await expect(peso).toHaveValue("62.5");
  await peso.fill("40");
  await page.getByRole("button", { name: "Completar" }).first().click();
  // Queda marcada como hecha y el contador avanza
  await expect(
    page.getByRole("button", { name: "✓ Hecha" }).first(),
  ).toBeVisible();
  await expect(page.getByText(/·\s*1\/\d+ series/)).toBeVisible();

  // Persistencia real EN EL SERVIDOR: se espera al indicador de la cabecera
  // antes de recargar. Desde que la sesión es local-first, "✓ Hecha" solo
  // promete "guardado en este móvil"; recargar sin esperar comprobaría el
  // cuaderno local, que no es lo que este test quiere probar.
  await expect(page.locator("header").getByRole("status")).toHaveText(
    /Guardado/,
    { timeout: 30_000 },
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "✓ Hecha" }).first(),
  ).toBeVisible();

  // Sustituir tras haber registrado una serie elimina la serie anterior en DB
  // y debe reinicializar también el estado cliente (sin "hechas" fantasma).
  await page.getByRole("button", { name: "Sustituir ejercicio" }).click();
  await page
    .getByRole("searchbox", { name: "Buscar ejercicio para sustituir" })
    .fill("Curl con barra");
  await page
    .getByRole("button", { name: /Curl con barra/ })
    .first()
    .click();
  await expect(page.getByText("Ejercicio sustituido")).toBeVisible();
  await expect(page.getByRole("button", { name: "✓ Hecha" })).toHaveCount(0);
  await page.getByRole("button", { name: "Completar" }).first().click();
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

  // Feedback → guardar y finalizar.
  //
  // Los chips de esta pantalla (fatiga, dolor articular, motivación,
  // rendimiento percibido) son la ÚNICA entrada del motor de fatiga de F3.3.
  // Antes se pulsaba "Guardar y finalizar" sin tocar ninguno, así que si el
  // guardado de estos valores se rompiera, el motor se quedaría ciego y ningún
  // test se enteraría.
  await expect(page.getByText("¿Cómo ha ido?")).toBeVisible();
  for (const escala of [
    "Rendimiento",
    "Molestias articulares",
    "Fatiga (opcional)",
  ]) {
    await page
      .getByRole("group", { name: escala })
      .getByRole("button", { name: "4", exact: true })
      .click();
  }
  await page.getByRole("button", { name: /Guardar y finalizar/i }).click();

  // De vuelta en Entrenar, y la sesión aparece en el historial
  await expect(page).toHaveURL(/\/train$/, { timeout: 15_000 });
  await page.goto("/train/history");
  await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible();
  // (La DB e2e es compartida: puede haber más de una sesión en el historial.)
  await expect(page.getByText(/[1-9]\d* series/).first()).toBeVisible();

  // Y el feedback llegó de verdad a la sesión: la tarjeta de recuperación de
  // /train lo cuenta entre las sesiones que ha podido valorar.
  await page.goto("/train");
  await expect(
    page.getByText(/sesi[oó]n(es)? en \d+ días/).first(),
  ).toBeVisible();
});

test("la acción principal de /train se alcanza sin scroll", async ({
  page,
}) => {
  // Regresión medida en revisión: la tarjeta de recuperación (634 px) se
  // pintaba ENCIMA de "Hoy toca", así que en un Pixel 7 el botón primario caía
  // por debajo de la nav fija — inalcanzable sin desplazarse.
  await onboard(page);
  await page.goto("/train");

  const cta = page.getByRole("button", { name: "Empezar entrenamiento" });
  await expect(cta).toBeVisible();
  await expect(cta).toBeInViewport();

  // Y por encima de la nav inferior, que es fija y taparía cualquier cosa.
  const nav = page.getByRole("navigation").last();
  const ctaBox = await cta.boundingBox();
  const navBox = await nav.boundingBox();
  expect(ctaBox!.y + ctaBox!.height).toBeLessThanOrEqual(navBox!.y);
});

test("volver a una sesión ya cerrada no deja una pantalla muerta", async ({
  page,
}) => {
  // El caso de la pestaña vieja: terminas la sesión y vuelves atrás. Antes se
  // renderizaba el ejecutor entero —con sus botones— para una sesión cerrada,
  // y cada toque devolvía "ok" sin guardar nada. Ahora ni siquiera se llega a
  // esa pantalla.
  await onboard(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empezar entrenamiento" }).click();
  await expect(page).toHaveURL(/\/train\/session\//);
  const urlSesion = page.url();

  await page.getByRole("button", { name: "Completar" }).first().click();
  const next = page.getByRole("button", { name: "Siguiente" });
  while (await next.isVisible().catch(() => false)) await next.click();
  await page.getByRole("button", { name: "Finalizar" }).click();
  await page.getByRole("button", { name: /Guardar y finalizar/i }).click();
  await expect(page).toHaveURL(/\/train$/, { timeout: 15_000 });

  // "Atrás" a la URL de la sesión: debe llevar al historial, no al ejecutor.
  await page.goto(urlSesion);
  await expect(page).toHaveURL(/\/train\/history$/);
  await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible();
});
