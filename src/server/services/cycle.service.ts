import { Prisma } from "@/generated/prisma/client";

import { analyzeBody, type BodyMeasurementPoint } from "@/core/body";
import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import {
  assessComposition,
  CYCLE_PLAN_VERSION,
  planCycleTargets,
  summarizeCycle,
  summarizePerformance,
  trainingVolumeNote,
  type CompositionAdvisory,
  type CyclePlan,
  type CycleSummary,
} from "@/core/cycles";
import {
  addDays,
  ageInYears,
  DEFAULT_TIMEZONE,
  diffDays,
  toLocalDate,
} from "@/core/dates";
import {
  GoalStatus,
  GoalStrategy,
  GoalType,
  Sex,
  STRATEGY_TO_GOAL_TYPE,
  WorkActivity,
  type CycleOutcome,
} from "@/core/enums";
import type { PerformanceTrend } from "@/core/insights";
import type { CalorieAdjustment } from "@/core/nutrition/calorie-adjustment";
import {
  ENERGY_BALANCE_VERSION,
  estimateMaintenance,
  regimeStartFor,
  type MaintenanceEstimate,
  type PriorEstimate,
} from "@/core/nutrition/energy-balance";
import { estimateInitialTargets } from "@/core/nutrition/initial-estimate";
import { computeMacros } from "@/core/nutrition/macros";
import type {
  CycleCloseData,
  CyclePlanRequest,
  CycleStartData,
} from "@/core/schemas/cycle";
import { prisma } from "@/server/db";
import { listMeasurements } from "@/server/repositories/body-measurement.repo";
import {
  BODY_FAT_CEILING_KEY,
  findGoalByOpenRequest,
  findGoalOwnedBy,
  findLatestCycleCloseEstimate,
  getBodyFatCeiling,
  getTrainingLoadPreferences,
  listAllTargets,
  listEnergyEstimates,
  listGoals,
  listPerformancePoints,
  type EnergyEstimateRecord,
  type GoalRecord,
  type NutritionTargetFull,
} from "@/server/repositories/cycle.repo";
import { listEquipmentChangePoints } from "@/server/repositories/equipment-change.repo";
import {
  listIntake,
  type IntakeRecord,
} from "@/server/repositories/intake.repo";
import { getProfileById } from "@/server/repositories/profile.repo";
import { toEnginePoints } from "@/server/services/body.service";

/**
 * Ciclos físicos (docs/CYCLES.md): en qué fase estás, cómo te fue la anterior
 * y cómo empezar la siguiente, con el mantenimiento aprendido del historial.
 *
 * TRES PRINCIPIOS que este servicio hace cumplir:
 *   · La persona decide. Nada aquí cierra ni abre un ciclo por su cuenta: solo
 *     `closeCycle` y `startCycle`, que se llaman desde una acción explícita.
 *   · El historial es permanente. Cerrar un ciclo cambia su estado y congela su
 *     resumen; no borra ni reescribe mediciones, sesiones, objetivos ni
 *     decisiones.
 *   · Toda transición es atómica e idempotente: una transacción, una clave de
 *     idempotencia y un índice parcial que impide dos ciclos activos.
 *
 * Como el resto de servicios, recibe el `profileId` YA resuelto desde la sesión.
 */

// ── Errores esperables ──────────────────────────────────────────────────────

export class CycleNotFoundError extends Error {
  constructor() {
    super("Ese ciclo no existe o no es tuyo.");
    this.name = "CycleNotFoundError";
  }
}

/** El ciclo activo ya no es el que la persona vio (otro dispositivo, doble envío). */
export class StaleCycleError extends Error {
  constructor() {
    super(
      "Tu ciclo ha cambiado desde que abriste esta pantalla. Revísalo de nuevo.",
    );
    this.name = "StaleCycleError";
  }
}

/** El plan recalculado ya no coincide con el que la persona vio. */
export class StalePlanError extends Error {
  constructor(public readonly plan: { kcal: number }) {
    super(
      "Los números han cambiado desde que los viste (llegó un dato nuevo). Revísalos antes de confirmar.",
    );
    this.name = "StalePlanError";
  }
}

export class CloseOutcomeRequiredError extends Error {
  constructor() {
    super(
      "Indica si das tu ciclo actual por completado o lo dejas sin completar.",
    );
    this.name = "CloseOutcomeRequiredError";
  }
}

export class MissingProfileDataError extends Error {
  constructor() {
    super(
      "Falta información de tu perfil para calcular. Revisa tus datos en Ajustes.",
    );
    this.name = "MissingProfileDataError";
  }
}

// ── Contexto ────────────────────────────────────────────────────────────────

/** Desde cuándo se leen datos para estimar: dos años bastan y acotan la consulta. */
const LOOKBACK_DAYS = 800;

interface ProfileContext {
  profileId: string;
  sex: Sex;
  birthDate: string;
  heightCm: number;
  dailySteps: number;
  workActivity: WorkActivity;
  daysPerWeek: number;
  minutesPerSession: number;
}

function today(now: Date): string {
  return toLocalDate(now, DEFAULT_TIMEZONE);
}

