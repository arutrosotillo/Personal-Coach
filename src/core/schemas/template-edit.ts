import { z } from "zod";

/** Edición de un ejercicio de plantilla (límites básicos, docs/TRAINING_ENGINE.md). */
export const templateExerciseEditSchema = z.object({
  baseSets: z
    .number()
    .int()
    .min(1, "Mínimo 1 serie")
    .max(10, "Máximo 10 series"),
  repRangeMin: z.number().int().min(1).max(50),
  repRangeMax: z.number().int().min(1).max(50),
  targetRir: z.number().int().min(0).max(5),
  restSeconds: z.number().int().min(30).max(600),
});
export type TemplateExerciseEdit = z.output<typeof templateExerciseEditSchema>;
