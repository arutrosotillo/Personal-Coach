import { estimateOneRepMax } from "@/core/training/e1rm";
import type { PrismaClient } from "@/generated/prisma/client";

export interface SeedSet {
  setNumber: number;
  weightKg: number;
  reps: number;
  rir?: number | null;
  setType?: "WARMUP" | "WORKING";
  completed?: boolean;
}

/**
 * Crea una sesión con un ejercicio (variante) y sus sets, sin pasar por el
 * flujo de logSet. Útil para montar historial arbitrario (incluidos WARMUP y
 * sesiones ABORTED) en los tests de historial/progresión.
 */
export async function seedCompletedSessionWithSets(
  prisma: PrismaClient,
  opts: {
    mesocycleId: string;
    variantId: string;
    localDate: string;
    status?: "COMPLETED" | "ABORTED" | "IN_PROGRESS";
    templateId?: string | null;
    weekNumber?: number;
    plannedSets?: number;
    finishedAt?: Date;
    sets: SeedSet[];
  },
): Promise<string> {
  const status = opts.status ?? "COMPLETED";
  const plannedSets = opts.plannedSets ?? opts.sets.length;

  const session = await prisma.workoutSession.create({
    data: {
      mesocycleId: opts.mesocycleId,
      templateId: opts.templateId ?? null,
      weekNumber: opts.weekNumber ?? 1,
      weekKind: "ACCUMULATION",
      status,
      localDate: opts.localDate,
      startedAt: opts.finishedAt ?? undefined,
      finishedAt:
        status === "COMPLETED" ? (opts.finishedAt ?? new Date()) : null,
      exercises: {
        create: {
          exerciseVariantId: opts.variantId,
          ordinal: 1,
          plannedSets,
          repRangeMin: 8,
          repRangeMax: 12,
          targetRir: 2,
          restSeconds: 120,
        },
      },
    },
    include: { exercises: true },
  });

  const workoutExerciseId = session.exercises[0].id;
  for (const s of opts.sets) {
    const rir = s.rir ?? null;
    await prisma.setLog.create({
      data: {
        workoutExerciseId,
        exerciseVariantId: opts.variantId,
        localDate: opts.localDate,
        setNumber: s.setNumber,
        setType: s.setType ?? "WORKING",
        weightKg: s.weightKg,
        reps: s.reps,
        rir,
        completed: s.completed ?? true,
        estimated1Rm: estimateOneRepMax(s.weightKg, s.reps, rir),
      },
    });
  }
  return session.id;
}
