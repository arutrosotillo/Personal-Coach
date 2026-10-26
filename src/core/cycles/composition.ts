import { analyzeBody } from "@/core/body";
import type { BodyMeasurementPoint } from "@/core/body";
import { CYCLE_CONFIG } from "@/core/config/cycle-config";
import type { GoalType } from "@/core/enums";
import type { PerformanceTrend } from "@/core/insights";
import type { PaceReading } from "@/core/nutrition/adjustment-common";

/**
 * ¿Estás acumulando demasiada grasa en la fase de ganancia? (docs/CYCLES.md §4)
 *
 * NO calcula cuánto músculo has ganado: ninguna medida doméstica permite esa
 * cifra y fingirla sería inventar. Cruza señales independientes, cada una con
 * su propia cautela, y solo SUGIERE revisar la fase cuando varias apuntan a
 * lo mismo. Nunca cierra el ciclo ni cambia de fase: la decisión es tuya.
 *
 * Señales, con su peso:
 *   · Cintura subiendo por encima de su error de medida (1).
 *   · Ganancia de peso por encima del ritmo, confirmada (0,5) o excesiva (1).
 *   · % graso subiendo entre lecturas comparables: medido (1), estimado (0,5).
 *   · % graso por encima de tu preferencia: medido (1), estimado (0,5) — una
 *     báscula de bioimpedancia se equivoca varios puntos, así que una lectura
 *     estimada nunca es un límite rígido.
 *   · Rendimiento cayendo mientras ganas peso (0,5): puede ser fatiga, por
 *     eso pesa poco.
 */

type CycleConfig = typeof CYCLE_CONFIG;

export type CompositionSignalCode =
  | "WAIST_RISING"
  | "GAIN_FAST"
  | "GAIN_EXCESSIVE"
  | "BODY_FAT_RISING"
  | "ABOVE_BODY_FAT_PREFERENCE"
  | "PERFORMANCE_DECLINING";

export interface CompositionSignal {
  code: CompositionSignalCode;
  weight: number;
  detail: string;
}

export interface CompositionAdvisory {
  level: "NONE" | "WATCH" | "SUGGEST_REVIEW";
  score: number;
  signals: CompositionSignal[];
  title: string;
  explanation: string;
  /** Opciones que la persona puede elegir. Ninguna se aplica sola. */
  options: string[];
  notes: string[];
}

export interface CompositionInput {
  goalType: GoalType;
  todayLocalDate: string;
  cycleStartLocalDate: string;
  measurements: readonly BodyMeasurementPoint[];
  /** Lectura de ritmo del ajuste calórico (política de ganancia), si la hay. */
  pace: PaceReading | null;
  performanceTrend: PerformanceTrend | null;
  /** Preferencia "% graso máximo". Orienta, no limita. */
  bodyFatCeilingPct: number | null;
  startWeightKg: number;
}

const fmt = (n: number, d = 1) =>
  n.toLocaleString("es-ES", { maximumFractionDigits: d }).replace("-", "−");

