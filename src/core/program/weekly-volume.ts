import { MUSCLE_GROUPS } from "@/core/catalog/muscle-groups";
import type { MuscleGroupCode } from "@/core/enums";
import type { CatalogExercise, GroupVolume } from "@/core/program/types";

/** Los 16 grupos, en el orden del seed (mismo criterio que el generador). */
const ALL_GROUPS: MuscleGroupCode[] = MUSCLE_GROUPS.map((g) => g.code);

/**
 * Volumen semanal efectivo por músculo, calculado sobre lo que HAY (el programa
 * vigente o las sesiones realmente entrenadas), no sobre lo que se generó el
 * primer día.
 *
 * Existe porque `generateInitialProgram` calcula esto mismo pero enterrado en su
 * bucle de reparto, y su resultado se congela en la `AlgorithmDecision` del día
 * de la generación. En cuanto cambias un ejercicio o subes una serie, aquel
 * número deja de describir tu programa. Este módulo es la misma contabilidad,
 * extraída y aplicable a cualquier conjunto de series.
 *
 * Reglas idénticas a las del generador, para que los dos números sean
 * comparables:
 *   · `directSets`     = series cuyo grupo PRIMARIO es este.
 *   · `fractionalSets` = Σ(series × factor de contribución), directas e indirectas.
 *   · `frequency`      = nº de días DISTINTOS con trabajo DIRECTO del grupo. El
 *                        estímulo indirecto no suma frecuencia; ya está contado
 *                        en el volumen efectivo.
 *
 * Puro y determinista: no conoce Prisma, ni fechas del sistema, ni la sesión.
 */

/** Una entrada = las series de una variante en un día concreto. */
export interface VolumeEntry {
  variantId: string;
  /**
   * Qué cuenta como "un día". Para el volumen PLANIFICADO es la plantilla
   * (`templateId`); para el REALIZADO es el `localDate` de la sesión. Así la
   * frecuencia significa lo mismo en los dos casos: días distintos.
   */
  dayKey: string;
  sets: number;
}

export interface WeeklyVolumeResult {
  byGroup: GroupVolume[];
  /**
   * Series que no se pudieron atribuir a ningún músculo porque su variante no
   * está en el catálogo recibido (por ejemplo, un ejercicio propio borrado).
   * Se informa en vez de descontarlo en silencio: un conteo que se traga
   * series miente hacia abajo y nadie se entera.
   */
  unattributedSets: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function computeWeeklyVolume(input: {
  entries: VolumeEntry[];
  catalog: CatalogExercise[];
  targets: Record<MuscleGroupCode, number>;
  priorityMuscles: MuscleGroupCode[];
}): WeeklyVolumeResult {
  const { entries, catalog, targets, priorityMuscles } = input;
  const priority = new Set(priorityMuscles);

  // variante → ejercicio, para resolver las contribuciones de cada serie.
  const exerciseByVariant = new Map<string, CatalogExercise>();
  for (const exercise of catalog) {
    for (const variant of exercise.variants) {
      exerciseByVariant.set(variant.id, exercise);
    }
  }

  const zero = () =>
    Object.fromEntries(ALL_GROUPS.map((g) => [g, 0])) as Record<
      MuscleGroupCode,
      number
    >;
  const directSets = zero();
  const fractionalSets = zero();
  const directDays = Object.fromEntries(
    ALL_GROUPS.map((g) => [g, new Set<string>()]),
  ) as Record<MuscleGroupCode, Set<string>>;

  let unattributedSets = 0;

  for (const entry of entries) {
    if (entry.sets <= 0) continue;
    const exercise = exerciseByVariant.get(entry.variantId);
    if (!exercise) {
      unattributedSets += entry.sets;
      continue;
    }
    for (const contribution of exercise.contributions) {
      fractionalSets[contribution.group] += entry.sets * contribution.factor;
      if (contribution.role === "PRIMARY") {
        directSets[contribution.group] += entry.sets;
        directDays[contribution.group].add(entry.dayKey);
      }
    }
  }

  return {
    byGroup: ALL_GROUPS.map((group) => ({
      group,
      directSets: directSets[group],
      fractionalSets: round1(fractionalSets[group]),
      frequency: directDays[group].size,
      isPriority: priority.has(group),
      targetSets: round1(targets[group]),
    })),
    unattributedSets,
  };
}
