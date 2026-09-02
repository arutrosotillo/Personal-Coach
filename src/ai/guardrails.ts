import type { CoachContext } from "@/ai/context";
import type { CoachResponse } from "@/ai/types";
import {
  matchesWithPolarity,
  palabra,
  polarityAt,
  type Polarity,
} from "@/ai/clause";
import {
  citations,
  esDominioCorporal,
  isSupported,
  supportedNumbers,
  userNumbers,
  ventanaDeClausula,
  type Citation,
} from "@/ai/numbers";

/**
 * Guardrails de Coach AI: se ejecutan DESPUÉS del modelo y antes de enseñar
 * nada. Su trabajo es impedir que la IA invente cifras o contradiga al motor
 * determinista.
 *
 * `block` = la respuesta no se muestra y se cae al fallback determinista.
 * `warnings` = se muestra, pero queda registrado el aviso.
 *
 * Lecciones aprendidas que explican la forma del código:
 *   · comprobar solo `recommendation` dejaba pasar la misma frase escrita en
 *     el titular, en un highlight o en una hipótesis → se evalúa TODO el texto;
 *   · `contextJson.includes("202")` daba por buena una carga de 202 kg porque
 *     las FECHAS contienen "202" → se compara contra números reales;
 *   · y la lección de la QA en vivo (B6.1): un conjunto plano de números ya no
 *     basta. Desde que viaja el cuerpo, "82,4" puede ser la báscula o la
 *     barra, y hacen falta las dos cosas que aporta `numbers.ts` — saber QUÉ
 *     significa cada cifra— y `clause.ts` —saber si la frase la AFIRMA, la
 *     niega, la rechaza o la plantea—. De los 13 bloqueos de la primera
 *     batería real, los 13 eran falsos positivos por no distinguir eso.
 */

export interface GuardrailResult {
  block: boolean;
  reason: string | null;
  warnings: string[];
}

/** Sustancias que la app nunca recomienda (COACH_PHILOSOPHY §12). */
const FORBIDDEN = palabra(
  "esteroides?|sarms?|anabolizantes?|clembuterol|oxandrolona|trembolona|estanozolol|nandrolona|winstrol|dianabol|enantato|propionato|aas|testosterona",
);

/**
 * Mover la CARGA. `peso` sigue contando como sustantivo de carga cuando va
 * DETRÁS del verbo ("baja el peso"), pero `kg` y `kilos` ya no bastan por sí
 * solos: era el fallo F1. "El peso baja a −0,42 kg/semana" —la frase central
 * del bloque corporal— se leía como una orden de bajar la carga, y se
 * descartaba una respuesta correcta entera.
 */
const VERBO_SUBIR =
  "sub(?:e|es|ir|ir[íi]a|ir[íi]as|imos)|aument(?:a|ar|ar[íi]a)|increment(?:a|ar)|a[ñn]ad(?:e|ir|ir[íi]a)|met(?:e|er)|pon(?:le|er)?|progresa";
const VERBO_BAJAR =
  "baj(?:a|ar|ar[íi]a)|reduc(?:e|ir)|recort(?:a|ar)|quit(?:a|ar)|alig(?:era|erar)|resta";
const CARGA_INEQUIVOCA =
  "carga|cargas|disco|discos|barra|mancuerna|mancuernas|peso";
/** Ambiguos: solo cuentan si la cláusula NO habla del cuerpo. */
const CARGA_AMBIGUA = "kilos|kg";

const hint = (verbos: string, nombre: string) =>
  new RegExp(
    // El hueco NO cruza puntuación ni coma: un verbo y su objeto están en la
    // misma cláusula. Sin esto, "el rendimiento sube; es compatible con
    // perder grasa" se leía como una prescripción de comida.
    `(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_])(?:${verbos})(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_])[^.,;:!?\n]{0,30}(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_])(?:${nombre})(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_])`,
    "i",
  );

const SUBIR_CARGA = hint(VERBO_SUBIR, CARGA_INEQUIVOCA);
const SUBIR_KILOS = hint(VERBO_SUBIR, CARGA_AMBIGUA);
const BAJAR_CARGA = hint(VERBO_BAJAR, CARGA_INEQUIVOCA);
const BAJAR_KILOS = hint(VERBO_BAJAR, CARGA_AMBIGUA);

