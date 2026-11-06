import type { ManualProgramInput } from "@/core/schemas/manual-program";
import { prisma } from "@/server/db";
import { archiveActivePrograms } from "@/server/services/program-archive.service";

/**
 * Crea un programa MANUAL (Fase 3.1). Aterriza en EXACTAMENTE las mismas tablas
 * que el generado (TrainingProgram → Mesocycle → WorkoutTemplate → TemplateExercise)
 * y NO crea AlgorithmDecision/Recommendation (no hay algoritmo) — por eso "manual
 * vs generado" se deriva de la ausencia de `INITIAL_PROGRAM` (ver program-source).
 *
 * Archiva el programa activo previo y cierra su bloque con sus fechas (NO se
 * borra: sesiones, snapshots e historial se conservan). Transaccional.
 */
export async function createManualProgram(
  profileId: string,
  input: ManualProgramInput,
  now: Date = new Date(),
): Promise<{ programId: string }> {
  // Verifica que todas las variantes existen y están activas (evita FK opaco).
  const variantIds = [
    ...new Set(
      input.days.flatMap((d) => d.exercises.map((e) => e.exerciseVariantId)),
    ),
  ];
  const found = await prisma.exerciseVariant.count({
    where: { id: { in: variantIds }, deletedAt: null },
  });
  if (found !== variantIds.length) {
    throw new Error("Algún ejercicio seleccionado ya no está disponible.");
  }

  return prisma.$transaction(async (tx) => {
    const inProgress = await tx.workoutSession.findFirst({
      where: { status: "IN_PROGRESS", mesocycle: { program: { profileId } } },
      select: { id: true },
    });
    if (inProgress) {
      throw new Error(
        "Finaliza o descarta la sesión en curso antes de cambiar de programa.",
      );
    }

    await archiveActivePrograms(tx, profileId);

    const program = await tx.trainingProgram.create({
      data: {
        profileId,
        name: input.name,
        daysPerWeek: input.days.length,
        description: input.description ?? null,
        createdAt: now,
        mesocycles: {
          create: {
            ordinal: 1,
            status: "ACTIVE",
            weeksPlanned: 6,
            templates: {
              create: input.days.map((day, di) => ({
                name: day.name,
                ordinal: di + 1,
                exercises: {
                  create: day.exercises.map((e, ei) => ({
                    exerciseVariantId: e.exerciseVariantId,
                    ordinal: ei + 1,
                    baseSets: e.baseSets,
                    // Normaliza el rango sin descartar valores.
                    repRangeMin: Math.min(e.repRangeMin, e.repRangeMax),
                    repRangeMax: Math.max(e.repRangeMin, e.repRangeMax),
                    targetRir: e.targetRir,
                    targetRirMin: e.targetRirMin ?? null,
                    restSeconds: e.restSeconds,
                  })),
                },
              })),
            },
          },
        },
      },
    });

    return { programId: program.id };
  });
}
