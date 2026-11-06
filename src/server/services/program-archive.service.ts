import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Archivar un programa: dejar de usarlo sin perder nada de lo entrenado.
 *
 * Nada se borra ni se reescribe: sesiones, series, plantillas y prescripciones
 * siguen donde estaban. Solo cambia el estado del programa y se anotan en su
 * bloque las fechas reales (primera y última sesión completada), que es lo único
 * que `isActive: false` por sí solo dejaba sin decir. Los motores leen el perfil
 * entero, así que archivar tampoco reinicia la fatiga ni la acumulación
 * (`training-context.repo`).
 *
 * Un bloque sin ninguna sesión vuelve a `PLANNED`: no se entrenó, no hay nada que
 * cerrar ni fechas que anotar.
 */
export async function archiveActivePrograms(
  tx: Tx,
  profileId: string,
): Promise<void> {
  const active = await tx.trainingProgram.findMany({
    where: { profileId, isActive: true },
    select: { id: true },
  });
  if (active.length === 0) return;
  const programIds = active.map((p) => p.id);

  const blocks = await tx.workoutSession.groupBy({
    by: ["mesocycleId"],
    where: {
      status: "COMPLETED",
      mesocycle: { programId: { in: programIds } },
    },
    _min: { localDate: true },
    _max: { localDate: true },
  });
  for (const block of blocks) {
    await tx.mesocycle.update({
      where: { id: block.mesocycleId },
      data: {
        status: "COMPLETED",
        startDate: block._min.localDate,
        endDate: block._max.localDate,
      },
    });
  }

  await tx.mesocycle.updateMany({
    where: {
      programId: { in: programIds },
      status: "ACTIVE",
      id: { notIn: blocks.map((b) => b.mesocycleId) },
    },
    data: { status: "PLANNED" },
  });

  await tx.trainingProgram.updateMany({
    where: { profileId, isActive: true },
    data: { isActive: false },
  });
}

/**
 * Al reactivar un programa su bloque vuelve a estar en marcha: conserva cuándo
 * empezó y deja de tener fin. La próxima vez que se archive, el fin se recalcula
 * con lo entrenado hasta entonces.
 */
export async function reopenProgramBlocks(
  tx: Tx,
  programId: string,
): Promise<void> {
  await tx.mesocycle.updateMany({
    where: { programId },
    data: { status: "ACTIVE", endDate: null },
  });
}
