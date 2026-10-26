import { analyzeBody, linearRegression } from "@/core/body";
import type {
  BodyFatTrendStatus,
  BodyMeasurementPoint,
  WaistTrendStatus,
} from "@/core/body";
import { BODY_CONFIG, type BodyConfig } from "@/core/config/body-config";
import { CYCLE_CONFIG } from "@/core/config/cycle-config";
import { addDays, diffDays } from "@/core/dates";
import type {
  BodyFatReliability,
  GoalStatus,
  GoalStrategy,
  GoalType,
} from "@/core/enums";
import type { CyclePerformanceSummary } from "@/core/cycles/performance";
import {
  meanTargetBetween,
  summarizeLoggedIntake,
  type IntakeDay,
  type MaintenanceEstimate,
} from "@/core/nutrition/energy-balance";

/**
 * Resumen de un ciclo (docs/CYCLES.md §2). Puro: recibe todo lo que pasó
 * entre `startLocalDate` y `endLocalDate` y devuelve números con su contexto.
 *
 * Lo que NO hace: juzgar si el ciclo "salió bien". Enseña la evolución con las
 * mismas cautelas que el resto de la app —la cintura solo cuenta por encima
 * de su error de medida, el % graso solo entre lecturas comparables— y deja
 * la valoración a la persona. Y no marca nada como completado: llegar al peso
 * objetivo se informa, no cierra el ciclo.
 */

export const CYCLE_SUMMARY_VERSION = "1.0.0";

type CycleConfig = typeof CYCLE_CONFIG;

export interface CycleSummaryInput {
  goal: {
    strategy: GoalStrategy;
    type: GoalType;
    status: GoalStatus;
    startDate: string;
    weeklyRatePct: number;
    startWeightKg: number;
    targetWeightKg: number | null;
  };
  /** Último día del ciclo (hoy si sigue activo). */
  endLocalDate: string;
  measurements: readonly BodyMeasurementPoint[];
  targets: readonly {
    effectiveFrom: string;
    kcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
  }[];
  intake: readonly IntakeDay[];
  performance: CyclePerformanceSummary | null;
  maintenance: MaintenanceEstimate | null;
}

