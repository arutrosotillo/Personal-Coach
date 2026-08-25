import "server-only";

/**
 * Configuración de Coach AI. Solo servidor: este módulo lee `process.env` y
 * NUNCA debe importarse desde un componente cliente.
 *
 * Toda la app funciona sin IA. Si falta `OPENAI_API_KEY`, `isCoachConfigured()`
 * devuelve `false` y la UI muestra "AI Coach no configurado" — el tracker sigue
 * intacto.
 */

/**
 * Modelo por defecto: `gpt-5.6-luna`, la generación actual más barata
 * ($0.20 / 1M input, $1.20 / 1M output — precios oficiales verificados el
 * 2026-08-25 en developers.openai.com/api/docs/pricing). A ~4.000 tokens de
 * entrada y ~500 de salida sale a ~0,0014 $ por consulta.
 *
 * Se puede cambiar sin tocar código con `AI_COACH_MODEL`.
 */
const DEFAULT_MODEL = "gpt-5.6-luna";

/** Lee un número de entorno, ignorando valores no numéricos. */
function num(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const AI_CONFIG = {
  model: process.env.AI_COACH_MODEL ?? DEFAULT_MODEL,
  /**
   * Tope de salida. Ojo: en los modelos de razonamiento los tokens de
   * razonamiento CUENTAN aquí y se facturan como salida, por eso las llamadas
   * van con `reasoning.effort = "none"` y `text.verbosity = "low"`.
   *
   * 1.600 ≈ el máximo que permite el contrato de respuesta (5.360 caracteres).
   * Con 700 una respuesta larga se cortaba a medias y llegaba como JSON roto.
   */
  maxOutputTokens: num(process.env.AI_COACH_MAX_OUTPUT_TOKENS, 1600),
  /** Tope duro del contexto que se envía, medido en caracteres del JSON. */
  maxContextChars: num(process.env.AI_COACH_MAX_CONTEXT_CHARS, 24_000),
  /** Timeout por petición. Un coach que tarda 30 s no sirve en el gimnasio. */
  timeoutMs: num(process.env.AI_COACH_TIMEOUT_MS, 25_000),
  /** Reintentos del SDK. 1 basta: si falla, se muestra el fallback. */
  maxRetries: num(process.env.AI_COACH_MAX_RETRIES, 1),
  /** Tope de consultas por hora, para que el endpoint no sea un grifo abierto. */
  maxCallsPerHour: num(process.env.AI_COACH_MAX_CALLS_PER_HOUR, 30),
  /** Longitud máxima de una pregunta libre. */
  maxQuestionChars: 500,
} as const;

/** Precios en $ por millón de tokens, para estimar coste sin llamar a nadie. */
export const AI_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.6-terra": { input: 2.0, output: 12.0 },
  "gpt-5.6-sol": { input: 4.0, output: 20.0 },
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = AI_PRICING[model];
  if (!price) return null;
  return (
    (inputTokens * price.input) / 1e6 + (outputTokens * price.output) / 1e6
  );
}

/** La clave vive SOLO en el servidor. Nunca se expone ni se registra. */
export function getApiKey(): string | undefined {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export function isCoachConfigured(): boolean {
  // `AI_COACH_FAKE` es el proveedor enlatado de los E2E: si está activo, la UI
  // debe presentarse como configurada para no mostrar un aviso que contradice
  // lo que el botón hace. La app nunca lo activa por su cuenta.
  if (process.env.AI_COACH_FAKE === "1") return true;
  return getApiKey() !== undefined;
}
