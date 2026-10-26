import { analyzeBody, weeklyMeanTrend } from "@/core/body";
import type { BodyAnalysis, BodyConfidence } from "@/core/body";
import { BODY_CONFIG } from "@/core/config/body-config";
import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import { addDays, diffDays, formatLocalDate } from "@/core/dates";
import {
  adherenceExplains,
  adherenceText,
  CALORIE_ADJUSTMENT_VERSION,
  cooldownUntil,
  floorFor,
  INSUFFICIENT_REASON,
  kcalFmt,
  kgFmt,
  readAdherence,
  rebalanceMacros,
  roundTo,
  type AdjustmentConfig,
  type AdjustmentPolicy,
  type AdjustmentReasonCode,
  type CalorieAdjustment,
  type CalorieAdjustmentInput,
  type KcalDirection,
  type PaceReading,
  type ProposedTarget,
} from "@/core/nutrition/adjustment-common";
import { regimeStartFor } from "@/core/nutrition/energy-balance";

/**
 * Ajuste calórico para fases LARGAS con ritmos PEQUEÑOS: ganancia muscular
 * controlada, mantenimiento y recomposición (docs/CYCLES.md §4).
 *
 * POR QUÉ NO SIRVEN LAS REGLAS DE LA DEFINICIÓN: un volumen al 0,10 %/semana
 * son 75 g/semana a 75 kg. Con la ventana de 28 días el margen de la pendiente
 * es de ±0,12 kg/semana: ese objetivo es indistinguible de cero por
 * construcción, y las bandas relativas (60–140 % del objetivo) son diez veces
 * más estrechas que el ruido. Hace falta otra cosa:
 *
 *   · VENTANAS LARGAS (hasta 84 días) que arrancan en el último cambio de
 *     calorías. Largas porque solo así se distingue +0,10 %/semana de 0;
 *     arrancando en el cambio porque mezclar dos objetivos calóricos en la
 *     misma recta haría que, tras subir 100 kcal por ir lento, la ventana
 *     siguiera viendo "lento" y volviera a subir (oscilación por acumulación).
 *   · ESTABILIZACIÓN al empezar el ciclo: las 2–3 primeras semanas son agua,
 *     glucógeno y contenido intestinal, sobre todo al salir de una
 *     definición. No entran en la tendencia.
 *   · BANDA MUERTA + CONFIRMACIÓN: solo se actúa si el desvío supera la banda,
 *     el intervalo de confianza entero queda del mismo lado del objetivo, y
 *     la lectura de hace 14 días (7 si el desvío es fuerte) decía lo mismo.
 *   · PASO PROPORCIONAL Y AMORTIGUADO (50–150 kcal): corrige el 60 % del
 *     desvío estimado, no todo. Con densidad energética incierta, quedarse
 *     corto y volver a mirar es estable; pasarse oscila.
 *   · ANTIOSCILACIÓN: mínimo 28 días entre cambios, y durante 56 días tras un
 *     cambio, ir en la dirección contraria exige un desvío 1,5 veces mayor.
 *
 * Nunca aplica nada: propone, explica y espera a que la persona acepte.
 */

type ReadResult = {
  analysis: BodyAnalysis;
  reading: PaceReading | null;
  refKg: number | null;
};

const pctFmt2 = (n: number) =>
  n.toLocaleString("es-ES", { maximumFractionDigits: 2 }).replace("-", "−");

/**
 * Primer día que entra en la tendencia: el inicio del ciclo más la
 * estabilización, o el último cambio de calorías más su asentamiento, lo que
 * sea más tarde.
 */
export function trackingStartFor(
  input: CalorieAdjustmentInput,
  config: AdjustmentConfig = NUTRITION_CONFIG,
): { start: string; cause: "CYCLE_START" | "LAST_CHANGE" } {
  const goal = input.goal!;
  const regime = regimeStartFor(
    goal.startDate,
    input.previousGoalType === "FAT_LOSS",
    goal.type === "FAT_LOSS",
    config,
  );
  const afterChange =
    input.lastChange === null
      ? null
      : addDays(
          input.lastChange.localDate,
          config.adaptive.settleDaysAfterChange,
        );
  return afterChange !== null && afterChange > regime
    ? { start: afterChange, cause: "LAST_CHANGE" }
    : { start: regime, cause: "CYCLE_START" };
}

/** Tendencia de ventana larga desde `start`, vista en `onDate`. */
function readLong(
  input: CalorieAdjustmentInput,
  onDate: string,
  start: string,
  config: AdjustmentConfig,
): ReadResult {
  return readWith(input, onDate, start, config.adaptive.windows);
}

/** Tendencia reciente (≤ 28 días) desde `start`, vista en `onDate`. */
function readRecent(
  input: CalorieAdjustmentInput,
  onDate: string,
  start: string,
  config: AdjustmentConfig,
): ReadResult {
  return readWith(input, onDate, start, config.adaptive.recentWindows);
}

