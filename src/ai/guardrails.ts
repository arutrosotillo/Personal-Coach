import type { CoachContext } from "@/ai/context";
import type { CoachResponse } from "@/ai/types";

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
/**
 * PROPONER una descarga. Ojo: nombrarla no es proponerla.
 *
 * Desde que el contexto marca las sesiones de descarga (`descarga: true`), el
 * coach habla de ellas con normalidad —"esta semana hiciste una descarga
 * recomendada y no debes recuperar el volumen"—, que es exactamente lo que
 * queremos que sepa distinguir. Bloquear cualquier mención tiraba justo esas
 * respuestas. Así que se exige un giro PRESCRIPTIVO junto al sustantivo, o una
 * frase que ya es imperativa por sí sola.
 */
const DELOAD_PRESCRIPTION = new RegExp(
  [
    // "haz / tómate / necesitas / deberías … una descarga"
    "\\b(?:haz(?:te)?|har[íi]a|t[óo]mate|toma|tomar[íi]a|necesitas|necesitar[íi]as|deber[íi]as|te\\s+recomiendo|recomiendo|conviene|planifica|programa|m[ée]tete|toca|hay\\s+que|vale\\s+la\\s+pena|considera|valora)\\b[^.!?]{0,40}\\b(?:descarga|deload|semana\\s+(?:de\\s+)?(?:descarga|suave|floja|ligera|mantenimiento|adaptaci[óo]n))\\b",
    // Frases que ya son una orden por sí mismas.
    "\\bdescansa(?:r)?\\s+(?:una\\s+semana|\\d+\\s+d[íi]as)\\b",
    "\\bbaja(?:r)?\\s+el\\s+volumen\\b",
    "\\bs[áa]ltate\\s+(?:la|las|el|los)\\s+\\w+\\s+sesi[óo]n\\w*",
    "\\brecorta\\s+(?:las\\s+)?series\\b",
  ].join("|"),
  "i",
);

/** Desaconsejar una descarga que el motor SÍ recomienda, sin nombrarla. */
const DELOAD_DENIAL =
  /\b(?:no\s+necesitas\s+(?:parar|descansar|bajar)|sigue\s+empujando|no\s+hace\s+falta\s+(?:parar|frenar)|jam[áa]s\s+hace\s+falta|olv[íi]date\s+de\s+la\s+descarga|entrena\s+normal)\b/i;

/**
 * ¿La coincidencia va precedida de una negación que la afecta de verdad?
 *
 * Se mira SOLO la cláusula inmediata (se corta por `,;:.` y también por el
 * inicio de la frase) y se exige que la negación esté pegada al verbo. Antes se
 * miraban 40 caracteres a pelo, así que "No hay duda: sube la carga" y "Sin
 * miedo, sube la carga" contaban como negadas.
 */
const NEGATION_BEFORE =
  /\b(?:no|nunca|jam[áa]s|sin|nada\s+de|tampoco|ni)\b[\s\wáéíóúñ]{0,12}$/i;

/**
 * Adverbios que convierten cualquier giro en una orden para HOY. Si aparecen,
 * la exención condicional no aplica: "cuando entrenes, baja la carga hoy" es
 * una prescripción disfrazada de condicional.
 */
const PRESCRIPTIVE_NOW =
  /\b(?:hoy|ya|ahora|esta\s+semana|esta\s+sesi[óo]n|la\s+pr[óo]xima\s+(?:vez|sesi[óo]n)|siguiente\s+sesi[óo]n|mismo)\b/i;

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
  /\b(?:para|cuando|cu[áa]ndo|si|hasta|en\s+cuanto|una\s+vez|antes\s+de|requisito|condici[óo]n|permitir[áa]|har[áa]\s+que)\b[^.!?]*$/i;

/**
 * Cosas que la app no hace NUNCA, por presencia y sin excepción condicional.
 * Ninguna estaba filtrada: la única lista de contenido eran las sustancias.
 */

/** Diagnóstico clínico. La app no diagnostica (COACH_PHILOSOPHY §12). */
const DIAGNOSIS =
  /\b(?:tendinitis|tendinopat[íi]a|hernia\s+discal|rotura\s+(?:de\s+)?(?:fibrilar|fibras|tend[óo]n)|artrosis|bursitis|s[íi]ndrome\s+(?:subacromial|del\s+manguito)|pinzamiento|condromalacia)\b/i;

