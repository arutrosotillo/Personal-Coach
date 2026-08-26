/**
 * URL de la base de datos E2E. Vive aparte para que la use tanto el script de
 * preparación como la config de Playwright y no puedan divergir.
 *
 * SEGURIDAD: solo PostgreSQL local. El script de preparación hace DROP
 * DATABASE, así que apuntar esto a Neon borraría entrenamientos reales.
 */
export const E2E_DATABASE_NAME = "personal_coach_e2e";

export function e2eAdminUrl(): string {
  const base = process.env.TEST_DATABASE_URL;
  if (base) return base;
  // El PostgreSQL de Homebrew usa tu usuario de macOS como superusuario.
  const user = process.env.USER ?? process.env.LOGNAME ?? "postgres";
  return `postgresql://${encodeURIComponent(user)}@localhost:5432/postgres`;
}

export function e2eDatabaseUrl(): string {
  const url = new URL(e2eAdminUrl());
  assertLocal(url);
  url.pathname = `/${E2E_DATABASE_NAME}`;
  return url.toString();
}

export function assertLocal(url: URL): void {
  const local = new Set(["localhost", "127.0.0.1", "::1", ""]);
  if (!local.has(url.hostname)) {
    throw new Error(
      `Los E2E solo pueden usar un PostgreSQL local (host recibido: ` +
        `"${url.hostname}"). Este script BORRA la base de datos entera.`,
    );
  }
}
