import type { CoachContext } from "@/ai/context";
import type { CoachResponse } from "@/ai/types";

/**
 * Guardrails de Coach AI: se ejecutan DESPUÉS del modelo y antes de enseñar
 * nada. Su trabajo es impedir que la IA invente cifras o contradiga al motor
 * determinista.
 *
 * `block` = la respuesta no se muestra y se cae al fallback determinista.
 * `warnings` = se muestra, pero queda registrado el aviso.
 */

export interface GuardrailResult {
  block: boolean;
  reason: string | null;
  warnings: string[];
}

/** Palabras que la app nunca debe recomendar (COACH_PHILOSOPHY §12). */
const FORBIDDEN =
  /\b(esteroide|esteroides|sarm|sarms|anabolizante|clembuterol|testosterona\s+exógena)\b/i;

/** Verbos de cambio de carga, para detectar contradicciones con el motor. */
const ARTICLE = "(?:el|la|los|las|tu|tus)\\s+";
const INCREASE_HINT = new RegExp(
  `\\b(sub[ei]|aumenta|incrementa|añade)\\s+(?:${ARTICLE})?(carga|peso|kilos)\\b`,
  "i",
);
const DECREASE_HINT = new RegExp(
  `\\b(baja|bajar|reduce|reducir|recorta)\\s+(?:${ARTICLE})?(carga|peso|kilos)\\b`,
  "i",
);
const DELOAD_HINT =
  /\b(descarga|deload|semana\s+(de\s+)?(descarga|suave)|desload)\b/i;

/** Números que acompañan a un kilo: son los que más daño hacen si se inventan. */
const KG_NUMBER = /(\d+(?:[.,]\d+)?)\s*(?:kg|kilos?)\b/gi;
const PERCENT_NUMBER = /(\d+(?:[.,]\d+)?)\s*%/g;

function normalizeNumber(raw: string): string {
  return raw.replace(",", ".").replace(/\.0+$/, "");
}

/**
 * ¿Aparece este número en el contexto que se le pasó al modelo? Se compara
 * sobre el JSON serializado, tolerando `80` vs `80.0` vs `80,0`.
 */
function isGrounded(value: string, contextJson: string): boolean {
  const n = normalizeNumber(value);
  if (contextJson.includes(n)) return true;
  // Un entero puede aparecer en el contexto como decimal (`82.5` → `82.5`), o
  // al revés (`45` ↔ `45.0`).
  const asFloat = Number(n);
  if (!Number.isFinite(asFloat)) return false;
  return (
    contextJson.includes(asFloat.toFixed(1)) ||
    contextJson.includes(String(Math.round(asFloat)))
  );
}

function collect(regex: RegExp, text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(regex)) out.push(match[1]);
  return out;
}

export function checkResponse(
  response: CoachResponse,
  context: CoachContext,
  contextJson: string,
): GuardrailResult {
  const text = [
    response.headline,
    response.recommendation,
    response.fatigue ?? "",
    ...response.highlights.map((h) => `${h.label} ${h.detail}`),
    ...response.hypotheses,
  ].join("\n");

  const warnings: string[] = [];

  // ── 1. Sustancias vetadas ──────────────────────────────────────────────
  if (FORBIDDEN.test(text)) {
    return {
      block: true,
      reason:
        "La respuesta mencionaba sustancias que esta app nunca recomienda.",
      warnings,
    };
  }

  // ── 2. Cifras inventadas en kilos ──────────────────────────────────────
  const ungroundedKg = collect(KG_NUMBER, text).filter(
    (v) => !isGrounded(v, contextJson),
  );
  if (ungroundedKg.length > 0) {
    return {
      block: true,
      reason: `La respuesta citaba cargas que no están en tus datos (${ungroundedKg.join(", ")} kg).`,
      warnings,
    };
  }

  // Los porcentajes solo avisan: pueden ser redondeos legítimos.
  const ungroundedPct = collect(PERCENT_NUMBER, text).filter(
    (v) => !isGrounded(v, contextJson),
  );
  if (ungroundedPct.length > 0) {
    warnings.push(
      `Porcentajes no verificables en los datos: ${ungroundedPct.join(", ")} %.`,
    );
  }

  // ── 3. Contradicción con el motor de progresión ────────────────────────
  // Solo aplica cuando TODOS los ejercicios del contexto coinciden en no tocar
  // la carga: si alguno sí sube o baja, hablar de carga es legítimo.
  const actions = new Set(context.exercises.map((e) => e.progression.action));
  const anyIncrease = actions.has("INCREASE_LOAD");
  const anyDecrease = actions.has("DECREASE_LOAD");
  if (!anyIncrease && INCREASE_HINT.test(text)) {
    return {
      block: true,
      reason:
        "La respuesta proponía subir la carga cuando el motor no lo recomienda en ningún ejercicio.",
      warnings,
    };
  }
  if (!anyDecrease && DECREASE_HINT.test(text)) {
    return {
      block: true,
      reason:
        "La respuesta proponía bajar la carga cuando el motor no lo recomienda en ningún ejercicio.",
      warnings,
    };
  }

  // ── 4. Descarga inventada ──────────────────────────────────────────────
  if (
    context.fatigue.decision !== "DELOAD_RECOMMENDED" &&
    DELOAD_HINT.test(response.recommendation)
  ) {
    return {
      block: true,
      reason:
        "La respuesta recomendaba una descarga que el motor de fatiga no recomienda.",
      warnings,
    };
  }

  // ── 5. Métricas que no registramos ─────────────────────────────────────
  for (const missing of context.notAvailable) {
    const head = missing.split(" ")[0];
    const pattern = new RegExp(`\\b${head}\\b[^.]{0,40}\\d`, "i");
    if (pattern.test(text)) {
      warnings.push(
        `Menciona "${missing}" con cifras, y eso no se registra en la app.`,
      );
    }
  }

  return { block: false, reason: null, warnings };
}
