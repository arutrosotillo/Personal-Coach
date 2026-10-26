import { analyzeBody, tCritical975, weeklyMeanTrend } from "@/core/body";
import type { BodyConfidence, BodyMeasurementPoint } from "@/core/body";
import { BODY_CONFIG, type BodyConfig } from "@/core/config/body-config";
import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import { addDays, diffDays } from "@/core/dates";
import { roundKcal } from "@/core/nutrition/macros";

/**
 * Mantenimiento calórico REAL estimado por balance energético
 * (docs/CYCLES.md §3). Función pura `(input, config) → estimación`.
 *
 * LA IDEA, en una línea: si durante 8 semanas comiste de media 2.150 kcal y tu
 * peso bajó 0,40 kg/semana, tu gasto era unas 2.150 + 0,40 × 7.700 / 7 ≈
 * 2.590 kcal. Eso es un dato TUYO, no una fórmula de población.
 *
 * TRES FUENTES, combinadas por precisión (cada una pesa 1/error²):
 *   · OBSERVADA — la de arriba, con los datos del régimen actual.
 *   · CICLO ANTERIOR — la estimación congelada al cerrar el ciclo previo,
 *     escalada al peso de hoy y con más error cuanto más antigua.
 *   · FÓRMULA — el modelo aditivo del onboarding con tus datos de hoy.
 * Con pocos datos manda la fórmula; con semanas de báscula manda lo
 * observado. Así "aprende": nada se sobrescribe, cada fuente dice cuánto sabe.
 *
 * LO QUE NO HACE, y lo dice:
 *   · No confunde lo prescrito con lo comido. Si hay registro suficiente usa
 *     el registro; si no, asume el objetivo y lo declara con más error.
 *   · No usa días de agua y glucógeno: el régimen empieza después de la
 *     estabilización (lo decide quien llama con `regimeStartLocalDate`).
 *   · No mezcla ciclos: la parte observada solo ve el régimen actual; lo
 *     anterior entra como estimación ya cerrada, no como datos crudos.
 *   · No inventa precisión: sin 28 días de pesajes no hay parte observada, y
 *     el error combinado nunca baja de `minSeKcal`.
 */

export const ENERGY_BALANCE_VERSION = "1.0.0";

type NutritionConfig = typeof NUTRITION_CONFIG;

export interface IntakeDay {
  localDate: string;
  /** Lo que se COMIÓ ese día (registro), no el objetivo. */
  kcal: number;
  proteinG?: number | null;
}

export interface TargetPeriod {
  /** localDate desde el que rige. */
  effectiveFrom: string;
  kcal: number;
}

/**
 * La memoria de un ciclo anterior: su parte de DATOS (`MaintenanceEstimate.memory`),
 * nunca la combinación con la fórmula.
 */
export interface PriorEstimate {
  tdeeKcal: number;
  seKcal: number;
  /** Día en que se congeló. */
  localDate: string;
  /** Peso de referencia en ese momento. */
  weightKg: number;
  /** El periodo del que sale era un déficit. */
  fromDeficit: boolean;
}

export interface EnergyBalanceInput {
  todayLocalDate: string;
  /**
   * Primer día que describe el régimen actual: inicio del ciclo más la
   * estabilización. Nada anterior entra en la parte observada.
   */
  regimeStartLocalDate: string;
  measurements: readonly BodyMeasurementPoint[];
  /** Ingesta registrada (puede venir vacía: el registro es opcional). */
  intake: readonly IntakeDay[];
  /** Historial completo de objetivos calóricos. */
  targets: readonly TargetPeriod[];
  /** Fórmula aditiva con los datos de hoy. */
  formulaTdeeKcal: number;
  /**
   * La misma fórmula al peso de la estimación anterior. Sirve para escalar
   * esa estimación al peso actual sin suponer una pendiente kcal/kg concreta.
   */
  formulaTdeeAtPriorWeightKcal: number | null;
  prior: PriorEstimate | null;
  /** El régimen actual NO es un déficit (para el error de transición). */
  currentIsDeficit: boolean;
}

