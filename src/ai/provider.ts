import OpenAI from "openai";

import { AI_CONFIG, estimateCostUsd, getApiKey } from "@/ai/config";
import { COACH_RESPONSE_JSON_SCHEMA } from "@/ai/types";

/**
 * Proveedor de Coach AI. Aísla el SDK de OpenAI del resto de la app para que
 * los tests nunca toquen la red: `FakeCoachProvider` implementa el mismo
 * contrato.
 *
 * Se usa la **Responses API**, que es la recomendada para código nuevo (Chat
 * Completions sigue soportada pero es el estándar anterior). Verificado el
 * 2026-08-25 contra developers.openai.com y el README de `openai@7.5.0`.
 */

export interface ProviderRequest {
  system: string;
  instructions: string;
  contextJson: string;
  userMessage: string;
}

export interface ProviderSuccess {
  kind: "OK";
  /** Texto crudo devuelto por el modelo (debe ser el JSON del contrato). */
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

/**
 * Fallos, como unión discriminada con `kind` literal en cada miembro: así
 * TypeScript puede estrechar el tipo tras descartarlos uno a uno.
 */
export type ProviderFailure =
  | { kind: "TIMEOUT"; detail: string }
  | { kind: "RATE_LIMIT"; detail: string }
  /** Mensaje técnico para log local. NUNCA contiene la API key. */
  | { kind: "ERROR"; detail: string };

export type ProviderResult = ProviderSuccess | ProviderFailure;

export interface CoachProvider {
  generate(request: ProviderRequest): Promise<ProviderResult>;
}

/** Proveedor real. Solo servidor. */
export class OpenAICoachProvider implements CoachProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = AI_CONFIG.model) {
    this.client = new OpenAI({
      apiKey,
      timeout: AI_CONFIG.timeoutMs,
      maxRetries: AI_CONFIG.maxRetries,
    });
    this.model = model;
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    try {
      const response = await this.client.responses.create({
        model: this.model,
        instructions: `${request.system}\n\n${request.instructions}`,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                // El contexto va delimitado y etiquetado como DATOS para que
                // nada de dentro se pueda leer como instrucción.
                text: `<APPLICATION_DATA>\n${request.contextJson}\n</APPLICATION_DATA>\n\n<USER_MESSAGE>\n${request.userMessage}\n</USER_MESSAGE>`,
              },
            ],
          },
        ],
        max_output_tokens: AI_CONFIG.maxOutputTokens,
        // Sin razonamiento extendido: los tokens de razonamiento se facturan
        // como salida y aquí no aportan nada.
        reasoning: { effort: "none" },
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "coach_response",
            strict: true,
            schema: COACH_RESPONSE_JSON_SCHEMA,
          },
        },
        store: false,
      });

      const text = response.output_text?.trim() ?? "";
      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      return {
        kind: "OK",
        text,
        model: this.model,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCostUsd(
          this.model,
          inputTokens,
          outputTokens,
        ),
      };
    } catch (error) {
      return classifyError(error);
    }
  }
}

function classifyError(error: unknown): ProviderFailure {
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return { kind: "TIMEOUT", detail: "timeout" };
  }
  if (error instanceof OpenAI.RateLimitError) {
    return { kind: "RATE_LIMIT", detail: "rate limit" };
  }
  if (error instanceof OpenAI.APIError) {
    // Nunca se propaga el cuerpo del error: podría arrastrar la petición entera.
    return { kind: "ERROR", detail: `api error ${error.status ?? "?"}` };
  }
  if (error instanceof Error && /timeout|abort/i.test(error.message)) {
    return { kind: "TIMEOUT", detail: "timeout" };
  }
  return { kind: "ERROR", detail: "unknown error" };
}

/** Proveedor de test: determinista, sin red. */
export class FakeCoachProvider implements CoachProvider {
  constructor(
    private readonly script: ProviderResult | (() => ProviderResult),
  ) {}

  async generate(_request: ProviderRequest): Promise<ProviderResult> {
    void _request;
    return typeof this.script === "function" ? this.script() : this.script;
  }
}

/**
 * Respuesta enlatada para E2E. Se activa SOLO con `AI_COACH_FAKE=1`, que la
 * app nunca pone por su cuenta: existe para poder probar la ruta de éxito en
 * Playwright sin gastar tokens ni depender de la red.
 */
const FAKE_RESPONSE = {
  headline: "Semana sólida: progresas en los empujes.",
  highlights: [
    {
      label: "Progresión",
      detail: "El motor mantiene el plan en los ejercicios registrados.",
      direction: "UP",
    },
  ],
  fatigue: "Recuperación correcta, sin señales acumuladas.",
  recommendation: "Sigue con el plan y registra el RIR de cada serie.",
  hypotheses: [],
};

/** Devuelve el proveedor real, o `null` si no hay clave configurada. */
export function createProvider(): CoachProvider | null {
  if (process.env.AI_COACH_FAKE === "1") {
    return new FakeCoachProvider({
      kind: "OK",
      text: JSON.stringify(FAKE_RESPONSE),
      model: "fake",
      inputTokens: 1234,
      outputTokens: 210,
      estimatedCostUsd: 0.0005,
    });
  }
  const apiKey = getApiKey();
  if (!apiKey) return null;
  return new OpenAICoachProvider(apiKey);
}
