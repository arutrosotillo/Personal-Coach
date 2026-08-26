import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Localiza las herramientas de línea de comandos de PostgreSQL.
 *
 * En macOS, Homebrew instala postgresql@17 fuera del PATH por defecto, así que
 * `pg_dump` suele no encontrarse aunque esté instalado. Mejor buscarlo en los
 * sitios conocidos que fallar con "command not found".
 */
const CANDIDATE_DIRS = [
  "/opt/homebrew/opt/postgresql@18/bin",
  "/opt/homebrew/opt/postgresql@17/bin",
  "/opt/homebrew/bin",
  "/usr/local/opt/postgresql@17/bin",
  "/usr/local/bin",
  "/usr/bin",
];

export function findPgTool(name: string): string {
  try {
    const found = execFileSync("which", [name], { encoding: "utf8" }).trim();
    if (found) return found;
  } catch {
    // No está en el PATH: seguimos buscando.
  }
  for (const dir of CANDIDATE_DIRS) {
    const candidate = `${dir}/${name}`;
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No se encuentra "${name}". Instala las herramientas de PostgreSQL:\n` +
      `  brew install postgresql@17\n` +
      `Deben ser de la MISMA versión mayor que el servidor (Neon usa 17).`,
  );
}

/** Describe una conexión sin revelar la contraseña. */
export function describeTarget(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
}

export function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL no está definida (ver .env.example).");
  }
  return url;
}
