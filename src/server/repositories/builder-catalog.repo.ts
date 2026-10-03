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
  /**
   * RIR por defecto de ESTA variante: rol + coste sistémico del ejercicio,
   * ajustado por la estabilidad de la variante (`defaultTargetRir`). Dos
   * variantes del mismo ejercicio pueden traer objetivos distintos, y esa es
   * justamente la razón de que se calcule aquí dentro del bucle.
   */
  defaultTargetRir: number;
  primaryMuscle: string; // nameEs del músculo PRIMARIO (para filtrar)
}

/**
 * Catálogo PLANO de variantes para el builder (Fase 3.1): reps y descanso salen
 * del catálogo; el RIR por defecto se deriva del rol (patrón + fatiga sistémica)
 * y de la estabilidad de la variante. Read-only; sin migración.
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
    const primaryMuscle =
      e.contributions.find((c) => c.role === "PRIMARY")?.muscleGroup.nameEs ??
      "";
    for (const v of e.variants) out.push(toBuilderVariant(e, v, primaryMuscle));
  }
  return out;
}

/** Fila del picker a partir del ejercicio y la variante. Una sola definición. */
function toBuilderVariant(
  exercise: { name: string; movementPattern: string; systemicFatigue: number },
  variant: {
    id: string;
    name: string;
    equipment: string;
    stability: string | null;
    repRangeMin: number;
    repRangeMax: number;
    defaultRestSeconds: number;
  },
  primaryMuscle: string,
): BuilderVariant {
  return {
    variantId: variant.id,
    label: `${exercise.name} — ${variant.name}`,
    equipment: variant.equipment,
    repRangeMin: variant.repRangeMin,
    repRangeMax: variant.repRangeMax,
    defaultRestSeconds: variant.defaultRestSeconds,
    defaultTargetRir: defaultTargetRir(
      exercise.movementPattern,
      exercise.systemicFatigue,
      variant.stability,
      variant.equipment,
    ),
    primaryMuscle,
  };
}

/**
 * UNA variante para el picker, por id.
 *
 * La usa el alta de ejercicio desde el builder: al crear uno nuevo hay que
 * poder añadirlo al programa en el mismo gesto, sin recargar el catálogo
 * entero ni recomponer la fila en el cliente (el RIR por defecto se calcula en
 * el servidor y no debe tener una segunda implementación).
 */
export async function getBuilderVariant(
  profileId: string,
  variantId: string,
): Promise<BuilderVariant | null> {
  const variant = await prisma.exerciseVariant.findFirst({
    where: {
      id: variantId,
      deletedAt: null,
      exercise: {
        isActive: true,
        deletedAt: null,
        ...visibleExerciseWhere(profileId),
      },
    },
    include: {
      exercise: {
        include: { contributions: { include: { muscleGroup: true } } },
      },
    },
  });
  if (!variant) return null;
  const primaryMuscle =
    variant.exercise.contributions.find((c) => c.role === "PRIMARY")
      ?.muscleGroup.nameEs ?? "";
  return toBuilderVariant(variant.exercise, variant, primaryMuscle);
}
