import type { CoachContext } from "@/ai/context";
import { alcance, palabra } from "@/ai/clause";

/**
 * Modelo SEMÁNTICO de las cifras que el coach puede citar.
 *
 * Antes había un único `Set<number>` con "los kilos del contexto". La QA en
 * vivo demostró que eso ya no basta: desde que el bloque corporal viaja, el
 * conjunto contiene el peso corporal (82,4), el peso objetivo (78) y los kilos
 * que faltan (4,4), así que "ponte a 4,4 kg en las elevaciones laterales"
 * quedaba respaldado por una cifra que no tiene nada que ver con una mancuerna.
 *
 * La regla nueva: el guardrail no pregunta "¿aparece 82,4 en algún sitio?",
 * pregunta "¿de qué está hablando esta cifra y hay una fuente de ESE tipo que
 * la respalde?".
 */

export type NumberKind =
  /** Kilos movidos en una serie, o la carga que sugiere el motor. */
  | "TRAINING_LOAD_KG"
  /** El escalón de carga de la prescripción. El prompt MANDA citarlo. */
  | "LOAD_STEP_KG"
  /**
   * e1RM estimado. Son kilos, pero NO son una carga de trabajo: van ~40 % por
   * encima. Con su propio tipo, el coach puede citarlo y sigue sin poder
   * convertirlo en un peso a poner en la barra.
   */
  | "ESTIMATED_1RM_KG"
  /** Peso corporal: último, suavizado u objetivo. */
  | "BODY_WEIGHT_KG"
  /** Cambios de peso corporal y kilos que faltan para el objetivo. */
  | "BODY_CHANGE_KG"
  /** Ritmo de peso, en kg por semana (pendiente, intervalo, objetivo). */
  | "BODY_RATE_KG_PER_WEEK"
  | "WAIST_CM"
  | "BODY_FAT_PCT"
  /** Repeticiones, series, sesiones, días, mediciones. */
  | "COUNT"
  | "PERCENT";

export type SupportedNumbers = Record<NumberKind, Set<number>>;

/** Cómo se ha citado una cifra en la respuesta. */
export type CitationKind =
  | NumberKind
  /** Kilos sin marca de dominio: podrían ser de la barra o de la báscula. */
  | "AMBIGUOUS_KG"
  /** Comida: la app no registra ingesta, así que NADA puede respaldarla. */
  | "INTAKE";

export interface Citation {
  raw: string;
  value: number;
  index: number;
  kind: CitationKind;
  /** Unidad literal, para el mensaje de bloqueo. */
  unit: string;
}

function vacio(): SupportedNumbers {
  return {
    TRAINING_LOAD_KG: new Set(),
    LOAD_STEP_KG: new Set(),
    ESTIMATED_1RM_KG: new Set(),
    BODY_WEIGHT_KG: new Set(),
    BODY_CHANGE_KG: new Set(),
    BODY_RATE_KG_PER_WEEK: new Set(),
    WAIST_CM: new Set(),
    BODY_FAT_PCT: new Set(),
    COUNT: new Set(),
    PERCENT: new Set(),
  };
}

/** Añade un valor y su magnitud: el contexto guarda −2,3 y se dice "2,3 kg". */
function conSigno(destino: Set<number>, v: number | null | undefined): void {
  if (typeof v !== "number" || !Number.isFinite(v)) return;
  destino.add(v);
  destino.add(Math.abs(v));
}

function simple(destino: Set<number>, v: number | null | undefined): void {
  if (typeof v !== "number" || !Number.isFinite(v)) return;
  destino.add(v);
}

/** Todos los números del contexto, sin fechas. Respalda recuentos y %. */
function todosLosNumeros(valor: unknown, salida: Set<number>): void {
  if (typeof valor === "number" && Number.isFinite(valor)) {
    salida.add(valor);
    salida.add(Math.abs(valor));
    return;
  }
  if (typeof valor === "string") {
    // Las fechas fuera ANTES de extraer: "2026-08-21" metía 2026, 8 y 21.
    const sinFechas = valor.replace(/\d{4}-\d{2}-\d{2}/g, " ");
    for (const m of sinFechas.matchAll(/\d+(?:[.,]\d+)?/g)) {
      const n = Number(m[0].replace(",", "."));
      if (Number.isFinite(n)) salida.add(n);
    }
    return;
  }
  if (Array.isArray(valor)) {
    valor.forEach((v) => todosLosNumeros(v, salida));
    return;
  }
  if (valor && typeof valor === "object") {
    Object.values(valor as Record<string, unknown>).forEach((v) =>
      todosLosNumeros(v, salida),
    );
  }
}