function readWith(
  input: CalorieAdjustmentInput,
  onDate: string,
  start: string,
  windows:
    | AdjustmentConfig["adaptive"]["windows"]
    | AdjustmentConfig["adaptive"]["recentWindows"],
): ReadResult {
  const analysis = analyzeBody(
    {
      measurements: input.measurements,
      todayLocalDate: onDate,
      goal: input.goal,
      analysisStartLocalDate: start,
    },
    { ...BODY_CONFIG, trendWindows: windows },
  );
  const { weight } = analysis;
  const refKg = weight.latestEmaKg ?? weight.latestKg ?? null;
  if (
    weight.trend === null ||
    weight.windowDays === null ||
    refKg === null ||
    input.goal === null
  ) {
    return { analysis, reading: null, refKg };
  }
  // La tendencia que decide es la de MEDIAS SEMANALES con margen honesto
  // (ver `weekly-trend.ts`): la regresión diaria confirma picos de agua del
  // lunes y su margen ignora la autocorrelación.
  const weekly = weeklyMeanTrend(weight.series, onDate, weight.windowDays);
  if (weekly === null) return { analysis, reading: null, refKg };
  const target = (input.goal.weeklyRatePct / 100) * refKg;
  const { slopePerWeek, ciLowPerWeek, ciHighPerWeek } = weekly;
  const ratio = target === 0 ? 0 : slopePerWeek / target;
  const boundA = target === 0 ? 0 : ciLowPerWeek / target;
  const boundB = target === 0 ? 0 : ciHighPerWeek / target;
  return {
    analysis,
    refKg,
    reading: {
      localDate: onDate,
      observedKgPerWeek: slopePerWeek,
      ciLowKgPerWeek: ciLowPerWeek,
      ciHighKgPerWeek: ciHighPerWeek,
      targetKgPerWeek: target,
      ratio,
      fastestPlausibleRatio: Math.max(boundA, boundB),
      slowestPlausibleRatio: Math.min(boundA, boundB),
      windowDays: weight.windowDays,
      measurements: weight.measurementsInWindow,
      confidence: weekly.confidence,
      pace: "ON_TRACK",
    },
  };
}

// ── Esqueleto común de las tres políticas ───────────────────────────────────

interface PolicyContext {
  input: CalorieAdjustmentInput;
  config: AdjustmentConfig;
  policy: AdjustmentPolicy;
  start: string;
  startCause: "CYCLE_START" | "LAST_CHANGE";
  daysOnPhase: number;
}

function baseOf(ctx: PolicyContext) {
  return {
    engineVersion: CALORIE_ADJUSTMENT_VERSION,
    policy: ctx.policy,
    proposal: null,
    currentKcal: ctx.input.currentTarget?.kcal ?? null,
    floorKcal: null,
    daysOnPhase: ctx.daysOnPhase,
    now: null,
    weekAgo: null,
    insufficientDataReason: null,
    nextEligibleLocalDate: null,
    trackingStartLocalDate: ctx.start,
    adherence: null,
  } satisfies Partial<CalorieAdjustment>;
}

function holdOf(
  ctx: PolicyContext,
  ruleId: string,
  reasonCode: AdjustmentReasonCode,
  title: string,
  explanation: string,
  extra: Partial<CalorieAdjustment> = {},
): CalorieAdjustment {
  return {
    ...baseOf(ctx),
    ruleId,
    reasonCode,
    action: "HOLD",
    confidence: "LOW",
    title,
    explanation,
    ...extra,
  };
}

/**
 * Las comprobaciones previas comunes: sin objetivo calórico, todavía en
 * estabilización, o sin pesajes suficientes. Devuelve la decisión si alguna
 * aplica, o la lectura de hoy si se puede seguir.
 */
function preflight(
  ctx: PolicyContext,
):
  | { done: CalorieAdjustment }
  | { now: PaceReading; read: ReadResult; refKg: number } {
  const { input, config } = ctx;
  if (input.currentTarget === null) {
    return {
      done: holdOf(
        ctx,
        "NA",
        "NO_TARGET",
        "No tienes objetivo calórico",
        "Sin un objetivo calórico vigente no hay nada que ajustar.",
      ),
    };
  }
  const minSpan = Math.min(
    ...config.adaptive.windows.map((w) => w.minSpanDays),
  );
  const firstReading = addDays(ctx.start, minSpan);
  if (diffDays(firstReading, input.todayLocalDate) < 0) {
    const why =
      ctx.startCause === "CYCLE_START"
        ? `Las primeras semanas de una fase la báscula se mueve por agua, glucógeno y contenido intestinal${input.previousGoalType === "FAT_LOSS" ? " (al salir de una definición es normal subir 1–2 kg que no son ni grasa ni músculo)" : ""}, así que la tendencia empieza a contar el ${formatLocalDate(ctx.start)}.`
        : `Cambiaste tus calorías hace poco: la tendencia vuelve a contar desde el ${formatLocalDate(ctx.start)} para no mezclar los dos objetivos.`;
    return {
      done: holdOf(
        ctx,
        "R4a",
        "INITIAL_PHASE",
        "Todavía no toca ajustar",
        `${why} Con unos ${minSpan} días de pesajes desde entonces podré decirte si vas al ritmo.`,
        { nextEligibleLocalDate: firstReading },
      ),
    };
  }
  const read = readLong(input, input.todayLocalDate, ctx.start, config);
  if (read.reading === null || read.refKg === null) {
    const reason =
      INSUFFICIENT_REASON[read.analysis.weight.reasonCode] ??
      INSUFFICIENT_REASON.TOO_FEW_MEASUREMENTS;
    return {
      done: holdOf(
        ctx,
        "R1",
        "INSUFFICIENT_DATA",
        "Necesito más pesajes para opinar",
        `${reason} Desde el ${formatLocalDate(ctx.start)} tienes ${read.analysis.weight.measurementsInWindow} en la ventana más reciente. En fases largas no hace falta pesarse a diario, pero sí con regularidad: 3 o 4 veces por semana bastan.`,
        { insufficientDataReason: read.analysis.weight.reasonCode },
      ),
    };
  }
  return { now: read.reading, read, refKg: read.refKg };
}

