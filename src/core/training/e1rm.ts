/**
 * Estimación de 1RM (Epley con reps efectivas). SIEMPRE una estimación:
 * válida solo con pocas reps (reps + RIR ≤ 12). Fuera de ese rango devuelve
 * null (no se estima para rangos altos). docs/TRAINING_ENGINE.md §2.
 */
export function estimateOneRepMax(
  weightKg: number,
  reps: number,
  rir: number | null | undefined,
): number | null {
  if (weightKg <= 0 || reps <= 0) return null;
  const effectiveReps = reps + Math.min(rir ?? 0, 4);
  if (effectiveReps > 12) return null;
  const e1rm = weightKg * (1 + effectiveReps / 30);
  return Math.round(e1rm * 10) / 10;
}