/** Las fuentes autorizadas, cada una con su significado. */
export function supportedNumbers(context: CoachContext): SupportedNumbers {
  const s = vacio();

  for (const e of context.exercises) {
    simple(s.TRAINING_LOAD_KG, e.progression.suggestedWeightKg);
    for (const v of e.equivalentLoadTrend ?? []) simple(s.TRAINING_LOAD_KG, v);
    for (const linea of e.recentSets ?? []) {
      for (const m of String(linea).matchAll(/(\d+(?:[.,]\d+)?)\s*[×x]/g)) {
        simple(s.TRAINING_LOAD_KG, Number(m[1].replace(",", ".")));
      }
    }
    // El escalón, explícito y tipado. La regla 1 del prompt ordena citarlo
    // ("el siguiente escalón son 2,5 kg") y no estaba en ninguna fuente: el
    // guardrail bloqueaba la frase que el propio prompt había pedido.
    simple(s.LOAD_STEP_KG, e.loadStepKg);
    simple(s.ESTIMATED_1RM_KG, e.bestRecentE1rm);
  }

  const b = context.body;
  if (b) {
    conSigno(s.BODY_WEIGHT_KG, b.weight.latestKg);
    conSigno(s.BODY_WEIGHT_KG, b.weight.latestEmaKg);
    conSigno(s.BODY_WEIGHT_KG, b.goal?.targetWeightKg ?? null);
    conSigno(s.BODY_CHANGE_KG, b.weight.totalChangeKg);
    conSigno(s.BODY_CHANGE_KG, b.goal?.kgToTargetWeight ?? null);
    conSigno(s.BODY_RATE_KG_PER_WEEK, b.weight.slopeKgPerWeek);
    conSigno(s.BODY_RATE_KG_PER_WEEK, b.weight.ciLowPerWeek);
    conSigno(s.BODY_RATE_KG_PER_WEEK, b.weight.ciHighPerWeek);
    conSigno(s.BODY_RATE_KG_PER_WEEK, b.goal?.targetKgPerWeek ?? null);
    if (b.waist) {
      conSigno(s.WAIST_CM, b.waist.latestCm);
      conSigno(s.WAIST_CM, b.waist.fittedChangeCm);
      conSigno(s.WAIST_CM, b.waist.minDetectableChangeCm);
    }
    if (b.bodyFat) {
      conSigno(s.BODY_FAT_PCT, b.bodyFat.latestPct);
      conSigno(s.BODY_FAT_PCT, b.bodyFat.changePp);
      conSigno(s.BODY_FAT_PCT, b.bodyFat.minInterpretableChangePp);
    }
  }

  // Recuentos y porcentajes conservan la cobertura amplia de antes: no son
  // cifras peligrosas y acotarlas solo generaría falsos positivos.
  todosLosNumeros(context, s.COUNT);
  s.PERCENT = new Set(s.COUNT);
  return s;
}

/** Qué fuentes puede invocar una cifra citada de cada manera. */
const ADMITE: Record<CitationKind, readonly NumberKind[]> = {
  // Una carga solo la respalda una carga (o el escalón, que también son
  // kilos de barra). NUNCA el peso corporal: esa era la colisión.
  TRAINING_LOAD_KG: ["TRAINING_LOAD_KG", "LOAD_STEP_KG"],
  LOAD_STEP_KG: ["LOAD_STEP_KG", "TRAINING_LOAD_KG"],
  ESTIMATED_1RM_KG: ["ESTIMATED_1RM_KG"],
  BODY_WEIGHT_KG: ["BODY_WEIGHT_KG", "BODY_CHANGE_KG"],
  BODY_CHANGE_KG: ["BODY_CHANGE_KG", "BODY_WEIGHT_KG", "BODY_RATE_KG_PER_WEEK"],
  BODY_RATE_KG_PER_WEEK: ["BODY_RATE_KG_PER_WEEK", "BODY_CHANGE_KG"],
  WAIST_CM: ["WAIST_CM"],
  BODY_FAT_PCT: ["BODY_FAT_PCT", "PERCENT"],
  COUNT: ["COUNT"],
  PERCENT: ["PERCENT"],
  // Sin marca de dominio se acepta cualquier kilo: es la cobertura de antes,
  // y sin señal no hay base para ser más estricto.
  AMBIGUOUS_KG: [
    "TRAINING_LOAD_KG",
    "LOAD_STEP_KG",
    "ESTIMATED_1RM_KG",
    "BODY_WEIGHT_KG",
    "BODY_CHANGE_KG",
    "BODY_RATE_KG_PER_WEEK",
  ],
  // La app no registra ingesta: ninguna fuente puede respaldar una kcal.
  INTAKE: [],
};

/** Tolerancia por tipo. Las cargas van al gramo; el resto, al redondeo. */
function tolerancia(kind: CitationKind): number {
  return kind === "TRAINING_LOAD_KG" ||
    kind === "LOAD_STEP_KG" ||
    kind === "ESTIMATED_1RM_KG"
    ? 0.011
    : 0.051;
}