/**
 * Las guardas que van entre "hay un desvío confirmado" y "propongo": R2
 * (adherencia), enfriamiento, antioscilación y "ahora no".
 */
function guards(
  ctx: PolicyContext,
  direction: KcalDirection,
  deviationRatio: number,
  now: PaceReading,
  holdWith: (
    ruleId: string,
    reasonCode: AdjustmentReasonCode,
    title: string,
    tail: string,
    extra?: Partial<CalorieAdjustment>,
  ) => CalorieAdjustment,
): { done: CalorieAdjustment } | { adherence: CalorieAdjustment["adherence"] } {
  const { input, config } = ctx;
  const a = config.adaptive;
  const today = input.todayLocalDate;

  const adherence = readAdherence(
    input,
    addDays(today, -(now.windowDays - 1)),
    today,
    config,
  );
  if (adherenceExplains(adherence, direction, config)) {
    return {
      done: holdWith(
        "R2",
        "ADHERENCE_GAP",
        direction === "UP"
          ? "Antes de subir: estás comiendo por debajo del objetivo"
          : "Antes de bajar: estás comiendo por encima del objetivo",
        `${adherenceText(adherence!)} Cambiar el número no cambia lo que comes: acércate primero a tu objetivo actual y lo vuelvo a mirar.`,
        { adherence },
      ),
    };
  }

  if (input.lastChange !== null) {
    const cd = cooldownUntil(
      input.lastChange.localDate,
      a.minDaysBetweenChanges,
      today,
    );
    if (cd.active) {
      return {
        done: holdWith(
          "R3",
          "COOLDOWN",
          "Acabas de cambiar el objetivo: hay que darle tiempo",
          `Lo cambiaste hace ${cd.since} días. En una fase larga los cambios se espacian al menos ${a.minDaysBetweenChanges} días, así que no vuelvo a tocarlo antes del ${formatLocalDate(cd.until)}.`,
          { nextEligibleLocalDate: cd.until, adherence },
        ),
      };
    }
    const reversal = cooldownUntil(
      input.lastChange.localDate,
      a.reversalGuardDays,
      today,
    );
    if (
      input.lastChange.direction !== direction &&
      reversal.active &&
      deviationRatio < a.reversalEvidenceMultiplier
    ) {
      return {
        done: holdWith(
          "R3b",
          "REVERSAL_GUARD",
          "No deshago el último cambio tan pronto",
          `Hace ${reversal.since} días ${input.lastChange.direction === "UP" ? "subiste" : "bajaste"} las calorías. Ir ahora en sentido contrario por un desvío pequeño sería oscilar: solo lo haré antes del ${formatLocalDate(reversal.until)} si el desvío es claramente mayor que el actual.`,
          { nextEligibleLocalDate: reversal.until, adherence },
        ),
      };
    }
  }

  if (input.lastRejectedLocalDate !== null) {
    const snooze = cooldownUntil(
      input.lastRejectedLocalDate,
      config.calorieAdjustment.rejectionSnoozeDays,
      today,
    );
    if (snooze.active) {
      return {
        done: holdWith(
          "SNOOZE",
          "SNOOZED",
          "Dejaste la sugerencia para más adelante",
          `Hace ${snooze.since} días preferiste no cambiar nada. Volveré a mirarlo a partir del ${formatLocalDate(snooze.until)}.`,
          { nextEligibleLocalDate: snooze.until, adherence },
        ),
      };
    }
  }
  return { adherence };
}

/**
 * Paso de la política de ganancia: el 60 % del desvío estimado, pero nunca más
 * que la parte del desvío de la que hay CERTEZA (la distancia del borde del
 * margen al objetivo). Con margen estrecho manda la amortiguación; con margen
 * ancho, la certeza. No se amortigua dos veces: eso deja a alguien meses sin
 * ganar peso por exceso de prudencia.
 */
function cautiousStep(
  gapKcalPerDay: number,
  certainGapKcalPerDay: number,
  config: AdjustmentConfig,
): number {
  const a = config.adaptive;
  const raw = roundTo(
    Math.min(
      Math.abs(gapKcalPerDay) * a.damping,
      Math.abs(certainGapKcalPerDay),
    ),
    config.kcalRounding,
  );
  return Math.min(Math.max(raw, a.minStepKcal), a.maxStepKcal);
}

/** Paso proporcional al desvío en kcal, amortiguado y acotado. */
function stepFor(gapKcalPerDay: number, config: AdjustmentConfig): number {
  const a = config.adaptive;
  const raw = roundTo(Math.abs(gapKcalPerDay) * a.damping, config.kcalRounding);
  return Math.min(Math.max(raw, a.minStepKcal), a.maxStepKcal);
}

