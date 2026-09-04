import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";

import { e2eDatabaseUrl } from "./db-url";
import { onboard } from "./helpers/onboard";

/**
 * El escenario real: entrenar en un gimnasio sin cobertura.
 *
 * Entro con Internet → empiezo → desaparece la cobertura → sigo registrando
 * series con normalidad → vuelve la cobertura → todo aparece en el servidor
 * exactamente UNA vez.
 *
 * Se comprueba contra la base de datos, no contra la pantalla: la pantalla ya
 * mentía antes (mostraba una serie "guardada" un instante y luego la borraba).
 *
 * Corre con el SERVICE WORKER BLOQUEADO (ver el proyecto `offline` en
 * playwright.config.ts), y no por comodidad: Playwright no aplica su emulación
 * de red a las peticiones que salen a través de un service worker, así que con
 * uno activo las escrituras llegaban al servidor con `navigator.onLine ===
 * false` y estos tests no probaban nada. Recargar y reabrir sin cobertura —lo
 * único que SÍ necesita el service worker— se prueba aparte, en
 * `offline-shell.spec.ts`.
 */

/** Cuántas series tiene registradas la sesión, según Postgres. */
async function seriesEnDb(sessionId: string): Promise<number> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM "SetLog" s
         JOIN "WorkoutExercise" we ON we.id = s."workoutExerciseId"
        WHERE we."sessionId" = $1`,
      [sessionId],
    );
    return Number(rows[0].n);
  } finally {
    await client.end();
  }
}

async function estadoEnDb(sessionId: string) {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{
      status: string;
      fatigue: number | null;
      finishToken: string | null;
    }>(
      `SELECT status, fatigue, "finishToken" FROM "WorkoutSession" WHERE id = $1`,
      [sessionId],
    );
    return rows[0];
  } finally {
    await client.end();
  }
}

/**
 * Deja la cuenta lista para empezar un entrenamiento nuevo.
 *
 * Descartar la sesión anterior no es cosmético: `completeOnboarding` se niega a
 * cambiar de programa mientras haya una sesión IN_PROGRESS, así que una sesión
 * que se quede abierta rompe todas las specs que vengan detrás. Y el diálogo de
 * confirmación hay que ACEPTARLO a mano: Playwright cancela los `confirm()` por
 * defecto, así que sin esto "Descartar" no descartaba nada.
 */
async function empezarDeCero(page: Page) {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/train");
  const reanudar = page.getByRole("button", { name: "Reanudar sesión" });
  if (await reanudar.isVisible().catch(() => false)) {
    await reanudar.click();
    await expect(page).toHaveURL(/\/train\/session\//);
    await expect(
      page.getByRole("button", { name: "Descartar sesión" }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await descartar(page);
  }
  await onboard(page);
  await page.goto("/train");
  await page.getByRole("button", { name: "Empezar entrenamiento" }).click();
  await expect(page).toHaveURL(/\/train\/session\//);
}

async function descartar(page: Page) {
  const boton = page.getByRole("button", { name: "Descartar sesión" });
  // Descartar es online-only: se deshabilita mientras no haya conexión.
  await expect(boton).toBeEnabled({ timeout: 60_000 });
  await boton.click();
  await expect(page).toHaveURL(/\/train$/, { timeout: 30_000 });
}

function sessionIdDe(page: Page): string {
  const id = new URL(page.url()).pathname.split("/").pop();
  if (!id) throw new Error(`URL de sesión inesperada: ${page.url()}`);
  return id;
}

async function cortarRed(context: BrowserContext) {
  await context.setOffline(true);
}

async function devolverRed(context: BrowserContext) {
  await context.setOffline(false);
}

/**
 * El indicador de guardado, acotado a la cabecera: `role="status"` a secas
 * también encuentra los toasts.
 */
function indicador(page: Page) {
  return page.locator("header").getByRole("status");
}

/** Registra la serie visible `idx` (0-based) con un peso concreto. */
async function registrarSerie(page: Page, idx: number, kg: string) {
  await page
    .getByRole("textbox", { name: "Peso (kg)", exact: true })
    .nth(idx)
    .fill(kg);
  await page.getByRole("button", { name: "Completar" }).first().click();
  await expect(
    page.getByRole("button", { name: "✓ Hecha" }).nth(idx),
  ).toBeVisible();
}

test("registrar sin cobertura y sincronizar exactamente una vez al volver", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await empezarDeCero(page);
  const sessionId = sessionIdDe(page);

  // --- Con cobertura: una serie, como siempre ---------------------------
  await registrarSerie(page, 0, "40");
  await expect(indicador(page)).toHaveText(/Guardado/, { timeout: 15_000 });
  expect(await seriesEnDb(sessionId)).toBe(1);

  // --- Se cae la cobertura ---------------------------------------------
  await cortarRed(context);

  await registrarSerie(page, 1, "42.5");
  await registrarSerie(page, 2, "45");

  // Lo importante: las series SIGUEN AHÍ. Antes se revertían solas y salía un
  // "Sin conexión: la serie no se ha guardado".
  await expect(page.getByRole("button", { name: "✓ Hecha" })).toHaveCount(3);
  await expect(indicador(page)).toHaveText(/Sin conexión/, {
    timeout: 30_000,
  });
  // Y el servidor, honestamente, todavía no las tiene.
  expect(await seriesEnDb(sessionId)).toBe(1);

  // Sin cobertura se sigue pudiendo corregir el RIR, añadir series y navegar.
  await page
    .getByRole("group", { name: /RIR de la serie 2/ })
    .getByRole("button", { name: "RIR 1", exact: true })
    .click();
  await page.getByRole("button", { name: "+ Añadir serie" }).click();
  await registrarSerie(page, 3, "45");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText(/Ejercicio 2\//)).toBeVisible();
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await expect(page.getByRole("button", { name: "✓ Hecha" })).toHaveCount(4);
  expect(await seriesEnDb(sessionId)).toBe(1);

  // --- Vuelve la cobertura ---------------------------------------------
  await devolverRed(context);
  await expect(indicador(page)).toHaveText(/Guardado/, { timeout: 90_000 });

  // Exactamente una fila por serie: ni una de más por los reintentos.
  expect(await seriesEnDb(sessionId)).toBe(4);

  // Y tras recargar CON conexión, servidor y cliente dicen lo mismo.
  await page.reload();
  await expect(page.getByRole("button", { name: "✓ Hecha" })).toHaveCount(4, {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("textbox", { name: "Peso (kg)", exact: true }).nth(1),
  ).toHaveValue("42.5");
  await expect(
    page
      .getByRole("group", { name: /RIR de la serie 2/ })
      .getByRole("button", { name: "RIR 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await descartar(page);
});

test("finalizar el entrenamiento sin cobertura y que se guarde al volver", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await empezarDeCero(page);
  const sessionId = sessionIdDe(page);

  await registrarSerie(page, 0, "50");
  await expect(indicador(page)).toHaveText(/Guardado/, {
    timeout: 10_000,
  });

  await cortarRed(context);
  await registrarSerie(page, 1, "50");

  // Ir al último ejercicio y finalizar, sin conexión.
  const siguiente = page.getByRole("button", { name: "Siguiente" });
  while (await siguiente.isVisible().catch(() => false)) {
    await siguiente.click();
  }
  await page.getByRole("button", { name: "Finalizar" }).click();
  await page
    .getByRole("group", { name: "Fatiga (opcional)" })
    .getByRole("button", { name: "4", exact: true })
    .click();
  await page.getByRole("button", { name: /Guardar y finalizar/i }).click();

  // El entrenamiento se da por terminado en el acto, y se dice la verdad sobre
  // dónde está guardado.
  await expect(
    page.getByRole("heading", { name: "Entrenamiento terminado" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/vuelva la cobertura/)).toBeVisible({
    timeout: 20_000,
  });
  expect((await estadoEnDb(sessionId)).status).toBe("IN_PROGRESS");

  // Vuelve la cobertura: se sincroniza solo y lleva a /train.
  await devolverRed(context);
  await expect(page).toHaveURL(/\/train$/, { timeout: 60_000 });

  const cerrada = await estadoEnDb(sessionId);
  expect(cerrada.status).toBe("COMPLETED");
  expect(cerrada.fatigue).toBe(4);
  expect(cerrada.finishToken).not.toBeNull();
  expect(await seriesEnDb(sessionId)).toBe(2);
});

test("la cobertura que va y viene no corrompe la sesión ni duplica series", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await empezarDeCero(page);
  const sessionId = sessionIdDe(page);

  // online → offline → online → offline → online, registrando en cada tramo.
  for (const [idx, offline] of [false, true, false].entries()) {
    if (offline) await cortarRed(context);
    else await devolverRed(context);
    await registrarSerie(page, idx, `${50 + idx}`);
  }
  await devolverRed(context);

  await expect(indicador(page)).toHaveText(/Guardado/, {
    timeout: 60_000,
  });
  expect(await seriesEnDb(sessionId)).toBe(3);

  await page.reload();
  await expect(page.getByRole("button", { name: "✓ Hecha" })).toHaveCount(3);
  await descartar(page);
});

test("registrar una serie no espera al servidor por lento que vaya", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await empezarDeCero(page);
  const sessionId = sessionIdDe(page);

  // Una conexión de gimnasio: la escritura tarda ocho segundos en salir. Antes,
  // el `useTransition` compartido dejaba TODA la lista de series bloqueada ese
  // rato; ahora no debería notarse.
  await context.route("**/train/session/**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((r) => setTimeout(r, 8_000));
    await route.continue();
  });

  const inicio = Date.now();
  await registrarSerie(page, 0, "60");
  await registrarSerie(page, 1, "60");
  await registrarSerie(page, 2, "60");
  expect(Date.now() - inicio).toBeLessThan(5_000);

  await context.unroute("**/train/session/**");
  await expect(indicador(page)).toHaveText(/Guardado/, {
    timeout: 60_000,
  });
  expect(await seriesEnDb(sessionId)).toBe(3);
  await descartar(page);
});

/** El texto de la nota de ejercicio que hay ahora mismo en Postgres. */
async function notaEnDb(sessionOrdinal: number): Promise<string | null> {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ text: string }>(
      `SELECT n.text
         FROM "ExerciseNote" n
         JOIN "WorkoutExercise" we ON we."exerciseVariantId" = n."exerciseVariantId"
         JOIN "WorkoutSession" s ON s.id = we."sessionId"
        WHERE we.ordinal = $1
        ORDER BY n."updatedAt" DESC
        LIMIT 1`,
      [sessionOrdinal],
    );
    return rows[0]?.text ?? null;
  } finally {
    await client.end();
  }
}

test("una nota escrita sin cobertura no se pierde y se sincroniza sola", async ({
  page,
  context,
}) => {
  // El fallo que motivó esto: escribir una nota sin cobertura llamaba a la
  // server action y esperaba. Fallaba, salía un toast de error y el texto se
  // quedaba SOLO en el estado de React, así que perderlo era cuestión de
  // cerrar la pantalla. Las series eran local-first desde hacía tiempo; las
  // notas, no.
  //
  // Aquí se prueba la cola (guardado inmediato, coalescencia, sincronización
  // al volver). Que además sobreviva a MATAR la app lo prueba
  // `offline-shell.spec.ts`, que es donde hay service worker.
  test.setTimeout(300_000);
  await empezarDeCero(page);

  await cortarRed(context);

  await page.getByRole("button", { name: "+ Añadir nota" }).first().click();
  await page
    .getByRole("textbox", { name: /^Nota sobre / })
    .fill("Sin cobertura: 2 discos son 40 kg");
  await page.getByRole("button", { name: "Guardar" }).click();

  // 1. Se ve YA, sin esperar al servidor, y se dice honestamente que de momento
  //    solo está guardada aquí.
  await expect(page.getByText("Sin cobertura: 2 discos son 40 kg")).toBeVisible();
  await expect(page.getByText(/sin sincronizar/i)).toBeVisible();
  expect(await notaEnDb(1)).toBeNull();

  // 2. Está escrita en el cuaderno del móvil, que es lo que la salva si iOS
  //    mata la app entre series.
  const enDisco = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("pc:session:")) return localStorage.getItem(key);
    }
    return null;
  });
  expect(enDisco).toContain("Sin cobertura: 2 discos son 40 kg");

  // 3. Se puede reeditar sin cobertura y gana la última versión (una sola
  //    operación en la cola, no seis).
  await page
    .getByRole("button", { name: /^Editar mi nota sobre / })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: /^Nota sobre / })
    .fill("Corregido sin cobertura: 40 kg son 2 discos por lado");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(
    page.getByText("Corregido sin cobertura: 40 kg son 2 discos por lado"),
  ).toBeVisible();

  // 4. Y navegar por la sesión sin cobertura no la borra.
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await expect(
    page.getByText("Corregido sin cobertura: 40 kg son 2 discos por lado"),
  ).toBeVisible();

  // 5. Vuelve la cobertura: se sincroniza sola, sin que nadie toque nada, y
  //    llega UNA sola vez con el texto corregido.
  await devolverRed(context);
  await expect(indicador(page)).toHaveText(/Guardado/, { timeout: 90_000 });
  await expect
    .poll(() => notaEnDb(1), { timeout: 60_000 })
    .toBe("Corregido sin cobertura: 40 kg son 2 discos por lado");
  await expect(page.getByText(/sin sincronizar/i)).toHaveCount(0);

  await descartar(page);
});

test("empezar un entrenamiento sin cobertura lo dice claro, y no rompe nada", async ({
  page,
  context,
}) => {
  // Decisión de producto CERRADA: iniciar la sesión es lo único del
  // entrenamiento que necesita servidor, porque es lo que da los ids con los
  // que se registra todo después. Lo que no puede pasar es fallar en silencio,
  // que es lo que hacía: la promesa se rechazaba dentro de `startTransition` y
  // el botón volvía a su texto sin decir nada.
  test.setTimeout(300_000);
  await empezarDeCero(page);
  await descartar(page);

  await page.goto("/train");
  const empezar = page.getByRole("button", { name: /^Empezar/ }).first();
  await expect(empezar).toBeVisible();

  await cortarRed(context);
  await empezar.click();

  await expect(page.getByText(/Necesitas conexión solo para empezar/)).toBeVisible({
    timeout: 30_000,
  });
  // Y sigue en /train, sin navegar a una sesión que no existe.
  await expect(page).toHaveURL(/\/train$/);

  // Al volver la cobertura, el mismo botón funciona.
  await devolverRed(context);
  await page.getByRole("button", { name: /^Empezar/ }).first().click();
  await expect(page).toHaveURL(/\/train\/session\//, { timeout: 60_000 });
  await descartar(page);
});
