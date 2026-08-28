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
  // Las rutas conocidas van PRIMERO y ordenadas de más nueva a más vieja. El
  // cliente debe ser de versión igual o mayor que el servidor, y Neon va por
  // delante del Postgres que sueles tener en local: mirar el PATH primero
  // elegiría el viejo y `pg_dump` abortaría por "server version mismatch".
  for (const dir of CANDIDATE_DIRS) {
    const candidate = `${dir}/${name}`;
    if (existsSync(candidate)) return candidate;
  }
  try {
    const found = execFileSync("which", [name], { encoding: "utf8" }).trim();
    if (found) return found;
  } catch {
    // Tampoco está en el PATH.
  }
  throw new Error(
    `No se encuentra "${name}". Instala las herramientas de PostgreSQL:\n` +
      `  brew install postgresql@17\n` +
      `Deben ser de la MISMA versión mayor que el servidor (Neon usa 17).`,
  );
}

/**
 * Traduce una URL de conexión a las variables de entorno de libpq.
 *
 * Las herramientas de PostgreSQL aceptan la URL como argumento, pero entonces
 * la contraseña queda visible en `ps aux` y, peor, en los mensajes de error:
 * un fallo de pg_dump imprime la línea de comando ENTERA. Por eso la conexión
 * viaja por el entorno, que no aparece en ninguno de los dos sitios.
 */
export function connectionEnv(url: string): Record<string, string> {
  const u = new URL(url);
  const env: Record<string, string> = {};
  if (u.hostname) env.PGHOST = u.hostname;
  if (u.port) env.PGPORT = u.port;
  if (u.username) env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const base = u.pathname.replace(/^\//, "");
  if (base) env.PGDATABASE = base;
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  const channelBinding = u.searchParams.get("channel_binding");
  if (channelBinding) env.PGCHANNELBINDING = channelBinding;
  return env;
}

/**
 * Quita cualquier credencial de un texto antes de enseñarlo. Las herramientas
 * de PostgreSQL vuelcan su línea de comando al fallar.
 */
export function redact(texto: string): string {
  return texto.replace(
    /(postgres(?:ql)?:\/\/)[^\s@]*@/g,
    "$1<credenciales-ocultas>@",
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