export type IntakeSource = "LOGGED" | "TARGET_PROXY";

export type ObservedUnavailableReason =
  "REGIME_TOO_SHORT" | "INSUFFICIENT_WEIGHINGS" | "NO_INTAKE_DATA";

export interface ObservedEnergy {
  tdeeKcal: number;
  seKcal: number;
  intakeSource: IntakeSource;
  meanIntakeKcal: number;
  slopeKgPerWeek: number;
  ciLowKgPerWeek: number;
  ciHighKgPerWeek: number;
  windowStartLocalDate: string;
  windowEndLocalDate: string;
  windowDays: number;
  weighings: number;
  loggedDays: number;
  /** Días registrados / días de la ventana. */
  loggedCoverage: number;
  /** Días registrados descartados por parecer incompletos. */
  excludedIncompleteDays: number;
  /** Desglose del error típico, para auditar de dónde sale la incertidumbre. */
  seBreakdown: { intake: number; slope: number; density: number };
}

export type MaintenanceBasis = "OBSERVED" | "PRIOR" | "FORMULA";

export type MaintenanceReasonCode =
  "OBSERVED_DOMINANT" | "BLENDED" | "PRIOR_DOMINANT" | "FORMULA_ONLY";

export interface MaintenanceEstimate {
  engineVersion: string;
  /** Redondeado a 25 kcal. */
  tdeeKcal: number;
  /** Intervalo ≈ 95 % (± 1,96 errores típicos), redondeado a 25. */
  lowKcal: number;
  highKcal: number;
  seKcal: number;
  confidence: BodyConfidence;
  /** La fuente con más peso. */
  basis: MaintenanceBasis;
  reasonCode: MaintenanceReasonCode;
  observed: ObservedEnergy | null;
  observedUnavailableReason: ObservedUnavailableReason | null;
  /** Estimación anterior ya escalada al peso de hoy. */
  prior: { tdeeKcal: number; seKcal: number; weight: number } | null;
  formula: { tdeeKcal: number; seKcal: number; weight: number };
  /** Peso relativo (0–1) de la parte observada. */
  observedWeight: number;
  /**
   * La parte que sale de DATOS (observado + memoria de ciclos anteriores),
   * sin la fórmula. Es lo que se hereda al siguiente ciclo: si se heredara la
   * combinación entera, la fórmula volvería a sumarse en cada ciclo y contaría
   * dos, tres, cuatro veces. `null` si no hay ningún dato propio.
   */
  memory: { tdeeKcal: number; seKcal: number } | null;
  explanation: string;
  notes: string[];
}

// ── Formato es-ES ───────────────────────────────────────────────────────────