/** Entrenar al fallo por sistema, o entrenar a través del dolor. */
const HARMFUL_ADVICE =
  /\b(?:al\s+fallo\s+(?:muscular\s+)?absoluto|todas\s+las\s+series\s+al\s+fallo|hasta\s+el\s+fallo\s+en\s+(?:todas|cada))\b|\b(?:ignora|aguanta|entrena\s+(?:a\s+trav[ée]s\s+d|con))\w*\s+(?:el\s+)?dolor\b|\bel\s+dolor\s+\w+\s+es\s+normal\b/i;

/**
 * Cambiar el PROGRAMA. Ni siquiera el motor determinista hace esto: añadir o
 * quitar series es F3.4 y está aplazada. Que lo hiciera la IA sería la
 * violación más directa de "el motor es la única autoridad".
 */
const PROGRAM_MUTATION =
  /\b(?:a[ñn]ad(?:e|ir)|met(?:e|er)|quit(?:a|ar)|elimin(?:a|ar)|sustituy(?:e|ir)|cambia(?:r)?|p[áa]sate)\b[^.!?]{0,40}\b(?:serie|series|ejercicio|ejercicios|d[íi]a|d[íi]as|rutina|programa|split)\b|\b(?:baja|sube|cambia|pon)\w*\s+(?:el\s+)?RIR\b/i;

const KG_NUMBER = /(\d+(?:[.,]\d+)?)\s*(?:kgs?|kilo(?:gramo)?s?)\b/gi;
/** Carga sin unidad: "sube a 102,5", "ponte a 90". */
const BARE_LOAD =
  /\b(?:sub(?:e|es|ir)|p[oó]n(?:te|le)?|s[úu]belo|baja(?:lo)?)\s+(?:a|hasta)\s+(\d+(?:[.,]\d+)?)/gi;
