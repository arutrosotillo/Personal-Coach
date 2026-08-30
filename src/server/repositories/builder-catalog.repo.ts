import { defaultTargetRir } from "@/core/training/prescription-defaults";
import { prisma } from "@/server/db";
import { visibleExerciseWhere } from "@/server/repositories/exercise-library.repo";

/** Variante pickable para el Custom Program Builder, con defaults ya resueltos. */
export interface BuilderVariant {
  variantId: string;
  label: string; // "Press banca — Barra"
  equipment: string;
  repRangeMin: number;
  repRangeMax: number;
  defaultRestSeconds: number;
  defaultTargetRir: number; // por rol (reutiliza F3.2)
  primaryMuscle: string; // nameEs del músculo PRIMARIO (para filtrar)
}

/**
 * Catálogo PLANO de variantes para el builder (Fase 3.1): reps y descanso salen
 * del catálogo; el RIR por defecto se deriva del rol (patrón + fatiga sistémica).
 * Read-only; sin migración.
 */
export async function listBuilderCatalog(
  profileId: string,
): Promise<BuilderVariant[]> {
  const exercises = await prisma.exercise.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      ...visibleExerciseWhere(profileId),
    },
    orderBy: { name: "asc" },
    include: {
      contributions: { include: { muscleGroup: true } },
      variants: { where: { deletedAt: null }, orderBy: { name: "asc" } },
    },
  });

  const out: BuilderVariant[] = [];
  for (const e of exercises) {
    const rir = defaultTargetRir(e.movementPattern, e.systemicFatigue);
    const primary = e.contributions.find((c) => c.role === "PRIMARY");
    const primaryMuscle = primary?.muscleGroup.nameEs ?? "";
    for (const v of e.variants) {
      out.push({
        variantId: v.id,
        label: `${e.name} — ${v.name}`,
        equipment: v.equipment,
        repRangeMin: v.repRangeMin,
        repRangeMax: v.repRangeMax,
        defaultRestSeconds: v.defaultRestSeconds,
        defaultTargetRir: rir,
        primaryMuscle,
      });
    }
  }
  return out;
}
