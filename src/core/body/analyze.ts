import { BODY_CONFIG, type BodyConfig } from "@/core/config/body-config";
import { addDays, diffDays, isLocalDate } from "@/core/dates";
import type { BodyFatReliability, WaistProtocol } from "@/core/enums";

import {
  exponentialMovingAverage,
  linearRegression,
  type Observation,
  type RegressionResult,
} from "@/core/body/stats";
import {
  cm,
  kg,
  pctPoints,
  type BodyAnalysis,
  type BodyAnalysisInput,
  type BodyConfidence,
  type BodyFatAnalysis,
  type BodyMeasurementPoint,
  type Cm,
  type GoalComparison,
  type Kg,
  type LinearTrend,
  type PctPoints,
  type SmoothedPoint,
  type WaistAnalysis,
  type WeightAnalysis,
} from "@/core/body/types";

/**
 * Motor de seguimiento corporal. Función pura `(input, config) → output`:
 * sin Prisma, sin `Date.now()`, sin red. La fecha de corte entra SIEMPRE por
 * parámetro (`todayLocalDate`) y nada posterior a ella se mira.
 *
 * Qué hace y qué NO hace:
 *   · Describe. Calcula tendencias con su incertidumbre y las clasifica.
 *   · NO redacta mensajes, NO toca el objetivo, NO toca la nutrición, NO
 *     modifica las mediciones que recibe.
 *   · Cuando no puede afirmar algo, lo dice. `INCONCLUSIVE` es una respuesta
 *     legítima y frecuente, no un fallo.
 *
 * Ver `docs/NUTRITION_ENGINE.md` §4 para la spec anterior y en qué se aparta
 * esta implementación.
 */

export const BODY_ENGINE_VERSION = "1.0.0";

// ── Normalización de la serie ────────────────────────────────────────────────

interface NormalizedPoint {
  localDate: string;
  dayOffset: number;
  weightKg: number | null;
  waistCm: number | null;
  waistProtocol: WaistProtocol | null;
  bodyFatPct: number | null;
  bodyFatReliability: BodyFatReliability | null;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, v) => a + v, 0) / values.length;
}

/**
 * Ordena, recorta por la fecha de corte y colapsa los días repetidos.
 *
 * DÍAS REPETIDOS: la clave única de la base de datos los impide, pero el motor
 * tiene que ser total y no puede depender de eso. Se colapsan tomando la MEDIA
 * de cada métrica por separado, que es la única regla que da el mismo resultado
 * llegue el input en el orden que llegue —y "el orden de entrada no cambia el
 * resultado" es un invariante que se prueba—. Quedarse "con el último" habría
 * dependido del orden de llegada.
 *
 * PROCEDENCIA del % graso en un día repetido: si las lecturas no coinciden en
 * procedencia se degrada a ESTIMATED. Nunca al revés: una estimación no se
 * asciende a medición fiable por estar al lado de una.
 *
 * FECHAS INVÁLIDAS: se descartan en silencio. El motor no lanza; validar la
 * forma del dato es trabajo del schema Zod de la frontera.
 */
