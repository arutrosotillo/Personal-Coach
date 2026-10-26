import { BODY_CONFIG, type BodyConfig } from "@/core/config/body-config";
import { addDays, diffDays } from "@/core/dates";

import {
  autocorrelationInflation,
  linearRegression,
  tCritical975,
  type Observation,
} from "@/core/body/stats";
import type { BodyConfidence, SmoothedPoint } from "@/core/body/types";

/**
 * Tendencia del peso sobre MEDIAS SEMANALES, para los motores que DECIDEN con
 * ella durante meses (ajuste adaptativo y estimación del mantenimiento). El
 * análisis de `/progress` sigue con su regresión diaria: describe, no actúa.
 *
 * POR QUÉ SEMANAL. El peso tiene un ritmo semanal (más alto tras el fin de
 * semana: Orsama 2014, doi:10.1159/000356147). En una regresión diaria, una
 * ventana que acaba en lunes tiene en su extremo —donde más pesa cada punto—
 * un pico de agua, y la lectura de "confirmación" de hace 7 o 14 días acaba
 * también en lunes: hereda el mismo sesgo y confirma un ruido. Con una media
 * por semana cada bloque lleva su lunes dentro y el ritmo semanal se anula.
 *
 * Y EL MARGEN, HONESTO. Se toma el más ancho de tres estimaciones:
 *   · la de mínimos cuadrados sobre las medias, corregida por la
 *     autocorrelación que quede entre semanas (lo que comes cada día se
 *     acumula en el tejido como un paseo aleatorio);
 *   · un jackknife quitando semanas de una en una, que no supone ningún modelo
 *     del ruido;
 *   · un suelo físico: una media semanal nunca es más precisa que
 *     `weeklyMeanResidualSdFloorKg` (con pocas semanas la varianza estimada
 *     puede salir casi nula por azar).
 * Con pocas semanas los grados de libertad son pocos y el margen sale ancho:
 * con 4 semanas el multiplicador t es 4,3. Es lo que hay; no se maquilla.
 */

export interface WeeklyTrend {
  slopePerWeek: number;
  ciLowPerWeek: number;
  ciHighPerWeek: number;
  ciHalfWidthPerWeek: number;
  /** Semanas con al menos un pesaje dentro de la ventana. */
  weeks: number;
  /** Pesajes usados. */
  n: number;
  confidence: BodyConfidence;
}

/** Semianchura por jackknife quitando un punto (aquí, una semana) cada vez. */
function jackknifeHalfWidth(points: readonly Observation[]): number | null {
  if (points.length < 4) return null;
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const r = linearRegression(points.filter((_, j) => j !== i));
    if (r) slopes.push(r.slopePerDay);
  }
  const b = slopes.length;
  if (b < 4) return null;
  const mean = slopes.reduce((a, s) => a + s, 0) / b;
  const variance =
    ((b - 1) / b) * slopes.reduce((a, s) => a + (s - mean) ** 2, 0);
  return tCritical975(b - 1) * Math.sqrt(variance);
}

export function weeklyMeanTrend(
  series: readonly SmoothedPoint[],
  onLocalDate: string,
  windowDays: number,
  config: BodyConfig = BODY_CONFIG,
): WeeklyTrend | null {
  const from = addDays(onLocalDate, -(windowDays - 1));
  const inWindow = series.filter(
    (p) =>
      diffDays(from, p.localDate) >= 0 &&
      diffDays(p.localDate, onLocalDate) >= 0,
  );
  // Semanas contadas hacia atrás desde el corte: la 0 son los últimos 7 días.
  const byWeek = new Map<number, { offsets: number[]; values: number[] }>();
  for (const p of inWindow) {
    const ago = diffDays(p.localDate, onLocalDate);
    const key = Math.floor(ago / 7);
    const bucket = byWeek.get(key) ?? { offsets: [], values: [] };
    bucket.offsets.push(-ago);
    bucket.values.push(p.usedKg);
    byWeek.set(key, bucket);
  }
  const weekly: Observation[] = [...byWeek.values()].map((b) => ({
    dayOffset: b.offsets.reduce((a, v) => a + v, 0) / b.offsets.length,
    value: b.values.reduce((a, v) => a + v, 0) / b.values.length,
  }));
  if (weekly.length < 3) return null;
  const regression = linearRegression(weekly);
  if (regression === null) return null;

  const { factor } = autocorrelationInflation(weekly, regression);
  const jackknife = jackknifeHalfWidth(weekly);
  // Suelo físico: ninguna media semanal es más precisa que
  // `weeklyMeanResidualSdFloorKg`, por mucho que cuatro puntos se alineen.
  const meanX = weekly.reduce((a, o) => a + o.dayOffset, 0) / weekly.length;
  const sxx = weekly.reduce((a, o) => a + (o.dayOffset - meanX) ** 2, 0);
  const floorHalfWidth =
    tCritical975(weekly.length - 2) *
    (config.weeklyMeanResidualSdFloorKg / Math.sqrt(sxx));
  const halfWidth =
    Math.max(
      regression.ciHalfWidthPerDay * factor,
      jackknife ?? 0,
      floorHalfWidth,
    ) * 7;
  const slope = regression.slopePerDay * 7;
  const cuts = config.confidenceCiHalfWidthKgPerWeek;
  return {
    slopePerWeek: slope,
    ciLowPerWeek: slope - halfWidth,
    ciHighPerWeek: slope + halfWidth,
    ciHalfWidthPerWeek: halfWidth,
    weeks: weekly.length,
    n: inWindow.length,
    confidence:
      halfWidth <= cuts.high
        ? "HIGH"
        : halfWidth <= cuts.medium
          ? "MEDIUM"
          : "LOW",
  };
}