/** Construye la propuesta respetando el suelo. `null` si ya está en él. */
function buildProposal(
  ctx: PolicyContext,
  direction: KcalDirection,
  stepKcal: number,
  refKg: number,
):
  | { proposal: ProposedTarget; floorKcal: number }
  | { atFloor: true; floorKcal: number } {
  const { input, config } = ctx;
  const current = input.currentTarget!;
  const floorKcal = floorFor(input, refKg, config);
  let kcal =
    direction === "UP" ? current.kcal + stepKcal : current.kcal - stepKcal;
  let clampedToFloor = false;
  if (direction === "DOWN") {
    if (current.kcal <= floorKcal) return { atFloor: true, floorKcal };
    if (kcal < floorKcal) {
      kcal = floorKcal;
      clampedToFloor = true;
    }
  }
  const macros = rebalanceMacros(current, kcal, refKg, config);
  return {
    floorKcal,
    proposal: {
      kcal,
      ...macros,
      deltaKcal: kcal - current.kcal,
      direction,
      clampedToFloor,
    },
  };
}

function confidenceOf(
  now: PaceReading,
  weekAgo: PaceReading,
  logged: boolean,
): BodyConfidence {
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  const minRank = Math.min(rank[now.confidence], rank[weekAgo.confidence]);
  if (logged && minRank === 2) return "HIGH";
  return minRank >= 1 ? "MEDIUM" : "LOW";
}

function contextFor(
  input: CalorieAdjustmentInput,
  config: AdjustmentConfig,
  policy: AdjustmentPolicy,
): PolicyContext {
  const { start, cause } = trackingStartFor(input, config);
  return {
    input,
    config,
    policy,
    start,
    startCause: cause,
    daysOnPhase: diffDays(input.goal!.startDate, input.todayLocalDate),
  };
}

function finalize(
  ctx: PolicyContext,
  built: ReturnType<typeof buildProposal>,
  fields: {
    ruleId: string;
    reasonCode: AdjustmentReasonCode;
    now: PaceReading;
    weekAgo: PaceReading;
    adherence: CalorieAdjustment["adherence"];
    explanation: (proposal: ProposedTarget) => string;
  },
  holdWith: (
    ruleId: string,
    reasonCode: AdjustmentReasonCode,
    title: string,
    tail: string,
    extra?: Partial<CalorieAdjustment>,
  ) => CalorieAdjustment,
): CalorieAdjustment {
  const current = ctx.input.currentTarget!;
  if ("atFloor" in built) {
    return holdWith(
      "R0",
      "AT_FLOOR",
      "No voy a proponerte comer menos",
      `Ya estás en ${kcalFmt(current.kcal)} kcal, el mínimo que la app considera seguro para ti (${kcalFmt(built.floorKcal)} kcal).`,
      { floorKcal: built.floorKcal, adherence: fields.adherence },
    );
  }
  const { proposal, floorKcal } = built;
  const verb = proposal.direction === "UP" ? "Subir" : "Bajar";
  return {
    ...baseOf(ctx),
    ruleId: fields.ruleId,
    reasonCode: fields.reasonCode,
    action: "ADJUST",
    confidence: confidenceOf(
      fields.now,
      fields.weekAgo,
      fields.adherence !== null,
    ),
    title: `${verb} a ${kcalFmt(proposal.kcal)} kcal`,
    explanation: fields.explanation(proposal),
    proposal,
    floorKcal,
    now: fields.now,
    weekAgo: fields.weekAgo,
    adherence: fields.adherence,
  };
}

function effectText(
  proposal: ProposedTarget,
  config: AdjustmentConfig,
  floorKcal: number | null,
): string {
  const shift = (Math.abs(proposal.deltaKcal) * 7) / config.kcalPerKgBodyweight;
  const verb = proposal.direction === "UP" ? "Subir" : "Bajar";
  const floorTxt =
    proposal.clampedToFloor && floorKcal !== null
      ? ` El paso se ha recortado para no bajar de tu mínimo de seguridad (${kcalFmt(floorKcal)} kcal).`
      : "";
  return `${verb} ${kcalFmt(Math.abs(proposal.deltaKcal))} kcal al día mueve tu ritmo unos ${kgFmt(shift)} kg/semana, ajustando solo los carbohidratos: la proteína (${proposal.proteinG} g) y la grasa (${proposal.fatG} g) se quedan como están.${floorTxt} Después vuelvo a medir desde cero, sin mezclar este objetivo con el anterior.`;
}

// ── Ganancia muscular controlada ────────────────────────────────────────────

type GainPace =
  | "ON_TRACK"
  | "UNCONFIRMED_SLOW"
  | "SLOW"
  | "UNCONFIRMED_FAST"
  | "FAST"
  | "EXCESSIVE";

function classifyGain(
  reading: PaceReading,
  refKg: number,
  config: AdjustmentConfig,
): { pace: GainPace; halfBand: number; strong: boolean } {
  const g = config.adaptive.gain;
  const target = reading.targetKgPerWeek;
  const halfBand = Math.max(
    g.bandRelative * target,
    (g.bandMinPctPerWeek / 100) * refKg,
  );
  const dev = reading.observedKgPerWeek - target;
  const excessive = Math.max(
    g.excessiveMultiplier * target,
    target + (g.excessiveExtraPctPerWeek / 100) * refKg,
  );
  let pace: GainPace;
  if (Math.abs(dev) <= halfBand) pace = "ON_TRACK";
  else if (dev < 0)
    pace = reading.ciHighKgPerWeek < target ? "SLOW" : "UNCONFIRMED_SLOW";
  else if (reading.ciLowKgPerWeek > target)
    pace = reading.observedKgPerWeek >= excessive ? "EXCESSIVE" : "FAST";
  else pace = "UNCONFIRMED_FAST";
  // Fuerte: excesivo, o perder peso con certeza en plena fase de ganancia.
  const strong =
    pace === "EXCESSIVE" || (pace === "SLOW" && reading.ciHighKgPerWeek < 0);
  return { pace, halfBand, strong };
}