function normalize(
  measurements: readonly BodyMeasurementPoint[],
  todayLocalDate: string,
  analysisStartLocalDate: string | null,
): NormalizedPoint[] {
  const from =
    analysisStartLocalDate !== null && isLocalDate(analysisStartLocalDate)
      ? analysisStartLocalDate
      : null;
  const byDate = new Map<string, BodyMeasurementPoint[]>();
  for (const m of measurements) {
    if (!isLocalDate(m.localDate)) continue;
    // Nada del futuro entra: el corte es el corte.
    if (diffDays(m.localDate, todayLocalDate) < 0) continue;
    // Ni nada anterior al inicio de la fase, si se ha declarado uno.
    if (from !== null && diffDays(from, m.localDate) < 0) continue;
    const bucket = byDate.get(m.localDate);
    if (bucket) bucket.push(m);
    else byDate.set(m.localDate, [m]);
  }

  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) return [];
  const origin = dates[0];

  return dates.map((localDate) => {
    const sameDay = byDate.get(localDate)!;
    const weights = sameDay
      .map((m) => m.weightKg)
      .filter((v): v is Kg => v !== null);
    const waists = sameDay
      .map((m) => m.waistCm)
      .filter((v): v is Cm => v !== null);
    const fats = sameDay
      .map((m) => m.bodyFatPct)
      .filter((v): v is PctPoints => v !== null);

    const reliabilities = new Set(
      sameDay
        .filter((m) => m.bodyFatPct !== null)
        .map((m) => m.bodyFatReliability),
    );
    const bodyFatReliability =
      fats.length === 0
        ? null
        : reliabilities.size === 1
          ? ([...reliabilities][0] ?? null)
          : "ESTIMATED";

    return {
      localDate,
      dayOffset: diffDays(origin, localDate),
      weightKg: weights.length > 0 ? mean(weights) : null,
      waistCm: waists.length > 0 ? mean(waists) : null,
      // Día repetido con protocolos distintos: gana el conservador. Nunca al
      // revés, igual que con la procedencia del % graso.
      waistProtocol:
        waists.length === 0
          ? null
          : sameDay.every(
                (m) =>
                  m.waistCm === null || m.waistProtocol === "MEAN_OF_THREE",
              )
            ? "MEAN_OF_THREE"
            : "SINGLE",
      bodyFatPct: fats.length > 0 ? mean(fats) : null,
      bodyFatReliability,
    };
  });
}

/** Convierte una regresión por día en una tendencia por semana. */
function toWeekly(regression: RegressionResult): LinearTrend {
  const slopePerWeek = regression.slopePerDay * 7;
  const halfWidth = regression.ciHalfWidthPerDay * 7;
  return {
    slopePerWeek,
    ciLowPerWeek: slopePerWeek - halfWidth,
    ciHighPerWeek: slopePerWeek + halfWidth,
    ciHalfWidthPerWeek: halfWidth,
    residualSd: regression.residualSd,
    n: regression.n,
    spanDays: regression.spanDays,
  };
}

// ── Peso ─────────────────────────────────────────────────────────────────────

function weightConfidence(
  halfWidth: number,
  config: BodyConfig,
): BodyConfidence {
  const cuts = config.confidenceCiHalfWidthKgPerWeek;
  if (halfWidth <= cuts.high) return "HIGH";
  if (halfWidth <= cuts.medium) return "MEDIUM";
  return "LOW";
}

const EMPTY_WEIGHT: WeightAnalysis = {
  status: "INSUFFICIENT_DATA",
  reasonCode: "NO_MEASUREMENTS",
  confidence: "LOW",
  windowDays: null,
  trend: null,
  latestKg: null,
  latestLocalDate: null,
  latestEmaKg: null,
  totalChangeKg: null,
  series: [],
  measurementsInWindow: 0,
};