export interface CycleTargetPeriod {
  fromLocalDate: string;
  toLocalDate: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export interface CycleSummary {
  version: string;
  strategy: GoalStrategy;
  goalType: GoalType;
  status: GoalStatus;
  startLocalDate: string;
  endLocalDate: string;
  days: number;
  weeks: number;
  weeklyRatePct: number;
  weight: {
    /** Media de los pesajes de los primeros días (o `null` sin pesajes). */
    startKg: number | null;
    endKg: number | null;
    changeKg: number | null;
    /** Pendiente de la regresión sobre todo el ciclo, con su margen. */
    ratePerWeekKg: number | null;
    ciLowPerWeekKg: number | null;
    ciHighPerWeekKg: number | null;
    /** El mismo ritmo en % del peso de inicio. */
    ratePctPerWeek: number | null;
    weighings: number;
  };
  waist: {
    status: WaistTrendStatus;
    startCm: number | null;
    endCm: number | null;
    fittedChangeCm: number | null;
    minDetectableChangeCm: number;
  };
  bodyFat: {
    status: BodyFatTrendStatus;
    changePp: number | null;
    reliability: BodyFatReliability | null;
  };
  nutrition: {
    periods: CycleTargetPeriod[];
    /** Objetivo medio día a día. */
    meanTargetKcal: number | null;
    loggedDays: number;
    loggedCoverage: number;
    meanLoggedKcal: number | null;
    meanLoggedProteinG: number | null;
  };
  maintenance: MaintenanceEstimate | null;
  performance: CyclePerformanceSummary | null;
  /** Peso objetivo alcanzado (informativo, no cierra nada). `null` sin objetivo. */
  targetWeightReached: boolean | null;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((a, v) => a + v, 0) / values.length;
}

export function summarizeCycle(
  input: CycleSummaryInput,
  config: CycleConfig = CYCLE_CONFIG,
  bodyConfig: BodyConfig = BODY_CONFIG,
): CycleSummary {
  const start = input.goal.startDate;
  const end = input.endLocalDate;
  const days = Math.max(diffDays(start, end) + 1, 1);

  // El motor corporal de siempre, con horizontes que cubren el ciclo entero:
  // la pregunta aquí es "¿qué pasó en el ciclo?", no "¿cómo voy ahora?".
  const analysis = analyzeBody(
    {
      measurements: input.measurements,
      todayLocalDate: end,
      goal: null,
      analysisStartLocalDate: start,
    },
    {
      ...bodyConfig,
      waistLookbackDays: days,
      bodyFatLookbackDays: days,
    },
  );

  const series = analysis.weight.series;
  const edge = config.summary.edgeDays;
  const firstDays = series.filter(
    (p) => diffDays(p.localDate, addDays(start, edge - 1)) >= 0,
  );
  const lastDays = series.filter(
    (p) => diffDays(addDays(end, -(edge - 1)), p.localDate) >= 0,
  );
  const startKg = mean(firstDays.map((p) => p.usedKg));
  const endKg = mean(lastDays.map((p) => p.usedKg));
  const regression = linearRegression(
    series.map((p) => ({
      dayOffset: diffDays(start, p.localDate),
      value: p.usedKg,
    })),
  );
  const ratePerWeekKg = regression ? regression.slopePerDay * 7 : null;
  const halfWidth = regression ? regression.ciHalfWidthPerDay * 7 : null;
  const refStart = startKg ?? input.goal.startWeightKg;

  // ── Objetivos calóricos que rigieron durante el ciclo ──
  const sortedTargets = [...input.targets].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
  // El vigente al empezar (puede venir de antes del ciclo) + los que entraron después.
  const atStart = [...sortedTargets]
    .reverse()
    .find((t) => diffDays(t.effectiveFrom, start) >= 0);
  const after = sortedTargets.filter(
    (t) =>
      diffDays(start, t.effectiveFrom) > 0 &&
      diffDays(t.effectiveFrom, end) >= 0,
  );
  const chain = [...(atStart ? [atStart] : []), ...after];
  const periods: CycleTargetPeriod[] = chain.map((t, i) => {
    const from = i === 0 ? start : t.effectiveFrom;
    const next = chain[i + 1];
    return {
      fromLocalDate: diffDays(start, from) < 0 ? start : from,
      toLocalDate: next ? addDays(next.effectiveFrom, -1) : end,
      kcal: t.kcal,
      proteinG: t.proteinG,
      fatG: t.fatG,
      carbsG: t.carbsG,
    };
  });

  const logged = summarizeLoggedIntake(input.intake, start, end);
  const proteinValues = input.intake
    .filter(
      (d) =>
        d.proteinG !== null &&
        d.proteinG !== undefined &&
        diffDays(start, d.localDate) >= 0 &&
        diffDays(d.localDate, end) >= 0,
    )
    .map((d) => d.proteinG as number);

  const target = input.goal.targetWeightKg;
  const targetWeightReached =
    target === null || endKg === null
      ? null
      : input.goal.weeklyRatePct < 0
        ? endKg <= target
        : input.goal.weeklyRatePct > 0
          ? endKg >= target
          : null;

  const waistPoints = input.measurements
    .filter(
      (m) =>
        m.waistCm !== null &&
        diffDays(start, m.localDate) >= 0 &&
        diffDays(m.localDate, end) >= 0,
    )
    .sort((a, b) => a.localDate.localeCompare(b.localDate));

  return {
    version: CYCLE_SUMMARY_VERSION,
    strategy: input.goal.strategy,
    goalType: input.goal.type,
    status: input.goal.status,
    startLocalDate: start,
    endLocalDate: end,
    days,
    weeks: Math.round((days / 7) * 10) / 10,
    weeklyRatePct: input.goal.weeklyRatePct,
    weight: {
      startKg,
      endKg,
      changeKg: startKg !== null && endKg !== null ? endKg - startKg : null,
      ratePerWeekKg,
      ciLowPerWeekKg:
        ratePerWeekKg !== null && halfWidth !== null
          ? ratePerWeekKg - halfWidth
          : null,
      ciHighPerWeekKg:
        ratePerWeekKg !== null && halfWidth !== null
          ? ratePerWeekKg + halfWidth
          : null,
      ratePctPerWeek:
        ratePerWeekKg !== null && refStart > 0
          ? (ratePerWeekKg / refStart) * 100
          : null,
      weighings: series.length,
    },
    waist: {
      status: analysis.waist.status,
      startCm: waistPoints[0]?.waistCm ?? null,
      endCm: waistPoints[waistPoints.length - 1]?.waistCm ?? null,
      fittedChangeCm: analysis.waist.fittedChangeCm,
      minDetectableChangeCm: analysis.waist.minDetectableChangeCm,
    },
    bodyFat: {
      status: analysis.bodyFat.status,
      changePp: analysis.bodyFat.changePp,
      reliability: analysis.bodyFat.comparedReliability,
    },
    nutrition: {
      periods,
      meanTargetKcal: meanTargetBetween(sortedTargets, start, end),
      loggedDays: logged.usedDays,
      loggedCoverage: logged.coverage,
      meanLoggedKcal: logged.meanKcal,
      meanLoggedProteinG: mean(proteinValues),
    },
    maintenance: input.maintenance,
    performance: input.performance,
    targetWeightReached,
  };
}