export function evaluateGainAdjustment(
  input: CalorieAdjustmentInput,
  config: AdjustmentConfig = NUTRITION_CONFIG,
): CalorieAdjustment {
  const ctx = contextFor(input, config, "GAIN");
  const pre = preflight(ctx);
  if ("done" in pre) return pre.done;
  const { refKg } = pre;
  const today = input.todayLocalDate;
  const a = config.adaptive;

  // La ventana larga manda, salvo que la reciente vea un desvío FUERTE que la
  // larga todavía diluye (un cambio de hábitos sin cambio de calorías).
  const longCls = classifyGain(pre.now, refKg, config);
  const recent = readRecent(input, today, ctx.start, config);
  const recentCls =
    recent.reading && recent.refKg !== null
      ? classifyGain(recent.reading, recent.refKg, config)
      : null;
  const useRecent = recentCls !== null && recentCls.strong && !longCls.strong;
  const read = useRecent ? readRecent : readLong;
  const cls = useRecent ? recentCls : longCls;
  const now: PaceReading = {
    ...(useRecent ? recent.reading! : pre.now),
    pace: cls.pace,
  };
  const target = now.targetKgPerWeek;
  const dev = now.observedKgPerWeek - target;
  const readingTxt =
    `Desde el ${formatLocalDate(ctx.start)}, tu tendencia ${useRecent ? "de las últimas semanas" : ""} (${now.windowDays} días, ${now.measurements} pesajes) es de ${kgFmt(now.observedKgPerWeek)} kg/semana (margen ${kgFmt(now.ciLowKgPerWeek)} a ${kgFmt(now.ciHighKgPerWeek)}); tu objetivo es ${kgFmt(target)} kg/semana (${pctFmt2(input.goal!.weeklyRatePct)} % de tu peso).`.replace(
      "tendencia  (",
      "tendencia (",
    );
  const holdWith = (
    ruleId: string,
    reasonCode: AdjustmentReasonCode,
    title: string,
    tail: string,
    extra: Partial<CalorieAdjustment> = {},
  ) =>
    holdOf(ctx, ruleId, reasonCode, title, `${readingTxt} ${tail}`, {
      confidence: now.confidence,
      now,
      ...extra,
    });

  switch (cls.pace) {
    case "ON_TRACK":
      return holdWith(
        "G6",
        "ON_TRACK",
        "Vas al ritmo previsto",
        `Está dentro de la banda buena (${kgFmt(target - cls.halfBand)} a ${kgFmt(target + cls.halfBand)} kg/semana). En un volumen lento la báscula casi no se mueve de una semana a otra: lo que cuenta es la tendencia de varias semanas, y va bien. No toques nada.`,
      );
    case "UNCONFIRMED_SLOW":
    case "UNCONFIRMED_FAST":
      return holdWith(
        "G1b",
        cls.pace,
        cls.pace === "UNCONFIRMED_SLOW"
          ? "Parece algo lento, pero aún no está claro"
          : "Parece algo rápido, pero aún no está claro",
        `El margen de error todavía admite que vayas a tu ritmo. Con un ritmo tan pequeño, ajustar ahora sería reaccionar al ruido: cada semana de pesajes estrecha ese margen.`,
      );
  }

  const direction: KcalDirection = cls.pace === "SLOW" ? "UP" : "DOWN";
  const lag = cls.strong ? a.strongConfirmationLagDays : a.confirmationLagDays;
  const prev = read(input, addDays(today, -lag), ctx.start, config);
  const prevCls =
    prev.reading && prev.refKg !== null
      ? classifyGain(prev.reading, prev.refKg, config)
      : null;
  const sameSide =
    prevCls !== null &&
    (direction === "UP"
      ? prevCls.pace === "SLOW"
      : prevCls.pace === "FAST" || prevCls.pace === "EXCESSIVE");
  if (!sameSide || prev.reading === null) {
    return holdWith(
      direction === "UP" ? "G7" : "G5",
      direction === "UP" ? "SLOW_FIRST_READING" : "FAST_FIRST_READING",
      direction === "UP"
        ? "Vas más lento de lo previsto: lo confirmo antes de tocar nada"
        : cls.pace === "EXCESSIVE"
          ? "Estás subiendo bastante más rápido de lo previsto"
          : "Vas más rápido de lo previsto: lo confirmo antes de tocar nada",
      `Es la primera lectura que lo dice con seguridad. Nunca ajusto por una sola lectura: si dentro de ${lag} días sigue igual, te propondré ${direction === "UP" ? "subir" : "bajar"} un poco las calorías${direction === "DOWN" ? " para que lo que ganes no sea sobre todo grasa" : ""}.`,
      { nextEligibleLocalDate: addDays(today, lag) },
    );
  }
  const weekAgo: PaceReading = { ...prev.reading, pace: prevCls!.pace };

  const g = guards(
    ctx,
    direction,
    Math.abs(dev) / cls.halfBand,
    now,
    (r, c, t, tail, extra) => holdWith(r, c, t, tail, { weekAgo, ...extra }),
  );
  if ("done" in g) return g.done;

  // Se corrige solo la parte del desvío de la que hay certeza: la distancia
  // del BORDE del margen al objetivo, no la del centro. Con ventanas cortas el
  // centro exagera, y corregirlo entero es lo que hace oscilar.
  const certainDev =
    direction === "UP"
      ? target - now.ciHighKgPerWeek
      : now.ciLowKgPerWeek - target;
  const gapKcal = (dev * config.kcalPerKgBodyweight) / 7;
  const certainGapKcal = (certainDev * config.kcalPerKgBodyweight) / 7;
  const built = buildProposal(
    ctx,
    direction,
    cautiousStep(gapKcal, certainGapKcal, config),
    refKg,
  );
  const reasonCode: AdjustmentReasonCode =
    direction === "UP" ? "SLOW_CONFIRMED" : "FAST_CONFIRMED";
  return finalize(
    ctx,
    built,
    {
      ruleId: direction === "UP" ? "G7b" : "G5b",
      reasonCode,
      now,
      weekAgo,
      adherence: g.adherence,
      explanation: (proposal) => {
        const why =
          direction === "UP"
            ? `Incluso en el mejor caso del margen vas por debajo de tu objetivo, y hace ${lag} días ya lo decía (${kgFmt(weekAgo.observedKgPerWeek)} kg/semana).`
            : `Incluso en el caso más lento del margen vas por encima de tu objetivo, y hace ${lag} días ya lo decía (${kgFmt(weekAgo.observedKgPerWeek)} kg/semana). Ganar más rápido no acelera el músculo: suma sobre todo grasa.`;
        const gapTxt = `La diferencia equivale a unas ${kcalFmt(Math.abs(gapKcal))} kcal/día, pero con el margen de error lo seguro son unas ${kcalFmt(Math.abs(certainGapKcal))}: propongo ${kcalFmt(Math.abs(proposal.deltaKcal))} y volver a medir, en vez de corregirlo todo de golpe.`;
        return `${readingTxt} ${why} ${gapTxt} ${effectText(proposal, config, "floorKcal" in built ? built.floorKcal : null)}`;
      },
    },
    (r, c, t, tail, extra) => holdWith(r, c, t, tail, { weekAgo, ...extra }),
  );
}

