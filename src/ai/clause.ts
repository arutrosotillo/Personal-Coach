/**
 * Análisis de CLÁUSULA para los guardrails.
 *
 * Sustituye a la heurística anterior —"¿hay una negación en los 12 caracteres
 * previos?"—, que fallaba en las dos direcciones y por la misma razón: el
 * español no pone la negación a una distancia fija del verbo. "No puedo
 * recomendar aumentar la ingesta" se bloqueaba (18 caracteres) mientras que
 * "Sin miedo, sube la carga" se dejaba pasar.
 *
 * Aquí no hay NLP general y no hace falta: hay cuatro polaridades explícitas,
 * cada regla declara cuáles tolera, y todas están cubiertas por tests.
 */

/** Frontera de palabra que respeta acentos y ñ. El `\b` de JS no lo hace: */
/** para él "quizá" acaba en un carácter que no es de palabra. */
const IZQ = "(?<![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_])";
const DER = "(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_])";

/** Construye una expresión con fronteras de palabra correctas en español. */
export function palabra(fuente: string, banderas = "i"): RegExp {
  return new RegExp(`${IZQ}(?:${fuente})${DER}`, banderas);
}

export type Polarity =
  /** "Sube la carga hoy." Se afirma o se manda. */
  | "AFFIRMATIVE"
  /** "No subas la carga." / "No estás perdiendo músculo." Se niega el hecho. */
  | "NEGATED"
  /** "No puedo recomendarlo." / "No se puede saber." Se rechaza poder decirlo. */
  | "REJECTION"
  /** "Podría ser." / "Es compatible con." Se presenta como posibilidad. */
  | "UNCERTAIN"
  /** "Para subir carga, cierra el rango." Describe una condición, no una orden. */
  | "CONDITIONAL";

/**
 * RECHAZO: el coach dice que NO PUEDE o que NO PROCEDE, no que algo sea falso.
 *
 * Es la polaridad que más importaba y la que no existía: casi todas las
 * respuestas correctas de la QA en vivo empezaban por una de estas fórmulas y
 * acababan descartadas.
 */
const RECHAZO = palabra(
  [
    "no\\s+(?:te\\s+|le\\s+|me\\s+|lo\\s+)?(?:puedo|puedes|puede|podemos|pueden|podr[íi]a|podr[íi]amos|debo|debemos|voy\\s+a|vamos\\s+a)",
    "no\\s+se\\s+(?:puede|pueden|debe|deben|sabe)",
    "no\\s+(?:es|ser[íi]a)\\s+posible",
    "no\\s+hay\\s+(?:forma|manera|datos|base|informaci[óo]n)",
    // "no hay señal que respalde", "no hay razón que justifique": una
    // construcción de rechazo explícita, no una negación a distancia.
    // Sin espacio final: `palabra()` cierra con una frontera de palabra y un
    // espacio al final la haría fallar siempre.
    "no\\s+hay\\s+[^.,;:!?\\n]{0,40}?\\sque",
    "no\\s+(?:corresponde|procede|toca|conviene|cabe|hace\\s+falta|necesitas|necesita)",
    "no\\s+(?:recomiendo|recomienda|recomiendan|aconsejo|aconseja|sugiero|sugiere|prescribo|prescribe|prescribir[ée]|indico|indica)",
    "no\\s+(?:permite|permiten|basta|bastan|alcanza|demuestra|demuestran|confirma|confirman)",
    "tampoco\\s+(?:puedo|se\\s+puede|corresponde|recomiendo|recomienda)",
    "sin\\s+(?:datos|informaci[óo]n)\\s+(?:para|que|suficientes?)",
    "imposible\\s+(?:saber|afirmar|confirmar|determinar)",
  ].join("|"),
);

/** INCERTIDUMBRE: se presenta como posibilidad, no como hecho. */
const INCERTIDUMBRE = palabra(
  [
    "podr[íi]a(?:n|s)?",
    "puede\\s+(?:que|ser)",
    "quiz[áa]s?",
    "tal\\s+vez",
    "posible(?:mente)?",
    "hip[óo]tesis",
    "(?:es|ser[íi]a|resulta)\\s+(?:compatible|consistente|coherente)",
    "compatible\\s+con",
    "coincide\\s+con",
    "cabr[íi]a",
    "parece",
  ].join("|"),
);

/** Negadores simples. La polaridad depende de a qué distancia EN PALABRAS van. */
const NEGADOR = palabra("no|ni|sin|nunca|jam[áa]s|tampoco|evita|evites");

/**
 * Adverbios que convierten un giro condicional en una orden PARA HOY.
 *
 * Se evalúan DESPUÉS del rechazo y de la negación, no antes: ese era el fallo
 * F5. "El motor no recomienda descargar ni subir carga ahora" es un rechazo
 * con un adverbio dentro, no una prescripción.
 */
const AHORA = palabra(
  "hoy|ya|ahora|esta\\s+semana|esta\\s+sesi[óo]n|la\\s+pr[óo]xima\\s+(?:vez|sesi[óo]n)|siguiente\\s+sesi[óo]n|mismo",
);

/** Aperturas condicionales: describen un requisito, no mandan nada. */
const CONDICIONAL = palabra(
  "para|cuando|cu[áa]ndo|si|hasta|en\\s+cuanto|una\\s+vez|antes\\s+de|requisito|condici[óo]n|mientras",
);

/** Puntuación que cierra una idea. Lo de antes ya no gobierna lo de después. */
const FUERTE = /[.;:!?\n]/;

