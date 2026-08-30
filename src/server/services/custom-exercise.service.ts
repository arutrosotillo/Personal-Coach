import {
  PRIMARY_FACTOR,
  type CustomExerciseInput,
} from "@/core/schemas/custom-exercise";
import { prisma } from "@/server/db";

/**
 * Ejercicios propios del banco (`Exercise.profileId != null`).
 *
 * Los del seed son globales y NADIE los puede tocar desde la app: se editan
 * cambiando el catálogo y re-sembrando. Estos son de quien los crea, y solo
 * aparecen en su biblioteca, su builder y su lista de sustitución.
 */

/** El nombre ya existe (en el catálogo global o en el de otra persona). */
export class DuplicateExerciseNameError extends Error {
  constructor(name: string) {
    super(`Ya existe un ejercicio llamado "${name}".`);
    this.name = "DuplicateExerciseNameError";
  }
}

/** Se intenta borrar un ejercicio que ya está en uso en un programa o historial. */
export class ExerciseInUseError extends Error {
  constructor() {
    super(
      "Este ejercicio está en uso en tu programa o en tu historial: quítalo de ahí antes de borrarlo.",
    );
    this.name = "ExerciseInUseError";
  }
}

export interface CreatedCustomExercise {
  exerciseId: string;
  variantId: string;
}

/**
 * Crea un ejercicio propio con su primera (y única) variante.
 *
 * Nace ya utilizable: la variante es `isDefault`, así que el picker del
 * builder, la biblioteca y la sustitución en sesión lo ofrecen sin más pasos.
 * El músculo principal cuenta 1.0 y los secundarios con su factor: es lo que
 * consume el conteo de volumen efectivo.
 */
export async function createCustomExercise(
  profileId: string,
  input: CustomExerciseInput,
): Promise<CreatedCustomExercise> {
  // Se comprueba ANTES para poder dar un error legible; la unicidad real la
  // sigue garantizando el índice de la base (dos peticiones a la vez).
  const clash = await prisma.exercise.findUnique({
    where: { name: input.name },
    select: { id: true },
  });
  if (clash) throw new DuplicateExerciseNameError(input.name);

  const codes = [
    input.primaryMuscle,
    ...input.secondaryMuscles.map((m) => m.group),
  ];
  const groups = await prisma.muscleGroup.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const idByCode = new Map(groups.map((g) => [g.code, g.id]));
  const missing = codes.filter((c) => !idByCode.has(c));
  if (missing.length > 0) {
    throw new Error(`Grupo muscular desconocido: ${missing.join(", ")}`);
  }

  try {
    const exercise = await prisma.exercise.create({
      data: {
        name: input.name,
        movementPattern: input.movementPattern,
        systemicFatigue: input.systemicFatigue,
        instructions: input.instructions || null,
        isCustom: true,
        isActive: true,
        profileId,
        contributions: {
          create: [
            {
              muscleGroupId: idByCode.get(input.primaryMuscle) as string,
              role: "PRIMARY",
              factor: PRIMARY_FACTOR,
            },
            ...input.secondaryMuscles.map((m) => ({
              muscleGroupId: idByCode.get(m.group) as string,
              role: "SECONDARY",
              factor: m.factor,
            })),
          ],
        },
        variants: {
          create: {
            name: input.variantName,
            equipment: input.equipment,
            loadStepKg: input.loadStepKg,
            repRangeMin: input.repRangeMin,
            repRangeMax: input.repRangeMax,
            defaultRestSeconds: input.restSeconds,
            contraindications: input.contraindications,
            isDefault: true,
          },
        },
      },
      include: { variants: true },
    });

    const variantId = exercise.variants[0]?.id;
    if (!variantId) throw new Error("El ejercicio se creó sin variante.");
    return { exerciseId: exercise.id, variantId };
  } catch (error) {
    // Carrera contra el índice único: se traduce al mismo error legible.
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      throw new DuplicateExerciseNameError(input.name);
    }
    throw error;
  }
}

/**
 * Borra un ejercicio propio, solo si NO se está usando.
 *
 * El borrado es real (no `deletedAt`) precisamente porque se exige que no tenga
 * uso: un soft-delete dejaría filas huérfanas que la biblioteca esconde pero el
 * conteo de volumen seguiría viendo. Si el ejercicio está en una plantilla o
 * tiene series registradas, se rechaza en vez de romper el historial — la
 * regla de que la edición NUNCA reescribe lo ya entrenado también aplica aquí.
 */
export async function deleteCustomExercise(
  profileId: string,
  exerciseId: string,
): Promise<void> {
  // `profileId` en el WHERE: nadie puede borrar el ejercicio de otra persona,
  // ni uno global (esos tienen profileId null y no casan nunca).
  const exercise = await prisma.exercise.findFirst({
    where: { id: exerciseId, profileId },
    include: { variants: { select: { id: true } } },
  });
  if (!exercise) {
    throw new Error("Ese ejercicio no existe o no es tuyo.");
  }

  const variantIds = exercise.variants.map((v) => v.id);
  if (variantIds.length > 0) {
    const [enPlantilla, entrenado] = await Promise.all([
      prisma.templateExercise.count({
        where: { exerciseVariantId: { in: variantIds } },
      }),
      prisma.workoutExercise.count({
        where: { exerciseVariantId: { in: variantIds } },
      }),
    ]);
    if (enPlantilla > 0 || entrenado > 0) throw new ExerciseInUseError();
  }

  await prisma.$transaction(async (tx) => {
    // Las contribuciones caen por cascada; las variantes no (su relación con
    // Exercise es obligatoria y sin onDelete), así que van primero.
    await tx.exerciseVariant.deleteMany({ where: { exerciseId } });
    await tx.exercise.delete({ where: { id: exerciseId } });
  });
}