function analyzeWeight(
  points: readonly NormalizedPoint[],
  todayLocalDate: string,
  config: BodyConfig,
): WeightAnalysis {
  const withWeight = points.filter(
    (p): p is NormalizedPoint & { weightKg: number } => p.weightKg !== null,
  );
  if (withWeight.length === 0) return EMPTY_WEIGHT;

  // La EMA se calcula sobre TODO el historial: es la línea del gráfico y no
  // depende de la ventana de decisión. Los valores winsorizados que produce
  // son los que alimentan después la regresión.
  const ema = exponentialMovingAverage(
    withWeight.map((p) => ({ dayOffset: p.dayOffset, value: p.weightKg })),
  );
  const series: SmoothedPoint[] = withWeight.map((p, i) => ({
    localDate: p.localDate,
    rawKg: kg(ema[i].value),
    usedKg: kg(ema[i].used),
    emaKg: kg(ema[i].ema),
    winsorized: ema[i].winsorized,
    gapDays: ema[i].gapDays,
  }));

  const last = series[series.length - 1];
  const base = {
    latestKg: last.rawKg,
    latestLocalDate: last.localDate,
    latestEmaKg: last.emaKg,
    totalChangeKg: last.rawKg - series[0].rawKg,
    series,
  };

  // Elección de ventana: se recorre la escalera EN SU ORDEN DE PREFERENCIA
  // (28 primaria → 21 → 14 → 56 de último recurso) y gana la primera que
  // cumple. Es UNA sola prueba, decidida por los datos disponibles y nunca por
  // el resultado: probar ventanas hasta que una salga significativa sería
  // justo lo que no se puede hacer.
  let chosen: { days: number; observations: Observation[] } | null = null;
  let widest = 0;
  for (const window of config.trendWindows) {
    const from = addDays(todayLocalDate, -(window.days - 1));
    const inWindow = series.filter((p) => diffDays(from, p.localDate) >= 0);
    const span =
      inWindow.length > 0
        ? diffDays(
            inWindow[0].localDate,
            inWindow[inWindow.length - 1].localDate,
          )
        : 0;
    widest = Math.max(widest, inWindow.length);
    if (
      inWindow.length >= window.minMeasurements &&
      span >= window.minSpanDays
    ) {
      chosen = {
        days: window.days,
        // Se regresa sobre el valor USADO (winsorizado), no sobre el crudo:
        // un pesaje disparatado no puede arrastrar la pendiente entera.
        observations: inWindow.map((p) => ({
          dayOffset: diffDays(todayLocalDate, p.localDate),
          value: p.usedKg,
        })),
      };
      break;
    }
  }

  if (!chosen) {
    // El motivo se da sobre la ventana MÁS LARGA, que es donde más datos hay:
    // decir "te faltan pesajes" mirando solo los últimos 14 días sería
    // engañoso para quien lleva meses pesándose una vez por semana.
    const longest = [...config.trendWindows].sort((a, b) => b.days - a.days)[0];
    const from = addDays(todayLocalDate, -(longest.days - 1));
    const inLongest = series.filter((p) => diffDays(from, p.localDate) >= 0);
    const span =
      inLongest.length > 0
        ? diffDays(
            inLongest[0].localDate,
            inLongest[inLongest.length - 1].localDate,
          )
        : 0;
    return {
      ...EMPTY_WEIGHT,
      ...base,
      reasonCode:
        inLongest.length < longest.minMeasurements
          ? "TOO_FEW_MEASUREMENTS"
          : span < longest.minSpanDays
            ? "SPAN_TOO_SHORT"
            : "SPARSE_MEASUREMENTS",
      measurementsInWindow: widest,
    };
  }

  const regression = linearRegression(chosen.observations);
  if (!regression) {
    return {
      ...EMPTY_WEIGHT,
      ...base,
      reasonCode: "TOO_FEW_MEASUREMENTS",
      windowDays: chosen.days,
      measurementsInWindow: chosen.observations.length,
    };
  }

  const trend = toWeekly(regression);
  const flatBand = (config.flatBandPctPerWeek / 100) * last.emaKg;

  // ORDEN DE LOS CASOS, y es deliberado: "prácticamente plano" se comprueba
  // ANTES que la dirección. Un intervalo entero por debajo de cero pero dentro
  // de la banda plana (p. ej. −0,08 a −0,02 kg/sem) es estadísticamente
  // seguro y prácticamente irrelevante; decirle a alguien que está perdiendo
  // peso a 50 gramos por semana sería técnicamente cierto y completamente
  // inútil.
  const withinFlatBand =
    trend.ciLowPerWeek >= -flatBand && trend.ciHighPerWeek <= flatBand;
  const status = withinFlatBand
    ? ("MAINTAINING" as const)
    : trend.ciHighPerWeek < 0
      ? ("LOSING" as const)
      : trend.ciLowPerWeek > 0
        ? ("GAINING" as const)
        : ("INCONCLUSIVE" as const);

  const reasonCode = withinFlatBand
    ? ("CONFIDENCE_INTERVAL_WITHIN_FLAT_BAND" as const)
    : status === "LOSING"
      ? ("CONFIDENCE_INTERVAL_BELOW_ZERO" as const)
      : status === "GAINING"
        ? ("CONFIDENCE_INTERVAL_ABOVE_ZERO" as const)
        : ("CONFIDENCE_INTERVAL_INCLUDES_ZERO" as const);

  return {
    ...base,
    status,
    reasonCode,
    confidence: weightConfidence(trend.ciHalfWidthPerWeek, config),
    windowDays: chosen.days,
    trend,
    measurementsInWindow: regression.n,
  };
}

