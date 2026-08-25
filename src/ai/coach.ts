import { AI_CONFIG } from "@/ai/config";
import {
  buildCoachContext,
  serializeContext,
  type CoachContext,
  type CoachProfileInput,
} from "@/ai/context";
import { checkResponse } from "@/ai/guardrails";
import {
  ASK_INSTRUCTIONS,
  EXERCISE_INSTRUCTIONS,
  EXPLAIN_INSTRUCTIONS,
  SYSTEM_PROMPT,
  WEEKLY_INSTRUCTIONS,
} from "@/ai/prompts";
import type { CoachProvider } from "@/ai/provider";
import {
  coachResponseSchema,
  type CoachResult,
  type CoachTask,
} from "@/ai/types";
import type { TrainingAnalysis } from "@/core/training/analysis";

/**
 * Orquestación de Coach AI. Puro salvo por el proveedor, que se inyecta: los
 * tests pasan un `FakeCoachProvider` y NUNCA tocan la red.
 *
 * Flujo: análisis determinista → contexto estructurado → modelo → validación de
 * schema → guardrails → respuesta o fallback determinista.
 */

const INSTRUCTIONS: Record<CoachTask, string> = {
  WEEKLY: WEEKLY_INSTRUCTIONS,
  EXERCISE: EXERCISE_INSTRUCTIONS,
  EXPLAIN: EXPLAIN_INSTRUCTIONS,
  ASK: ASK_INSTRUCTIONS,
};

export interface CoachRequest {
  task: CoachTask;
  analysis: TrainingAnalysis;
  profile: CoachProfileInput;
  /** Para EXERCISE y EXPLAIN: acota el contexto a esa variante. */
  variantId?: string;
  /** Para ASK: la pregunta del usuario. */
  question?: string;
}

/** Explicación determinista de respaldo cuando la IA no está o falla. */
export function deterministicFallback(request: CoachRequest): string | null {
  const { analysis, variantId } = request;
  if (request.task === "WEEKLY" || request.task === "ASK") {
    return analysis.fatigue.explanation;
  }
  const variant = variantId
    ? analysis.variants.find((v) => v.variantId === variantId)
    : analysis.variants[0];
  return variant?.suggestion.explanation ?? null;
}

/**
 * Acota el contexto al ejercicio preguntado. Si no aparece, se devuelve SIN
 * ejercicios: `runCoach` responderá `NO_DATA`. Antes se sustituía por el
 * primero de la lista y el coach explicaba, con total aplomo, otro ejercicio.
 */
function focusContext(
  context: CoachContext,
  variantId: string | undefined,
): CoachContext {
  if (!variantId) return context;
  return {
    ...context,
    exercises: context.exercises.filter((e) => e.variantId === variantId),
    sessions: context.sessions.slice(-4),
  };
}

function userMessage(request: CoachRequest, context: CoachContext): string {
  switch (request.task) {
    case "WEEKLY":
      return "Resume mi semana de entrenamiento.";
    case "EXERCISE": {
      const name = context.exercises[0];
      return name
        ? `¿Cómo estoy progresando en ${name.exercise} (${name.variant})?`
        : "¿Cómo estoy progresando en este ejercicio?";
    }
    case "EXPLAIN": {
      const name = context.exercises[0];
      return name
        ? `¿Por qué hago ${name.prescription} en ${name.exercise} (${name.variant})?`
        : "¿Por qué hago esta prescripción?";
    }
    case "ASK":
      return (request.question ?? "").slice(0, AI_CONFIG.maxQuestionChars);
  }
}

export async function runCoach(
  provider: CoachProvider,
  request: CoachRequest,
): Promise<CoachResult> {
  const fallback = deterministicFallback(request);

  if (request.analysis.context.sessions.length === 0) {
    return {
      ok: false,
      task: request.task,
      error: "NO_DATA",
      message:
        "Todavía no hay sesiones registradas para analizar. Entrena y vuelve.",
      fallback,
    };
  }

  const full = buildCoachContext(
    request.analysis,
    request.profile,
    request.variantId,
  );
  const context = focusContext(full, request.variantId);
  if (request.variantId && context.exercises.length === 0) {
    return {
      ok: false,
      task: request.task,
      error: "NO_DATA",
      message:
        "No tengo historial reciente de este ejercicio para analizarlo. Regístralo una vez y vuelve.",
      fallback,
    };
  }

  const contextJson = serializeContext(context, AI_CONFIG.maxContextChars);

  const result = await provider.generate({
    system: SYSTEM_PROMPT,
    instructions: INSTRUCTIONS[request.task],
    contextJson,
    userMessage: userMessage(request, context),
  });

  if (result.kind === "TRUNCATED") {
    return {
      ok: false,
      task: request.task,
      error: "INVALID_RESPONSE",
      message: "La respuesta del coach se cortó a mitad. Inténtalo otra vez.",
      fallback,
    };
  }
  if (result.kind === "TIMEOUT") {
    return {
      ok: false,
      task: request.task,
      error: "TIMEOUT",
      message: "El coach ha tardado demasiado. Inténtalo otra vez.",
      fallback,
    };
  }
  if (result.kind === "RATE_LIMIT") {
    return {
      ok: false,
      task: request.task,
      error: "RATE_LIMIT",
      message: "Demasiadas consultas seguidas. Espera un momento.",
      fallback,
    };
  }
  if (result.kind === "ERROR") {
    return {
      ok: false,
      task: request.task,
      error: "PROVIDER_ERROR",
      message: "El coach no está disponible ahora mismo.",
      fallback,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(result.text);
  } catch {
    return {
      ok: false,
      task: request.task,
      error: "INVALID_RESPONSE",
      message: "El coach ha devuelto una respuesta que no he podido leer.",
      fallback,
    };
  }

  const parsed = coachResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false,
      task: request.task,
      error: "INVALID_RESPONSE",
      message: "El coach ha devuelto una respuesta incompleta.",
      fallback,
    };
  }

  const guard = checkResponse(parsed.data, context, request.task);
  if (guard.block) {
    return {
      ok: false,
      task: request.task,
      error: "GUARDRAIL_BLOCKED",
      message: `${guard.reason} Te dejo lo que dice el motor.`,
      fallback,
    };
  }

  return {
    ok: true,
    task: request.task,
    response: parsed.data,
    usage: {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedCostUsd: result.estimatedCostUsd,
    },
    warnings: guard.warnings,
  };
}
