import { execFileSync } from "node:child_process";

import { Client } from "pg";

import {
  E2E_DATABASE_NAME,
  assertLocal,
  e2eAdminUrl,
  e2eDatabaseUrl,
} from "./db-url";
import {
  E2E_DISABLED_PASSWORD,
  E2E_DISABLED_USERNAME,
  E2E_PASSWORD,
  E2E_USERNAME,
} from "./auth-constants";

/**
 * Prepara una base de datos E2E limpia en PostgreSQL: la recrea desde cero,
 * aplica migraciones y siembra el catálogo. Se ejecuta como primer paso del
 * comando webServer de Playwright (que arranca ANTES que globalSetup, por eso
 * no puede vivir allí).
 *
 * Nunca toca la base real: solo acepta un servidor local y solo destruye la
 * base llamada `personal_coach_e2e`.
 */
async function main(): Promise<void> {
  const adminUrl = e2eAdminUrl();
  assertLocal(new URL(adminUrl));

  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
  } catch (cause) {
    throw new Error(
      `No hay un PostgreSQL local escuchando en ${adminUrl}.\n` +
        `Arráncalo con:  brew services start postgresql@17`,
      { cause },
    );
  }
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [E2E_DATABASE_NAME],
    );
    await client.query(`DROP DATABASE IF EXISTS "${E2E_DATABASE_NAME}"`);
    await client.query(`CREATE DATABASE "${E2E_DATABASE_NAME}"`);
  } finally {
    await client.end();
  }

  const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl() };
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  execFileSync("pnpm", ["db:seed"], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });

  await crearCuentasDePrueba(env.DATABASE_URL);
}

/**
 * Cuentas de prueba. Se crean aquí y no con `pnpm user:create` porque ese
 * script pide la contraseña por teclado a propósito.
 */
async function crearCuentasDePrueba(connectionString: string): Promise<void> {
  // Import dinámico: el cliente de Prisma se genera durante el build y este
  // fichero se ejecuta antes de que arranque el servidor.
  const { PrismaClient } = await import("../../src/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { hashPassword } = await import("../../src/server/auth/password");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    await prisma.user.create({
      data: {
        username: E2E_USERNAME,
        passwordHash: await hashPassword(E2E_PASSWORD),
      },
    });
    await prisma.user.create({
      data: {
        username: E2E_DISABLED_USERNAME,
        passwordHash: await hashPassword(E2E_DISABLED_PASSWORD),
        isActive: false,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