// ── Cintura ──────────────────────────────────────────────────────────────────

const emptyWaist = (config: BodyConfig): WaistAnalysis => ({
  status: "INSUFFICIENT_DATA",
  reasonCode: "NO_MEASUREMENTS",
  confidence: "LOW",
  trend: null,
  fittedChangeCm: null,
  minDetectableChangeCm: config.waistMinDetectableChangeCm,
  protocol: null,
  latestCm: null,
  latestLocalDate: null,
  measurementsUsed: 0,
});

/**
 * Umbral de detección que le corresponde a un conjunto de medidas.
 *
 * Manda el PEOR protocolo presente: una serie no puede ser más precisa que su
 * medida más burda, y comparar el primer valor —de una sola toma, del
 * onboarding— con el último —media de tres— arrastra el error del primero.
 * `null` cuenta como `SINGLE`: no saber cómo se midió no es lo mismo que
 * haberlo hecho bien.
 */
function waistThreshold(
  protocols: ReadonlyArray<WaistProtocol | null>,
  config: BodyConfig,
): { cm: number; protocol: WaistProtocol | "MIXED" | null } {
  if (protocols.length === 0) {
    return { cm: config.waistMinDetectableChangeCm, protocol: null };
  }
  const conUna = protocols.some((p) => p !== "MEAN_OF_THREE");
  const conTres = protocols.some((p) => p === "MEAN_OF_THREE");
  if (conUna && conTres) {
    return { cm: config.waistMinDetectableChangeCm, protocol: "MIXED" };
  }
  if (conTres) {
    return {
      cm: config.waistMinDetectableChangeCmMeanOfThree,
      protocol: "MEAN_OF_THREE",
    };
  }
  return { cm: config.waistMinDetectableChangeCm, protocol: "SINGLE" };
}

/**
 * Cintura. Deliberadamente más conservadora que el peso: el error de una
 * automedición doméstica es tan grande que un cambio de uno o dos centímetros
 * es indistinguible del ruido, y afirmarlo sería peor que callarse.
 *
 * El cambio se mide con el AJUSTE (pendiente × span), no restando el primer
 * valor del último: la resta de extremos depende de solo dos mediciones, que
 * son justo las que llevan todo el error de medida.
 */
function analyzeWaist(
  points: readonly NormalizedPoint[],
  todayLocalDate: string,
  config: BodyConfig,
): WaistAnalysis {
  const from = addDays(todayLocalDate, -(config.waistLookbackDays - 1));
  const withWaist = points.filter(
    (p): p is NormalizedPoint & { waistCm: number } =>
      p.waistCm !== null && diffDays(from, p.localDate) >= 0,
  );
  if (withWaist.length === 0) return emptyWaist(config);

  const last = withWaist[withWaist.length - 1];
  const umbral = waistThreshold(
    withWaist.map((p) => p.waistProtocol),
    config,
  );
  const base = {
    latestCm: cm(last.waistCm),
    latestLocalDate: last.localDate,
    measurementsUsed: withWaist.length,
    minDetectableChangeCm: umbral.cm,
    protocol: umbral.protocol,
  };
  const span = diffDays(withWaist[0].localDate, last.localDate);

  if (withWaist.length < config.waistMinMeasurements) {
    return {
      ...emptyWaist(config),
      ...base,
      reasonCode: "TOO_FEW_MEASUREMENTS",
    };
  }
  if (span < config.waistMinSpanDays) {
    return { ...emptyWaist(config), ...base, reasonCode: "SPAN_TOO_SHORT" };
  }

  const regression = linearRegression(
    withWaist.map((p) => ({ dayOffset: p.dayOffset, value: p.waistCm })),
  );
  if (!regression) {
    return {
      ...emptyWaist(config),
      ...base,
      reasonCode: "TOO_FEW_MEASUREMENTS",
    };
  }

  const trend = toWeekly(regression);
  const fittedChangeCm = regression.slopePerDay * regression.spanDays;
  const threshold = umbral.cm;
  const magnitude = Math.abs(fittedChangeCm);

  if (magnitude < threshold) {
    return {
      ...emptyWaist(config),
      ...base,
      status: "WITHIN_MEASUREMENT_ERROR",
      reasonCode: "CHANGE_BELOW_MEASUREMENT_ERROR",
      trend,
      fittedChangeCm,
    };
  }

  return {
    ...base,
    status: fittedChangeCm < 0 ? "DECREASING" : "INCREASING",
    reasonCode: "CHANGE_ABOVE_MEASUREMENT_ERROR",
    confidence: magnitude >= threshold * 1.5 ? "MEDIUM" : "LOW",
    trend,
    fittedChangeCm,
  };
}