const ANCLA_ENTRENAMIENTO_BASE =
  "carga|cargas|barra|mancuerna|mancuernas|disco|discos|serie|series|repetici[óo]n|repeticiones|press|sentadilla|dominada|remo|curl|jal[óo]n|fondo|fondos|prensa|peso\\s+muerto|hip\\s+thrust|elevaci[óo]n|elevaciones|extensi[óo]n|flexi[óo]n|zancada|face\\s+pull|apertura|aperturas|encogimiento|gemelo|b[íi]ceps|tr[íi]ceps|levantas|levantar";

const ANCLA_CUERPO = palabra(
  [
    "tu\\s+peso",
    "mi\\s+peso",
    "su\\s+peso",
    "el\\s+peso\\s+corporal",
    "peso\\s+corporal",
    "b[áa]scula",
    "pesaje|pesajes",
    "te\\s+quedan|te\\s+faltan",
    "peso\\s+objetivo|objetivo\\s+de\\s+peso",
    "cambio\\s+total",
    "has\\s+(?:bajado|subido|perdido|ganado)",
    "media\\s+m[óo]vil|EMA",
    "tendencia",
  ].join("|"),
);

const MARCA_RITMO =
  /(?:\/\s*semana|por\s+semana|semanal|a\s+la\s+semana|\/\s*sem\b)/i;

const MARCA_ESCALON = palabra(
  "escal[óo]n|incremento|salto|paso\\s+de\\s+carga|siguiente\\s+escal[óo]n",
);

/** El e1RM se nombra: no hace falta adivinarlo. */
const MARCA_E1RM =
  /\b(?:e1RM|1RM|RM\s+estimad|repetici[óo]n\s+m[áa]xima|m[áa]ximo\s+estimado)/i;

/**
 * Ventana de texto que decide de qué habla una cifra.
 *
 * Está ACOTADA A LA ORACIÓN a propósito. Con una ventana ciega de 60
 * caracteres, «…son 80 kg.\nRendimiento Las cargas equivalentes…» arrastraba
 * la palabra "cargas" de la línea siguiente y clasificaba un peso corporal
 * como carga de entrenamiento.
 */
export function ventanaDeClausula(
  texto: string,
  index: number,
  finMatch = index,
): { antes: string; despues: string; adyacente: string } {
  const resto = texto.slice(finMatch);
  const corte = resto.search(/[.;:!?\n]/);
  return {
    antes: alcance(texto, index),
    despues: (corte === -1 ? resto : resto.slice(0, corte)).slice(0, 60),
    // Pegado al número: para marcas que solo valen si son adyacentes.
    adyacente: resto.slice(0, 14),
  };
}