const kcalFmt = (n: number) => Math.round(n).toLocaleString("es-ES");
const kgFmt = (n: number) =>
  n
    .toLocaleString("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace("-", "−");

// ── Parte observada ─────────────────────────────────────────────────────────

/** Objetivo vigente un día concreto (el último con `effectiveFrom ≤ día`). */
export function targetOn(
  targets: readonly TargetPeriod[],
  localDate: string,
): number | null {
  let best: TargetPeriod | null = null;
  for (const t of targets) {
    if (diffDays(t.effectiveFrom, localDate) < 0) continue;
    if (best === null || t.effectiveFrom > best.effectiveFrom) best = t;
  }
  return best?.kcal ?? null;
}

/** Media del objetivo vigente día a día entre dos fechas (ambas incluidas). */
export function meanTargetBetween(
  targets: readonly TargetPeriod[],
  from: string,
  to: string,
): number | null {
  const days = diffDays(from, to) + 1;
  if (days <= 0) return null;
  let sum = 0;
  for (let i = 0; i < days; i++) {
    const kcal = targetOn(targets, addDays(from, i));
    if (kcal === null) return null;
    sum += kcal;
  }
  return sum / days;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface LoggedIntakeSummary {
  loggedDays: number;
  usedDays: number;
  excludedIncompleteDays: number;
  coverage: number;
  meanKcal: number | null;
  sdKcal: number | null;
  sufficient: boolean;
}

/**
 * Resumen del registro de ingesta entre dos fechas. Los días por debajo de
 * `incompleteDayFraction` × mediana se descartan como registros incompletos:
 * es mucho más probable olvidar apuntar una comida que comer la mitad.
 */
export function summarizeLoggedIntake(
  intake: readonly IntakeDay[],
  from: string,
  to: string,
  config: NutritionConfig = NUTRITION_CONFIG,
): LoggedIntakeSummary {
  const cfg = config.energyBalance;
  const days = Math.max(diffDays(from, to) + 1, 1);
  const byDate = new Map<string, number>();
  for (const d of intake) {
    if (diffDays(from, d.localDate) < 0 || diffDays(d.localDate, to) < 0) {
      continue;
    }
    if (!Number.isFinite(d.kcal) || d.kcal <= 0) continue;
    byDate.set(d.localDate, d.kcal);
  }
  const values = [...byDate.values()];
  if (values.length === 0) {
    return {
      loggedDays: 0,
      usedDays: 0,
      excludedIncompleteDays: 0,
      coverage: 0,
      meanKcal: null,
      sdKcal: null,
      sufficient: false,
    };
  }
  const cut = median(values) * cfg.incompleteDayFraction;
  const used = values.filter((v) => v >= cut);
  const mean = used.reduce((a, v) => a + v, 0) / used.length;
  const sd =
    used.length > 1
      ? Math.sqrt(
          used.reduce((a, v) => a + (v - mean) ** 2, 0) / (used.length - 1),
        )
      : 0;
  const coverage = used.length / days;
  return {
    loggedDays: values.length,
    usedDays: used.length,
    excludedIncompleteDays: values.length - used.length,
    coverage,
    meanKcal: mean,
    sdKcal: sd,
    sufficient:
      used.length >= cfg.minLoggedDays && coverage >= cfg.minLoggedCoverage,
  };
}

function observe(
  input: EnergyBalanceInput,
  config: NutritionConfig,
  bodyConfig: BodyConfig,
): { observed: ObservedEnergy } | { reason: ObservedUnavailableReason } {
  const cfg = config.energyBalance;
  const shortest = Math.min(...cfg.windows.map((w) => w.minSpanDays));
  if (diffDays(input.regimeStartLocalDate, input.todayLocalDate) < shortest) {
    return { reason: "REGIME_TOO_SHORT" };
  }

  // Reutiliza el motor corporal: la misma winsorización y la misma regresión
  // que el resto de la app, con otra escalera de ventanas.
  const analysis = analyzeBody(
    {
      measurements: input.measurements,
      todayLocalDate: input.todayLocalDate,
      goal: null,
      analysisStartLocalDate: input.regimeStartLocalDate,
    },
    { ...bodyConfig, trendWindows: cfg.windows },
  );
  const { weight } = analysis;
  if (
    weight.trend === null ||
    weight.windowDays === null ||
    weight.latestLocalDate === null
  ) {
    return { reason: "INSUFFICIENT_WEIGHINGS" };
  }

  const windowEnd = weight.latestLocalDate;
  const windowStart = addDays(windowEnd, -weight.trend.spanDays);
  const windowDays = weight.trend.spanDays + 1;

  const logged = summarizeLoggedIntake(
    input.intake,
    windowStart,
    windowEnd,
    config,
  );
  const targetMean = meanTargetBetween(input.targets, windowStart, windowEnd);

  let intakeSource: IntakeSource;
  let meanIntake: number;
  let intakeSe: number;
  if (logged.sufficient && logged.meanKcal !== null) {
    intakeSource = "LOGGED";
    meanIntake = logged.meanKcal;
    const random = (logged.sdKcal ?? 0) / Math.sqrt(logged.usedDays);
    const systematic = cfg.loggedSystematicSePct * meanIntake;
    intakeSe = Math.sqrt(random ** 2 + systematic ** 2);
  } else if (targetMean !== null) {
    intakeSource = "TARGET_PROXY";
    meanIntake = targetMean;
    intakeSe = cfg.targetProxySePct * meanIntake;
  } else {
    return { reason: "NO_INTAKE_DATA" };
  }

  const density = config.kcalPerKgBodyweight;
  // La pendiente que entra en el balance es la de MEDIAS SEMANALES, con su
  // margen honesto (`weekly-trend.ts`): anula el ritmo semanal del agua y no
  // finge la precisión de una regresión diaria con residuos autocorrelados.
  const weekly = weeklyMeanTrend(
    weight.series,
    input.todayLocalDate,
    weight.windowDays,
    bodyConfig,
  );
  if (weekly === null) return { reason: "INSUFFICIENT_WEIGHINGS" };
  const slopePerWeek = weekly.slopePerWeek;
  const halfWidth = weekly.ciHalfWidthPerWeek;
  const t = tCritical975(Math.max(weekly.weeks - 2, 1));
  const slopeSePerDay = halfWidth / t / 7;
  const slopeSe = slopeSePerDay * density;
  const slopePerDay = slopePerWeek / 7;
  const densitySe = Math.abs(slopePerDay) * density * cfg.densityRelativeSe;
  const se = Math.sqrt(intakeSe ** 2 + slopeSe ** 2 + densitySe ** 2);

  return {
    observed: {
      tdeeKcal: meanIntake - slopePerDay * density,
      seKcal: se,
      intakeSource,
      meanIntakeKcal: meanIntake,
      slopeKgPerWeek: slopePerWeek,
      ciLowKgPerWeek: slopePerWeek - halfWidth,
      ciHighKgPerWeek: slopePerWeek + halfWidth,
      windowStartLocalDate: windowStart,
      windowEndLocalDate: windowEnd,
      windowDays,
      weighings: weekly.n,
      loggedDays: logged.usedDays,
      loggedCoverage: logged.coverage,
      excludedIncompleteDays: logged.excludedIncompleteDays,
      seBreakdown: { intake: intakeSe, slope: slopeSe, density: densitySe },
    },
  };
}

// ── Combinación ─────────────────────────────────────────────────────────────

function scaledPrior(
  input: EnergyBalanceInput,
  config: NutritionConfig,
): { tdeeKcal: number; seKcal: number } | null {
  const prior = input.prior;
  if (prior === null) return null;
  const cfg = config.energyBalance;
  // El gasto escala con el peso; la fórmula dice CUÁNTO sin suponer una
  // pendiente kcal/kg concreta: se aplica su cociente, no su valor absoluto.
  const ratio =
    input.formulaTdeeAtPriorWeightKcal && input.formulaTdeeAtPriorWeightKcal > 0
      ? input.formulaTdeeKcal / input.formulaTdeeAtPriorWeightKcal
      : 1;
  const months =
    Math.max(diffDays(prior.localDate, input.todayLocalDate), 0) / 30.4;
  const drift = cfg.priorDriftSeKcalPerMonth * months;
  const transition =
    prior.fromDeficit && !input.currentIsDeficit
      ? cfg.priorTransitionSeKcal
      : 0;
  return {
    tdeeKcal: prior.tdeeKcal * ratio,
    seKcal: Math.sqrt(prior.seKcal ** 2 + drift ** 2 + transition ** 2),
  };
}

const UNAVAILABLE_TEXT: Record<ObservedUnavailableReason, string> = {
  REGIME_TOO_SHORT:
    "Todavía no hay cuatro semanas de datos en esta fase (sin contar las primeras, que son agua y glucógeno), así que aún no puedo medir tu gasto con tu báscula.",
  INSUFFICIENT_WEIGHINGS:
    "Faltan pesajes para medir tu gasto con tu báscula: hacen falta al menos 8 repartidos en cuatro semanas.",
  NO_INTAKE_DATA:
    "No hay ni registro de ingesta ni objetivo calórico con los que comparar el peso.",
};

export function estimateMaintenance(
  input: EnergyBalanceInput,
  config: NutritionConfig = NUTRITION_CONFIG,
  bodyConfig: BodyConfig = BODY_CONFIG,
): MaintenanceEstimate {
  const cfg = config.energyBalance;
  const result = observe(input, config, bodyConfig);
  const observed = "observed" in result ? result.observed : null;
  const unavailable = "reason" in result ? result.reason : null;
  const prior = scaledPrior(input, config);
  const formula = {
    tdeeKcal: input.formulaTdeeKcal,
    seKcal: input.formulaTdeeKcal * cfg.formulaSePct,
  };

  const parts = [
    observed ? { key: "OBSERVED" as const, ...observed } : null,
    prior ? { key: "PRIOR" as const, ...prior } : null,
    { key: "FORMULA" as const, ...formula },
  ].filter((p): p is NonNullable<typeof p> => p !== null);

  const precision = parts.map((p) => 1 / p.seKcal ** 2);
  const total = precision.reduce((a, w) => a + w, 0);
  const weights = precision.map((w) => w / total);
  const mean = parts.reduce((a, p, i) => a + p.tdeeKcal * weights[i], 0);
  const se = Math.max(Math.sqrt(1 / total), cfg.minSeKcal);
  const weightOf = (key: MaintenanceBasis) => {
    const i = parts.findIndex((p) => p.key === key);
    return i === -1 ? 0 : weights[i];
  };

  const dataParts = parts.filter((p) => p.key !== "FORMULA");
  const dataPrecision = dataParts.reduce((a, p) => a + 1 / p.seKcal ** 2, 0);
  const memory =
    dataParts.length === 0
      ? null
      : {
          tdeeKcal: Math.round(
            dataParts.reduce((a, p) => a + p.tdeeKcal / p.seKcal ** 2, 0) /
              dataPrecision,
          ),
          seKcal: Math.round(
            Math.max(Math.sqrt(1 / dataPrecision), cfg.minSeKcal),
          ),
        };

  const dominant = parts[weights.indexOf(Math.max(...weights))].key;
  const observedWeight = weightOf("OBSERVED");
  const reasonCode: MaintenanceReasonCode =
    parts.length === 1
      ? "FORMULA_ONLY"
      : dominant === "OBSERVED" && observedWeight >= 0.6
        ? "OBSERVED_DOMINANT"
        : dominant === "PRIOR" && weightOf("PRIOR") >= 0.6
          ? "PRIOR_DOMINANT"
          : "BLENDED";

  const confidence: BodyConfidence =
    se <= cfg.confidenceSeKcal.high
      ? "HIGH"
      : se <= cfg.confidenceSeKcal.medium
        ? "MEDIUM"
        : "LOW";

  const tdeeKcal = roundKcal(mean, config);
  const lowKcal = roundKcal(mean - 1.96 * se, config);
  const highKcal = roundKcal(mean + 1.96 * se, config);

  // ── Explicación con los números usados ──
  const notes: string[] = [];
  const sentences: string[] = [
    `Tu mantenimiento estimado es de unas ${kcalFmt(tdeeKcal)} kcal/día (probablemente entre ${kcalFmt(lowKcal)} y ${kcalFmt(highKcal)}).`,
  ];
  if (observed) {
    const balance = -observed.slopeKgPerWeek * (config.kcalPerKgBodyweight / 7);
    const intakeTxt =
      observed.intakeSource === "LOGGED"
        ? `has comido de media ${kcalFmt(observed.meanIntakeKcal)} kcal según tu registro (${observed.loggedDays} días)`
        : `tu objetivo medio fue de ${kcalFmt(observed.meanIntakeKcal)} kcal (no hay registro suficiente de lo que comes, así que se asume que lo cumpliste)`;
    const weightTxt =
      Math.abs(observed.slopeKgPerWeek) < 0.005
        ? "tu peso se ha mantenido estable"
        : `tu peso ha ${observed.slopeKgPerWeek < 0 ? "bajado" : "subido"} ${kgFmt(Math.abs(observed.slopeKgPerWeek))} kg/semana (margen ${kgFmt(observed.ciLowKgPerWeek)} a ${kgFmt(observed.ciHighKgPerWeek)})`;
    const balanceTxt =
      Math.abs(balance) < 12.5
        ? ""
        : `, lo que equivale a unas ${kcalFmt(Math.abs(balance))} kcal/día de ${balance > 0 ? "déficit" : "superávit"}`;
    sentences.push(
      `En los últimos ${observed.windowDays} días ${intakeTxt} y ${weightTxt}${balanceTxt}: con tus datos sale un gasto de ${kcalFmt(observed.tdeeKcal)} kcal.`,
    );
    if (observed.intakeSource === "TARGET_PROXY") {
      notes.push(
        "Sin registro de lo que comes, la estimación supone que comiste tu objetivo. Registrar kcal unas semanas la hace bastante más fiable.",
      );
    }
    if (observed.excludedIncompleteDays > 0) {
      notes.push(
        `${observed.excludedIncompleteDays} día(s) registrados muy por debajo de lo habitual se han tratado como registros incompletos y no cuentan.`,
      );
    }
  } else if (unavailable) {
    sentences.push(UNAVAILABLE_TEXT[unavailable]);
  }
  if (prior) {
    sentences.push(
      `Tu ciclo anterior dejó una estimación que, ajustada a tu peso de hoy, son ${kcalFmt(prior.tdeeKcal)} kcal.`,
    );
  }
  sentences.push(
    `La fórmula, con tu peso y tu actividad, da ${kcalFmt(formula.tdeeKcal)} kcal.`,
  );
  sentences.push(
    reasonCode === "OBSERVED_DOMINANT"
      ? `Pesa sobre todo lo que dicen tus datos (${Math.round(observedWeight * 100)} %).`
      : reasonCode === "PRIOR_DOMINANT"
        ? "Pesa sobre todo la estimación de tu ciclo anterior: aún hay pocos datos de este."
        : reasonCode === "FORMULA_ONLY"
          ? "Por ahora es solo la fórmula: es un punto de partida y se corregirá con tus datos."
          : "Es una mezcla ponderada por lo fiable que es cada fuente.",
  );

  return {
    engineVersion: ENERGY_BALANCE_VERSION,
    tdeeKcal,
    lowKcal,
    highKcal,
    seKcal: Math.round(se),
    confidence,
    basis: dominant,
    reasonCode,
    observed,
    observedUnavailableReason: unavailable,
    prior: prior
      ? {
          tdeeKcal: Math.round(prior.tdeeKcal),
          seKcal: Math.round(prior.seKcal),
          weight: weightOf("PRIOR"),
        }
      : null,
    formula: {
      tdeeKcal: Math.round(formula.tdeeKcal),
      seKcal: Math.round(formula.seKcal),
      weight: weightOf("FORMULA"),
    },
    observedWeight,
    memory,
    explanation: sentences.join(" "),
    notes,
  };
}

/**
 * Primer día del régimen que describe un ciclo: su inicio más la
 * estabilización (más larga si viene justo de un déficit).
 */
export function regimeStartFor(
  cycleStartLocalDate: string,
  previousWasDeficit: boolean,
  currentIsDeficit: boolean,
  config: NutritionConfig = NUTRITION_CONFIG,
): string {
  const cfg = config.regimeStart;
  const days =
    previousWasDeficit && !currentIsDeficit
      ? cfg.postDeficitStabilizationDays
      : cfg.stabilizationDays;
  return addDays(cycleStartLocalDate, days);
}
