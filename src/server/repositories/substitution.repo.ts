import type { SubstitutionExercise } from "@/components/training/session-runner";
import { prisma } from "@/server/db";
import { visibleExerciseWhere } from "@/server/repositories/exercise-library.repo";

/**
 * Catálogo de sustitución: ejercicios activos con sus variantes, para elegir
 * manualmente un reemplazo durante la ejecución (sin recomendaciones en F2A).
 */
export async function listSubstitutionOptions(
  profileId: string,
): Promise<SubstitutionExercise[]> {
  const exercises = await prisma.exercise.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      ...visibleExerciseWhere(profileId),
    },
    orderBy: { name: "asc" },
    include: {
      variants: { where: { deletedAt: null }, orderBy: { name: "asc" } },
    },
  });
  return exercises
    .filter((e) => e.variants.length > 0)
    .map((e) => ({
      exerciseName: e.name,
      variants: e.variants.map((v) => ({
        id: v.id,
        name: `${e.name} — ${v.name}`,
        equipment: v.equipment,
      })),
    }));
}