/**
 * PROPONER una descarga. Ojo: nombrarla no es proponerla — desde que el
 * contexto marca las sesiones de descarga, el coach habla de ellas con
 * normalidad y bloquear cualquier mención tiraba justo esas respuestas.
 */
const DELOAD_PRESCRIPTION = new RegExp(
  [
    "\\b(?:haz(?:te)?|har[íi]a|t[óo]mate|toma|tomar[íi]a|necesitas|necesitar[íi]as|deber[íi]as|te\\s+recomiendo|recomiendo|conviene|planifica|programa|m[ée]tete|toca|hay\\s+que|vale\\s+la\\s+pena|considera|valora)\\b[^.!?]{0,40}\\b(?:descarga|deload|semana\\s+(?:de\\s+)?(?:descarga|suave|floja|ligera|mantenimiento|adaptaci[óo]n))\\b",
    "\\bdescansa(?:r)?\\s+(?:una\\s+semana|\\d+\\s+d[íi]as)\\b",
    "\\bbaja(?:r)?\\s+el\\s+volumen\\b",
    "\\bs[áa]ltate\\s+(?:la|las|el|los)\\s+\\w+\\s+sesi[óo]n\\w*",
    "\\brecorta\\s+(?:las\\s+)?series\\b",
  ].join("|"),
  "i",
);

/**
 * DESACONSEJAR la descarga que el motor sí recomienda.
 *
 * Exige un marco de consejo. Antes bastaba con que "no" y "descarga"
 * cayeran a menos de 30 caracteres, así que "no hay sesiones de descarga
 * registradas" —un dato de adherencia, no un consejo— tumbaba la respuesta.
 */
const DELOAD_DISCOURAGED = new RegExp(
  [
    "\\bno\\s+(?:necesitas|necesitar[íi]as|hace\\s+falta|debes|deber[íi]as|tienes\\s+que|hay\\s+que|conviene|toca|te\\s+recomiendo|recomiendo)\\b[^.,;:!?\\n]{0,30}\\b(?:descarga|deload|descansar|parar|frenar)\\b",
    "\\bno\\s+(?:la\\s+)?(?:hagas|apliques|tomes|te\\s+tomes)\\b[^.,;:!?\\n]{0,25}\\b(?:descarga|deload)\\b",
    "\\bs[áa]ltate\\s+la\\s+descarga\\b",
  ].join("|"),
  "i",
);

/** Desaconsejarla sin nombrarla. */
const DELOAD_DENIAL =
  /\b(?:no\s+necesitas\s+(?:parar|descansar|bajar)|sigue\s+empujando|no\s+hace\s+falta\s+(?:parar|frenar)|jam[áa]s\s+hace\s+falta|olv[íi]date\s+de\s+la\s+descarga|entrena\s+normal)\b/i;

/** Diagnóstico clínico. La app no diagnostica (COACH_PHILOSOPHY §12). */
const DIAGNOSIS = palabra(
  "tendinitis|tendinopat[íi]a|hernia\\s+discal|rotura\\s+(?:de\\s+)?(?:fibrilar|fibras|tend[óo]n)|artrosis|bursitis|s[íi]ndrome\\s+(?:subacromial|del\\s+manguito)|pinzamiento|condromalacia",
);

/** Entrenar al fallo por sistema, o entrenar a través del dolor. */
const HARMFUL_ADVICE =
  /\b(?:al\s+fallo\s+(?:muscular\s+)?absoluto|todas\s+las\s+series\s+al\s+fallo|hasta\s+el\s+fallo\s+en\s+(?:todas|cada))\b|\b(?:ignora|aguanta|entrena\s+(?:a\s+trav[ée]s\s+d|con))\w*\s+(?:el\s+)?dolor\b|\bel\s+dolor\s+\w+\s+es\s+normal\b/i;

