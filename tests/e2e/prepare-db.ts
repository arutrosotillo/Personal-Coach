import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Prepara una base de datos E2E limpia (data/e2e.db): borra la anterior,
 * aplica migraciones y siembra el catálogo. Se ejecuta como primer paso del
 * comando webServer de Playwright (que arranca ANTES que globalSetup, por eso
 * no puede vivir allí) con DATABASE_URL apuntando a esta DB — nunca a la real.
 */
const root = process.cwd();
const dataDir = join(root, "data");
if (!existsSync(dataDir)) mkdirSync(dataDir);

const dbFile = join(dataDir, "e2e.db");
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  rmSync(dbFile + suffix, { force: true });
}

// Prisma 7.8's schema engine expects the SQLite file to exist already.
closeSync(openSync(dbFile, "a"));

const env = { ...process.env, DATABASE_URL: "file:./data/e2e.db" };
execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
  cwd: root,
  env,
  stdio: "inherit",
});
execFileSync("pnpm", ["db:seed"], { cwd: root, env, stdio: "inherit" });
