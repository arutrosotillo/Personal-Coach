import { defineConfig, devices } from "@playwright/test";

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
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    // prepare-db recrea/migra/siembra la base Postgres E2E antes del server
    // (el webServer de Playwright arranca antes que globalSetup).
    command: `pnpm exec tsx tests/e2e/prepare-db.ts && pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Siempre servidor (y DB e2e) frescos: el spec asume base de datos limpia.
    reuseExistingServer: false,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      // Coach AI en modo FALSO: los E2E nunca llaman a OpenAI ni necesitan
      // clave. `OPENAI_API_KEY` se deja vacía a propósito.
      AI_COACH_FAKE: "1",
      OPENAI_API_KEY: "",
    },
    timeout: 120_000,
  },
});
