import { COMPOUND_PATTERNS, TARGET_RIR } from "@/core/config/training-config";

/**
 * RIR objetivo por defecto según el ROL del ejercicio, reutilizando la misma
 * lógica que el generador (F3.2): compuesto pesado 3 · compuesto 2 · aislamiento 1.
 * Puro y determinista. Se usa como default editable al añadir un ejercicio a un
 * programa manual (docs/PHASE_3_1_CUSTOM_PROGRAM_PLAN.md §4). El rango de reps y el
 * descanso por defecto salen directos de la variante del catálogo (no aquí).
 */
export function defaultTargetRir(
  movementPattern: string,
  systemicFatigue: number,
): number {
  if (!COMPOUND_PATTERNS.has(movementPattern)) return TARGET_RIR.isolation;
  return systemicFatigue >= 3 ? TARGET_RIR.compoundHeavy : TARGET_RIR.compound;
}
