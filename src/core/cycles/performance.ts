import { CYCLE_CONFIG } from "@/core/config/cycle-config";
import { addDays, diffDays } from "@/core/dates";

/**
 * Evolución del rendimiento a lo largo de un ciclo, para su resumen. Puro.
 *
 * Compara, variante a variante, el mejor e1RM de las primeras semanas del
 * ciclo con el de las últimas. Solo entran las variantes entrenadas en las
 * dos ventanas: comparar contra un ejercicio que se dejó de hacer, o que se
 * empezó a mitad, no dice nada del ciclo.
 *
 * La identidad es la VARIANTE (CLAUDE.md): nunca se comparan cargas entre
 * variantes distintas del mismo ejercicio.
 */

type CycleConfig = typeof CYCLE_CONFIG;

export interface PerformanceSetPoint {
  variantId: string;
  exerciseName: string;
  variantName: string;
  localDate: string;
  /** e1RM de la serie (Epley con reps efectivas, ya calculado en escritura). */
  e1rmKg: number;
}

export interface PerformanceHighlight {
  exerciseName: string;
  variantName: string;
  fromKg: number;
  toKg: number;
  changePct: number;
}

export interface CyclePerformanceSummary {
  windowDays: number;
  comparedVariants: number;
  improved: number;
  stable: number;
  declined: number;
  /** Mediana del cambio porcentual de las variantes comparadas. */
  medianChangePct: number;
  /** Los mayores cambios, primero los que más suben. */
  highlights: PerformanceHighlight[];
}

function bestByVariant(
  points: readonly PerformanceSetPoint[],
  from: string,
  to: string,
): Map<string, PerformanceSetPoint> {
  const best = new Map<string, PerformanceSetPoint>();
  for (const p of points) {
    if (diffDays(from, p.localDate) < 0 || diffDays(p.localDate, to) < 0)
      continue;
    if (!Number.isFinite(p.e1rmKg) || p.e1rmKg <= 0) continue;
    const current = best.get(p.variantId);
    if (!current || p.e1rmKg > current.e1rmKg) best.set(p.variantId, p);
  }
  return best;
}

export function summarizePerformance(
  points: readonly PerformanceSetPoint[],
  startLocalDate: string,
  endLocalDate: string,
  config: CycleConfig = CYCLE_CONFIG,
): CyclePerformanceSummary | null {
  const cfg = config.performance;
  const days = diffDays(startLocalDate, endLocalDate) + 1;
  const windowDays = Math.min(cfg.windowDays, Math.floor(days / 2));
  if (windowDays < cfg.minWindowDays) return null;

  const early = bestByVariant(
    points,
    startLocalDate,
    addDays(startLocalDate, windowDays - 1),
  );
  const late = bestByVariant(
    points,
    addDays(endLocalDate, -(windowDays - 1)),
    endLocalDate,
  );

  const changes: PerformanceHighlight[] = [];
  for (const [variantId, first] of early) {
    const last = late.get(variantId);
    if (!last) continue;
    changes.push({
      exerciseName: first.exerciseName,
      variantName: first.variantName,
      fromKg: first.e1rmKg,
      toKg: last.e1rmKg,
      changePct: ((last.e1rmKg - first.e1rmKg) / first.e1rmKg) * 100,
    });
  }
  if (changes.length === 0) return null;

  const sorted = [...changes].sort((a, b) => a.changePct - b.changePct);
  const mid = Math.floor(sorted.length / 2);
  const medianChangePct =
    sorted.length % 2 === 0
      ? (sorted[mid - 1].changePct + sorted[mid].changePct) / 2
      : sorted[mid].changePct;

  return {
    windowDays,
    comparedVariants: changes.length,
    improved: changes.filter((c) => c.changePct >= cfg.stableChangePct).length,
    stable: changes.filter((c) => Math.abs(c.changePct) < cfg.stableChangePct)
      .length,
    declined: changes.filter((c) => c.changePct <= -cfg.stableChangePct).length,
    medianChangePct,
    highlights: [...changes]
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, cfg.highlights)
      .sort((a, b) => b.changePct - a.changePct),
  };
}
