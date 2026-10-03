import { analyzeBody } from "@/core/body";
import type {
  BodyAnalysis,
  BodyConfidence,
  BodyGoalInput,
  BodyMeasurementPoint,
} from "@/core/body";
import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import { addDays, diffDays } from "@/core/dates";
import type { Sex } from "@/core/enums";
import { mifflinStJeor } from "@/core/nutrition/initial-estimate";

/**
 * Ajuste calórico por tendencia de peso (docs/NUTRITION_ENGINE.md §5, versión
 * reducida). Función pura: `(input, config) → decisión`.
 *
 * QUÉ RESPONDE: "con lo que dice la báscula, ¿tu objetivo calórico sigue
 * sirviendo para el ritmo que elegiste?". Y si no, propone UN paso de 100 kcal.
 * Nunca lo aplica: el usuario acepta o no.
 *
 * QUÉ NO SABE, y lo dice: la app todavía no registra lo que comes, así que no
 * puede distinguir "el objetivo es demasiado alto" de "no estás comiendo el
 * objetivo". Las reglas de adherencia (R2), pasos (R7a) y retención (R4b) de la
 * spec necesitan esos datos y no se aplican. Por eso un recorte nunca sale con
 * confianza alta y su explicación pide comprobar la ingesta antes de aceptar.
 *
 * NUNCA POR UN DATO AISLADO: la tendencia sale de la regresión del motor
 * corporal (no de la última pesada), tiene que distinguirse del objetivo con su
 * intervalo de confianza, y tiene que repetirse en dos lecturas separadas una
 * semana. Una semana plana no basta.
 */

export const CALORIE_ADJUSTMENT_VERSION = "1.0.0";

type AdjustmentConfig = typeof NUTRITION_CONFIG;

export type KcalDirection = "UP" | "DOWN";

export interface NutritionTargetSnapshot {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  /** localDate desde el que rige. */
  effectiveFrom: string;
}

export interface CalorieAdjustmentInput {
  todayLocalDate: string;
  sex: Sex;
  ageYears: number;
  heightCm: number;
  /** Objetivo activo. `startDate` abre la fase y acota la tendencia. */
  goal: (BodyGoalInput & { startDate: string }) | null;
  measurements: readonly BodyMeasurementPoint[];
  currentTarget: NutritionTargetSnapshot | null;
  /** Último CAMBIO del objetivo calórico (no el de onboarding). */
  lastChange: { localDate: string; direction: KcalDirection } | null;
  /** Último "ahora no" a esta sugerencia. */
  lastRejectedLocalDate: string | null;
}

export type AdjustmentReasonCode =
  | "NOT_APPLICABLE_GOAL"
  | "NO_TARGET"
  | "INITIAL_PHASE"
  | "INSUFFICIENT_DATA"
  | "UNCONFIRMED_SLOW"
  | "UNCONFIRMED_FAST"
  | "STALLED_FIRST_WEEK"
  | "STALLED_CONFIRMED"
  | "EXCESSIVE_FIRST_WEEK"
  | "EXCESSIVE_CONFIRMED"
  | "SLIGHTLY_SLOW"
  | "ON_TRACK"
  | "SLIGHTLY_FAST"
  | "COOLDOWN"
  | "SNOOZED"
  | "AT_FLOOR";

/** Lectura de la tendencia en un día concreto, en las unidades del objetivo. */
export interface PaceReading {
  localDate: string;
  observedKgPerWeek: number;
  ciLowKgPerWeek: number;
  ciHighKgPerWeek: number;
  targetKgPerWeek: number;
  /** observado / objetivo: 1 = justo al ritmo; 0 = parado; <0 = al revés. */
  ratio: number;
  /** El ratio más FAVORABLE que admite el intervalo de confianza. */
  fastestPlausibleRatio: number;
  /** El ratio más DESFAVORABLE que admite el intervalo de confianza. */
  slowestPlausibleRatio: number;
  windowDays: number;
  measurements: number;
  confidence: BodyConfidence;
  pace:
    | "STALLED"
    | "UNCONFIRMED_SLOW"
    | "SLOW"
    | "ON_TRACK"
    | "FAST"
    | "UNCONFIRMED_FAST"
    | "EXCESSIVE";
}

