import type {
  BodyReasonCode,
  WaistTrendStatus,
  WeightTrendStatus,
} from "@/core/body";

/**
 * Traducción del vocabulario del motor a lo que lee una persona.
 *
 * Este módulo es la frontera donde se decide QUÉ SE AFIRMA, y por eso está
 * aparte de los componentes y tiene sus propios tests: es más fácil colar aquí
 * una mentira que en el motor.
 *
 * Tres reglas que gobiernan todo lo de abajo:
 *
 *   1. Si el motor dice `INCONCLUSIVE`, la interfaz NO puede insinuar una
 *      dirección. "Todavía no hay una tendencia clara" es la respuesta
 *      completa, no un preámbulo antes de enseñar la flecha igualmente.
 *   2. La confianza es PRECISIÓN ESTADÍSTICA, nunca valoración del progreso.
 *      Por eso no se pinta como "vas bien / vas regular" sino como el margen
 *      de error real, en kg/semana, que es lo que significa.
 *   3. Que el peso suba o baje no es bueno ni malo por sí mismo: depende del
 *      objetivo. Aquí no hay verde ni rojo, ni flechas de aprobación.
 */

/** Frase principal del estado. Es lo que se lee en grande. */
export const WEIGHT_STATUS_TITLE: Record<WeightTrendStatus, string> = {
  INSUFFICIENT_DATA: "Aún faltan mediciones para calcular una tendencia.",
  INCONCLUSIVE: "Todavía no hay una tendencia clara.",
  MAINTAINING: "Tu peso se mantiene aproximadamente estable.",
  LOSING: "Tu peso está bajando.",
  GAINING: "Tu peso está subiendo.",
};

/**
 * ¿Se puede enseñar la pendiente como una cifra afirmada?
 *
 * Solo cuando el motor la respalda. Con `INCONCLUSIVE` la pendiente EXISTE
 * —está calculada y sirve para dibujar la recta— pero el intervalo de
 * confianza incluye el cero, así que enseñarla como "bajas 0,2 kg/semana"
 * sería exactamente la falsa precisión que el motor evita.
 */
export function showsSlope(status: WeightTrendStatus): boolean {
  return (
    status === "LOSING" || status === "GAINING" || status === "MAINTAINING"
  );
}

/**
 * Qué falta para poder decir algo. Se enseña solo cuando no hay tendencia:
 * un estado vacío que no explica cómo salir de él es un callejón.
 */
export const WEIGHT_REASON_HINT: Partial<Record<BodyReasonCode, string>> = {
  NO_MEASUREMENTS: "Anota tu peso para empezar tu historial.",
  TOO_FEW_MEASUREMENTS:
    "Con unos cuantos pesajes más podré calcular tu tendencia.",
  SPAN_TOO_SHORT:
    "Hacen falta al menos dos semanas de registros: el peso oscila cerca de un kilo entre días y hace falta tiempo para separar la señal del ruido.",
  SPARSE_MEASUREMENTS:
    "Tus pesajes están muy repartidos. Registrando con algo más de regularidad podré calcular la tendencia.",
  CONFIDENCE_INTERVAL_INCLUDES_ZERO:
    "El margen de error todavía incluye el cero, así que no puedo distinguir si subes, bajas o te mantienes.",
};

/** Cintura. Igual de conservadora: su error de medida es grande. */
export const WAIST_STATUS_TITLE: Record<WaistTrendStatus, string> = {
  INSUFFICIENT_DATA: "Aún no hay medidas suficientes de cintura.",
  WITHIN_MEASUREMENT_ERROR:
    "El cambio de cintura todavía está dentro del margen de error de la cinta.",
  DECREASING: "Tu cintura está bajando.",
  INCREASING: "Tu cintura está subiendo.",
};

const nf = (digits: number) =>
  new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** Número con coma decimal y signo explícito. `+0,4` · `−0,4`. */
export function formatSigned(value: number, digits = 2): string {
  // El menos tipográfico (−, U+2212) y no el guion: se alinea con las cifras.
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${nf(digits).format(Math.abs(value))}`;
}

export function formatNumber(value: number, digits = 1): string {
  return nf(digits).format(value);
}

/** `29 ago` · `29 ago 2025` si es de otro año que el de referencia. */
export function formatShortDate(
  localDate: string,
  todayLocalDate: string,
): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const mes = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ][m - 1];
  const mismoAño = todayLocalDate.slice(0, 4) === String(y);
  return mismoAño ? `${d} ${mes}` : `${d} ${mes} ${y}`;
}

/**
 * El intervalo de confianza en palabras. Es la forma honesta de enseñar la
 * "confianza": el margen real, no una etiqueta de tres niveles que se lee como
 * una nota del examen.
 */
export function formatConfidenceInterval(
  low: number,
  high: number,
  unit: string,
): string {
  return `entre ${formatSigned(low)} y ${formatSigned(high)} ${unit}`;
}

/** Ventana en palabras: "últimos 28 días". */
export function formatWindow(days: number): string {
  return `últimos ${days} días`;
}

/**
 * Por debajo de esta distancia (kg) se dice "justo en tu objetivo": la cifra
 * se enseña con un decimal y 0,04 kg no es una distancia que exista.
 */
const TARGET_TOLERANCE_KG = 0.05;

export interface TargetWeightStatus {
  /** Lo que se lee como etiqueta del dato. */
  label: string;
  /** El dato, ya con su dirección en palabras. */
  value: string;
  /** El peso de referencia ya está en el objetivo o lo ha pasado. */
  reached: boolean;
}

/**
 * Dónde estás respecto a tu peso objetivo, CON DIRECCIÓN.
 *
 * `kgToTargetWeight` es objetivo − peso de referencia (positivo = hay que
 * subir). Antes se pintaba su valor absoluto bajo "Te quedan", así que al
 * pasar el objetivo en una definición seguía diciendo "te quedan 0,3 kg"
 * cuando en realidad sobraban 0,3 por debajo. Pasar el objetivo no es un
 * error ni una alarma: se dice tal cual y la persona decide.
 *
 * En fases de peso estable (mantenimiento, recomposición) no hay "llegar":
 * solo se dice a qué distancia estás y hacia dónde.
 */
export function targetWeightStatus(
  expectedDirection: "DOWN" | "UP" | "FLAT",
  kgToTargetWeight: number,
): TargetWeightStatus {
  const distance = Math.abs(kgToTargetWeight);
  const kgTxt = `${formatNumber(distance)} kg`;
  const atTarget = distance < TARGET_TOLERANCE_KG;

  if (expectedDirection === "FLAT") {
    return {
      label: "Respecto a tu objetivo",
      value: atTarget
        ? "En tu peso objetivo"
        : `${kgTxt} ${kgToTargetWeight > 0 ? "por debajo" : "por encima"}`,
      reached: false,
    };
  }

  // DOWN: hay que bajar mientras el objetivo quede por debajo (kgTo < 0).
  // UP: hay que subir mientras quede por encima (kgTo > 0).
  const remaining =
    expectedDirection === "DOWN" ? -kgToTargetWeight : kgToTargetWeight;
  if (remaining >= TARGET_TOLERANCE_KG) {
    return {
      label: expectedDirection === "DOWN" ? "Te quedan" : "Te faltan",
      value: kgTxt,
      reached: false,
    };
  }
  return {
    label: "Objetivo alcanzado",
    value: atTarget
      ? "Justo en tu objetivo"
      : `${kgTxt} ${expectedDirection === "DOWN" ? "por debajo" : "por encima"}`,
    reached: true,
  };
}
