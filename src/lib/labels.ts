import { GoalType, WorkActivity } from "@/core/enums";

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
