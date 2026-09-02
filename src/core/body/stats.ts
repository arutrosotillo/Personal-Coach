import { BODY_CONFIG } from "@/core/config/body-config";

/**
 * Estadística del motor corporal. Funciones puras sobre `number[]`: aquí no hay
 * kilos ni centímetros, solo valores y días.
 *
 * Todo lo de este archivo es aritmética estándar de mínimos cuadrados. Lo único
 * opinable es de dónde salen los umbrales, y eso vive en `body-config.ts`.
 */

export interface Observation {
  /** Días transcurridos desde un origen arbitrario común. */
  dayOffset: number;
  value: number;
}

export interface RegressionResult {
  /** Pendiente en unidades por DÍA. */
  slopePerDay: number;
  /** Ordenada en el origen (valor ajustado en `dayOffset = 0`). */
  intercept: number;
  /** Semianchura del intervalo de confianza de la pendiente, por día. */
  ciHalfWidthPerDay: number;
  /** Desviación típica de los residuos. */
  residualSd: number;
  n: number;
  spanDays: number;
}

/**
 * Cuantil t de Student al 97,5 % (bilateral 95 %), por grados de libertad.
 *
 * Tabla en vez de una función especial: son diez líneas, son exactas para los
 * tamaños de muestra que esta app ve de verdad, y no meten una dependencia en
 * `core`, que es determinista y no importa nada de fuera. Por encima de 30
 * grados de libertad la diferencia con la normal es menor que la tercera cifra
 * decimal y se usa 1,96.
 */
const T_975: Record<number, number> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.16,
  14: 2.145,
  15: 2.131,
  16: 2.12,
  17: 2.11,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  21: 2.08,
  22: 2.074,
  23: 2.069,
  24: 2.064,
  25: 2.06,
  26: 2.056,
  27: 2.052,
  28: 2.048,
  29: 2.045,
  30: 2.042,
};

export function tCritical975(degreesOfFreedom: number): number {
  if (degreesOfFreedom < 1) return Number.POSITIVE_INFINITY;
  return T_975[degreesOfFreedom] ?? 1.96;
}

/**
 * Mínimos cuadrados de `value` sobre `dayOffset`, con el intervalo de confianza
 * de la pendiente.
 *
 * Se regresa sobre el DÍA DE CALENDARIO, no sobre el índice de la medición: con
 * huecos en la serie, usar el índice comprimiría el tiempo y multiplicaría la
 * pendiente. Es también el motivo de no interpolar los días que faltan — un
 * día sin pesaje no es un dato, y rellenarlo inventa precisión.
 *
 * Devuelve `null` con menos de 3 puntos (harían falta 2 para la recta y 1 más
 * para tener algún grado de libertad con el que estimar el error) o si todas
 * las observaciones caen en el mismo día, donde la pendiente no está definida.
 */
export function linearRegression(
  observations: readonly Observation[],
): RegressionResult | null {
  const n = observations.length;
  if (n < 3) return null;

  const meanX = observations.reduce((a, o) => a + o.dayOffset, 0) / n;
  const meanY = observations.reduce((a, o) => a + o.value, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (const o of observations) {
    const dx = o.dayOffset - meanX;
    sxx += dx * dx;
    sxy += dx * (o.value - meanY);
  }
  // Todos los puntos en el mismo día: no hay recta que ajustar.
  if (sxx === 0) return null;

  const slopePerDay = sxy / sxx;
  const intercept = meanY - slopePerDay * meanX;

  let sse = 0;
  for (const o of observations) {
    const residual = o.value - (intercept + slopePerDay * o.dayOffset);
    sse += residual * residual;
  }
  const df = n - 2;
  const residualVariance = sse / df;
  const residualSd = Math.sqrt(residualVariance);
  const standardError = Math.sqrt(residualVariance / sxx);

  const offsets = observations.map((o) => o.dayOffset);

  return {
    slopePerDay,
    intercept,
    ciHalfWidthPerDay: tCritical975(df) * standardError,
    residualSd,
    n,
    spanDays: Math.max(...offsets) - Math.min(...offsets),
  };
}

export interface EmaPoint {
  value: number;
  ema: number;
  /** Valor efectivamente incorporado a la EMA (winsorizado o no). */
  used: number;
  winsorized: boolean;
  gapDays: number;
}

/**
 * Media móvil exponencial sobre una serie con huecos, con winsorización de
 * atípicos.
 *
 * HUECOS: no se interpola. Se ajusta el peso del dato nuevo en función de
 * cuántos días han pasado, `α_eff = 1 − (1 − α)^n`, que es exactamente el
 * efecto que habrían tenido n actualizaciones consecutivas. Un pesaje después
 * de dos semanas de silencio pesa casi todo; uno del día siguiente pesa α.
 *
 * WINSORIZACIÓN: se compara con la EMA ANTERIOR, no con la resultante, para que
 * la decisión sea causal —cada punto se juzga solo con su pasado— y por tanto
 * independiente del orden en que llegaron los datos a la función. El primer
 * punto siembra la EMA y no se puede winsorizar: no hay nada con lo que
 * compararlo.
 *
 * La entrada NUNCA se modifica: cada punto devuelve su crudo y su usado.
 */
export function exponentialMovingAverage(
  points: readonly { dayOffset: number; value: number }[],
  alpha: number = BODY_CONFIG.emaAlpha,
  clampPct: number = BODY_CONFIG.outlierClampPct,
): EmaPoint[] {
  const out: EmaPoint[] = [];
  let ema: number | null = null;
  let previousOffset = 0;

  for (const point of points) {
    if (ema === null) {
      ema = point.value;
      previousOffset = point.dayOffset;
      out.push({
        value: point.value,
        ema,
        used: point.value,
        winsorized: false,
        gapDays: 0,
      });
      continue;
    }

    // Copia local tipada: sin ella TypeScript no puede inferir el tipo de
    // `used`, porque depende de `ema` y `ema` se reasigna a partir de `used`.
    const previousEma: number = ema;
    const gapDays = Math.max(1, point.dayOffset - previousOffset);
    const effectiveAlpha = 1 - Math.pow(1 - alpha, gapDays);

    const bound = Math.abs(previousEma) * clampPct;
    const upper = previousEma + bound;
    const lower = previousEma - bound;
    const winsorized = point.value > upper || point.value < lower;
    const used = winsorized
      ? Math.min(Math.max(point.value, lower), upper)
      : point.value;

    ema = previousEma + effectiveAlpha * (used - previousEma);
    previousOffset = point.dayOffset;
    out.push({ value: point.value, ema, used, winsorized, gapDays });
  }

  return out;
}