/** Cifras SIN unidad de peso que también hay que respaldar (G-7). */
const OTHER_NUMBER =
  /(\d+(?:[.,]\d+)?)\s*(?:repeticiones|reps|series|kcal|calor[íi]as|gramos\s+de\s+prote[íi]na|g\s+de\s+prote[íi]na)\b/gi;
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
      // Fuera las fechas ANTES de extraer números: `"2026-08-21"` metía 2026,
      // 8 y 21 en el conjunto, así que "ponte 21 kg" (o 2026 kg) pasaba como
      // cifra respaldada por los datos.
      const sinFechas = value.replace(/\d{4}-\d{2}-\d{2}/g, " ");
      for (const match of sinFechas.matchAll(/\d+(?:[.,]\d+)?/g)) {
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

/**
 * Los pesos que aparecen en el contexto, y solo esos.
 *
 * Para validar kilos no vale el conjunto general de números: el contexto lleva
 * umbrales, días y contadores, así que "ponte 21 kg" quedaba respaldado por
 * `windowDays: 21`. Una carga solo puede estar respaldada por una carga.
 */
function contextLoads(context: CoachContext): Set<number> {
  const out = new Set<number>();
  const add = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.add(v);
  };
  for (const e of context.exercises) {
    add(e.progression.suggestedWeightKg);
    for (const v of e.equivalentLoadTrend ?? []) add(v);
    for (const linea of e.recentSets ?? []) {
      for (const m of String(linea).matchAll(/(\d+(?:[.,]\d+)?)\s*[×x]/g)) {
        add(Number(m[1].replace(",", ".")));
      }
    }
  }
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

/** La cláusula en la que cae `index`: se corta por puntuación fuerte y comas. */
function clauseBefore(text: string, index: number): string {
  const upTo = text.slice(0, index);
  const cut = Math.max(
    upTo.lastIndexOf("."),
    upTo.lastIndexOf(";"),
    upTo.lastIndexOf(":"),
    upTo.lastIndexOf("!"),
    upTo.lastIndexOf("?"),
    upTo.lastIndexOf("\n"),
  );
  return upTo.slice(cut + 1);
}

/**
 * Coincidencias de `regex` en `text` que son PRESCRIPTIVAS: ni negadas
 * ("no toca descarga") ni condicionales ("para subir carga, cierra 10 reps").
 *
 * Ojo: esto NO se aplica a las sustancias vetadas. Una excepción condicional
 * ahí significaba que "Para volumen, usa esteroides" pasaba el filtro.
 */
function matchesAffirmative(regex: RegExp, text: string): boolean {
  const global = new RegExp(regex.source, `${regex.flags.replace("g", "")}g`);
  for (const match of text.matchAll(global)) {
    const index = match.index ?? 0;
    const clause = clauseBefore(text, index);
    // Una orden para hoy no es una condición, por mucho "cuando" que lleve.
    // Hay que mirar la frase ENTERA: en "si quieres progresar, sube la carga
    // hoy mismo" el adverbio va después del verbo.
    const rest = text.slice(index).split(/[.!?\n]/)[0] ?? "";
    const sentence = clause + rest;
    if (PRESCRIPTIVE_NOW.test(sentence)) return true;
    const negationWindow = clause.split(",").pop() ?? clause;
    if (
      NEGATION_BEFORE.test(negationWindow) ||
      CONDITIONAL_BEFORE.test(clause)
    ) {
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

  // ── 1. Sustancias vetadas ───────────────────────────────────────────────
  // Por PRESENCIA, sin excepción condicional. Pasaba por `matchesAffirmative`
  // y bastaba abrir la frase con "Para" o "Si" para que la app recomendara
  // anabolizantes. El coste de un falso positivo aquí es cero: que se
  // descarte una respuesta por nombrar una sustancia es exactamente lo que
  // queremos, aunque fuera para desaconsejarla.
  if (FORBIDDEN.test(text)) {
    return {
      block: true,
      reason:
        "La respuesta mencionaba sustancias que esta app nunca recomienda.",
      warnings,
    };
  }

  // ── 2. Cifras inventadas en kilos ──────────────────────────────────────
  const loads = contextLoads(context);
  const ungroundedKg = [
    ...collect(KG_NUMBER, text),
    ...collect(BARE_LOAD, text),
  ].filter((v) => !isGrounded(v, loads));
  if (ungroundedKg.length > 0) {
    return {
      block: true,
      reason: `La respuesta citaba cargas que no están en tus datos (${ungroundedKg.join(", ")} kg).`,
      warnings,
    };
  }

  // Repeticiones, series, RIR y kilocalorías. Antes solo se comprobaban los
  // kilos, así que bastaba omitir la unidad ("sube a 102,5 y cierra 6") o
  // hablar de series para que la cifra inventada pasara sin más.
  const ungroundedOther = collect(OTHER_NUMBER, text).filter(
    (v) => !isGrounded(v, numbers),
  );
  if (ungroundedOther.length > 0) {
    return {
      block: true,
      reason: `La respuesta citaba cifras que no están en tus datos (${ungroundedOther.join(", ")}).`,
      warnings,
    };
  }

  // Un porcentaje puede estar respaldado por su FRACCIÓN, y al revés: el
  // contexto lleva tanto fracciones (0.5 de recorte) como porcentajes enteros
  // (`avgCompletionPct: 91`), y el modelo escribe indistintamente una u otro.
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

  // ── 2b. Contenido que la app no produce nunca ───────────────────────────
  if (DIAGNOSIS.test(text)) {
    return {
      block: true,
      reason:
        "La respuesta ponía un diagnóstico clínico, y esta app no diagnostica.",
      warnings,
    };
  }
  if (HARMFUL_ADVICE.test(text)) {
    return {
      block: true,
      reason:
        "La respuesta aconsejaba entrenar al fallo por sistema o pasar por alto el dolor.",
      warnings,
    };
  }
  if (PROGRAM_MUTATION.test(text)) {
    return {
      block: true,
      reason:
        "La respuesta cambiaba el programa (series, ejercicios, días o RIR objetivo), y eso no lo decide el coach.",
      warnings,
    };
  }

  // ── 3. Contradicción con el motor de progresión ────────────────────────
  //
  // EXPLAIN ya NO está exenta. Lo estuvo, y era un boquete: dejaba pasar
  // "sube la carga hoy mismo" en la pantalla que más parece una instrucción.
  // El problema real era la ventana de 30 caracteres de la detección
  // condicional, no la comprobación en sí; ampliada a la cláusula completa,
  // las explicaciones legítimas ("para subir carga, cierra el rango") pasan
  // con la regla activa.
  const actions = new Set(context.exercises.map((e) => e.progression.action));
  if (
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
  const proposesDeload = matchesAffirmative(DELOAD_PRESCRIPTION, text);
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
    (/\b(?:no|sin|nada\s+de|jam[áa]s)\b[^.]{0,30}\b(?:descarga|deload|descansar|parar)\b/i.test(
      text,
    ) ||
      DELOAD_DENIAL.test(text))
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