async function loadContext(profileId: string): Promise<ProfileContext> {
  const [profile, load, program] = await Promise.all([
    getProfileById(profileId),
    getTrainingLoadPreferences(profileId),
    prisma.trainingProgram.findFirst({
      where: { profileId, isActive: true, deletedAt: null },
      select: { daysPerWeek: true },
    }),
  ]);
  if (!profile) throw new MissingProfileDataError();
  const sex = Sex.safeParse(profile.sex);
  if (!sex.success) throw new MissingProfileDataError();
  const work = WorkActivity.safeParse(profile.workActivity);
  return {
    profileId,
    sex: sex.data,
    birthDate: profile.birthDate,
    heightCm: profile.heightCm,
    dailySteps: profile.dailySteps ?? 7000,
    workActivity: work.success ? work.data : "SEDENTARY",
    daysPerWeek: program?.daysPerWeek ?? load.daysPerWeek ?? 3,
    minutesPerSession: load.minutesPerSession ?? 60,
  };
}

/** Fórmula aditiva del onboarding con los datos dados (sin objetivo). */
function formulaTdee(
  ctx: ProfileContext,
  localDate: string,
  weightKg: number,
  overrides: { dailySteps?: number; workActivity?: WorkActivity } = {},
): number {
  return estimateInitialTargets({
    sex: ctx.sex,
    ageYears: ageInYears(ctx.birthDate, localDate),
    heightCm: ctx.heightCm,
    weightKg,
    dailySteps: overrides.dailySteps ?? ctx.dailySteps,
    workActivity: overrides.workActivity ?? ctx.workActivity,
    trainingSessionsPerWeek: ctx.daysPerWeek,
    minutesPerSession: ctx.minutesPerSession,
    goalType: "MAINTENANCE",
  }).tdee;
}

/** Peso de referencia: la media suavizada actual, o el último pesaje. */
function currentWeight(
  points: readonly BodyMeasurementPoint[],
  localDate: string,
): number | null {
  const analysis = analyzeBody({
    measurements: points,
    todayLocalDate: localDate,
    goal: null,
  });
  return analysis.weight.latestEmaKg ?? analysis.weight.latestKg ?? null;
}