export function assessComposition(
  input: CompositionInput,
  config: CycleConfig = CYCLE_CONFIG,
): CompositionAdvisory | null {
  if (input.goalType !== "LEAN_GAIN") return null;
  const cfg = config.composition;

  const analysis = analyzeBody({
    measurements: input.measurements,
    todayLocalDate: input.todayLocalDate,
    goal: null,
    analysisStartLocalDate: input.cycleStartLocalDate,
  });

  const signals: CompositionSignal[] = [];
  const { waist, bodyFat, weight } = analysis;

  if (waist.status === "INCREASING" && waist.fittedChangeCm !== null) {
    signals.push({
      code: "WAIST_RISING",
      weight: 1,
      detail: `Tu cintura ha subido unos ${fmt(waist.fittedChangeCm)} cm, más que el error de una cinta métrica (${fmt(waist.minDetectableChangeCm)} cm).`,
    });
  }
  if (input.pace?.pace === "EXCESSIVE") {
    signals.push({
      code: "GAIN_EXCESSIVE",
      weight: 1,
      detail: `Ganas ${fmt(input.pace.observedKgPerWeek, 2)} kg/semana, muy por encima de tu objetivo (${fmt(input.pace.targetKgPerWeek, 2)}).`,
    });
  } else if (input.pace?.pace === "FAST") {
    signals.push({
      code: "GAIN_FAST",
      weight: 0.5,
      detail: `Ganas ${fmt(input.pace.observedKgPerWeek, 2)} kg/semana, por encima de tu objetivo (${fmt(input.pace.targetKgPerWeek, 2)}).`,
    });
  }
  if (bodyFat.status === "INCREASING" && bodyFat.changePp !== null) {
    const measured = bodyFat.comparedReliability === "MEASURED";
    signals.push({
      code: "BODY_FAT_RISING",
      weight: measured ? 1 : 0.5,
      detail: `Tu % graso ${measured ? "medido" : "estimado"} ha subido ${fmt(bodyFat.changePp)} puntos entre lecturas comparables.`,
    });
  }
  if (
    input.bodyFatCeilingPct !== null &&
    bodyFat.latestPct !== null &&
    bodyFat.latestPct > input.bodyFatCeilingPct
  ) {
    const measured = bodyFat.latestReliability === "MEASURED";
    signals.push({
      code: "ABOVE_BODY_FAT_PREFERENCE",
      weight: measured ? 1 : 0.5,
      detail: `Tu última lectura de % graso (${fmt(bodyFat.latestPct)} %, ${measured ? "medida" : "estimada, con varios puntos de error"}) supera el ${fmt(input.bodyFatCeilingPct)} % que prefieres no pasar.`,
    });
  }
  if (input.performanceTrend === "DECLINING") {
    signals.push({
      code: "PERFORMANCE_DECLINING",
      weight: 0.5,
      detail:
        "Tu rendimiento está bajando mientras ganas peso (también puede ser fatiga acumulada).",
    });
  }

  const score = signals.reduce((a, s) => a + s.weight, 0);
  const level =
    score >= cfg.reviewScore
      ? "SUGGEST_REVIEW"
      : score >= cfg.watchScore
        ? "WATCH"
        : "NONE";

  const notes: string[] = [];
  const current = weight.latestEmaKg;
  if (current !== null && input.startWeightKg > 0) {
    const gainPct =
      ((current - input.startWeightKg) / input.startWeightKg) * 100;
    if (gainPct >= cfg.cumulativeGainNotePct) {
      notes.push(
        `Llevas un ${fmt(gainPct)} % más de peso que al empezar la fase. No es un problema por sí solo, pero es buen momento para mirar la cintura y cómo te ves.`,
      );
    }
  }

  const title =
    level === "SUGGEST_REVIEW"
      ? "Puede que estés acumulando más grasa de la que quieres"
      : level === "WATCH"
        ? "Una señal a vigilar"
        : "Sin señales de exceso de grasa";
  const explanation =
    signals.length === 0
      ? "Ni la cintura ni el ritmo de ganancia sugieren que estés acumulando grasa de más."
      : `${signals.map((s) => s.detail).join(" ")} ${level === "SUGGEST_REVIEW" ? "Varias señales independientes apuntan a lo mismo." : level === "WATCH" ? "Es una señal sola: todavía no justifica cambiar nada." : "Es una señal débil y, por sí sola, no justifica cambiar nada."} Esto no mide cuánto músculo o grasa has ganado; orienta, y la decisión es tuya.`;

  return {
    level,
    score,
    signals,
    title,
    explanation,
    options:
      level === "SUGGEST_REVIEW"
        ? [
            "Seguir igual si te ves bien: tú decides.",
            "Bajar el ritmo de ganancia (por ejemplo a 0,10 % por semana).",
            "Unas semanas de mantenimiento para consolidar.",
            "Una minidefinición corta (4–8 semanas) y volver al volumen.",
          ]
        : [],
    notes,
  };
}
