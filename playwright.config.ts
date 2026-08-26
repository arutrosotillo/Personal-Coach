import { defineConfig, devices } from "@playwright/test";

import {
  E2E_AUTH_SECRET,
  E2E_PASSWORD,
  STORAGE_STATE,
} from "./tests/e2e/auth-constants";
import { e2eDatabaseUrl } from "./tests/e2e/db-url";

const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      // Prueba la puerta: corre sin sesión, a propósito.
      name: "acceso",
      testMatch: /(auth|pwa)\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    {
      // Inicia sesión una vez y guarda la cookie para el resto.
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-chrome",
      testIgnore: /(auth\.(spec|setup)|pwa\.spec)\.ts/,
      use: { ...devices["Pixel 7"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // prepare-db recrea/migra/siembra la base Postgres E2E antes del server
    // (el webServer de Playwright arranca antes que globalSetup).
    command: `pnpm exec tsx tests/e2e/prepare-db.ts && pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    // Siempre servidor (y DB e2e) frescos: el spec asume base de datos limpia.
    reuseExistingServer: false,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      // Credenciales de prueba: la app falla cerrada sin ellas, así que los
      // E2E necesitan configurarlas igual que producción.
      APP_PASSWORD: E2E_PASSWORD,
      AUTH_SECRET: E2E_AUTH_SECRET,
      // Coach AI en modo FALSO: los E2E nunca llaman a OpenAI ni necesitan
      // clave. `OPENAI_API_KEY` se deja vacía a propósito.
      AI_COACH_FAKE: "1",
      OPENAI_API_KEY: "",
    },
    timeout: 120_000,
  },
});
