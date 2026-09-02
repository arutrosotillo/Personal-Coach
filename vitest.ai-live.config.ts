import { readFileSync } from "node:fs";

import { defineConfig } from "vitest/config";

/**
 * Vitest no lee `.env`, y esta batería necesita la clave real. Se cargan SOLO
 * las variables de IA: `DATABASE_URL` se queda fuera a propósito para que ni
 * por accidente pueda apuntar a la base de desarrollo — los escenarios viven
 * en una base temporal que crea y destruye el propio test.
 */
function cargarClavesDeIa() {
  let bruto = "";
  try {
    bruto = readFileSync(new URL("./.env", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const linea of bruto.split("\n")) {
    const m = /^\s*(OPENAI_API_KEY|AI_COACH_[A-Z_]+)\s*=\s*(.*)$/.exec(linea);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
cargarClavesDeIa();

/**
 * Configuración APARTE para la QA en vivo del Coach AI.
 *
 * Vive fuera de `vitest.config.ts` a propósito: esta batería llama al
 * proveedor REAL, cuesta dinero y depende de la red, así que no puede formar
 * parte de `pnpm test` ni de ningún quality gate. Se ejecuta a mano con
 * `pnpm test:ai:live` cuando cambia el prompt, el modelo o el contexto,
 * exactamente como manda docs/AI_EVALUATION.md § Procedimiento de cambio.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    name: "ai-live",
    environment: "node",
    include: ["tests/ai-live/**/*.live.ts"],
    pool: "forks",
    maxWorkers: 1,
    // Una batería completa son ~100 llamadas reales al modelo.
    testTimeout: 30 * 60_000,
    hookTimeout: 10 * 60_000,
  },
});
