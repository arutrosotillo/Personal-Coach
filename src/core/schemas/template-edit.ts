import { z } from "zod";

import { isValidRirRange, RIR_RANGE_ERROR } from "@/core/training/rir-target";

/** Edición de un ejercicio de plantilla (límites básicos, docs/TRAINING_ENGINE.md). */
export const templateExerciseEditSchema = z
  .object({
    baseSets: z
      .number()
      .int()
      .min(1, "Mínimo 1 serie")
      .max(10, "Máximo 10 series"),
    repRangeMin: z.number().int().min(1).max(50),
    repRangeMax: z.number().int().min(1).max(50),
    targetRir: z.number().int().min(0).max(5),
    /** Extremo inferior de un objetivo en rango; `null` = valor único. */
    targetRirMin: z.number().int().min(0).max(5).nullable().optional(),
    restSeconds: z.number().int().min(30).max(600),
  })
  .refine((e) => isValidRirRange(e.targetRir, e.targetRirMin), {
    message: RIR_RANGE_ERROR,
    path: ["targetRirMin"],
  });
export type TemplateExerciseEdit = z.output<typeof templateExerciseEditSchema>;
