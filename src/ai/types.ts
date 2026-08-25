import { z } from "zod";

/**
 * Contrato de Coach AI. La respuesta del modelo se valida SIEMPRE contra este
 * schema: si no encaja, se descarta y se muestra el fallback determinista.
 */

/**
 * Los límites de longitud se TRUNCAN, no se rechazan: el modo estricto de
 * Structured Outputs no admite `maxLength`, así que el modelo puede devolver
 * una respuesta perfectamente conforme a su schema y 20 caracteres más larga
 * de lo que esperábamos. Tirarla entera (y cobrarla) sería absurdo.
 */
const cap = (max: number) => z.string().transform((s) => s.slice(0, max));

export const coachHighlightSchema = z.object({
  label: cap(60),
  detail: cap(400),
  direction: z.enum(["UP", "DOWN", "FLAT", "INFO"]),
});

export const coachResponseSchema = z.object({
  headline: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, 200)),
  highlights: z.array(coachHighlightSchema).transform((v) => v.slice(0, 6)),
  fatigue: z
    .string()
    .transform((s) => s.slice(0, 400))
    .nullable(),
  recommendation: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, 800)),
  hypotheses: z.array(cap(300)).transform((v) => v.slice(0, 4)),
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
      maxItems: 6,
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
    hypotheses: { type: "array", maxItems: 4, items: { type: "string" } },
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