function parseType(value: string): GoalType | null {
  const parsed = GoalType.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Último día de un ciclo: el guardado, o —para los cerrados antes de que
 * existiera la columna— el día anterior al inicio del siguiente.
 */
function endOf(
  goal: GoalRecord,
  next: GoalRecord | undefined,
  todayLocal: string,
): string {
  if (goal.status === "ACTIVE") return todayLocal;
  if (goal.endDate) return goal.endDate;
  if (next) {
    const end = addDays(next.startDate, -1);
    return diffDays(goal.startDate, end) < 0 ? goal.startDate : end;
  }
  return goal.startDate;
}

/** El ciclo inmediatamente anterior a `goal`, si empezó justo después de él. */
function contiguousPrevious(
  goals: readonly GoalRecord[],
  goal: GoalRecord,
  todayLocal: string,
): GoalRecord | null {
  const idx = goals.findIndex((g) => g.id === goal.id);
  if (idx <= 0) return null;
  const prev = goals[idx - 1];
  const prevEnd = endOf(prev, goal, todayLocal);
  return diffDays(prevEnd, goal.startDate) <=
    NUTRITION_CONFIG.regimeStart.contiguousCycleDays
    ? prev
    : null;
}

function priorFrom(record: EnergyEstimateRecord | null): PriorEstimate | null {
  if (
    !record ||
    record.memoryTdeeKcal === null ||
    record.memorySeKcal === null ||
    record.weightKg === null
  ) {
    return null;
  }
  return {
    tdeeKcal: record.memoryTdeeKcal,
    seKcal: record.memorySeKcal,
    localDate: record.localDate,
    weightKg: record.weightKg,
    fromDeficit: record.fromDeficit,
  };
}

interface DataSnapshot {
  ctx: ProfileContext;
  todayLocalDate: string;
  goals: GoalRecord[];
  active: GoalRecord | null;
  points: BodyMeasurementPoint[];
  intake: IntakeRecord[];
  targets: NutritionTargetFull[];
  priorRecord: EnergyEstimateRecord | null;
}

async function loadSnapshot(
  profileId: string,
  now: Date,
): Promise<DataSnapshot> {
  const todayLocalDate = today(now);
  const from = addDays(todayLocalDate, -LOOKBACK_DAYS);
  const [ctx, goals, records, intake, targets, priorRecord] = await Promise.all(
    [
      loadContext(profileId),
      listGoals(profileId),
      listMeasurements(profileId, from, todayLocalDate),
      listIntake(profileId, from, todayLocalDate),
      listAllTargets(profileId),
      findLatestCycleCloseEstimate(profileId),
    ],
  );
  return {
    ctx,
    todayLocalDate,
    goals,
    active: goals.filter((g) => g.status === "ACTIVE").at(-1) ?? null,
    points: toEnginePoints(records),
    intake,
    targets,
    priorRecord,
  };
}

/**
 * Mantenimiento estimado para un régimen concreto, con la memoria del último
 * ciclo cerrado como punto de partida.
 */
function maintenanceFor(
  snap: DataSnapshot,
  regimeStartLocalDate: string,
  currentIsDeficit: boolean,
  weightKg: number,
  overrides: { dailySteps?: number; workActivity?: WorkActivity } = {},
  prior: PriorEstimate | null = priorFrom(snap.priorRecord),
): MaintenanceEstimate {
  return estimateMaintenance({
    todayLocalDate: snap.todayLocalDate,
    regimeStartLocalDate,
    measurements: snap.points,
    intake: snap.intake,
    targets: snap.targets,
    formulaTdeeKcal: formulaTdee(
      snap.ctx,
      snap.todayLocalDate,
      weightKg,
      overrides,
    ),
    formulaTdeeAtPriorWeightKcal: prior
      ? formulaTdee(snap.ctx, snap.todayLocalDate, prior.weightKg, overrides)
      : null,
    prior,
    currentIsDeficit,
  });
}

/** Régimen del ciclo activo (o del hueco entre ciclos si no hay ninguno). */
function currentRegime(snap: DataSnapshot): {
  start: string;
  isDeficit: boolean;
} {
  if (snap.active) {
    const prev = contiguousPrevious(
      snap.goals,
      snap.active,
      snap.todayLocalDate,
    );
    const isDeficit = snap.active.type === "FAT_LOSS";
    return {
      start: regimeStartFor(
        snap.active.startDate,
        prev?.type === "FAT_LOSS",
        isDeficit,
      ),
      isDeficit,
    };
  }
  const last = snap.goals.at(-1);
  if (!last) return { start: snap.todayLocalDate, isDeficit: false };
  const end = endOf(last, undefined, snap.todayLocalDate);
  return {
    start: regimeStartFor(addDays(end, 1), last.type === "FAT_LOSS", false),
    isDeficit: false,
  };
}

function weightOrFallback(snap: DataSnapshot): number {
  return (
    currentWeight(snap.points, snap.todayLocalDate) ??
    snap.active?.startWeightKg ??
    snap.goals.at(-1)?.startWeightKg ??
    70
  );
}

// ── Lectura ─────────────────────────────────────────────────────────────────

export interface ActiveCycleView {
  goalId: string;
  strategy: GoalStrategy;
  goalType: GoalType;
  startDate: string;
  daysIn: number;
  /** Semana del ciclo (1 = la primera). */
  week: number;
  weeklyRatePct: number;
  targetWeightKg: number | null;
  startWeightKg: number;
}

export interface CycleOverview {
  todayLocalDate: string;
  active: ActiveCycleView | null;
  lastClosed: {
    goalId: string;
    strategy: GoalStrategy;
    status: GoalStatus;
    endDate: string;
  } | null;
  target: NutritionTargetFull | null;
  maintenance: MaintenanceEstimate;
  intake: {
    today: IntakeRecord | null;
    last14: {
      days: number;
      meanKcal: number | null;
      meanProteinG: number | null;
    };
  };
  composition: CompositionAdvisory | null;
  bodyFatCeilingPct: number | null;
  cyclesCount: number;
}

function toActiveView(
  goal: GoalRecord,
  todayLocal: string,
): ActiveCycleView | null {
  const strategy = GoalStrategy.safeParse(goal.strategy);
  const type = parseType(goal.type);
  if (!strategy.success || type === null) return null;
  const daysIn = Math.max(diffDays(goal.startDate, todayLocal), 0);
  return {
    goalId: goal.id,
    strategy: strategy.data,
    goalType: type,
    startDate: goal.startDate,
    daysIn,
    week: Math.floor(daysIn / 7) + 1,
    weeklyRatePct: goal.weeklyRatePct,
    targetWeightKg: goal.targetWeightKg,
    startWeightKg: goal.startWeightKg,
  };
}

/**
 * El estado del ciclo para "Hoy" y "Progreso". Leer no escribe nada.
 *
 * `adjustment` y `performanceTrend` son opcionales y solo sirven para el
 * aviso de composición de una fase de ganancia; quien ya los tiene (la
 * pantalla de progreso) los pasa para no recalcularlos.
 */
export async function getCycleOverview(
  profileId: string,
  now: Date = new Date(),
  deps: {
    adjustment?: CalorieAdjustment | null;
    performanceTrend?: PerformanceTrend | null;
  } = {},
): Promise<CycleOverview> {
  const snap = await loadSnapshot(profileId, now);
  const regime = currentRegime(snap);
  const weightKg = weightOrFallback(snap);
  const maintenance = maintenanceFor(
    snap,
    regime.start,
    regime.isDeficit,
    weightKg,
  );
  const ceiling = await getBodyFatCeiling(profileId);

  const last14From = addDays(snap.todayLocalDate, -13);
  const last14 = snap.intake.filter((d) => d.localDate >= last14From);
  const proteinDays = last14.filter((d) => d.proteinG !== null);
  const closed = snap.goals.filter((g) => g.status !== "ACTIVE");
  const lastClosedRow = closed.at(-1);
  const lastClosedStrategy = lastClosedRow
    ? GoalStrategy.safeParse(lastClosedRow.strategy)
    : null;
  const lastClosedStatus = lastClosedRow
    ? GoalStatus.safeParse(lastClosedRow.status)
    : null;

  const active = snap.active
    ? toActiveView(snap.active, snap.todayLocalDate)
    : null;
  const composition =
    active && active.goalType === "LEAN_GAIN"
      ? assessComposition({
          goalType: active.goalType,
          todayLocalDate: snap.todayLocalDate,
          cycleStartLocalDate: active.startDate,
          measurements: snap.points,
          pace: deps.adjustment?.policy === "GAIN" ? deps.adjustment.now : null,
          performanceTrend: deps.performanceTrend ?? null,
          bodyFatCeilingPct: ceiling,
          startWeightKg: active.startWeightKg,
        })
      : null;

  return {
    todayLocalDate: snap.todayLocalDate,
    active,
    lastClosed:
      lastClosedRow && lastClosedStrategy?.success && lastClosedStatus?.success
        ? {
            goalId: lastClosedRow.id,
            strategy: lastClosedStrategy.data,
            status: lastClosedStatus.data,
            endDate: endOf(
              lastClosedRow,
              snap.goals[snap.goals.indexOf(lastClosedRow) + 1],
              snap.todayLocalDate,
            ),
          }
        : null,
    target:
      snap.targets
        .filter((t) => t.effectiveFrom <= snap.todayLocalDate)
        .at(-1) ?? null,
    maintenance,
    intake: {
      today:
        snap.intake.find((d) => d.localDate === snap.todayLocalDate) ?? null,
      last14: {
        days: last14.length,
        meanKcal: last14.length
          ? last14.reduce((a, d) => a + d.kcal, 0) / last14.length
          : null,
        meanProteinG: proteinDays.length
          ? proteinDays.reduce((a, d) => a + (d.proteinG ?? 0), 0) /
            proteinDays.length
          : null,
      },
    },
    composition,
    bodyFatCeilingPct: ceiling,
    cyclesCount: snap.goals.length,
  };
}

/** Resumen de un ciclo con los datos crudos (para cerrar, o para los antiguos). */
async function buildSummary(
  profileId: string,
  snap: DataSnapshot,
  goal: GoalRecord,
  endLocalDate: string,
  maintenance: MaintenanceEstimate | null,
): Promise<CycleSummary | null> {
  const strategy = GoalStrategy.safeParse(goal.strategy);
  const type = parseType(goal.type);
  const status = GoalStatus.safeParse(goal.status);
  if (!strategy.success || type === null || !status.success) return null;
  const [perf, equipmentChanges] = await Promise.all([
    listPerformancePoints(profileId, goal.startDate, endLocalDate),
    listEquipmentChangePoints(profileId),
  ]);
  return summarizeCycle({
    goal: {
      strategy: strategy.data,
      type,
      status: status.data,
      startDate: goal.startDate,
      weeklyRatePct: goal.weeklyRatePct,
      startWeightKg: goal.startWeightKg,
      targetWeightKg: goal.targetWeightKg,
    },
    endLocalDate,
    measurements: snap.points,
    targets: snap.targets,
    intake: snap.intake,
    performance: summarizePerformance(
      perf,
      goal.startDate,
      endLocalDate,
      undefined,
      equipmentChanges,
    ),
    maintenance,
  });
}

export interface ClosePreview {
  todayLocalDate: string;
  goalId: string;
  summary: CycleSummary;
  /** Mantenimiento estimado al cerrar (lo que se congelará). */
  maintenance: MaintenanceEstimate;
  /** Lo que quedaría si eliges "mantenimiento mientras decides". */
  interim: { kcal: number; proteinG: number; fatG: number; carbsG: number };
  currentKcal: number | null;
}

function interimTargets(
  snap: DataSnapshot,
  maintenance: MaintenanceEstimate,
  weightKg: number,
) {
  const macros = computeMacros({
    kcalTarget: maintenance.tdeeKcal,
    weightKg,
    goalType: "MAINTENANCE",
    sex: snap.ctx.sex,
  });
  return {
    kcal: maintenance.tdeeKcal,
    proteinG: macros.proteinG,
    fatG: macros.fatG,
    carbsG: macros.carbsG,
  };
}

/** Lo que verá la persona al pulsar "Finalizar ciclo". `null` sin ciclo activo. */
export async function getClosePreview(
  profileId: string,
  now: Date = new Date(),
): Promise<ClosePreview | null> {
  const snap = await loadSnapshot(profileId, now);
  if (!snap.active) return null;
  const regime = currentRegime(snap);
  const weightKg = weightOrFallback(snap);
  const maintenance = maintenanceFor(
    snap,
    regime.start,
    regime.isDeficit,
    weightKg,
  );
  const summary = await buildSummary(
    profileId,
    snap,
    snap.active,
    snap.todayLocalDate,
    maintenance,
  );
  if (!summary) return null;
  return {
    todayLocalDate: snap.todayLocalDate,
    goalId: snap.active.id,
    summary,
    maintenance,
    interim: interimTargets(snap, maintenance, weightKg),
    currentKcal: snap.targets.at(-1)?.kcal ?? null,
  };
}

export interface CyclePlanPreview {
  todayLocalDate: string;
  plan: CyclePlan;
  /** Mantenimiento con el que se planifica (memoria + fórmula con tus datos de hoy). */
  maintenance: MaintenanceEstimate;
  /** Mantenimiento estimado del ciclo que se cierra, si lo hay (se congela al confirmar). */
  closingMaintenance: MaintenanceEstimate | null;
  volumeNote: string | null;
  previousGoalType: GoalType | null;
  weightKg: number;
  activeGoalId: string | null;
}

interface PlanComputation extends CyclePlanPreview {
  snap: DataSnapshot;
}

async function computePlan(
  profileId: string,
  request: CyclePlanRequest,
  now: Date,
): Promise<PlanComputation> {
  const snap = await loadSnapshot(profileId, now);
  const weightKg = request.weightKg ?? weightOrFallback(snap);
  const overrides = {
    dailySteps: request.dailySteps,
    workActivity: request.workActivity,
  };
  const nextType = STRATEGY_TO_GOAL_TYPE[request.strategy];

  let closingMaintenance: MaintenanceEstimate | null = null;
  let prior = priorFrom(snap.priorRecord);
  let previousGoalType: GoalType | null = null;
  if (snap.active) {
    // El ciclo que se cierra deja su memoria, y esa memoria es el punto de
    // partida del siguiente.
    const regime = currentRegime(snap);
    closingMaintenance = maintenanceFor(
      snap,
      regime.start,
      regime.isDeficit,
      weightKg,
    );
    previousGoalType = parseType(snap.active.type);
    prior = closingMaintenance.memory
      ? {
          tdeeKcal: closingMaintenance.memory.tdeeKcal,
          seKcal: closingMaintenance.memory.seKcal,
          localDate: snap.todayLocalDate,
          weightKg,
          fromDeficit: regime.isDeficit,
        }
      : prior;
  } else {
    const last = snap.goals.at(-1);
    previousGoalType = last ? parseType(last.type) : null;
    // Entre ciclos: lo observado en el hueco (si lo hay) entra como memoria.
    const regime = currentRegime(snap);
    const gap = maintenanceFor(snap, regime.start, false, weightKg);
    if (gap.observed && gap.memory) {
      prior = {
        tdeeKcal: gap.memory.tdeeKcal,
        seKcal: gap.memory.seKcal,
        localDate: snap.todayLocalDate,
        weightKg,
        fromDeficit: false,
      };
    }
  }

  // Al empezar, el régimen nuevo aún no tiene datos: manda la memoria, y la
  // fórmula (con tus pasos y actividad de hoy) entra una sola vez.
  const maintenance = maintenanceFor(
    snap,
    regimeStartFor(
      snap.todayLocalDate,
      previousGoalType === "FAT_LOSS",
      nextType === "FAT_LOSS",
    ),
    nextType === "FAT_LOSS",
    weightKg,
    overrides,
    prior,
  );
  const latestFat = [...snap.points]
    .reverse()
    .find((p) => p.bodyFatPct !== null);
  const plan = planCycleTargets({
    strategy: request.strategy,
    weeklyRatePct: request.weeklyRatePct,
    sex: snap.ctx.sex,
    ageYears: ageInYears(snap.ctx.birthDate, snap.todayLocalDate),
    heightCm: snap.ctx.heightCm,
    weightKg,
    bodyFatPct: latestFat?.bodyFatPct ?? undefined,
    bodyFatMeasured: latestFat?.bodyFatReliability === "MEASURED",
    targetWeightKg: request.targetWeightKg ?? undefined,
    maintenance,
    previousGoalType,
    currentKcal: snap.targets.at(-1)?.kcal ?? null,
  });

  return {
    snap,
    todayLocalDate: snap.todayLocalDate,
    plan,
    maintenance,
    closingMaintenance,
    volumeNote: trainingVolumeNote(previousGoalType, nextType),
    previousGoalType,
    weightKg,
    activeGoalId: snap.active?.id ?? null,
  };
}

/** Plan de un ciclo nuevo, sin guardar nada. */
export async function previewCyclePlan(
  profileId: string,
  request: CyclePlanRequest,
  now: Date = new Date(),
): Promise<CyclePlanPreview> {
  const c = await computePlan(profileId, request, now);
  return {
    todayLocalDate: c.todayLocalDate,
    plan: c.plan,
    maintenance: c.maintenance,
    closingMaintenance: c.closingMaintenance,
    volumeNote: c.volumeNote,
    previousGoalType: c.previousGoalType,
    weightKg: c.weightKg,
    activeGoalId: c.activeGoalId,
  };
}

/** Valores por defecto del formulario de ciclo nuevo. */
export async function getCycleFormDefaults(
  profileId: string,
  now: Date = new Date(),
) {
  const snap = await loadSnapshot(profileId, now);
  const ceiling = await getBodyFatCeiling(profileId);
  const latest = [...snap.points].reverse();
  return {
    todayLocalDate: snap.todayLocalDate,
    activeGoalId: snap.active?.id ?? null,
    activeStrategy: snap.active
      ? (GoalStrategy.safeParse(snap.active.strategy).data ?? null)
      : null,
    weightKg: currentWeight(snap.points, snap.todayLocalDate),
    lastWeighLocalDate:
      latest.find((p) => p.weightKg !== null)?.localDate ?? null,
    waistCm: latest.find((p) => p.waistCm !== null)?.waistCm ?? null,
    dailySteps: snap.ctx.dailySteps,
    workActivity: snap.ctx.workActivity,
    bodyFatCeilingPct: ceiling,
    heightCm: snap.ctx.heightCm,
  };
}

// ── Escritura ───────────────────────────────────────────────────────────────

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function estimateRow(
  profileId: string,
  goalId: string | null,
  localDate: string,
  kind: "CYCLE_CLOSE" | "CYCLE_START" | "ADJUSTMENT",
  m: MaintenanceEstimate,
  weightKg: number,
  fromDeficit: boolean,
): Prisma.EnergyEstimateUncheckedCreateInput {
  return {
    profileId,
    goalId,
    localDate,
    kind,
    tdeeKcal: m.tdeeKcal,
    lowKcal: m.lowKcal,
    highKcal: m.highKcal,
    seKcal: m.seKcal,
    confidence: m.confidence,
    basis: m.basis,
    observedTdeeKcal: m.observed ? Math.round(m.observed.tdeeKcal) : null,
    memoryTdeeKcal: m.memory?.tdeeKcal ?? null,
    memorySeKcal: m.memory?.seKcal ?? null,
    intakeSource: m.observed?.intakeSource ?? null,
    weightKg,
    fromDeficit,
    engineVersion: m.engineVersion,
    detail: toJson(m),
  };
}

/** Escribe un objetivo calórico aceptado con su decisión y recomendación (1:1). */
async function writeAcceptedTargets(
  tx: Prisma.TransactionClient,
  args: {
    profileId: string;
    goalId: string | null;
    localDate: string;
    now: Date;
    ruleId: string;
    title: string;
    body: string;
    inputSnapshot: unknown;
    output: unknown;
    target: { kcal: number; proteinG: number; fatG: number; carbsG: number };
  },
) {
  const decision = await tx.algorithmDecision.create({
    data: {
      engine: "nutrition",
      algorithmVersion: `${CYCLE_PLAN_VERSION}+${ENERGY_BALANCE_VERSION}`,
      ruleId: args.ruleId,
      inputSnapshot: toJson(args.inputSnapshot),
      output: toJson(args.output),
      explanation: args.body,
      evaluationDate: args.localDate,
    },
  });
  const recommendation = await tx.recommendation.create({
    data: {
      profileId: args.profileId,
      decisionId: decision.id,
      type: "CYCLE_TARGETS",
      scope: "NUTRITION",
      scopeId: args.goalId,
      priority: "MEDIUM",
      status: "ACCEPTED",
      title: args.title,
      body: args.body,
      payload: toJson(args.target),
      appliesToLocalDate: args.localDate,
      resolvedAt: args.now,
    },
  });
  const fields = {
    ...args.target,
    source: "CYCLE_START",
    recommendationId: recommendation.id,
    notes: args.body,
  };
  await tx.nutritionTarget.upsert({
    where: {
      profileId_effectiveFrom: {
        profileId: args.profileId,
        effectiveFrom: args.localDate,
      },
    },
    create: {
      profileId: args.profileId,
      effectiveFrom: args.localDate,
      ...fields,
    },
    update: fields,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export interface CloseResult {
  goalId: string;
  alreadyClosed: boolean;
  summary: CycleSummary | null;
}

/**
 * Cierra el ciclo activo SIN empezar otro. Idempotente: cerrar dos veces el
 * mismo ciclo devuelve lo que ya había.
 *
 * Deja un estado coherente y seguro: sin ciclo activo, el ajuste calórico no
 * propone nada, el volumen de entrenamiento usa el listón de mantenimiento y
 * las calorías son las que la persona eligió en este mismo paso (mantenimiento
 * estimado, o las que tenía).
 */
export async function closeCycle(
  profileId: string,
  data: CycleCloseData,
  now: Date = new Date(),
): Promise<CloseResult> {
  const goal = await findGoalOwnedBy(profileId, data.goalId);
  if (!goal) throw new CycleNotFoundError();
  if (goal.status !== "ACTIVE") {
    return { goalId: goal.id, alreadyClosed: true, summary: null };
  }

  const snap = await loadSnapshot(profileId, now);
  const regime = currentRegime(snap);
  const weightKg = weightOrFallback(snap);
  const maintenance = maintenanceFor(
    snap,
    regime.start,
    regime.isDeficit,
    weightKg,
  );
  const summary = await buildSummary(
    profileId,
    snap,
    goal,
    snap.todayLocalDate,
    maintenance,
  );
  const interim =
    data.interimNutrition === "MAINTENANCE"
      ? interimTargets(snap, maintenance, weightKg)
      : null;
  if (
    interim &&
    data.expectedKcal !== null &&
    interim.kcal !== data.expectedKcal
  ) {
    throw new StalePlanError({ kcal: interim.kcal });
  }

  await prisma.$transaction(async (tx) => {
    // Compare-and-set: solo se cierra si SIGUE activo. Otro dispositivo pudo
    // cerrarlo entre la lectura y aquí.
    const closed = await tx.goal.updateMany({
      where: { id: goal.id, profileId, status: "ACTIVE" },
      data: {
        status: data.outcome,
        endDate: snap.todayLocalDate,
        closedAt: now,
        closingSummary: toJson(summary),
      },
    });
    if (closed.count === 0) throw new StaleCycleError();
    await tx.energyEstimate.create({
      data: estimateRow(
        profileId,
        goal.id,
        snap.todayLocalDate,
        "CYCLE_CLOSE",
        maintenance,
        weightKg,
        regime.isDeficit,
      ),
    });
    if (interim) {
      await writeAcceptedTargets(tx, {
        profileId,
        goalId: null,
        localDate: snap.todayLocalDate,
        now,
        ruleId: "CYCLE_CLOSE_INTERIM_MAINTENANCE",
        title: `Mantenimiento mientras decides: ${interim.kcal.toLocaleString("es-ES")} kcal`,
        body: maintenance.explanation,
        inputSnapshot: { closedGoalId: goal.id, maintenance },
        output: interim,
        target: interim,
      });
    }
  });

  return { goalId: goal.id, alreadyClosed: false, summary };
}

export interface StartResult {
  goalId: string;
  duplicate: boolean;
  plan: CyclePlan | null;
}

/**
 * Empieza un ciclo nuevo —cerrando el activo, si lo hay— en UNA transacción.
 *
 * Guardas, en orden:
 *   1. Idempotencia: si este `requestId` ya abrió un ciclo, se devuelve ese.
 *   2. El ciclo activo tiene que ser el que la persona vio al empezar el flujo.
 *   3. El plan se recalcula en el servidor y tiene que coincidir con el que vio.
 *   4. El índice parcial de la base impide, pase lo que pase, dos activos.
 *
 * No toca el programa de entrenamiento ni el historial: el programa sigue, las
 * marcas y la progresión por variante siguen, y el ciclo anterior queda
 * cerrado con su resumen congelado.
 */
export async function startCycle(
  profileId: string,
  data: CycleStartData,
  now: Date = new Date(),
): Promise<StartResult> {
  const duplicate = await findGoalByOpenRequest(profileId, data.requestId);
  if (duplicate) return { goalId: duplicate.id, duplicate: true, plan: null };

  const computed = await computePlan(profileId, data, now);
  const { snap, plan, maintenance, closingMaintenance, weightKg } = computed;
  const active = snap.active;
  if ((active?.id ?? null) !== data.expectedActiveGoalId)
    throw new StaleCycleError();
  if (active && data.closeOutcome === null)
    throw new CloseOutcomeRequiredError();
  if (plan.kcal !== data.expectedKcal)
    throw new StalePlanError({ kcal: plan.kcal });

  const todayLocal = snap.todayLocalDate;
  const closingEnd = active
    ? diffDays(active.startDate, addDays(todayLocal, -1)) < 0
      ? active.startDate
      : addDays(todayLocal, -1)
    : null;
  const closingSummary =
    active && closingEnd
      ? await buildSummary(
          profileId,
          snap,
          active,
          closingEnd,
          closingMaintenance,
        )
      : null;
  const closingIsDeficit = active?.type === "FAT_LOSS";
  const nextType = STRATEGY_TO_GOAL_TYPE[data.strategy];

  try {
    const goalId = await prisma.$transaction(async (tx) => {
      if (active && closingEnd) {
        const closed = await tx.goal.updateMany({
          where: { id: active.id, profileId, status: "ACTIVE" },
          data: {
            status: data.closeOutcome as CycleOutcome,
            endDate: closingEnd,
            closedAt: now,
            closingSummary: toJson(closingSummary),
          },
        });
        if (closed.count === 0) throw new StaleCycleError();
        if (closingMaintenance) {
          await tx.energyEstimate.create({
            data: estimateRow(
              profileId,
              active.id,
              closingEnd,
              "CYCLE_CLOSE",
              closingMaintenance,
              weightKg,
              closingIsDeficit,
            ),
          });
        }
      }

      // Datos físicos confirmados o corregidos en el propio flujo.
      await tx.userProfile.update({
        where: { id: profileId },
        data: { dailySteps: data.dailySteps, workActivity: data.workActivity },
      });
      if (data.weightKg !== null || data.waistCm !== null) {
        const fields = {
          ...(data.weightKg !== null ? { weightKg: data.weightKg } : {}),
          // Cintura anotada en este paso: una toma, protocolo desconocido.
          ...(data.waistCm !== null
            ? { waistCm: data.waistCm, waistProtocol: null }
            : {}),
        };
        await tx.bodyMeasurement.upsert({
          where: { profileId_localDate: { profileId, localDate: todayLocal } },
          create: { profileId, localDate: todayLocal, ...fields },
          update: fields,
        });
      }
      if (data.bodyFatCeilingPct === null) {
        await tx.userPreference.deleteMany({
          where: { profileId, key: BODY_FAT_CEILING_KEY },
        });
      } else {
        await tx.userPreference.upsert({
          where: { profileId_key: { profileId, key: BODY_FAT_CEILING_KEY } },
          create: {
            profileId,
            key: BODY_FAT_CEILING_KEY,
            value: data.bodyFatCeilingPct,
          },
          update: { value: data.bodyFatCeilingPct },
        });
      }

      const goal = await tx.goal.create({
        data: {
          profileId,
          strategy: data.strategy,
          type: nextType,
          status: "ACTIVE",
          startDate: todayLocal,
          startWeightKg: weightKg,
          weeklyRatePct: plan.weeklyRatePct,
          targetWeightKg: data.targetWeightKg,
          openRequestId: data.requestId,
        },
        select: { id: true },
      });

      await writeAcceptedTargets(tx, {
        profileId,
        goalId: goal.id,
        localDate: todayLocal,
        now,
        ruleId: active ? "CYCLE_TRANSITION" : "CYCLE_START",
        title: `Nuevo ciclo: ${plan.kcal.toLocaleString("es-ES")} kcal`,
        body: `${plan.explanation.kcal} ${plan.explanation.macros}`,
        inputSnapshot: {
          request: data,
          maintenance,
          closingGoalId: active?.id ?? null,
        },
        output: plan,
        target: {
          kcal: plan.kcal,
          proteinG: plan.proteinG,
          fatG: plan.fatG,
          carbsG: plan.carbsG,
        },
      });
      await tx.energyEstimate.create({
        data: estimateRow(
          profileId,
          goal.id,
          todayLocal,
          "CYCLE_START",
          maintenance,
          weightKg,
          nextType === "FAT_LOSS",
        ),
      });
      return goal.id;
    });
    return { goalId, duplicate: false, plan };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Dos envíos simultáneos: o el mismo `requestId` (idempotencia), o un
      // segundo ciclo activo que el índice parcial ha rechazado.
      const dup = await findGoalByOpenRequest(profileId, data.requestId);
      if (dup) return { goalId: dup.id, duplicate: true, plan: null };
      throw new StaleCycleError();
    }
    throw error;
  }
}

// ── Historial ───────────────────────────────────────────────────────────────

export interface CycleHistoryItem {
  goalId: string;
  strategy: GoalStrategy | null;
  status: string;
  startDate: string;
  endDate: string;
  active: boolean;
  /** `true` si el resumen se ha calculado ahora (ciclo activo o anterior a esta versión). */
  computedNow: boolean;
  summary: CycleSummary | null;
}

export interface CycleHistory {
  todayLocalDate: string;
  items: CycleHistoryItem[];
  estimates: EnergyEstimateRecord[];
}

/** Todos los ciclos, del más reciente al más antiguo, con su resumen. */
export async function getCycleHistory(
  profileId: string,
  now: Date = new Date(),
): Promise<CycleHistory> {
  const snap = await loadSnapshot(profileId, now);
  const estimates = await listEnergyEstimates(profileId);
  const items: CycleHistoryItem[] = [];
  for (let i = 0; i < snap.goals.length; i++) {
    const goal = snap.goals[i];
    const next = snap.goals[i + 1];
    const end = endOf(goal, next, snap.todayLocalDate);
    const frozen =
      goal.status !== "ACTIVE" && goal.closingSummary
        ? (goal.closingSummary as unknown as CycleSummary)
        : null;
    const summary =
      frozen ?? (await buildSummary(profileId, snap, goal, end, null));
    const strategy = GoalStrategy.safeParse(goal.strategy);
    items.push({
      goalId: goal.id,
      strategy: strategy.success ? strategy.data : null,
      status: goal.status,
      startDate: goal.startDate,
      endDate: end,
      active: goal.status === "ACTIVE",
      computedNow: frozen === null,
      summary,
    });
  }
  return {
    todayLocalDate: snap.todayLocalDate,
    items: items.reverse(),
    estimates,
  };
}

/**
 * Mantenimiento estimado del régimen actual. Lo usa el ajuste calórico para
 * congelar la estimación cuando la persona responde a una sugerencia.
 */
export async function getCurrentMaintenance(
  profileId: string,
  now: Date = new Date(),
): Promise<{
  maintenance: MaintenanceEstimate;
  weightKg: number;
  isDeficit: boolean;
  goalId: string | null;
}> {
  const snap = await loadSnapshot(profileId, now);
  const regime = currentRegime(snap);
  const weightKg = weightOrFallback(snap);
  return {
    maintenance: maintenanceFor(snap, regime.start, regime.isDeficit, weightKg),
    weightKg,
    isDeficit: regime.isDeficit,
    goalId: snap.active?.id ?? null,
  };
}

export { estimateRow as energyEstimateRow };
