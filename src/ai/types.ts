import { z } from "zod";

/**
 * Contrato de Coach AI. La respuesta del modelo se valida SIEMPRE contra este
 * schema: si no encaja, se descarta y se muestra el fallback determinista.
 */

export const coachHighlightSchema = z.object({
  label: z.string().min(1).max(60),
  detail: z.string().min(1).max(400),
  direction: z.enum(["UP", "DOWN", "FLAT", "INFO"]),
});

export const coachResponseSchema = z.object({
  headline: z.string().min(1).max(200),
  highlights: z.array(coachHighlightSchema).max(6),
  fatigue: z.string().max(400).nullable(),
  recommendation: z.string().min(1).max(800),
  hypotheses: z.array(z.string().max(300)).max(4),
});

export type CoachHighlight = z.infer<typeof coachHighlightSchema>;
export type CoachResponse = z.infer<typeof coachResponseSchema>;

/** Esquema JSON equivalente, para Structured Outputs de la Responses API. */
export const COACH_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    highlights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          detail: { type: "string" },
          direction: { type: "string", enum: ["UP", "DOWN", "FLAT", "INFO"] },
        },
        required: ["label", "detail", "direction"],
        additionalProperties: false,
      },
    },
    fatigue: { type: ["string", "null"] },
    recommendation: { type: "string" },
    hypotheses: { type: "array", items: { type: "string" } },
  },
  required: [
    "headline",
    "highlights",
    "fatigue",
    "recommendation",
    "hypotheses",
  ],
  additionalProperties: false,
} as const;

export type CoachTask = "WEEKLY" | "EXERCISE" | "EXPLAIN" | "ASK";

export type CoachErrorCode =
  | "NOT_CONFIGURED"
  | "NO_DATA"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE"
  | "GUARDRAIL_BLOCKED";

export interface CoachUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export type CoachResult =
  | {
      ok: true;
      task: CoachTask;
      response: CoachResponse;
      usage: CoachUsage | null;
      /** Avisos del guardrail que no llegaron a bloquear la respuesta. */
      warnings: string[];
    }
  | {
      ok: false;
      task: CoachTask;
      error: CoachErrorCode;
      /** Mensaje para el usuario. Nunca contiene detalles del proveedor. */
      message: string;
      /** Explicación determinista de respaldo, si la hay. */
      fallback: string | null;
    };
