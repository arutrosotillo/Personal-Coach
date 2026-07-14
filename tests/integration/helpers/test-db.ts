import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Crea una base de datos SQLite temporal para la suite y aplica las
 * migraciones reales (prisma migrate deploy). Archivo temporal — no
 * `:memory:` — porque Prisma abre varias conexiones.
 */
export function createTestDatabase(): { url: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "personal-coach-test-"));
  const url = `file:${join(dir, "test.db")}`;

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    cwd: process.cwd(),
    stdio: "pipe",
  });

  return {
    url,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
