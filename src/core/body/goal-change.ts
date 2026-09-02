import type { GoalStrategy } from "@/core/enums";

/**
 * ¿Corregir el objetivo actual o empezar una fase nueva?
 *
 * La distinción no es cosmética: `Goal.startDate` es lo que acota la tendencia
 * corporal (`analysisStartLocalDate`), así que abrir una fase nueva REINICIA lo
 * que el motor considera "ahora". Hacerlo cuando no toca tira semanas de datos
 * válidos; no hacerlo cuando sí toca hace que la tendencia de la definición
 * contamine la evaluación del volumen.
 *
 * LA REGLA, en una frase: cambia la ESTRATEGIA → fase nueva; cambia cualquier
 * otra cosa → se corrige en sitio.
 *
 * Por qué la estrategia y no el ritmo: en esta app la dirección del peso está
 * determinada por la estrategia y solo por ella (`NUTRITION_CONFIG.weeklyRatePct`
 * acota FAT_LOSS a valores negativos, LEAN_GAIN a positivos, y RECOMP y
 * MAINTENANCE a cero). Pasar de −0,5 a −0,75 %/semana es la misma fase yendo
 * algo más rápido: el historial sigue describiendo lo mismo y solo se mueve el
 * listón contra el que se compara. Pasar de FAT_LOSS a LEAN_GAIN invierte la
 * dirección, y los kilos que bajaste el mes pasado no dicen nada sobre cómo va
 * el volumen que empieza hoy.
 *
 * Función pura y sin fechas: quién es "hoy" lo decide el servicio.
 */

export interface GoalSnapshot {
  strategy: GoalStrategy;
  weeklyRatePct: number;
  targetWeightKg: number | null;
}

export type GoalChangeKind =
  /** Nada que hacer: los tres campos coinciden. */
  | "NO_CHANGE"
  /** Se corrige la fila activa. `startDate` NO se toca. */
  | "EDIT_IN_PLACE"
  /** Se cierra la fila activa y se abre otra con `startDate` de hoy. */
  | "NEW_PHASE";

export function classifyGoalChange(
  current: GoalSnapshot,
  next: GoalSnapshot,
): GoalChangeKind {
  if (current.strategy !== next.strategy) return "NEW_PHASE";

  const mismoRitmo = current.weeklyRatePct === next.weeklyRatePct;
  const mismoObjetivo = current.targetWeightKg === next.targetWeightKg;
  if (mismoRitmo && mismoObjetivo) return "NO_CHANGE";

  return "EDIT_IN_PLACE";
}

/** ¿Este cambio reinicia la ventana de análisis corporal? */
export function resetsTrend(kind: GoalChangeKind): boolean {
  return kind === "NEW_PHASE";
}