// ── Mantenimiento ───────────────────────────────────────────────────────────

/** Peso de referencia de la banda: la media de la primera semana de seguimiento. */
function anchorOf(read: ReadResult, start: string): number | null {
  const series = read.analysis.weight.series;
  if (series.length === 0) return null;
  const firstWeek = series.filter(
    (p) => diffDays(p.localDate, addDays(start, 6)) >= 0,
  );
  const pts = firstWeek.length > 0 ? firstWeek : [series[0]];
  return pts.reduce((acc, p) => acc + p.usedKg, 0) / pts.length;
}

function classifyMaintenance(
  read: ReadResult,
  start: string,
  config: AdjustmentConfig,
): {
  pace: "IN_BAND" | "ABOVE_BAND" | "BELOW_BAND";
  anchorKg: number;
  driftKg: number;
  bandKg: number;
} | null {
  const anchor = anchorOf(read, start);
  const current = read.analysis.weight.latestEmaKg;
  if (anchor === null || current === null) return null;
  const band = (config.adaptive.maintenance.bandPctOfWeight / 100) * anchor;
  const drift = current - anchor;
  return {
    pace:
      Math.abs(drift) <= band
        ? "IN_BAND"
        : drift > 0
          ? "ABOVE_BAND"
          : "BELOW_BAND",
    anchorKg: anchor,
    driftKg: drift,
    bandKg: band,
  };
}