/** Cambiar el PROGRAMA: ni el motor determinista hace esto (F3.4, aplazada). */
const PROGRAM_MUTATION =
  /\b(?:a[ñn]ad(?:e|ir)|met(?:e|er)|quit(?:a|ar)|elimin(?:a|ar)|sustituy(?:e|ir)|cambia(?:r)?|p[áa]sate)\b[^.!?]{0,40}\b(?:serie|series|ejercicio|ejercicios|d[íi]a|d[íi]as|rutina|programa|split)\b|\b(?:baja|sube|cambia|pon)\w*\s+(?:el\s+)?RIR\b/i;

/**
 * VALORACIÓN CLÍNICA DEL CUERPO. Por presencia y sin excepción, igual que las
 * sustancias: el coste de un falso positivo aquí es cero. La app mide peso y
 * cintura para seguir un progreso, no para valorar salud.
 */
const BODY_CLINICAL = palabra(
  "obesidad|obeso|sobrepeso|infrapeso|delgadez|IMC|[íi]ndice\\s+de\\s+masa\\s+corporal|riesgo\\s+(?:cardiovascular|metab[óo]lico|para\\s+la\\s+salud)|rango\\s+(?:saludable|normal|[óo]ptimo)|nivel\\s+saludable|porcentaje\\s+(?:saludable|ideal)|peso\\s+ideal",
);

/**
 * AFIRMAR un cambio de tejido a partir del peso.
 *
 * Ya NO va por presencia (fallo F6): "No se puede saber si estás ganando
 * músculo o grasa" es la respuesta correcta a la pregunta más previsible de
 * una fase de volumen, y se descartaba. Se bloquea la AFIRMACIÓN del hecho
 * —en positivo o en negativo, porque la app tampoco puede negarlo— y se deja
 * pasar el rechazo epistémico y la hipótesis.
 */
const BODY_COMPOSITION_CLAIM =
  /\b(?:est[áa]s|vas|has|llevas|est[áa]bas|te\s+est[áa]s)\b[^.!?]{0,30}\b(?:perdiendo|perdido|ganando|ganado|conservando|preservando)\b[^.!?]{0,30}\b(?:m[úu]sculo|masa\s+muscular|masa\s+magra|grasa|masa\s+grasa|tejido)\b/i;

/**
 * PRESCRIPCIÓN NUTRICIONAL. La app no registra ingesta, así que cualquier
 * instrucción sobre comida sería una recomendación personal sin datos.
 *
 * `grasas` va en PLURAL a propósito: en singular, "grasa" es casi siempre la
 * corporal, y "añade lecturas de grasa con el mismo método" —una sugerencia de
 * REGISTRO, no de dieta— se bloqueaba como si fuera una prescripción.
 */
const NUTRITION_PRESCRIPTION = new RegExp(
  [
    "\\b(?:sub(?:e|es|ir)|baj(?:a|as|ar)|aument(?:a|as|ar)|reduc(?:e|es|ir)|recort(?:a|as|ar)|a[ñn]ad(?:e|ir)|quit(?:a|ar))\\b[^.,;:!?\\n]{0,40}\\b(?:calor[íi]as?|kcal|prote[íi]nas?|carbohidratos?|hidratos|grasas|d[ée]ficit|super[áa]vit|ingesta)\\b",
    "\\bcom(?:e|er)\\s+(?:m[áa]s|menos)\\b",
  ].join("|"),
  "i",
);

/** Sinónimos por métrica ausente, para que el aviso no dependa de una palabra. */
const MISSING_TERMS: Record<string, string[]> = {
  "peso corporal actual": ["peso corporal", "báscula", "bascula"],
  "calorías diarias": ["calorías", "calorias", "kcal", "superávit", "déficit"],
  "proteína diaria": ["proteína", "proteina"],
  "horas de sueño": ["sueño", "sueno", "dormir"],
  "pasos / actividad diaria": ["pasos"],
  "medidas corporales": ["cintura", "perímetro", "perimetro"],
};

/** Qué polaridad bloquea cada regla. Es el corazón del arreglo B6.1. */
const BLOQUEA: Record<string, readonly Polarity[]> = {
  // Una prescripción negada es una cautela legítima ("no recortes más las
  // calorías"); una insinuada sigue siendo una prescripción.
  nutricion: ["AFFIRMATIVE", "UNCERTAIN"],
  // El tejido no se puede afirmar NI negar: la báscula no lo mide.
  tejido: ["AFFIRMATIVE", "NEGATED"],
  // Contradecir al motor tampoco vale insinuado.
  carga: ["AFFIRMATIVE", "UNCERTAIN"],
  programa: ["AFFIRMATIVE"],
  descarga: ["AFFIRMATIVE"],
};

