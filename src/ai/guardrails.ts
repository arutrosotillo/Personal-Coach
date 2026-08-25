import type { CoachContext } from "@/ai/context";
import type { CoachResponse, CoachTask } from "@/ai/types";

/**
 * Guardrails de Coach AI: se ejecutan DESPUÉS del modelo y antes de enseñar
 * nada. Su trabajo es impedir que la IA invente cifras o contradiga al motor
 * determinista.
 *
 * `block` = la respuesta no se muestra y se cae al fallback determinista.
 * `warnings` = se muestra, pero queda registrado el aviso.
 *
 * Dos lecciones aprendidas en revisión, que explican la forma del código:
 *   · comprobar solo `recommendation` dejaba pasar la misma frase escrita en
 *     el titular, en un highlight o en una hipótesis → se evalúa TODO el texto;
 *   · `contextJson.includes("202")` daba por buena una carga de 202 kg porque
 *     las FECHAS contienen "202" → se compara contra el conjunto de números
 *     realmente presentes en el contexto, no contra el texto del JSON.
 */

export interface GuardrailResult {
  block: boolean;
  reason: string | null;
  warnings: string[];
}

/** Sustancias que la app nunca recomienda (COACH_PHILOSOPHY §12). */
const FORBIDDEN =
  /\b(esteroides?|sarms?|anabolizantes?|clembuterol|oxandrolona|trembolona|estanozolol|nandrolona|winstrol|dianabol|enantato|propionato|aas|testosterona)\b/i;

/** Verbos y giros que proponen mover la carga, incluidos infinitivos. */
const LOAD_NOUN = "(?:carga|peso|kilos|kg|disco|discos)";
const INCREASE_HINT = new RegExp(
  `\\b(?:sub(?:e|es|ir|iría|irías|imos)|aument(?:a|ar|aría)|increment(?:a|ar)|añad(?:e|ir|iría)|met(?:e|er)|pon(?:le|er)?|progresa)\\b[^.]{0,30}\\b${LOAD_NOUN}\\b`,
  "i",
);
const DECREASE_HINT = new RegExp(
  `\\b(?:baj(?:a|ar|aría)|reduc(?:e|ir)|recort(?:a|ar)|quit(?:a|ar)|alig(?:era|erar)|resta)\\b[^.]{0,30}\\b${LOAD_NOUN}\\b`,
  "i",
);

/** Formas de proponer una descarga, más allá de la palabra "deload". */
const DELOAD_HINT =
  /\b(?:descarga|deload|semana\s+(?:de\s+)?(?:descarga|suave|floja|ligera|adaptación|adaptacion)|descansa(?:r)?\s+(?:una\s+semana|\d+\s+días)|baja(?:r)?\s+el\s+volumen)\b/i;

/** ¿La coincidencia va precedida de una negación? "No toca deload" es correcto. */
const NEGATION_BEFORE = /\b(?:no|sin|nada\s+de|tampoco|ni)\b[^.]{0,30}$/i;

/**
 * ¿La coincidencia es CONDICIONAL o EXPLICATIVA en vez de prescriptiva?
 *
 * "Para subir carga, cierra 10 repeticiones" describe la regla del motor;
 * "sube a 25 kg" prescribe una acción para hoy. La diferencia importa: la
 * tarea EXPLAIN ("¿Por qué hago esto?") tiene como cometido explícito contar
 * "qué tendría que ocurrir para que suba la carga", así que sin esto el
 * guardrail bloqueaba SIEMPRE la respuesta que él mismo había pedido, y la
 * función quedaba muerta para cualquiera que no tuviera justo un ejercicio
 * listo para subir. Verificado en QA: una explicación correcta —que además
 * decía que la fatiga y el dolor suspenden las subidas— se descartaba entera.
 */
const CONDITIONAL_BEFORE =
  /\b(?:para|cuando|cuándo|si|hasta|en\s+cuanto|una\s+vez|antes\s+de|requisito|condici[óo]n|permitir[áa]|har[áa]\s+que|justifica|toca)\b[^.]{0,30}$/i;

const KG_NUMBER = /(\d+(?:[.,]\d+)?)\s*(?:kgs?|kilo(?:gramo)?s?)\b/gi;
const PERCENT_NUMBER = /(\d+(?:[.,]\d+)?)\s*%/g;

/** Sinónimos por métrica ausente, para que el aviso no dependa de una palabra. */
const MISSING_TERMS: Record<string, string[]> = {
  "peso corporal actual": ["peso corporal", "báscula", "bascula"],
  "calorías diarias": ["calorías", "calorias", "kcal", "superávit", "déficit"],
  "proteína diaria": ["proteína", "proteina"],
  "horas de sueño": ["sueño", "sueno", "dormir"],
  "pasos / actividad diaria": ["pasos"],
  "medidas corporales": ["cintura", "perímetro", "perimetro"],
};

/** Todos los números que aparecen realmente en el contexto, ya normalizados. */
function contextNumbers(context: CoachContext): Set<number> {
  const out = new Set<number>();
  const walk = (value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value)) {
      out.add(value);
      return;
    }
    if (typeof value === "string") {
      for (const match of value.matchAll(/\d+(?:[.,]\d+)?/g)) {
        const n = Number(match[0].replace(",", "."));
        if (Number.isFinite(n)) out.add(n);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  walk(context);
  return out;
}

function isGrounded(raw: string, numbers: Set<number>): boolean {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return false;
  // Tolerancia mínima por redondeos de presentación (82.5 ↔ 82.50).
  for (const value of numbers) {
    if (Math.abs(value - n) < 0.01) return true;
  }
  return false;
}

/**
 * Coincidencias de `regex` en `text` que son PRESCRIPTIVAS: ni negadas
 * ("no toca descarga") ni condicionales ("para subir carga, cierra 10 reps").
 */
function matchesAffirmative(regex: RegExp, text: string): boolean {
  const global = new RegExp(regex.source, `${regex.flags.replace("g", "")}g`);
  for (const match of text.matchAll(global)) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 40), index);
    if (NEGATION_BEFORE.test(before) || CONDITIONAL_BEFORE.test(before)) {
      continue;
    }
    return true;
  }
  return false;
}

