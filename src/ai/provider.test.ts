import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Política de reintentos del proveedor real.
 *
 * Las consultas al Coach son INTERACTIVAS: alguien está mirando la pantalla.
 * Con `maxRetries: 1` y un timeout de 25 s, una petición que no responde nunca
 * tenía a esa persona 50 s esperando para acabar viendo el MISMO fallback
 * determinista que ya tenía disponible a los 25. Este test fija el
 * comportamiento en un solo intento, contando peticiones de verdad contra un
 * servidor local que acepta la conexión y no contesta jamás.
 *
 * El timeout se baja por entorno SOLO aquí para no tardar 25 s en cada
 * ejecución de la suite: lo que se está probando es cuántas veces se llama, no
 * cuánto se espera.
 */
describe("OpenAICoachProvider: reintentos", () => {
  let server: Server;
  let peticiones = 0;
  let baseUrl = "";

  beforeEach(async () => {
    peticiones = 0;
    server = createServer(() => {
      peticiones += 1;
      // Ni respuesta ni cierre: la petición se queda colgada hasta que el
      // cliente la aborte por timeout. Es el caso que se quiere probar.
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/v1`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  });

  async function llamar() {
    vi.resetModules();
    vi.stubEnv("OPENAI_BASE_URL", baseUrl);
    vi.stubEnv("AI_COACH_TIMEOUT_MS", "400");
    const { OpenAICoachProvider } = await import("@/ai/provider");
    return new OpenAICoachProvider("sk-test-no-sirve-para-nada").generate({
      system: "s",
      instructions: "i",
      contextJson: "{}",
      userMessage: "u",
    });
  }

  it("una petición que no responde nunca se intenta UNA sola vez", async () => {
    const result = await llamar();

    expect(peticiones).toBe(1);
    expect(result.kind).toBe("TIMEOUT");
  });

  it("`AI_COACH_MAX_RETRIES` sigue pudiendo subir la política a mano", async () => {
    vi.resetModules();
    vi.stubEnv("OPENAI_BASE_URL", baseUrl);
    vi.stubEnv("AI_COACH_TIMEOUT_MS", "400");
    vi.stubEnv("AI_COACH_MAX_RETRIES", "1");
    const { OpenAICoachProvider } = await import("@/ai/provider");
    const result = await new OpenAICoachProvider("sk-test").generate({
      system: "s",
      instructions: "i",
      contextJson: "{}",
      userMessage: "u",
    });

    // Un reintento = dos peticiones. Confirma que el 1 del test anterior es la
    // política y no un tope del SDK ni un fallo antes de salir a la red.
    expect(peticiones).toBe(2);
    expect(result.kind).toBe("TIMEOUT");
  });

  it("el cero de `AI_COACH_MAX_RETRIES` no se descarta como si fuera vacío", async () => {
    vi.resetModules();
    vi.stubEnv("AI_COACH_MAX_RETRIES", "0");
    const { AI_CONFIG } = await import("@/ai/config");
    expect(AI_CONFIG.maxRetries).toBe(0);
  });
});