/** ¿La respuesta propone mover la carga, contando la ambigüedad de `peso`? */
function proponeMoverCarga(
  texto: string,
  inequivoca: RegExp,
  ambigua: RegExp,
): boolean {
  if (matchesWithPolarity(inequivoca, texto, BLOQUEA.carga).hit) return true;
  // Con `kg`/`kilos` hay que mirar de qué se está hablando: el bloque corporal
  // hace que casi todas las frases con kilos sean sobre la báscula.
  const global = new RegExp(ambigua.source, `${ambigua.flags}g`);
  for (const m of texto.matchAll(global)) {
    const i = m.index ?? 0;
    const v = ventanaDeClausula(texto, i, i + m[0].length);
    if (esDominioCorporal(v.antes + v.despues)) continue;
    if (BLOQUEA.carga.includes(polarityAt(texto, i))) return true;
  }
  return false;
}

/** De más grave a menos: gobierna qué motivo se le enseña al usuario. */
const GRAVEDAD: readonly Citation["kind"][] = [
  "TRAINING_LOAD_KG",
  "LOAD_STEP_KG",
  "ESTIMATED_1RM_KG",
  "AMBIGUOUS_KG",
  "INTAKE",
  "BODY_WEIGHT_KG",
  "BODY_CHANGE_KG",
  "BODY_RATE_KG_PER_WEEK",
  "WAIST_CM",
  "COUNT",
  "BODY_FAT_PCT",
  "PERCENT",
];

/** Mensaje de bloqueo por cifra, según lo que la cifra decía ser. */
function motivoCifra(cita: Citation): string {
  switch (cita.kind) {
    case "TRAINING_LOAD_KG":
    case "LOAD_STEP_KG":
    case "ESTIMATED_1RM_KG":
      return `La respuesta citaba cargas que no están en tus datos (${cita.raw} ${cita.unit}).`;
    case "BODY_WEIGHT_KG":
    case "BODY_CHANGE_KG":
    case "BODY_RATE_KG_PER_WEEK":
      return `La respuesta citaba un peso corporal que no está en tus mediciones (${cita.raw} ${cita.unit}).`;
    case "WAIST_CM":
      return `La respuesta citaba una medida de cintura que no está en tus datos (${cita.raw} cm).`;
    case "INTAKE":
      return `La respuesta daba una cifra de comida (${cita.raw} ${cita.unit}), y la app no registra lo que comes.`;
    default:
      return `La respuesta citaba cifras que no están en tus datos (${cita.raw}).`;
  }
}

