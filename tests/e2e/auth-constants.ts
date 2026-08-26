import { join } from "node:path";

/**
 * Credenciales SOLO para los E2E. No son secretos: la base de datos E2E se
 * recrea en cada ejecución y el servidor de pruebas es local.
 */
export const E2E_PASSWORD = "contraseña-de-pruebas-e2e-larga";
export const E2E_AUTH_SECRET = "secreto-de-pruebas-e2e-de-mas-de-32-caracteres";

/** Cookie de sesión reutilizada por las suites autenticadas. */
export const STORAGE_STATE = join(
  process.cwd(),
  "test-results",
  ".auth",
  "session.json",
);
