import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { E2E_USERNAME } from "./auth-constants";
import { e2eDatabaseUrl } from "./db-url";
import { onboard } from "./helpers/onboard";

/**
 * Llegar al peso objetivo en una definición: la app lo dice con el PESO DE
 * REFERENCIA (la media suavizada, no un pesaje suelto), no cambia nada sola y
 * deja seguir hacia otro peso sin cerrar el ciclo.
 *
 * Antes la tarjeta pintaba el valor absoluto de la distancia bajo "Te
 * quedan", así que al pasar el objetivo seguía diciendo "te quedan 0,4 kg".
 *
 * Para tener una fase con varios pesajes sin esperar días, se adelanta el
 * inicio de la fase y se siembran pesajes anteriores directamente en la base
 * E2E (local y desechable).
 */

test.describe.configure({ mode: "serial" });

const fecha = (diasAtras: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - diasAtras * 86_400_000));

async function sembrarDefinicionCasiTerminada() {
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `SELECT p.id FROM "UserProfile" p JOIN "User" u ON u.id = p."userId"
        WHERE u.username = $1`,
      [E2E_USERNAME],
    );
    const profileId = rows[0].id;
    // La fase empezó hace 10 días con objetivo 83 kg…
    await client.query(
      `UPDATE "Goal" SET "startDate" = $2, "targetWeightKg" = 83
        WHERE "profileId" = $1 AND status = 'ACTIVE'`,
      [profileId, fecha(10)],
    );
    // …y la media de estos días ya está por debajo (≈ 82,5 kg).
    const pesos = [83.4, 83.1, 82.9, 82.8, 82.6, 82.7, 82.4, 82.5, 82.3];
    for (const [i, kg] of pesos.entries()) {
      await client.query(
        `INSERT INTO "BodyMeasurement" (id, "profileId", "localDate", "weightKg")
         VALUES (gen_random_uuid()::text, $1, $2, $3)
         ON CONFLICT ("profileId", "localDate") DO UPDATE SET "weightKg" = $3`,
        [profileId, fecha(9 - i), kg],
      );
    }
    await client.query(
      `UPDATE "BodyMeasurement" SET "weightKg" = 82.4
        WHERE "profileId" = $1 AND "localDate" = $2`,
      [profileId, fecha(0)],
    );
  } finally {
    await client.end();
  }
}

test("llegar al peso objetivo: lo dice con la media, no cambia nada y deja seguir hasta otro peso", async ({
  page,
}) => {
  await onboard(page);
  await sembrarDefinicionCasiTerminada();

  await page.goto("/progress");
  // El peso que cuenta, a la vista junto al último pesaje.
  const peso = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Peso de referencia" })
    .first();
  await expect(peso.getByText("Último pesaje")).toBeVisible();
  await expect(peso.getByText(/media suavizada/)).toBeVisible();

  // Objetivo pasado: NO dice "Te quedan".
  const objetivo = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Tu objetivo" });
  await expect(objetivo.getByText("Objetivo alcanzado")).toBeVisible();
  await expect(objetivo.getByText(/kg por debajo/)).toBeVisible();
  await expect(objetivo.getByText("Te quedan")).toHaveCount(0);
  await expect(
    objetivo.getByText("Has llegado a tu peso objetivo"),
  ).toBeVisible();

  // Seguir definiendo hasta otro peso: en la misma fase, sin cerrar el ciclo.
  await objetivo.getByRole("button", { name: "Poner otro objetivo" }).click();
  await objetivo.getByLabel("Peso objetivo (kg)").fill("80");
  await objetivo.getByRole("button", { name: "Guardar objetivo" }).click();
  await expect(page.getByText(/Objetivo actualizado/)).toBeVisible();

  await page.reload();
  const tras = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Tu objetivo" });
  await expect(tras.getByText("Te quedan")).toBeVisible();
  await expect(tras.getByText("Has llegado a tu peso objetivo")).toHaveCount(0);
  // Sigue siendo la misma definición: no se ha abierto ningún ciclo nuevo.
  const ciclo = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Semana 2" });
  await expect(ciclo.getByText("Definición")).toBeVisible();

  // Y en "Hoy", el mismo peso de referencia junto al de hoy.
  await page.goto("/");
  const hoy = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Tu peso de hoy" });
  await expect(hoy.getByText("Peso de referencia")).toBeVisible();
});
