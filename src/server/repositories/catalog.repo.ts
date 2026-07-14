import {
  Contraindication,
  Equipment,
  MovementPattern,
  MuscleGroupCode,
  MuscleRole,
} from "@/core/enums";
import type { CatalogExercise } from "@/core/program/types";
import { prisma } from "@/server/db";

/** Nombres de los ejercicios activos (para autocompletado en el onboarding). */
export async function listExerciseNames(): Promise<string[]> {
  const exercises = await prisma.exercise.findMany({
    where: { isActive: true, deletedAt: null },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return exercises.map((e) => e.name);
}

/** Carga el catálogo activo en la vista que consumen los módulos de core. */
export async function loadCatalog(): Promise<CatalogExercise[]> {
  const exercises = await prisma.exercise.findMany({
    where: { isActive: true, deletedAt: null },
    include: {
      contributions: { include: { muscleGroup: true } },
      variants: { where: { deletedAt: null } },
    },
    orderBy: { name: "asc" },
  });

  return exercises.map((e) => ({
    id: e.id,
    name: e.name,
    movementPattern: MovementPattern.parse(e.movementPattern),
    systemicFatigue: e.systemicFatigue,
    contributions: e.contributions.map((c) => ({
      group: MuscleGroupCode.parse(c.muscleGroup.code),
      role: MuscleRole.parse(c.role),
      factor: c.factor,
    })),
    variants: e.variants.map((v) => ({
      id: v.id,
      name: v.name,
      equipment: Equipment.parse(v.equipment),
      loadStepKg: v.loadStepKg,
      repRangeMin: v.repRangeMin,
      repRangeMax: v.repRangeMax,
      defaultRestSeconds: v.defaultRestSeconds,
      contraindications: Contraindication.array().parse(
        v.contraindications ?? [],
      ),
      isDefault: v.isDefault,
    })),
  }));
}