/**
 * Trozo de frase que gobierna la polaridad de una coincidencia: desde la
 * última puntuación fuerte O la última coma, la que esté más cerca.
 *
 * La coma cuenta porque en español abre cláusula nueva con frecuencia: sin
 * ella, "No creo que haga falta, sube la carga hoy" se leería como negada.
 */
export function alcance(texto: string, indice: number): string {
  const previo = texto.slice(0, indice);
  let corte = -1;
  for (let i = previo.length - 1; i >= 0; i--) {
    const c = previo[i];
    if (FUERTE.test(c) || c === ",") {
      corte = i;
      break;
    }
  }
  return previo.slice(corte + 1);
}

/**
 * La CLÁUSULA completa (entre comas) en la que cae `indice`.
 *
 * Es el alcance correcto para los adverbios de "ahora": en «…añade datos de
 * ingesta y actividad; ahora mismo no están registrados», el adverbio vive en
 * otra cláusula y no convierte la anterior en una orden para hoy.
 */
export function clausulaCompleta(texto: string, indice: number): string {
  const resto = texto.slice(indice);
  const corte = resto.search(/[,.;:!?\n]/);
  return (
    alcance(texto, indice) + (corte === -1 ? resto : resto.slice(0, corte))
  );
}

/**
 * La parte de la ORACIÓN que precede a `indice`.
 *
 * Es el alcance de la apertura condicional: tiene que ir DELANTE del verbo
 * para gobernarlo. Mirando la oración entera, "Come más para sostener el
 * entrenamiento" quedaba exento por un "para" que es de finalidad y va detrás.
 */
export function oracionAntes(texto: string, indice: number): string {
  const previo = texto.slice(0, indice);
  let inicio = 0;
  for (let i = previo.length - 1; i >= 0; i--) {
    if (FUERTE.test(previo[i])) {
      inicio = i + 1;
      break;
    }
  }
  return previo.slice(inicio);
}

/** La oración completa en la que cae `indice`, para mirar sus adverbios. */
export function oracion(texto: string, indice: number): string {
  const previo = texto.slice(0, indice);
  let inicio = 0;
  for (let i = previo.length - 1; i >= 0; i--) {
    if (FUERTE.test(previo[i])) {
      inicio = i + 1;
      break;
    }
  }
  const resto = texto.slice(indice);
  const fin = resto.search(FUERTE);
  return texto.slice(inicio, fin === -1 ? texto.length : indice + fin);
}

/** Palabras (no caracteres) entre el final de `previo` y la coincidencia. */
function palabrasHasta(previo: string, desde: number): number {
  return previo
    .slice(desde)
    .split(/[\s,]+/)
    .filter(Boolean).length;
}

/**
 * ¿Un negador simple gobierna la coincidencia?
 *
 * Se mide en PALABRAS, no en caracteres: "No recortes", "No estás perdiendo" y
 * "no recomienda descargar ni subir" están todas dentro de cuatro palabras,
 * mientras que un negador que quedara a media frase de distancia ya pertenece
 * a otra idea.
 */
const MAX_PALABRAS_NEGACION = 4;

function negacionCercana(alcanceTexto: string): boolean {
  const global = new RegExp(NEGADOR.source, "gi");
  let ultima = -1;
  for (const m of alcanceTexto.matchAll(global)) {
    ultima = (m.index ?? 0) + m[0].length;
  }
  if (ultima === -1) return false;
  return palabrasHasta(alcanceTexto, ultima) <= MAX_PALABRAS_NEGACION;
}

/**
 * Polaridad de la cláusula en la que cae `indice`.
 *
 * El ORDEN es la regla, y es lo que arregla F4 y F5: primero se mira si el
 * coach está rechazando algo, luego si lo presenta como posibilidad, luego si
 * lo niega, y solo entonces si un adverbio lo convierte en orden.
 */
export function polarityAt(texto: string, indice: number): Polarity {
  const scope = alcance(texto, indice);
  if (RECHAZO.test(scope)) return "REJECTION";
  if (INCERTIDUMBRE.test(scope)) return "UNCERTAIN";
  if (negacionCercana(scope)) return "NEGATED";
  // El adverbio de inmediatez cuenta en SU cláusula; la apertura condicional,
  // en toda la oración. Con los dos medidos igual, «cuando cierres 12 con
  // reserva, el motor valorará subir carga» se leía como una orden: la coma
  // dejaba el "cuando" fuera del alcance.
  if (AHORA.test(clausulaCompleta(texto, indice))) return "AFFIRMATIVE";
  if (CONDICIONAL.test(oracionAntes(texto, indice))) return "CONDITIONAL";
  return "AFFIRMATIVE";
}

/**
 * ¿Alguna coincidencia de `regex` cae en una polaridad que la regla bloquea?
 *
 * Sustituye a `matchesAffirmative`. Cada regla declara qué tolera en vez de
 * compartir una única definición de "afirmativo": una prescripción nutricional
 * negada es una cautela legítima, pero una afirmación NEGADA sobre el tejido
 * ("no estás perdiendo músculo") sigue siendo una afirmación que la app no
 * puede hacer.
 */
export function matchesWithPolarity(
  regex: RegExp,
  texto: string,
  bloqueaEn: readonly Polarity[],
): { hit: boolean; polarity: Polarity | null; evidence: string | null } {
  const global = new RegExp(
    regex.source,
    regex.flags.includes("g") ? regex.flags : `${regex.flags}g`,
  );
  for (const m of texto.matchAll(global)) {
    const indice = m.index ?? 0;
    const p = polarityAt(texto, indice);
    if (bloqueaEn.includes(p)) {
      return { hit: true, polarity: p, evidence: m[0] };
    }
  }
  return { hit: false, polarity: null, evidence: null };
}
