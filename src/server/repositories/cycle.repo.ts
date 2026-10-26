import type { Prisma } from "@/generated/prisma/client";

import type { PerformanceSetPoint } from "@/core/cycles";
import { prisma } from "@/server/db";

/**
 * Lecturas de ciclos (filas de `Goal`), estimaciones congeladas y lo que hace
 * falta para resumir un ciclo. Las ESCRITURAS de una transición viven en el
 * servicio dentro de una única transacción: abrir y cerrar un ciclo no puede
 * quedarse a medias.
 */

export interface GoalRecord {
  id: string;
  strategy: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string | null;
  startWeightKg: number;
  weeklyRatePct: number;
  targetWeightKg: number | null;
  closingSummary: Prisma.JsonValue | null;
  openRequestId: string | null;
  createdAt: Date;
}

const GOAL_SELECT = {
  id: true,
  strategy: true,
  type: true,
  status: true,
  startDate: true,
  endDate: true,
  startWeightKg: true,
  weeklyRatePct: true,
  targetWeightKg: true,
  closingSummary: true,
  openRequestId: true,
  createdAt: true,
} as const;

/** Todos los ciclos del perfil, del más antiguo al más reciente. */
export async function listGoals(profileId: string): Promise<GoalRecord[]> {
  return prisma.goal.findMany({
    where: { profileId },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    select: GOAL_SELECT,
  });
}

/** Un ciclo de este perfil, o `null` si no existe o es de otra persona. */
export async function findGoalOwnedBy(
  profileId: string,
  goalId: string,
): Promise<GoalRecord | null> {
  return prisma.goal.findFirst({
    where: { id: goalId, profileId },
    select: GOAL_SELECT,
  });
}

export async function findGoalByOpenRequest(
  profileId: string,
  openRequestId: string,
): Promise<GoalRecord | null> {
  return prisma.goal.findFirst({
    where: { profileId, openRequestId },
    select: GOAL_SELECT,
  });
}

export interface NutritionTargetFull {
  effectiveFrom: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  source: string;
}

/** Historial completo de objetivos calóricos, del más antiguo al más reciente. */
export async function listAllTargets(
  profileId: string,
): Promise<NutritionTargetFull[]> {
  return prisma.nutritionTarget.findMany({
    where: { profileId },
    orderBy: { effectiveFrom: "asc" },
    select: {
      effectiveFrom: true,
      kcal: true,
      proteinG: true,
      fatG: true,
      carbsG: true,
      source: true,
    },
  });
}

export interface EnergyEstimateRecord {
  localDate: string;
  kind: string;
  goalId: string | null;
  tdeeKcal: number;
  lowKcal: number;
  highKcal: number;
  seKcal: number;
  confidence: string;
  basis: string;
  observedTdeeKcal: number | null;
  memoryTdeeKcal: number | null;
  memorySeKcal: number | null;
  intakeSource: string | null;
  weightKg: number | null;
  fromDeficit: boolean;
}

const ESTIMATE_SELECT = {
  localDate: true,
  kind: true,
  goalId: true,
  tdeeKcal: true,
  lowKcal: true,
  highKcal: true,
  seKcal: true,
  confidence: true,
  basis: true,
  observedTdeeKcal: true,
  memoryTdeeKcal: true,
  memorySeKcal: true,
  intakeSource: true,
  weightKg: true,
  fromDeficit: true,
} as const;

/** La última estimación congelada al CERRAR un ciclo que tenga memoria de datos. */
export async function findLatestCycleCloseEstimate(
  profileId: string,
): Promise<EnergyEstimateRecord | null> {
  return prisma.energyEstimate.findFirst({
    where: { profileId, kind: "CYCLE_CLOSE", memoryTdeeKcal: { not: null } },
    orderBy: [{ localDate: "desc" }, { createdAt: "desc" }],
    select: ESTIMATE_SELECT,
  });
}

/** Todas las estimaciones congeladas, para comparar su evolución. */
export async function listEnergyEstimates(
  profileId: string,
): Promise<EnergyEstimateRecord[]> {
  return prisma.energyEstimate.findMany({
    where: { profileId },
    orderBy: [{ localDate: "asc" }, { createdAt: "asc" }],
    select: ESTIMATE_SELECT,
  });
}

/**
 * Series de trabajo con e1RM de este perfil entre dos fechas, para la
 * evolución del rendimiento en el resumen. La propiedad se comprueba en la
 * misma consulta, recorriendo hasta `TrainingProgram.profileId`.
 */
export async function listPerformancePoints(
  profileId: string,
  fromLocalDate: string,
  toLocalDate: string,
): Promise<PerformanceSetPoint[]> {
  const rows = await prisma.setLog.findMany({
    where: {
      localDate: { gte: fromLocalDate, lte: toLocalDate },
      setType: "WORKING",
      completed: true,
      estimated1Rm: { not: null },
      workoutExercise: {
        session: { mesocycle: { program: { profileId } } },
      },
    },
    select: {
      localDate: true,
      estimated1Rm: true,
      exerciseVariantId: true,
      exerciseVariant: {
        select: { name: true, exercise: { select: { name: true } } },
      },
    },
  });
  return rows.map((r) => ({
    variantId: r.exerciseVariantId,
    exerciseName: r.exerciseVariant.exercise.name,
    variantName: r.exerciseVariant.name,
    localDate: r.localDate,
    e1rmKg: r.estimated1Rm!,
  }));
}

/** Preferencia "% graso máximo" (solo orienta el aviso de composición). */
export const BODY_FAT_CEILING_KEY = "body_fat_ceiling_pct";

export async function getBodyFatCeiling(
  profileId: string,
): Promise<number | null> {
  const row = await prisma.userPreference.findUnique({
    where: { profileId_key: { profileId, key: BODY_FAT_CEILING_KEY } },
    select: { value: true },
  });
  return typeof row?.value === "number" ? row.value : null;
}

/** Días/semana y minutos/sesión declarados (entran en la fórmula del gasto). */
export async function getTrainingLoadPreferences(
  profileId: string,
): Promise<{ daysPerWeek: number | null; minutesPerSession: number | null }> {
  const rows = await prisma.userPreference.findMany({
    where: {
      profileId,
      key: { in: ["days_per_week", "minutes_per_session"] },
    },
    select: { key: true, value: true },
  });
  const get = (key: string) => {
    const v = rows.find((r) => r.key === key)?.value;
    return typeof v === "number" ? v : null;
  };
  return {
    daysPerWeek: get("days_per_week"),
    minutesPerSession: get("minutes_per_session"),
  };
}
