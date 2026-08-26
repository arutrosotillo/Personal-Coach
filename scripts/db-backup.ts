import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describeTarget, findPgTool, requireDatabaseUrl } from "./pg-tools";

/**
 * Copia de seguridad completa en formato personalizado de PostgreSQL, la que
 * mejor fidelidad da al restaurar (comprimida, restaurable por partes).
 *
 * No dependas solo de los backups del proveedor: el plan gratuito de Neon
 * conserva una ventana de restauración de horas, no de años. Esta copia es
 * tuya y sobrevive a que cambien de política o a que cierres la cuenta.
 *
 * Se guarda en exports/, que está en .gitignore: un volcado contiene todo tu
 * historial y no debe acabar en el repositorio.
 */
function main(): void {
  const url = requireDatabaseUrl();
  const pgDump = findPgTool("pg_dump");

  const dir = join(process.cwd(), "exports");
  mkdirSync(dir, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 16);
  const file = join(dir, `personal-coach-${stamp}.dump`);

  console.log(`Origen:  ${describeTarget(url)}`);
  console.log(`Destino: ${file}`);

  execFileSync(
    pgDump,
    ["--format=custom", "--no-owner", "--no-privileges", `--file=${file}`, url],
    { stdio: "inherit" },
  );

  const bytes = statSync(file).size;
  if (bytes === 0) {
    throw new Error("El volcado ha salido vacío. No lo des por bueno.");
  }
  console.log(`Copia completada: ${(bytes / 1024).toFixed(0)} KB`);
  console.log("Restaurar:  pnpm db:restore " + file + "  (pide confirmación)");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