// ── % graso ──────────────────────────────────────────────────────────────────

const emptyBodyFat = (config: BodyConfig): BodyFatAnalysis => ({
  status: "NOT_RECORDED",
  reasonCode: null,
  confidence: "LOW",
  changePp: null,
  minInterpretableChangePp: config.bodyFatMinChangePp,
  latestPct: null,
  latestReliability: null,
  latestLocalDate: null,
  comparedReliability: null,
  excludedByReliability: 0,
  spanDays: null,
  measurementsUsed: 0,
});

/**
 * % graso. Métrica SECUNDARIA, y el motor lo trata como tal a propósito.
 *
 * Solo se comparan lecturas de la MISMA procedencia. Una báscula de
 * bioimpedancia doméstica tiene un error de 3,1–7,5 puntos frente a un modelo
 * de 4 compartimentos, pero el error del CAMBIO entre dos lecturas del mismo
 * aparato baja a 1,7–2,6 porque el sesgo constante se cancela. Mezclar una
 * lectura de báscula con una de DEXA destruye esa cancelación: la diferencia
 * mediría el cambio de aparato, no el de la persona.
 *
 * Por eso se toma la procedencia de la ÚLTIMA lectura y se descarta todo lo
 * demás. Nunca se devuelve confianza alta: sigue siendo una estimación.
 */
function analyzeBodyFat(
  points: readonly NormalizedPoint[],
  todayLocalDate: string,
  config: BodyConfig,
): BodyFatAnalysis {
  const from = addDays(todayLocalDate, -(config.bodyFatLookbackDays - 1));
  const withFat = points.filter(
    (
      p,
    ): p is NormalizedPoint & {
      bodyFatPct: number;
      bodyFatReliability: BodyFatReliability;
    } =>
      p.bodyFatPct !== null &&
      p.bodyFatReliability !== null &&
      diffDays(from, p.localDate) >= 0,
  );
  if (withFat.length === 0) return emptyBodyFat(config);

  const last = withFat[withFat.length - 1];
  const reliability = last.bodyFatReliability;
  const comparable = withFat.filter(
    (p) => p.bodyFatReliability === reliability,
  );
  const excluded = withFat.length - comparable.length;

  const base = {
    latestPct: pctPoints(last.bodyFatPct),
    latestReliability: reliability,
    latestLocalDate: last.localDate,
    comparedReliability: reliability,
    excludedByReliability: excluded,
    measurementsUsed: comparable.length,
  };

  if (comparable.length < config.bodyFatMinMeasurements) {
    return {
      ...emptyBodyFat(config),
      ...base,
      // Si lo que impide comparar es que la procedencia cambió, hay que
      // decirlo: no es "faltan datos", es "estas lecturas no son comparables".
      status: excluded > 0 ? "MIXED_RELIABILITY" : "INSUFFICIENT_DATA",
      reasonCode:
        excluded > 0 ? "BODY_FAT_RELIABILITY_CHANGED" : "TOO_FEW_MEASUREMENTS",
      spanDays: null,
    };
  }

  const first = comparable[0];
  const spanDays = diffDays(first.localDate, last.localDate);
  if (spanDays < config.bodyFatMinSpanDays) {
    return {
      ...emptyBodyFat(config),
      ...base,
      status: "INSUFFICIENT_DATA",
      reasonCode: "SPAN_TOO_SHORT",
      spanDays,
    };
  }

  const changePp = last.bodyFatPct - first.bodyFatPct;
  if (Math.abs(changePp) < config.bodyFatMinChangePp) {
    return {
      ...emptyBodyFat(config),
      ...base,
      status: "NOT_INTERPRETABLE",
      reasonCode: "BODY_FAT_CHANGE_BELOW_ERROR",
      changePp,
      spanDays,
    };
  }

  return {
    ...emptyBodyFat(config),
    ...base,
    status: changePp < 0 ? "DECREASING" : "INCREASING",
    reasonCode: "CHANGE_ABOVE_MEASUREMENT_ERROR",
    // Nunca HIGH: incluso un DEXA es una estimación, no una medida directa.
    confidence: reliability === "MEASURED" ? "MEDIUM" : "LOW",
    changePp,
    spanDays,
  };
}