export function checkResponse(
  response: CoachResponse,
  context: CoachContext,
  /** Mensaje del usuario, para distinguir la cifra que él propuso. */
  userMessage?: string,
): GuardrailResult {
  const text = [
    response.headline,
    response.recommendation,
    response.fatigue ?? "",
    ...response.highlights.map((h) => `${h.label} ${h.detail}`),
    ...response.hypotheses,
  ].join("\n");

  const warnings: string[] = [];

  // ── 1. Sustancias vetadas ───────────────────────────────────────────────
  // Por PRESENCIA, sin excepción: el coste de un falso positivo es cero.
  if (FORBIDDEN.test(text)) {
    return {
      block: true,
      reason:
        "La respuesta mencionaba sustancias que esta app nunca recomienda.",
      warnings,
    };
  }

  // ── 2. Cifras: cada una contra la fuente de SU tipo ────────────────────
  const fuentes = supportedNumbers(context);
  const delUsuario = userNumbers(userMessage);
  // Las cifras se revisan por GRAVEDAD, no por orden de aparición: si una
  // respuesta inventa a la vez una carga y un recuento, el motivo que se le
  // enseña al usuario debe ser la carga.
  for (const cita of [...citations(text, context)].sort(
    (a, b) => GRAVEDAD.indexOf(a.kind) - GRAVEDAD.indexOf(b.kind),
  )) {
    if (isSupported(cita, fuentes)) continue;

    // Una cifra que propuso el USUARIO puede citarse para rechazarla —"no
    // puedo recomendarte bajar 300 kcal"— pero nunca para recomendarla. Sin
    // esto, el coach no podía ni nombrar aquello que se estaba negando a
    // hacer, y las tres tiradas de esa pregunta acababan en el fallback.
    // Un porcentaje es una DESCRIPCIÓN, no una recomendación: citar "tu
    // báscula dice 15 %" no convierte esa cifra en un consejo. Se resuelve
    // antes que la regla de polaridad para que repetir el dato del usuario en
    // una frase descriptiva no tumbe la respuesta entera.
    if (cita.kind === "PERCENT" || cita.kind === "BODY_FAT_PCT") {
      if (!delUsuario.has(cita.value)) {
        warnings.push(
          `Porcentaje no verificable en tus datos: ${cita.raw} ${cita.unit}.`,
        );
      }
      continue;
    }

    if (delUsuario.has(cita.value)) {
      const p = polarityAt(text, cita.index);
      if (p === "REJECTION" || p === "NEGATED" || p === "UNCERTAIN") continue;
      return {
        block: true,
        reason: `La respuesta recomendaba una cifra que propusiste tú (${cita.raw} ${cita.unit}), y la app no tiene datos para respaldarla.`,
        warnings,
      };
    }

    return { block: true, reason: motivoCifra(cita), warnings };
  }

  // ── 3. Contenido que la app no produce nunca ───────────────────────────
  if (DIAGNOSIS.test(text)) {
    return {
      block: true,
      reason:
        "La respuesta ponía un diagnóstico clínico, y esta app no diagnostica.",
      warnings,
    };
  }
  if (BODY_CLINICAL.test(text)) {
    return {
      block: true,
      reason:
        "La respuesta valoraba tu cuerpo en términos clínicos, y esta app sigue tu progreso: no valora tu salud.",
      warnings,
    };
  }
  if (matchesWithPolarity(BODY_COMPOSITION_CLAIM, text, BLOQUEA.tejido).hit) {
    return {
      block: true,
      reason:
        "La respuesta afirmaba un cambio de músculo o de grasa, y eso no se deduce del peso ni de las cargas.",
      warnings,
    };
  }
  if (
    matchesWithPolarity(NUTRITION_PRESCRIPTION, text, BLOQUEA.nutricion).hit
  ) {
    return {
      block: true,
      reason:
        "La respuesta prescribía comida, y la app no registra lo que comes: cualquier cifra sería inventada.",
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
  if (matchesWithPolarity(PROGRAM_MUTATION, text, BLOQUEA.programa).hit) {
    return {
      block: true,
      reason:
        "La respuesta cambiaba el programa (series, ejercicios, días o RIR objetivo), y eso no lo decide el coach.",
      warnings,
    };
  }

  // ── 4. Contradicción con el motor de progresión ────────────────────────
  const actions = new Set(context.exercises.map((e) => e.progression.action));
  if (
    !actions.has("INCREASE_LOAD") &&
    proponeMoverCarga(text, SUBIR_CARGA, SUBIR_KILOS)
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
    proponeMoverCarga(text, BAJAR_CARGA, BAJAR_KILOS)
  ) {
    return {
      block: true,
      reason:
        "La respuesta proponía bajar la carga cuando el motor no lo recomienda en ningún ejercicio.",
      warnings,
    };
  }

  // ── 5. Descarga inventada (o desaconsejada cuando sí toca) ──────────────
  const proposesDeload = matchesWithPolarity(
    DELOAD_PRESCRIPTION,
    text,
    BLOQUEA.descarga,
  ).hit;
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
    (DELOAD_DISCOURAGED.test(text) || DELOAD_DENIAL.test(text))
  ) {
    return {
      block: true,
      reason:
        "La respuesta desaconsejaba una descarga que el motor de fatiga sí recomienda.",
      warnings,
    };
  }

  // ── 6. Métricas que no registramos ─────────────────────────────────────
  for (const missing of context.notAvailable) {
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