export function evaluateMaintenanceAdjustment(
  input: CalorieAdjustmentInput,
  config: AdjustmentConfig = NUTRITION_CONFIG,
): CalorieAdjustment {
  const ctx = contextFor(input, config, "MAINTAIN");
  const pre = preflight(ctx);
  if ("done" in pre) return pre.done;
  const { refKg } = pre;
  const today = input.todayLocalDate;
  const a = config.adaptive;

  const cls = classifyMaintenance(pre.read, ctx.start, config);
  if (cls === null) {
    return holdOf(
      ctx,
      "R1",
      "INSUFFICIENT_DATA",
      "Necesito más pesajes para opinar",
      "Aún no hay pesajes suficientes desde que empezó el seguimiento.",
    );
  }
  const now: PaceReading = {
    ...pre.now,
    pace: cls.pace,
    anchorKg: cls.anchorKg,
    driftKg: cls.driftKg,
  };
  const slope = now.observedKgPerWeek;
  const readingTxt = `Tu peso de referencia en esta fase es ${kgFmt(cls.anchorKg)} kg (la media de tu primera semana de seguimiento) y tu banda es de ±${kgFmt(cls.bandKg)} kg. Ahora estás en ${kgFmt(cls.anchorKg + cls.driftKg)} kg (${cls.driftKg >= 0 ? "+" : "−"}${kgFmt(Math.abs(cls.driftKg))}), con una tendencia de ${kgFmt(slope)} kg/semana (margen ${kgFmt(now.ciLowKgPerWeek)} a ${kgFmt(now.ciHighKgPerWeek)}).`;
  const holdWith = (
    ruleId: string,
    reasonCode: AdjustmentReasonCode,
    title: string,
    tail: string,
    extra: Partial<CalorieAdjustment> = {},
  ) =>
    holdOf(ctx, ruleId, reasonCode, title, `${readingTxt} ${tail}`, {
      confidence: now.confidence,
      now,
      ...extra,
    });

  // "Se mueve" y "ya vuelve" se leen en la tendencia RECIENTE: la larga va
  // con retraso cuando el peso cambia de dirección sin cambiar las calorías.
  const recent = readRecent(input, today, ctx.start, config).reading ?? now;
  const fastPct = config.adaptive.recomp.risingPctPerWeek;
  const movingFast =
    Math.abs(recent.observedKgPerWeek) > (fastPct / 100) * refKg &&
    (recent.ciLowKgPerWeek > 0 || recent.ciHighKgPerWeek < 0);

  if (cls.pace === "IN_BAND") {
    return movingFast
      ? holdWith(
          "M6b",
          "DRIFTING",
          "Dentro de tu banda, pero moviéndote",
          `Sigues dentro de la banda, aunque en las últimas semanas el peso ${recent.observedKgPerWeek > 0 ? "sube" : "baja"} con claridad (${kgFmt(recent.observedKgPerWeek)} kg/semana). No hay nada que corregir todavía; lo vigilo.`,
        )
      : holdWith(
          "M6",
          "IN_BAND",
          "Tu peso está estable: no toques nada",
          "Estás dentro de tu banda de mantenimiento. Es exactamente lo que buscas en esta fase.",
        );
  }

  const direction: KcalDirection = cls.pace === "ABOVE_BAND" ? "DOWN" : "UP";
  // Solo sirve para NO actuar, así que basta con que la tendencia reciente
  // apunte de vuelta con un mínimo de claridad: exigir certeza estadística a
  // tres o cuatro semanas sería imposible y empujaría a corregir algo que ya
  // se está corrigiendo solo.
  const backMin = (a.returningMinPctPerWeek / 100) * refKg;
  const returning =
    direction === "DOWN"
      ? recent.observedKgPerWeek <= -backMin
      : recent.observedKgPerWeek >= backMin;
  if (returning) {
    return holdWith(
      "M7",
      "DRIFT_RETURNING",
      "Fuera de la banda, pero ya vuelves",
      `Te saliste de la banda, pero en las últimas semanas el peso ya va de vuelta hacia tu referencia (${kgFmt(recent.observedKgPerWeek)} kg/semana). No hace falta tocar nada.`,
    );
  }

  const prev = readLong(
    input,
    addDays(today, -a.confirmationLagDays),
    ctx.start,
    config,
  );
  const prevCls = prev.reading
    ? classifyMaintenance(prev, ctx.start, config)
    : null;
  if (prevCls === null || prevCls.pace !== cls.pace || prev.reading === null) {
    return holdWith(
      "M8",
      "DRIFT_FIRST_READING",
      cls.pace === "ABOVE_BAND"
        ? "Estás por encima de tu banda"
        : "Estás por debajo de tu banda",
      `Es la primera lectura que lo dice. Si dentro de ${a.confirmationLagDays} días sigues fuera, te propondré ${direction === "UP" ? "subir" : "bajar"} un poco las calorías para volver.`,
      { nextEligibleLocalDate: addDays(today, a.confirmationLagDays) },
    );
  }
  const weekAgo: PaceReading = {
    ...prev.reading,
    pace: prevCls.pace,
    anchorKg: prevCls.anchorKg,
    driftKg: prevCls.driftKg,
  };

  const outside = Math.abs(cls.driftKg) - cls.bandKg;
  const g = guards(
    ctx,
    direction,
    1 + outside / cls.bandKg,
    now,
    (r, c, t, tail, extra) => holdWith(r, c, t, tail, { weekAgo, ...extra }),
  );
  if ("done" in g) return g.done;

  const away = direction === "DOWN" ? Math.max(slope, 0) : Math.min(slope, 0);
  const gapKcal =
    (Math.abs(away) * config.kcalPerKgBodyweight) / 7 +
    (Math.abs(cls.driftKg) * config.kcalPerKgBodyweight) /
      a.maintenance.returnOverDays;
  const built = buildProposal(ctx, direction, stepFor(gapKcal, config), refKg);
  return finalize(
    ctx,
    built,
    {
      ruleId: "M8b",
      reasonCode: "DRIFT_CONFIRMED",
      now,
      weekAgo,
      adherence: g.adherence,
      explanation: (proposal) =>
        `${readingTxt} Hace ${a.confirmationLagDays} días ya estabas fuera de la banda (${weekAgo.driftKg! >= 0 ? "+" : "−"}${kgFmt(Math.abs(weekAgo.driftKg!))} kg), así que no es una oscilación de agua. ${effectText(proposal, config, "floorKcal" in built ? built.floorKcal : null)}`,
    },
    (r, c, t, tail, extra) => holdWith(r, c, t, tail, { weekAgo, ...extra }),
  );
}

// ── Recomposición ───────────────────────────────────────────────────────────

