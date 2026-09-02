import { defineConfig, devices } from "@playwright/test";

import {
  E2E_AUTH_SECRET,
  E2E_PASSWORD,
  STORAGE_STATE,
} from "./tests/e2e/auth-constants";
import { e2eDatabaseUrl } from "./tests/e2e/db-url";

const PORT = 3100;
/**
 * Los E2E offline necesitan un servidor de PRODUCCIÓN, no `next dev`.
 *
 * En desarrollo, cuando el websocket del hot reload se cae —y sin conexión se
 * cae siempre— el cliente de Next recarga la página en bucle intentando
 * reconectar. Eso hace imposible probar precisamente lo que hay que probar. Y
 * de paso, un build real es el único sitio donde los chunks son inmutables y el
 * service worker se comporta como se va a comportar en el móvil del usuario.
 */
const PROD_PORT = 3101;

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
      // El onboarding va SOLO y va PRIMERO, en su propio proyecto.
      //
      // Es el único spec que arranca del estado vacío —cuenta sin perfil— y
      // pulsa el "Empezar — crear mi plan" del dashboard, que solo existe
      // mientras no hay perfil. En cuanto cualquier otro spec hace su
      // onboarding, ese botón desaparece para siempre en esa base.
      //
      // Antes el orden dependía del alfabeto: todos los specs que onboardan
      // empezaban por letra posterior a la "o" de onboarding, por casualidad.
      // Al añadirse `exercise-notes.spec.ts` la casualidad se rompió y con
      // ella la suite entera. Ahora la dependencia está declarada donde se
      // puede razonar sobre ella.
      name: "onboarding",
      testMatch: /onboarding\.spec\.ts/,
      use: { ...devices["Pixel 7"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
    {
      name: "mobile-chrome",
      testIgnore:
        /(auth\.(spec|setup)|pwa\.spec|onboarding\.spec|offline-(session|shell)\.spec)\.ts/,
      use: { ...devices["Pixel 7"], storageState: STORAGE_STATE },
      dependencies: ["onboarding"],
    },
    {
      // Semántica de la cola offline, contra el build de producción del puerto
      // 3101 (ver PROD_PORT). La cookie de sesión sirve igual: las cookies son
      // por host, no por puerto.
      //
      // `serviceWorkers: "block"` es imprescindible, no una simplificación:
      // Playwright NO aplica su emulación de red a las peticiones que salen a
      // través de un service worker, así que con uno activo las escrituras
      // llegaban al servidor con `navigator.onLine === false` y estos tests
      // pasaban por casualidad.
      name: "offline",
      testMatch: /offline-session\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        storageState: STORAGE_STATE,
        baseURL: `http://localhost:${PROD_PORT}`,
        serviceWorkers: "block",
      },
      // Va DESPUÉS de mobile-chrome, y la dependencia está declarada aquí para
      // que se pueda razonar sobre ella (misma razón que el proyecto
      // `onboarding`): estas specs TERMINAN entrenamientos, y la base E2E es
      // compartida. `progression.spec.ts` empieza comprobando que su primer
      // ejercicio no tiene historial —"Primera vez con este ejercicio"—, así
      // que una sesión completada antes que él lo rompe.
      dependencies: ["mobile-chrome"],
    },
    {
      // Lo único que necesita el service worker de verdad: recargar y reabrir
      // sin cobertura. Va después del proyecto `offline` para no competir por
      // la sesión activa (la base de datos E2E es compartida).
      name: "offline-shell",
      testMatch: /offline-shell\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        storageState: STORAGE_STATE,
        baseURL: `http://localhost:${PROD_PORT}`,
      },
      dependencies: ["offline"],
    },
  ],
  webServer: [
    {
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
        // Aquí no hay service worker, y no porque se apague: es `next dev`, y
        // el registro solo ocurre en builds de producción (los estáticos de
        // dev se sirven `must-revalidate` y una cache-first se comería el hot
        // reload). La capa offline se prueba contra el build de producción de
        // abajo, que es donde de verdad corre.
      },
      timeout: 120_000,
    },
    {
      // Build de producción para el proyecto `offline`. `NEXT_DIST_DIR` lo
      // manda a otro directorio para que no pise el `.next` del `next dev` que
      // arranca a la vez que este.
      command: `pnpm exec next build && pnpm exec next start --port ${PROD_PORT}`,
      url: `http://localhost:${PROD_PORT}/login`,
      reuseExistingServer: false,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        DATABASE_URL: e2eDatabaseUrl(),
        APP_PASSWORD: E2E_PASSWORD,
        AUTH_SECRET: E2E_AUTH_SECRET,
        AI_COACH_FAKE: "1",
        OPENAI_API_KEY: "",
        // El service worker NO necesita que se le active nada: es un build de
        // producción, y en producción va siempre.
      },
      timeout: 300_000,
    },
  ],
});
