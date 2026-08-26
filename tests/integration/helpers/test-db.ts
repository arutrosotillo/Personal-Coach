import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

/**
 * Bases de datos de integración sobre PostgreSQL.
 *
 * Cada fichero de test recibe una base de datos propia y desechable, clonada
 * de una plantilla ya migrada. Clonar cuesta milisegundos; aplicar las
 * migraciones cuesta segundos, así que solo se hace una vez por versión del
 * schema.
 *
 * SEGURIDAD: estas funciones CREAN Y DESTRUYEN bases de datos. Solo pueden
 * apuntar a un PostgreSQL local y solo pueden tocar bases cuyo nombre empiece
 * por TEST_DB_PREFIX. Cualquier otra cosa aborta antes de conectar.
 */

const TEST_DB_PREFIX = "personal_coach_test_";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

/**
 * Servidor local. El PostgreSQL de Homebrew crea como superusuario el usuario
 * de macOS, no "postgres", así que el rol por defecto sale del entorno.
 * Configurable con TEST_DATABASE_URL si el puerto o el usuario difieren.
 */
function adminUrl(): string {
  const fromEnv = process.env.TEST_DATABASE_URL;
  if (fromEnv) return fromEnv;
  const user = process.env.USER ?? process.env.LOGNAME ?? "postgres";
  return `postgresql://${encodeURIComponent(user)}@localhost:5432/postgres`;
}

/**
 * Impide que la suite apunte a una base remota. Sin esto, un
 * TEST_DATABASE_URL mal puesto (o heredado de producción) borraría datos
 * reales: los tests hacen DROP DATABASE.
 */
function assertLocal(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`TEST_DATABASE_URL no es una URL válida: ${url}`);
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Los tests de integración solo pueden usar un PostgreSQL local. ` +
        `Recibido host "${parsed.hostname}". Los tests crean y destruyen ` +
        `bases de datos: apuntar esto a Neon o a producción borraría datos.`,
    );
  }
  return parsed;
}

function urlForDatabase(name: string): string {
  const parsed = assertLocal(adminUrl());
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  assertLocal(adminUrl());
  const client = new Client({ connectionString: adminUrl() });
  try {
    await client.connect();
  } catch (cause) {
    throw new Error(
      `No hay un PostgreSQL local escuchando en ${adminUrl()}.\n` +
        `Arráncalo con:  brew services start postgresql@17\n` +
        `(los tests de integración necesitan Postgres real desde CLOUD.1)`,
      { cause },
    );
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Solo permitimos destruir bases que hemos creado nosotros. */
function assertDisposable(name: string): void {
  if (!name.startsWith(TEST_DB_PREFIX)) {
    throw new Error(
      `Negado: "${name}" no empieza por "${TEST_DB_PREFIX}". ` +
        `Los helpers de test no pueden tocar bases que no hayan creado.`,
    );
  }
}

/**
 * Identidad del schema = hash de las migraciones. Si cambian, el nombre de la
 * plantilla cambia y se reconstruye sola. Nunca se sirve una plantilla vieja.
 */
function migrationsFingerprint(): string {
  const dir = join(process.cwd(), "prisma", "migrations");
  const hash = createHash("sha256");
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const file = entry.isDirectory()
      ? join(dir, entry.name, "migration.sql")
      : join(dir, entry.name);
    hash.update(entry.name);
    try {
      hash.update(readFileSync(file));
    } catch {
      // Directorio de migración sin migration.sql: solo cuenta el nombre.
    }
  }
  return hash.digest("hex").slice(0, 12);
}

async function databaseExists(client: Client, name: string): Promise<boolean> {
  const res = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [name],
  );
  return res.rowCount === 1;
}

/** Aplica las migraciones reales. Es el mismo comando que usa producción. */
function applyMigrations(url: string): void {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    cwd: process.cwd(),
    stdio: "pipe",
  });
}

/**
 * Crea (una vez por versión del schema) la plantilla migrada y devuelve su
 * nombre. Las suites corren en serie (`maxWorkers: 1`), así que no hay carrera.
 */
async function ensureTemplate(client: Client): Promise<string> {
  const template = `${TEST_DB_PREFIX}template_${migrationsFingerprint()}`;
  if (await databaseExists(client, template)) return template;

  // Limpia plantillas de versiones anteriores del schema.
  const stale = await client.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE datname LIKE $1 AND datname <> $2",
    [`${TEST_DB_PREFIX}template_%`, template],
  );
  for (const row of stale.rows) {
    assertDisposable(row.datname);
    await client.query(`DROP DATABASE IF EXISTS "${row.datname}"`);
  }

  assertDisposable(template);
  await client.query(`CREATE DATABASE "${template}"`);
  applyMigrations(urlForDatabase(template));
  return template;
}

let counter = 0;

export interface TestDatabase {
  url: string;
  cleanup: () => void;
}

/**
 * Base de datos limpia y aislada para un fichero de test. Devuelve `cleanup`
 * síncrono para encajar con los `afterAll` existentes; el borrado real se
 * encola y se completa en el `process.on("exit")` de abajo si hiciera falta.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `${TEST_DB_PREFIX}${process.pid}_${++counter}`;
  assertDisposable(name);

  const template = await withAdmin(async (client) => {
    const tpl = await ensureTemplate(client);
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    // TEMPLATE clona el schema ya migrado: milisegundos en vez de segundos.
    await client.query(`CREATE DATABASE "${name}" TEMPLATE "${tpl}"`);
    return tpl;
  });
  void template;

  return {
    url: urlForDatabase(name),
    cleanup: () => {
      pendingDrops.add(name);
      void dropDatabase(name).then(() => pendingDrops.delete(name));
    },
  };
}

const pendingDrops = new Set<string>();

async function dropDatabase(name: string): Promise<void> {
  assertDisposable(name);
  try {
    await withAdmin(async (client) => {
      // Prisma puede dejar conexiones colgando; ciérralas antes del DROP.
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [name],
      );
      await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    });
  } catch {
    // Una base de test huérfana no debe tumbar la suite: la limpia el
    // siguiente `pnpm test:db:clean`.
  }
}

/** Borra todas las bases de test huérfanas (plantilla incluida). */
export async function dropAllTestDatabases(): Promise<number> {
  return withAdmin(async (client) => {
    const res = await client.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE $1",
      [`${TEST_DB_PREFIX}%`],
    );
    for (const row of res.rows) {
      assertDisposable(row.datname);
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [row.datname],
      );
      await client.query(`DROP DATABASE IF EXISTS "${row.datname}"`);
    }
    return res.rowCount ?? 0;
  });
}