function classifyRecomp(
  reading: PaceReading,
  refKg: number,
  config: AdjustmentConfig,
): "RISING" | "FALLING" | "IN_BAND" {
  const r = config.adaptive.recomp;
  if (
    reading.observedKgPerWeek > (r.risingPctPerWeek / 100) * refKg &&
    reading.ciLowKgPerWeek > 0
  ) {
    return "RISING";
  }
  if (
    reading.observedKgPerWeek < -(r.fallingPctPerWeek / 100) * refKg &&
    reading.ciHighKgPerWeek < 0
  ) {
    return "FALLING";
  }
  return "IN_BAND";
}

export function evaluateRecompAdjustment(
  input: CalorieAdjustmentInput,
  config: AdjustmentConfig = NUTRITION_CONFIG,
): CalorieAdjustment {
  const ctx = contextFor(input, config, "RECOMP");
  const pre = preflight(ctx);
  if ("done" in pre) return pre.done;
  const { refKg } = pre;
  const today = input.todayLocalDate;
  const a = config.adaptive;
  const r = a.recomp;

  const pace = classifyRecomp(pre.now, refKg, config);
  const now: PaceReading = { ...pre.now, pace };
  const waist = pre.read.analysis.waist;
  const readingTxt = `Tu tendencia desde el ${formatLocalDate(ctx.start)} es de ${kgFmt(now.observedKgPerWeek)} kg/semana (margen ${kgFmt(now.ciLowKgPerWeek)} a ${kgFmt(now.ciHighKgPerWeek)}).`;
  const holdWith = (
    ruleId: string,
    reasonCode: AdjustmentReasonCode,
    title: string,
    tail: string,
    extra: Partial<CalorieAdjustment> = {},
  ) =>
    holdOf(ctx, ruleId, reasonCode, title, `${readingTxt} ${tail}`, {
      confidence: now.confidence,
      now,
      ...extra,
    });

  if (pace === "IN_BAND") {
    return holdWith(
      "RC6",
      "IN_BAND",
      "Peso estable: es lo esperado en una recomposición",
      "En una recomposición la báscula es el dato menos importante: lo que cuenta es la cintura y el rendimiento. No hay nada que ajustar.",
    );
  }
  if (pace === "RISING" && waist.status === "DECREASING") {
    return holdWith(
      "RC6b",
      "IN_BAND",
      "Subes algo de peso, pero la cintura baja",
      "Con la cintura bajando por encima del error de medida, esa subida no parece grasa. No ajusto nada.",
    );
  }
  if (pace === "FALLING" && input.performanceTrend !== "DECLINING") {
    return holdWith(
      "RC7b",
      "RECOMP_FALLING_PERFORMANCE_OK",
      "Bajas algo de peso, pero rindes bien",
      "Mientras el rendimiento no caiga, perder algo de peso en una recomposición no es un problema. Si notas el entreno claramente peor, sube un poco las calorías.",
    );
  }

  const direction: KcalDirection = pace === "RISING" ? "DOWN" : "UP";
  const prev = readLong(
    input,
    addDays(today, -a.confirmationLagDays),
    ctx.start,
    config,
  );
  const prevPace =
    prev.reading && prev.refKg !== null
      ? classifyRecomp(prev.reading, prev.refKg, config)
      : null;
  if (prevPace !== pace || prev.reading === null) {
    return holdWith(
      pace === "RISING" ? "RC8" : "RC9",
      pace === "RISING"
        ? "RECOMP_RISING_FIRST_READING"
        : "RECOMP_FALLING_FIRST_READING",
      pace === "RISING"
        ? "Tu peso sube más de lo que encaja con una recomposición"
        : "Bajas de peso y el rendimiento cae",
      `Es la primera lectura que lo dice. Si dentro de ${a.confirmationLagDays} días sigue igual, te propondré ${direction === "UP" ? "subir" : "bajar"} ${r.stepKcal} kcal.`,
      { nextEligibleLocalDate: addDays(today, a.confirmationLagDays) },
    );
  }
  const weekAgo: PaceReading = { ...prev.reading, pace: prevPace };
  const g = guards(
    ctx,
    direction,
    a.reversalEvidenceMultiplier,
    now,
    (rid, c, t, tail, extra) =>
      holdWith(rid, c, t, tail, { weekAgo, ...extra }),
  );
  if ("done" in g) return g.done;

  const built = buildProposal(ctx, direction, r.stepKcal, refKg);
  return finalize(
    ctx,
    built,
    {
      ruleId: pace === "RISING" ? "RC8b" : "RC9b",
      reasonCode:
        pace === "RISING"
          ? "RECOMP_RISING_CONFIRMED"
          : "RECOMP_FALLING_CONFIRMED",
      now,
      weekAgo,
      adherence: g.adherence,
      explanation: (proposal) =>
        `${readingTxt} ${pace === "RISING" ? `Sube más de un ${pctFmt2(r.risingPctPerWeek)} % de tu peso por semana sin que la cintura baje, y hace ${a.confirmationLagDays} días ya era así.` : `Baja más de un ${pctFmt2(r.fallingPctPerWeek)} % de tu peso por semana y tu rendimiento está cayendo, y hace ${a.confirmationLagDays} días ya era así.`} ${effectText(proposal, config, "floorKcal" in built ? built.floorKcal : null)}`,
    },
    (rid, c, t, tail, extra) =>
      holdWith(rid, c, t, tail, { weekAgo, ...extra }),
  );
}
