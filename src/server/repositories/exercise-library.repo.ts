import { prisma } from "@/server/db";

/** Ejercicio de la biblioteca con músculos y variantes, para la UI de F2A. */
export interface LibraryExercise {
  id: string;
  name: string;
  movementPattern: string;
  instructions: string | null;
  isActive: boolean;
  muscles: Array<{
    code: string;
    nameEs: string;
    role: string;
    factor: number;
  }>;
  variants: Array<{
    id: string;
    name: string;
    equipment: string;
    repRangeMin: number;
    repRangeMax: number;
    defaultRestSeconds: number;
  }>;
}

/** Lista completa de la biblioteca (el filtrado/búsqueda se hace en cliente). */
export async function listLibrary(): Promise<LibraryExercise[]> {
  const exercises = await prisma.exercise.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    include: {
      contributions: { include: { muscleGroup: true } },
      variants: { where: { deletedAt: null }, orderBy: { name: "asc" } },
    },
  });

  return exercises.map((e) => ({
    id: e.id,
    name: e.name,
    movementPattern: e.movementPattern,
    instructions: e.instructions,
    isActive: e.isActive,
    muscles: e.contributions
      .slice()
      .sort((a, b) => b.factor - a.factor)
      .map((c) => ({
        code: c.muscleGroup.code,
        nameEs: c.muscleGroup.nameEs,
        role: c.role,
        factor: c.factor,
      })),
    variants: e.variants.map((v) => ({
      id: v.id,
      name: v.name,
      equipment: v.equipment,
      repRangeMin: v.repRangeMin,
      repRangeMax: v.repRangeMax,
      defaultRestSeconds: v.defaultRestSeconds,
    })),
  }));
}
