import { CYCLE_CONFIG } from "@/core/config/cycle-config";
import { addDays, diffDays } from "@/core/dates";
import {
  loadSegmentOn,
  type EquipmentChangePoint,
} from "@/core/training/equipment";

/**
 * Evolución del rendimiento a lo largo de un ciclo, para su resumen. Puro.
 *
 * Compara, variante a variante, el mejor e1RM de las primeras semanas del
 * ciclo con el de las últimas. Solo entran las variantes entrenadas en las
 * dos ventanas: comparar contra un ejercicio que se dejó de hacer, o que se
 * empezó a mitad, no dice nada del ciclo.
 *
 * La identidad es la VARIANTE (CLAUDE.md): nunca se comparan cargas entre
 * variantes distintas del mismo ejercicio. Y dentro de una variante, nunca
 * entre dos equipamientos: si cambió de máquina a mitad de ciclo, solo cuenta
 * el tramo con la máquina nueva, y casi siempre eso deja fuera la ventana del
 * principio. Esas variantes se cuentan aparte (`excludedByEquipmentChange`):
 * leer 100 → 65 kg como "baja un 35 %" sería tomar la máquina por la persona.
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
  /**
   * Variantes entrenadas al principio y al final que NO se comparan porque
   * cambiaron de equipamiento entre medias. Opcional: los resúmenes
   * congelados antes de existir no lo traen (equivale a 0).
   */
  excludedByEquipmentChange?: number;
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
  equipmentChanges: readonly EquipmentChangePoint[] = [],
): CyclePerformanceSummary | null {
  const cfg = config.performance;
  const days = diffDays(startLocalDate, endLocalDate) + 1;
  const windowDays = Math.min(cfg.windowDays, Math.floor(days / 2));
  if (windowDays < cfg.minWindowDays) return null;

  const earlyEnd = addDays(startLocalDate, windowDays - 1);
  const lateStart = addDays(endLocalDate, -(windowDays - 1));
  // Solo el tramo de equipamiento vigente al final del ciclo se compara.
  const comparable = points.filter((p) => {
    const since = loadSegmentOn(
      equipmentChanges,
      p.variantId,
      endLocalDate,
    ).since;
    return since === null || p.localDate >= since;
  });
  const early = bestByVariant(comparable, startLocalDate, earlyEnd);
  const late = bestByVariant(comparable, lateStart, endLocalDate);
  const rawEarly = bestByVariant(points, startLocalDate, earlyEnd);
  const rawLate = bestByVariant(points, lateStart, endLocalDate);
  const excludedByEquipmentChange = [...rawEarly.keys()].filter(
    (id) => rawLate.has(id) && !(early.has(id) && late.has(id)),
  ).length;

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
  if (changes.length === 0) {
    // Sin nada que comparar, el resumen solo existe para decir POR QUÉ: si
    // fue un cambio de equipamiento, eso es información; si no, no hay nada.
    if (excludedByEquipmentChange === 0) return null;
    return {
      windowDays,
      comparedVariants: 0,
      improved: 0,
      stable: 0,
      declined: 0,
      medianChangePct: 0,
      highlights: [],
      excludedByEquipmentChange,
    };
  }

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
    excludedByEquipmentChange,
  };
}