export interface ProposedTarget {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  deltaKcal: number;
  direction: KcalDirection;
  /** El paso se recortó para no bajar del suelo de seguridad. */
  clampedToFloor: boolean;
}

export interface CalorieAdjustment {
  engineVersion: string;
  ruleId: string;
  reasonCode: AdjustmentReasonCode;
  /** `ADJUST` solo cuando hay propuesta que aceptar. */
  action: "ADJUST" | "HOLD";
  confidence: BodyConfidence;
  title: string;
  explanation: string;
  proposal: ProposedTarget | null;
  currentKcal: number | null;
  floorKcal: number | null;
  daysOnPhase: number | null;
  now: PaceReading | null;
  weekAgo: PaceReading | null;
  /** Por qué no hay lectura, cuando no la hay (motivo del motor corporal). */
  insufficientDataReason: string | null;
  /** Fecha a partir de la cual volverá a poder proponer algo, si aplica. */
  nextEligibleLocalDate: string | null;
}

// ── Formato es-ES (la explicación lleva los números usados) ─────────────────

const kcalFmt = (n: number) => Math.round(n).toLocaleString("es-ES");
/** Con el menos tipográfico (U+2212), como el resto de `/progress`. */
const kgFmt = (n: number) =>
  n
    .toLocaleString("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace("-", "−");
const pctFmt = (n: number) =>
  Math.round(n * 100).toLocaleString("es-ES") + " %";

function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

// ── Lectura de la tendencia ─────────────────────────────────────────────────

function readPace(
  analysis: BodyAnalysis,
  config: AdjustmentConfig,
): PaceReading | null {
  const { weight, goal } = analysis;
  if (
    weight.status === "INSUFFICIENT_DATA" ||
    weight.trend === null ||
    weight.windowDays === null ||
    goal === null ||
    goal.targetKgPerWeek === null ||
    goal.referenceWeightKg === null ||
    goal.targetKgPerWeek === 0
  ) {
    return null;
  }

  const cfg = config.calorieAdjustment;
  const target = goal.targetKgPerWeek;
  const { slopePerWeek, ciLowPerWeek, ciHighPerWeek } = weight.trend;
  const ratio = slopePerWeek / target;
  // Dividir por un objetivo negativo invierte el orden de los extremos.
  const boundA = ciLowPerWeek / target;
  const boundB = ciHighPerWeek / target;
  const fastest = Math.max(boundA, boundB);
  const slowest = Math.min(boundA, boundB);

  // R5: en pérdida, "excesivo" es más rápido que max(1 % del peso, 1,5 ×
  // objetivo); en ganancia, 1,5 × objetivo.
  const excessiveRatio =
    target < 0
      ? Math.max(
          cfg.excessiveRatio,
          ((cfg.excessiveLossPctOfWeight / 100) * goal.referenceWeightKg) /
            Math.abs(target),
        )
      : cfg.excessiveRatio;

  // "Confirmado" = el intervalo de confianza ENTERO queda del mismo lado del
  // objetivo. Un ratio bajo con un margen que todavía admite ir al ritmo no
  // es un estancamiento: es falta de datos.
  const pace: PaceReading["pace"] =
    ratio < cfg.stalledRatio
      ? fastest < 1
        ? "STALLED"
        : "UNCONFIRMED_SLOW"
      : ratio < cfg.onTrackRatio.min
        ? "SLOW"
        : ratio <= cfg.onTrackRatio.max
          ? "ON_TRACK"
          : ratio >= excessiveRatio
            ? slowest > 1
              ? "EXCESSIVE"
              : "UNCONFIRMED_FAST"
            : "FAST";

  return {
    localDate: analysis.todayLocalDate,
    observedKgPerWeek: slopePerWeek,
    ciLowKgPerWeek: ciLowPerWeek,
    ciHighKgPerWeek: ciHighPerWeek,
    targetKgPerWeek: target,
    ratio,
    fastestPlausibleRatio: fastest,
    slowestPlausibleRatio: slowest,
    windowDays: weight.windowDays,
    measurements: weight.measurementsInWindow,
    confidence: weight.confidence,
    pace,
  };
}

const INSUFFICIENT_REASON: Record<string, string> = {
  NO_MEASUREMENTS: "Aún no hay pesajes en esta fase.",
  TOO_FEW_MEASUREMENTS: "Faltan pesajes para calcular una tendencia fiable.",
  SPAN_TOO_SHORT:
    "Los pesajes cubren todavía muy pocos días para calcular una tendencia.",
  SPARSE_MEASUREMENTS: "Los pesajes están demasiado espaciados.",
};

/** El suelo de seguridad, redondeado hacia arriba al paso de 25 kcal. */
function floorFor(
  input: CalorieAdjustmentInput,
  weightKg: number,
  config: AdjustmentConfig,
) {
  const bmr = mifflinStJeor(
    input.sex,
    weightKg,
    input.heightCm,
    input.ageYears,
  );
  const raw = Math.max(
    Math.round(bmr * config.minKcalBmrFactor),
    config.minKcalAbsolute[input.sex],
  );
  return ceilTo(raw, config.kcalRounding);
}

/**
 * Macros del nuevo objetivo: la proteína y la grasa NO se tocan (protegen el
 * músculo y la salud hormonal); el cambio sale entero de los carbohidratos
 * (spec §3: carbohidratos = resto). Solo si los carbohidratos bajaran del
 * mínimo se recorta la grasa hasta su suelo.
 */
function rebalanceMacros(
  current: NutritionTargetSnapshot,
  kcal: number,
  weightKg: number,
  config: AdjustmentConfig,
) {
  const proteinG = current.proteinG;
  let fatG = current.fatG;
  const carbsFor = () => Math.round((kcal - proteinG * 4 - fatG * 9) / 4);
  let carbsG = carbsFor();
  if (carbsG < config.minCarbsG) {
    const fatFloor = Math.max(
      Math.round(config.minFatGPerKg * weightKg),
      config.minFatGAbsolute,
    );
    fatG = Math.min(
      fatG,
      Math.max(
        fatFloor,
        fatG - Math.ceil(((config.minCarbsG - carbsG) * 4) / 9),
      ),
    );
    carbsG = carbsFor();
  }
  return { proteinG, fatG, carbsG: Math.max(carbsG, 0) };
}

// ── Motor ───────────────────────────────────────────────────────────────────

export function evaluateCalorieAdjustment(
  input: CalorieAdjustmentInput,
  config: AdjustmentConfig = NUTRITION_CONFIG,
): CalorieAdjustment {
  const cfg = config.calorieAdjustment;
  const today = input.todayLocalDate;

  const base = {
    engineVersion: CALORIE_ADJUSTMENT_VERSION,
    proposal: null,
    currentKcal: input.currentTarget?.kcal ?? null,
    floorKcal: null,
    daysOnPhase: null,
    now: null,
    weekAgo: null,
    insufficientDataReason: null,
    nextEligibleLocalDate: null,
  } satisfies Partial<CalorieAdjustment>;

  const hold = (
    ruleId: string,
    reasonCode: AdjustmentReasonCode,
    title: string,
    explanation: string,
    extra: Partial<CalorieAdjustment> = {},
  ): CalorieAdjustment => ({
    ...base,
    ruleId,
    reasonCode,
    action: "HOLD",
    confidence: "LOW",
    title,
    explanation,
    ...extra,
  });

  const goal = input.goal;
  if (goal === null || goal.weeklyRatePct === 0) {
    return hold(
      "NA",
      "NOT_APPLICABLE_GOAL",
      "Este ajuste es para fases de pérdida o ganancia",
      "Tu objetivo es mantener el peso: aquí la báscula es el dato menos importante y no hay un ritmo con el que comparar.",
    );
  }
  if (input.currentTarget === null) {
    return hold(
      "NA",
      "NO_TARGET",
      "No tienes objetivo calórico",
      "Sin un objetivo calórico vigente no hay nada que ajustar.",
    );
  }
  const current = input.currentTarget;

  const daysOnPhase = diffDays(goal.startDate, today);
  if (daysOnPhase < cfg.initialPhaseDays) {
    return hold(
      "R4a",
      "INITIAL_PHASE",
      "Demasiado pronto para ajustar",
      `Llevas ${daysOnPhase} días en esta fase. Las dos primeras semanas la báscula se mueve sobre todo por agua y glucógeno, no por grasa, así que no se ajusta nada hasta el día ${cfg.initialPhaseDays}.`,
      {
        daysOnPhase,
        nextEligibleLocalDate: addDays(goal.startDate, cfg.initialPhaseDays),
      },
    );
  }

  const analyze = (onDate: string) =>
    analyzeBody({
      measurements: input.measurements,
      todayLocalDate: onDate,
      goal,
      analysisStartLocalDate: goal.startDate,
    });

  const analysisNow = analyze(today);
  const now = readPace(analysisNow, config);
  const weekAgoDate = addDays(today, -cfg.confirmationLagDays);
  const weekAgo =
    diffDays(goal.startDate, weekAgoDate) >= cfg.initialPhaseDays
      ? readPace(analyze(weekAgoDate), config)
      : null;

  const refWeight =
    analysisNow.weight.latestEmaKg ??
    analysisNow.weight.latestKg ??
    goal.startWeightKg;
  const floorKcal = floorFor(input, refWeight, config);
  const ctx = { daysOnPhase, floorKcal, now, weekAgo };

  if (now === null) {
    const reason =
      INSUFFICIENT_REASON[analysisNow.weight.reasonCode] ??
      INSUFFICIENT_REASON.TOO_FEW_MEASUREMENTS;
    return hold(
      "R1",
      "INSUFFICIENT_DATA",
      "Necesito más pesajes para opinar",
      `${reason} Tienes ${analysisNow.weight.measurementsInWindow} en las últimas semanas. Pésate al menos 4 días por semana, en ayunas y después del baño: en una o dos semanas podré decirte si vas al ritmo.`,
      { ...ctx, insufficientDataReason: analysisNow.weight.reasonCode },
    );
  }

  const losing = now.targetKgPerWeek < 0;
  const observedTxt = `${kgFmt(now.observedKgPerWeek)} kg/semana`;
  const targetTxt = `${kgFmt(now.targetKgPerWeek)} kg/semana`;
  const marginTxt = `entre ${kgFmt(now.ciLowKgPerWeek)} y ${kgFmt(now.ciHighKgPerWeek)}`;
  const readingTxt = `Tu tendencia de los últimos ${now.windowDays} días (${now.measurements} pesajes) es ${observedTxt} (margen ${marginTxt}); tu objetivo es ${targetTxt}, así que vas al ${pctFmt(now.ratio)} del ritmo.`;
  const holdWith = (
    ruleId: string,
    reasonCode: AdjustmentReasonCode,
    title: string,
    tail: string,
    extra: Partial<CalorieAdjustment> = {},
  ) =>
    hold(ruleId, reasonCode, title, `${readingTxt} ${tail}`, {
      ...ctx,
      confidence: now.confidence,
      ...extra,
    });

  // ── ¿Hacia dónde habría que mover las kcal? ──
  let direction: KcalDirection;
  let adjustRule: string;
  let adjustCode: AdjustmentReasonCode;

  switch (now.pace) {
    case "ON_TRACK":
      return holdWith(
        "R6",
        "ON_TRACK",
        "Vas al ritmo: no toques nada",
        "Está dentro de la banda buena (60–140 % del objetivo). Mantener es lo correcto.",
      );
    case "SLOW":
      return holdWith(
        "R6b",
        "SLIGHTLY_SLOW",
        "Algo lento, pero sin motivo para ajustar",
        "Un poco por debajo de la banda buena, no lo bastante para cambiar nada. Lo vigilo la semana que viene.",
      );
    case "FAST":
      return holdWith(
        "R8",
        "SLIGHTLY_FAST",
        losing
          ? "Vas algo más rápido de lo previsto"
          : "Subes algo más rápido de lo previsto",
        "No es suficiente para cambiar el objetivo. Si notas el entreno o la energía claramente peor, dímelo con un check-in.",
      );
    case "UNCONFIRMED_SLOW":
    case "UNCONFIRMED_FAST":
      return holdWith(
        "R1b",
        now.pace,
        now.pace === "UNCONFIRMED_SLOW"
          ? "Parece lento, pero aún no está claro"
          : "Parece rápido, pero aún no está claro",
        `Con los pesajes actuales el margen de error todavía admite que vayas a tu ritmo (${targetTxt}). Ajustar ahora sería reaccionar al ruido. Pesarte más a menudo estrecha ese margen.`,
      );
    case "STALLED":
      direction = losing ? "DOWN" : "UP";
      if (weekAgo?.pace !== "STALLED") {
        return holdWith(
          "R7",
          "STALLED_FIRST_WEEK",
          "Te has frenado: lo confirmo la semana que viene",
          `Es la primera lectura que lo dice con seguridad. Nunca ajusto por una sola semana: si dentro de ${cfg.confirmationLagDays} días sigue igual, te propondré ${losing ? "bajar" : "subir"} ${cfg.stepKcal} kcal.`,
          { nextEligibleLocalDate: addDays(today, cfg.confirmationLagDays) },
        );
      }
      adjustRule = "R7b";
      adjustCode = "STALLED_CONFIRMED";
      break;
    case "EXCESSIVE":
      direction = losing ? "UP" : "DOWN";
      if (weekAgo?.pace !== "EXCESSIVE") {
        return holdWith(
          "R5",
          "EXCESSIVE_FIRST_WEEK",
          losing ? "Estás bajando muy rápido" : "Estás subiendo muy rápido",
          `Si se repite dentro de ${cfg.confirmationLagDays} días, te propondré ${losing ? "subir" : "bajar"} ${cfg.stepKcal} kcal${losing ? " para proteger el músculo y el rendimiento" : " para que lo que ganes no sea sobre todo grasa"}.`,
          { nextEligibleLocalDate: addDays(today, cfg.confirmationLagDays) },
        );
      }
      adjustRule = "R5";
      adjustCode = "EXCESSIVE_CONFIRMED";
      break;
  }

  // ── Enfriamientos (R3) ──
  if (input.lastChange !== null) {
    const since = diffDays(input.lastChange.localDate, today);
    const same = input.lastChange.direction === direction;
    const needed = same
      ? cfg.cooldownSameDirectionDays
      : cfg.cooldownAnyDirectionDays;
    if (since < needed) {
      return holdWith(
        "R3",
        "COOLDOWN",
        "Acabas de cambiar el objetivo: hay que darle tiempo",
        `Lo cambiaste hace ${since} días. Un cambio de calorías tarda unas dos semanas en verse en la tendencia, así que no vuelvo a tocarlo antes del ${addDays(input.lastChange.localDate, needed)}.`,
        { nextEligibleLocalDate: addDays(input.lastChange.localDate, needed) },
      );
    }
  }
  if (input.lastRejectedLocalDate !== null) {
    const since = diffDays(input.lastRejectedLocalDate, today);
    if (since < cfg.rejectionSnoozeDays) {
      const next = addDays(
        input.lastRejectedLocalDate,
        cfg.rejectionSnoozeDays,
      );
      return holdWith(
        "SNOOZE",
        "SNOOZED",
        "Dejaste la sugerencia para más adelante",
        `Hace ${since} días preferiste no cambiar nada. Volveré a mirarlo a partir del ${next}.`,
        { nextEligibleLocalDate: next },
      );
    }
  }

  // ── Propuesta ──
  let newKcal =
    direction === "DOWN"
      ? current.kcal - cfg.stepKcal
      : current.kcal + cfg.stepKcal;
  let clampedToFloor = false;
  if (direction === "DOWN") {
    if (current.kcal <= floorKcal) {
      return holdWith(
        "R0",
        "AT_FLOOR",
        "No voy a proponerte comer menos",
        `Ya estás en ${kcalFmt(current.kcal)} kcal, el mínimo que la app considera seguro para ti (${kcalFmt(floorKcal)} kcal). Bajar más no es la herramienta: moverte más o revisar la fase con un profesional sanitario sí puede serlo.`,
      );
    }
    if (newKcal < floorKcal) {
      newKcal = floorKcal;
      clampedToFloor = true;
    }
  }
  const macros = rebalanceMacros(current, newKcal, refWeight, config);
  const proposal: ProposedTarget = {
    kcal: newKcal,
    ...macros,
    deltaKcal: newKcal - current.kcal,
    direction,
    clampedToFloor,
  };

  // Lo que el cambio supone en la báscula, con la constante de §2 y su
  // imprecisión reconocida: es una orientación, no una promesa.
  const kgPerWeekShift =
    (Math.abs(proposal.deltaKcal) * 7) / config.kcalPerKgBodyweight;
  const verb = direction === "DOWN" ? "Bajar" : "Subir";
  const weekAgoTxt = `Hace una semana la lectura ya decía lo mismo (${kgFmt(weekAgo!.observedKgPerWeek)} kg/semana).`;
  const why =
    adjustCode === "STALLED_CONFIRMED"
      ? `Con ese margen, incluso en el mejor caso vas por debajo del objetivo, y no es una semana suelta. ${weekAgoTxt}`
      : `Con ese margen, incluso en el caso más lento vas por encima de lo previsto, y no es una semana suelta. ${weekAgoTxt}`;
  const effect = `${verb} ${kcalFmt(Math.abs(proposal.deltaKcal))} kcal al día equivale a unos ${kgFmt(kgPerWeekShift)} kg/semana ${direction === "DOWN" ? "más de pérdida" : "menos de pérdida"}, saliendo todo de los carbohidratos: la proteína (${proposal.proteinG} g) y la grasa (${proposal.fatG} g) se quedan como están.`;
  const effectGain = `${verb} ${kcalFmt(Math.abs(proposal.deltaKcal))} kcal al día equivale a unos ${kgFmt(kgPerWeekShift)} kg/semana ${direction === "UP" ? "más de ganancia" : "menos de ganancia"}, ajustando solo los carbohidratos.`;
  const floorTxt = clampedToFloor
    ? ` El paso se ha recortado para no bajar de tu mínimo de seguridad (${kcalFmt(floorKcal)} kcal).`
    : "";
  const adherenceTxt =
    direction === "DOWN" && losing
      ? ` Antes de aceptar: esto supone que de verdad estás comiendo unas ${kcalFmt(current.kcal)} kcal de media. Si te estás pasando algunos días, bajar el número no cambia nada; ajusta primero lo que comes.`
      : "";

  // Confianza: nunca HIGH, porque la ingesta no se mide; MEDIUM solo si las
  // dos lecturas son al menos de precisión media.
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  const confidence: BodyConfidence =
    rank[now.confidence] >= 1 && rank[weekAgo!.confidence] >= 1
      ? "MEDIUM"
      : "LOW";

  return {
    ...base,
    ...ctx,
    ruleId: adjustRule,
    reasonCode: adjustCode,
    action: "ADJUST",
    confidence,
    title: `${verb} a ${kcalFmt(newKcal)} kcal`,
    explanation: `${readingTxt} ${why} ${losing ? effect : effectGain}${floorTxt}${adherenceTxt}`,
    proposal,
  };
}
