import { GoalStrategy, GoalType, WorkActivity } from "@/core/enums";

/**
 * Etiquetas es-ES de valores de enum para presentación. Fuente única para
 * evitar que la misma cadena viva duplicada en varias pantallas.
 */

export const GOAL_LABELS: Record<GoalType, string> = {
  FAT_LOSS: "Perder grasa",
  RECOMP: "Recomposición",
  LEAN_GAIN: "Ganancia controlada",
  MAINTENANCE: "Mantenimiento",
};

/** Etiqueta corta de la estrategia elegida (para tarjetas y resúmenes). */
export const STRATEGY_LABELS: Record<GoalStrategy, string> = {
  FAT_LOSS_MUSCLE_PRESERVATION: "Perder grasa manteniendo músculo",
  RECOMP_MAINTAIN_WEIGHT: "Recomponer con peso estable",
  LEAN_GAIN: "Ganancia muscular controlada",
  MAINTENANCE: "Mantenimiento",
};

/** Descripción larga de cada estrategia (para el paso de objetivo). */
export const STRATEGY_DESCRIPTIONS: Record<GoalStrategy, string> = {
  FAT_LOSS_MUSCLE_PRESERVATION:
    "Déficit gradual para bajar de peso conservando (o ganando) músculo.",
  RECOMP_MAINTAIN_WEIGHT:
    "Mantener aproximadamente el peso mientras ganas músculo y pierdes algo de grasa.",
  LEAN_GAIN: "Superávit pequeño para ganar músculo con la mínima grasa.",
  MAINTENANCE: "Consolidar tu estado actual sin cambios de peso.",
};

/** Etiqueta de estrategia tolerante a valores no reconocidos. */
export function strategyLabel(value: string | null | undefined): string {
  const parsed = GoalStrategy.safeParse(value);
  return parsed.success ? STRATEGY_LABELS[parsed.data] : (value ?? "—");
}

export const WORK_ACTIVITY_LABELS: Record<WorkActivity, string> = {
  SEDENTARY: "Sedentaria",
  LIGHT: "Ligera",
  MODERATE: "Moderada",
  HIGH: "Alta",
};

/** Etiqueta de objetivo tolerante a valores no reconocidos (columna String de Prisma). */
export function goalLabel(value: string | null | undefined): string {
  const parsed = GoalType.safeParse(value);
  return parsed.success ? GOAL_LABELS[parsed.data] : (value ?? "—");
}

/** Etiqueta de actividad laboral tolerante a valores no reconocidos. */
export function workActivityLabel(value: string | null | undefined): string {
  const parsed = WorkActivity.safeParse(value);
  return parsed.success ? WORK_ACTIVITY_LABELS[parsed.data] : "—";
}