/** Una cifra con unidad, o una carga desnuda ("ponte a 90"). */
const CIFRAS =
  /(\d+(?:[.,]\d+)?)\s*(kgs?|kilogramos?|kilos?|cm|%|kcal|calor[íi]as|puntos?\s+porcentuales?|pp|repeticiones|reps|series|sesiones|d[íi]as|mediciones|gramos\s+de\s+prote[íi]na|g\s+de\s+prote[íi]na)(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/gi;
/**
 * Carga sin unidad: "sube a 102,5", "ponte a 90".
 *
 * La negación final es imprescindible: sin ella «el peso baja a 0,42 kg por
 * semana» producía DOS citas de la misma cifra —una correcta como ritmo
 * corporal y otra espuria como carga— y la segunda bloqueaba la respuesta.
 * Si el número lleva unidad, ya lo ha recogido `CIFRAS` con su contexto.
 *
 * El `(?![\d.,])` es igual de imprescindible, y más traicionero: sin él el
 * motor de expresiones RETROCEDE y, ante "baja a 65 kg", prueba con "6" —cuya
 * continuación "5 kg" ya no casa con la negación de unidad— y da por citada
 * una carga de 6 kg que nadie escribió.
 */
const CARGA_DESNUDA =
  /\b(?:sub(?:e|es|ir)|p[oó]n(?:te|le)?|s[úu]belo|baja(?:lo)?)\s+(?:a|hasta)\s+(\d+(?:[.,]\d+)?)(?![\d.,])(?!\s*(?:kgs?|kilos?|kilogramos?|cm|%|kcal|calor))/gi;

/**
 * Clasifica una cifra en kilos según lo que dice su cláusula.
 *
 * Aquí vive la desambiguación de `peso`, que en español es a la vez el de la
 * barra y el de la báscula (F1/F8). El orden importa: el ritmo es inequívoco,
 * el entrenamiento manda sobre el cuerpo cuando se nombra un ejercicio, y sin
 * ninguna marca se admite cualquier kilo.
 */
function claseDeKilos(
  v: { antes: string; despues: string; adyacente: string },
  nombresEjercicio: RegExp,
): CitationKind {
  // El ritmo solo cuenta PEGADO al número: «78 kg como peso objetivo», en una
  // frase que antes decía "por semana", no es un ritmo.
  if (MARCA_RITMO.test(v.adyacente)) return "BODY_RATE_KG_PER_WEEK";
  const clausula = v.antes + v.despues;
  if (MARCA_E1RM.test(clausula)) return "ESTIMATED_1RM_KG";
  if (MARCA_ESCALON.test(clausula)) return "LOAD_STEP_KG";
  if (nombresEjercicio.test(clausula)) return "TRAINING_LOAD_KG";
  if (ANCLA_CUERPO.test(clausula)) {
    return /\b(?:bajado|subido|perdido|ganado|cambio|quedan|faltan|menos|m[áa]s)\b/i.test(
      clausula,
    )
      ? "BODY_CHANGE_KG"
      : "BODY_WEIGHT_KG";
  }
  return "AMBIGUOUS_KG";
}

/**
 * ¿La cláusula habla del CUERPO y no de la barra?
 *
 * Lo usa el guardrail de carga: `peso` en español es a la vez el de la báscula
 * y el del disco, y sin esta comprobación "El peso baja a −0,42 kg/semana" se
 * leía como una orden de bajar la carga (F1).
 */
export function esDominioCorporal(clausula: string): boolean {
  return MARCA_RITMO.test(clausula) || ANCLA_CUERPO.test(clausula);
}

/** Expresión con los ejercicios REALES del contexto más los genéricos. */
export function anclaEntrenamiento(context: CoachContext): RegExp {
  const nombres = context.exercises
    .flatMap((e) => [e.exercise, e.variant])
    .filter(Boolean)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return palabra([ANCLA_ENTRENAMIENTO_BASE, ...nombres].join("|"));
}

/** Todas las cifras citadas en la respuesta, ya clasificadas. */
export function citations(texto: string, context: CoachContext): Citation[] {
  const ancla = anclaEntrenamiento(context);
  const out: Citation[] = [];

  for (const m of texto.matchAll(CIFRAS)) {
    const index = m.index ?? 0;
    const unidad = m[2].toLowerCase();
    const v = ventanaDeClausula(texto, index, index + m[0].length);
    const clausula = v.antes + v.despues;
    let kind: CitationKind;
    if (/^(kgs?|kilogramos?|kilos?)$/.test(unidad)) {
      kind = claseDeKilos(v, ancla);
    } else if (unidad === "cm") {
      kind = "WAIST_CM";
    } else if (unidad === "%" || /^(pp|puntos?)/.test(unidad)) {
      kind = /\bgrasa\b/i.test(clausula) ? "BODY_FAT_PCT" : "PERCENT";
    } else if (/^(kcal|calor|gramos|g\s)/.test(unidad)) {
      kind = "INTAKE";
    } else {
      kind = "COUNT";
    }
    out.push({
      raw: m[1],
      value: Number(m[1].replace(",", ".")),
      index,
      kind,
      unit: m[2],
    });
  }

  // "Ponte a 90" sin unidad es una carga: el verbo lo dice. Salvo que la
  // cláusula esté hablando del cuerpo, donde el mismo giro es descriptivo.
  for (const m of texto.matchAll(CARGA_DESNUDA)) {
    const v = ventanaDeClausula(
      texto,
      m.index ?? 0,
      (m.index ?? 0) + m[0].length,
    );
    if (esDominioCorporal(v.antes + v.despues)) continue;
    out.push({
      raw: m[1],
      value: Number(m[1].replace(",", ".")),
      index: m.index ?? 0,
      kind: "TRAINING_LOAD_KG",
      unit: "kg",
    });
  }
  return out;
}

/** ¿Alguna fuente admisible para ese tipo respalda el valor citado? */
export function isSupported(
  cita: Citation,
  fuentes: SupportedNumbers,
): boolean {
  const tol = tolerancia(cita.kind);
  for (const kind of ADMITE[cita.kind]) {
    for (const v of fuentes[kind]) {
      if (Math.abs(v - cita.value) < tol) return true;
      // Un porcentaje puede venir respaldado por su fracción, y al revés.
      if (
        (cita.kind === "PERCENT" || cita.kind === "BODY_FAT_PCT") &&
        Math.abs(v * 100 - cita.value) < 0.051
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Cifras que aparecen en el mensaje del usuario, para poder rechazarlas. */
export function userNumbers(userMessage: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!userMessage) return out;
  for (const m of userMessage.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const n = Number(m[0].replace(",", "."));
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}
