import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { shouldRegisterServiceWorker } from "@/components/offline/register-sw";

/**
 * Offline-first es COMPORTAMIENTO PERMANENTE de Personal Coach, no una función
 * que se enciende con una variable.
 *
 * Antes el registro del service worker dependía de `NEXT_PUBLIC_ENABLE_SW=1`, y
 * eso significaba que un despliegue en el que alguien olvidara ponerla dejaba a
 * quien entrena en un sótano sin la red de seguridad, en silencio y sin que
 * ningún test se enterara. Estos tests fijan que ya no puede pasar.
 */
describe("registro del service worker", () => {
  it("un build de PRODUCCIÓN lo registra, sin ninguna variable de por medio", () => {
    expect(shouldRegisterServiceWorker("production", true)).toBe(true);
  });

  it("la ausencia total de variables de entorno NO desactiva el offline", () => {
    // La firma no acepta ningún flag: no hay nada que puedas dejar sin poner en
    // Vercel que apague esto. Lo único que decide es el entorno del build.
    expect(shouldRegisterServiceWorker("production", true)).toBe(true);
    expect(shouldRegisterServiceWorker.length).toBe(2);
  });

  it("en desarrollo NO se registra, y por una razón técnica", () => {
    // `next dev` sirve /_next/static con `Cache-Control: no-cache,
    // must-revalidate`, y `cacheFirst` ignora ese header: serviría un chunk
    // viejo para siempre y se comería el hot reload. En producción los
    // estáticos van hasheados por contenido e inmutables, que es justo lo que
    // hace correcta esa estrategia.
    expect(shouldRegisterServiceWorker("development", true)).toBe(false);
    expect(shouldRegisterServiceWorker("test", true)).toBe(false);
    expect(shouldRegisterServiceWorker(undefined, true)).toBe(false);
  });

  it("un navegador sin service workers no se intenta forzar", () => {
    // Safari en privado y cualquier contexto no seguro no los exponen.
    expect(shouldRegisterServiceWorker("production", false)).toBe(false);
  });
});

/**
 * Guarda de regresión: que el flag no vuelva por la puerta de atrás.
 *
 * Un test sobre el árbol de ficheros y no sobre una función, porque lo que hay
 * que impedir es precisamente que alguien reintroduzca la condición en
 * cualquier sitio —código, config, docs o scripts—, no solo en el componente.
 */
describe("el feature flag no existe en ninguna parte", () => {
  const RAIZ = process.cwd();
  const IGNORADOS = new Set([
    "node_modules",
    ".next",
    ".next-e2e",
    ".git",
    "test-results",
    "playwright-report",
    "src/generated",
    "data",
    "exports",
  ]);
  const EXTENSIONES = /\.(ts|tsx|js|mjs|cjs|json|md|sql|example|yml|yaml)$/;

  function* ficheros(dir: string): Generator<string> {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      const relativa = ruta.slice(RAIZ.length + 1);
      if (IGNORADOS.has(entrada) || IGNORADOS.has(relativa)) continue;
      if (statSync(ruta).isDirectory()) {
        yield* ficheros(ruta);
        continue;
      }
      if (entrada === ".env.example" || EXTENSIONES.test(entrada)) yield ruta;
    }
  }

  it("ningún fichero del repositorio menciona una variable para activarlo", () => {
    const culpables: string[] = [];
    for (const ruta of ficheros(RAIZ)) {
      const texto = readFileSync(ruta, "utf8");
      // Este mismo fichero nombra el flag para prohibirlo; no cuenta.
      if (ruta.endsWith("register-sw.test.ts")) continue;
      if (
        /NEXT_PUBLIC_ENABLE_SW|\bENABLE_SW\b|\bENABLE_OFFLINE\b/.test(texto)
      ) {
        culpables.push(ruta.slice(RAIZ.length + 1));
      }
    }
    expect(culpables).toEqual([]);
  });
});
