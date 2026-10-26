import type { BodyConfidence } from "@/core/body";
import type { GoalStatus, GoalStrategy } from "@/core/enums";
import type { MaintenanceBasis } from "@/core/nutrition/energy-balance";

/**
 * Vocabulario de los ciclos para la interfaz. Mismo criterio que
 * `body-labels.ts`: aquí se decide qué se AFIRMA, y por eso vive aparte y con
 * tests. Nada de verde/rojo: terminar un ciclo "sin completar" no es un fallo,
 * es una decisión.
 */

/** Nombre corto del ciclo, el que se lee en grande. */
export const CYCLE_NAME: Record<GoalStrategy, string> = {
  FAT_LOSS_MUSCLE_PRESERVATION: "Definición",
  RECOMP_MAINTAIN_WEIGHT: "Recomposición",
  LEAN_GAIN: "Volumen limpio",
  MAINTENANCE: "Mantenimiento",
};

/** Una línea que dice para qué sirve cada fase (selector de ciclo nuevo). */
export const CYCLE_PURPOSE: Record<GoalStrategy, string> = {
  FAT_LOSS_MUSCLE_PRESERVATION: "Perder grasa despacio conservando el músculo.",
  RECOMP_MAINTAIN_WEIGHT:
    "Peso estable mientras ganas músculo y pierdes algo de grasa.",
  LEAN_GAIN:
    "Ganar músculo muy despacio, minimizando la grasa. Sin fecha de fin.",
  MAINTENANCE: "Consolidar tu estado actual. Ideal entre fases.",
};

/** Orden en el selector: de lo que más se usa tras una definición a lo menos. */
export const CYCLE_ORDER: readonly GoalStrategy[] = [
  "LEAN_GAIN",
  "MAINTENANCE",
  "RECOMP_MAINTAIN_WEIGHT",
  "FAT_LOSS_MUSCLE_PRESERVATION",
];

export const CYCLE_STATUS_LABEL: Record<GoalStatus, string> = {
  ACTIVE: "En curso",
  COMPLETED: "Completado",
  ABANDONED: "Sin completar",
  SUPERSEDED: "Cambio de fase",
};

export function cycleName(strategy: GoalStrategy | null): string {
  return strategy === null ? "Ciclo" : CYCLE_NAME[strategy];
}

export function cycleStatusLabel(status: string): string {
  return status in CYCLE_STATUS_LABEL
    ? CYCLE_STATUS_LABEL[status as GoalStatus]
    : status;
}

/** De dónde sale el mantenimiento, en palabras. */
export const MAINTENANCE_BASIS_LABEL: Record<MaintenanceBasis, string> = {
  OBSERVED: "calculado con tus datos",
  PRIOR: "basado en tu ciclo anterior",
  FORMULA: "estimado por fórmula",
};

export const CONFIDENCE_LABEL: Record<BodyConfidence, string> = {
  LOW: "Confianza baja",
  MEDIUM: "Confianza media",
  HIGH: "Confianza alta",
};

/** kcal con separador de miles es-ES: `2.150`. */
export function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("es-ES");
}

/**
 * Ritmo en % del peso por semana, con signo: `+0,15 %` · `−0,5 %` · `0 %`.
 * Usa el menos tipográfico como el resto de la app.
 */
export function formatRatePct(value: number): string {
  if (value === 0) return "0 %";
  const abs = Math.abs(value).toLocaleString("es-ES", {
    maximumFractionDigits: 2,
  });
  return `${value > 0 ? "+" : "−"}${abs} %`;
}

/** Duración en semanas y días: "17 semanas" · "3 semanas y 2 días" · "5 días". */
export function formatDuration(days: number): string {
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  const w = weeks === 1 ? "1 semana" : `${weeks} semanas`;
  const d = rest === 1 ? "1 día" : `${rest} días`;
  if (weeks === 0) return d;
  return rest === 0 ? w : `${w} y ${d}`;
}

/** Ritmo objetivo en palabras, sin cifras inventadas para fases de peso estable. */
export function rateText(
  strategy: GoalStrategy,
  weeklyRatePct: number,
): string {
  if (weeklyRatePct === 0) {
    return strategy === "RECOMP_MAINTAIN_WEIGHT"
      ? "Peso estable (lo que cuenta es la cintura y el rendimiento)"
      : "Mantener el peso (±1 %)";
  }
  return `${formatRatePct(weeklyRatePct)} de tu peso por semana`;
}