function collect(regex: RegExp, text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(regex)) out.push(match[1]);
  return out;
}

export function checkResponse(
  response: CoachResponse,
  context: CoachContext,
  task: CoachTask = "WEEKLY",
): GuardrailResult {
  const text = [
    response.headline,
    response.recommendation,
    response.fatigue ?? "",
    ...response.highlights.map((h) => `${h.label} ${h.detail}`),
    ...response.hypotheses,
  ].join("\n");

  const warnings: string[] = [];
  const numbers = contextNumbers(context);

  // ── 1. Sustancias vetadas (salvo si se están desaconsejando) ────────────
  if (matchesAffirmative(FORBIDDEN, text)) {
    return {
      block: true,
      reason:
        "La respuesta mencionaba sustancias que esta app nunca recomienda.",
      warnings,
    };
  }

  // ── 2. Cifras inventadas en kilos ──────────────────────────────────────
  const ungroundedKg = collect(KG_NUMBER, text).filter(
    (v) => !isGrounded(v, numbers),
  );
  if (ungroundedKg.length > 0) {
    return {
      block: true,
      reason: `La respuesta citaba cargas que no están en tus datos (${ungroundedKg.join(", ")} kg).`,
      warnings,
    };
  }

  // Un porcentaje puede estar respaldado por su FRACCIÓN: el contexto guarda
  // `avgCompletionRate: 0.826` y el modelo escribe, correctamente, "82,6 %".
  const ungroundedPct = collect(PERCENT_NUMBER, text).filter(
    (v) =>
      !isGrounded(v, numbers) &&
      !isGrounded(String(Number(v.replace(",", ".")) / 100), numbers),
  );
  if (ungroundedPct.length > 0) {
    warnings.push(
      `Porcentajes no verificables en tus datos: ${ungroundedPct.join(", ")} %.`,
    );
  }

  // ── 3. Contradicción con el motor de progresión ────────────────────────
  //
  // EXPLAIN queda fuera a propósito. Su cometido es contar CÓMO funciona la
  // progresión —incluido "qué haría que subiera la carga"—, así que hablar de
  // subir carga no es contradecir al motor: es la respuesta. Aplicarle esta
  // regla dejaba la función inservible para cualquiera que no tuviera justo un
  // ejercicio listo para subir, y encima de forma intermitente, según cómo
  // redactara el modelo la misma idea. Lo que SÍ sigue aplicándose a EXPLAIN:
  // cifras inventadas, descargas inventadas y sustancias vetadas — y su prompt
  // le prohíbe nombrar el peso al que subiría.
  const actions = new Set(context.exercises.map((e) => e.progression.action));
  const checkEngineContradiction = task !== "EXPLAIN";
  if (
    checkEngineContradiction &&
    !actions.has("INCREASE_LOAD") &&
    matchesAffirmative(INCREASE_HINT, text)
  ) {
    return {
      block: true,
      reason:
        "La respuesta proponía subir la carga cuando el motor no lo recomienda en ningún ejercicio.",
      warnings,
    };
  }
  if (
    checkEngineContradiction &&
    !actions.has("DECREASE_LOAD") &&
    matchesAffirmative(DECREASE_HINT, text)
  ) {
    return {
      block: true,
      reason:
        "La respuesta proponía bajar la carga cuando el motor no lo recomienda en ningún ejercicio.",
      warnings,
    };
  }

  // ── 4. Descarga inventada (o desaconsejada cuando sí toca) ──────────────
  const proposesDeload = matchesAffirmative(DELOAD_HINT, text);
  if (context.fatigue.decision !== "DELOAD_RECOMMENDED" && proposesDeload) {
    return {
      block: true,
      reason:
        "La respuesta recomendaba una descarga que el motor de fatiga no recomienda.",
      warnings,
    };
  }
  if (
    context.fatigue.decision === "DELOAD_RECOMMENDED" &&
    /\b(?:no|sin|nada\s+de)\b[^.]{0,30}\b(?:descarga|deload|descansar)\b/i.test(
      text,
    )
  ) {
    return {
      block: true,
      reason:
        "La respuesta desaconsejaba una descarga que el motor de fatiga sí recomienda.",
      warnings,
    };
  }

  // ── 5. Métricas que no registramos ─────────────────────────────────────
  for (const missing of context.notAvailable) {
    // Se busca la frase completa y sus sinónimos, no la primera palabra: con
    // "peso" saltaba en cualquier frase que mencionara el peso de la barra.
    const terms = MISSING_TERMS[missing] ?? [missing];
    const hit = terms.some((term) =>
      new RegExp(
        `\\d[^.]{0,25}\\b${term}\\b|\\b${term}\\b[^.]{0,25}\\d`,
        "i",
      ).test(text),
    );
    if (hit) {
      warnings.push(
        `Menciona "${missing}" con cifras, y eso no se registra en la app.`,
      );
    }
  }

  return { block: false, reason: null, warnings };
}