// ── Objetivo ─────────────────────────────────────────────────────────────────

/**
 * Compara la tendencia con el objetivo. SOLO números y direcciones: qué
 * significa "vas lento" es una decisión de producto que vive en B5, no aquí.
 *
 * `observedKgPerWeek` se rellena únicamente cuando la tendencia es AFIRMABLE.
 * Con `INCONCLUSIVE` o `INSUFFICIENT_DATA` va a `null` aunque la pendiente esté
 * calculada, para que nadie construya un "vas al 60 % de tu objetivo" sobre un
 * número que el motor acaba de declarar indistinguible de cero. La pendiente
 * cruda sigue disponible en `weight.trend` para dibujar.
 */
function compareWithGoal(
  goal: BodyAnalysisInput["goal"],
  weight: WeightAnalysis,
): GoalComparison | null {
  if (!goal) return null;

  const referenceWeightKg = weight.latestEmaKg ?? weight.latestKg;
  const targetKgPerWeek =
    referenceWeightKg === null
      ? null
      : (goal.weeklyRatePct / 100) * referenceWeightKg;

  // La dirección sale del ritmo configurado, no del `type`: el ritmo es lo que
  // el usuario eligió de verdad y lo que el motor de nutrición aplicó.
  const expectedDirection =
    goal.weeklyRatePct < 0 ? "DOWN" : goal.weeklyRatePct > 0 ? "UP" : "FLAT";

  const affirmable =
    weight.status === "LOSING" ||
    weight.status === "GAINING" ||
    weight.status === "MAINTAINING";
  const observedKgPerWeek =
    affirmable && weight.trend ? weight.trend.slopePerWeek : null;

  return {
    goalType: goal.type,
    strategy: goal.strategy,
    targetPctPerWeek: goal.weeklyRatePct,
    targetKgPerWeek,
    referenceWeightKg,
    expectedDirection,
    observedKgPerWeek,
    ratio:
      observedKgPerWeek !== null &&
      targetKgPerWeek !== null &&
      targetKgPerWeek !== 0
        ? observedKgPerWeek / targetKgPerWeek
        : null,
    targetWeightKg: goal.targetWeightKg,
    kgToTargetWeight:
      goal.targetWeightKg !== null && referenceWeightKg !== null
        ? goal.targetWeightKg - referenceWeightKg
        : null,
  };
}

// ── Entrada pública ──────────────────────────────────────────────────────────

export function analyzeBody(
  input: BodyAnalysisInput,
  config: BodyConfig = BODY_CONFIG,
): BodyAnalysis {
  const start = input.analysisStartLocalDate ?? null;
  const points = normalize(input.measurements, input.todayLocalDate, start);
  const weight = analyzeWeight(points, input.todayLocalDate, config);

  return {
    todayLocalDate: input.todayLocalDate,
    analysisStartLocalDate: start,
    engineVersion: BODY_ENGINE_VERSION,
    weight,
    waist: analyzeWaist(points, input.todayLocalDate, config),
    bodyFat: analyzeBodyFat(points, input.todayLocalDate, config),
    goal: compareWithGoal(input.goal, weight),
  };
}
