/**
 * Estimación de 1RM (Epley con reps efectivas). SIEMPRE una estimación:
 * válida solo con pocas reps (reps + RIR ≤ 12). Fuera de ese rango devuelve
 * null (no se estima para rangos altos). docs/TRAINING_ENGINE.md §2.
 *
 * Sin RIR registrado NO se estima: `rir = null` significa "no lo sé", y
 * tratarlo como 0 equivaldría a suponer que la serie fue al fallo — el sesgo
 * más optimista posible, y justo la imputación que la Fase 3.2c elimina.
 * Los consumidores (`bestSet`, `currentE1rm`, `trend`) ya saben caer a
 * tonelaje cuando esto es `null`.
 */
export function estimateOneRepMax(
  weightKg: number,
  reps: number,
  rir: number | null | undefined,
): number | null {
  if (weightKg <= 0 || reps <= 0) return null;
  if (rir === null || rir === undefined) return null;
  const effectiveReps = reps + Math.min(rir, 4);
  if (effectiveReps > 12) return null;
  const e1rm = weightKg * (1 + effectiveReps / 30);
  return Math.round(e1rm * 10) / 10;
}
