import { z } from "zod";

import { Contraindication, Equipment, MuscleGroupCode } from "@/core/enums";

/**
 * Forma de `AlgorithmDecision.output` del generador de programa inicial.
 * Se valida al leerlo para el bloque "Por qué este programa".
 */
export const programRationaleOutput = z.object({
  splitType: z.string(),
  splitLabel: z.string(),
  daysPerWeek: z.number(),
  minutesPerSession: z.number(),
  perDayMinutes: z.array(z.number()),
  equipment: z.array(Equipment),
  contraindications: z.array(Contraindication),
  excludedExerciseNames: z.array(z.string()),
  volumeByGroup: z.array(
    z.object({
      group: MuscleGroupCode,
      directSets: z.number(),
      fractionalSets: z.number(),
      frequency: z.number(),
      isPriority: z.boolean(),
      targetSets: z.number(),
    }),
  ),
  priorityMuscles: z.array(MuscleGroupCode),
  warnings: z.array(z.string()),
});

export type ProgramRationaleOutput = z.infer<typeof programRationaleOutput>;
