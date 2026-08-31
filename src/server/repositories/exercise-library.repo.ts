import { prisma } from "@/server/db";

/**
 * Visibilidad del banco: el catálogo global del seed (`profileId: null`) más
 * los ejercicios propios de ESTE perfil. Nunca los de otra persona.
 *
 * Se pasa `profileId` explícito en vez de resolver la sesión aquí: los
 * repositorios no leen cookies, esa frontera vive en `server/auth`.
 */
export function visibleExerciseWhere(profileId: string) {
  return { OR: [{ profileId: null }, { profileId }] };
}

/** Ejercicio de la biblioteca con músculos y variantes, para la UI de F2A. */
export interface LibraryExercise {
  id: string;
  name: string;
  movementPattern: string;
  instructions: string | null;
  isActive: boolean;
  /** `true` si lo creó el propio usuario (se puede borrar; el del seed no). */
  isOwn: boolean;
  /** Nota personal de ESTE perfil sobre el ejercicio; `null` si no hay. */
  note: string | null;
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
export async function listLibrary(
  profileId: string,
): Promise<LibraryExercise[]> {
  const exercises = await prisma.exercise.findMany({
    where: { deletedAt: null, ...visibleExerciseWhere(profileId) },
    orderBy: { name: "asc" },
    include: {
      contributions: { include: { muscleGroup: true } },
      variants: { where: { deletedAt: null }, orderBy: { name: "asc" } },
      // Filtrada por perfil: la nota es personal y el catálogo es compartido.
      notes: { where: { profileId }, select: { text: true } },
    },
  });

  return exercises.map((e) => ({
    id: e.id,
    name: e.name,
    movementPattern: e.movementPattern,
    instructions: e.instructions,
    isActive: e.isActive,
    isOwn: e.profileId !== null,
    note: e.notes[0]?.text ?? null,
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
