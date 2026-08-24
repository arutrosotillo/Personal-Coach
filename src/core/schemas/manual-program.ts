import { z } from "zod";

/**
 * Programa MANUAL (Custom Program Builder, Fase 3.1). Valida solo la INTEGRIDAD
 * ESTRUCTURAL — NO aplica los límites fisiológicos del generador (F3.2). Debe ser
 * válido crear 5×5, RIR 0, descansos personalizados, etc. Los límites por campo
 * coinciden con los de edición de plantilla (`template-edit.ts`).
 * docs/PHASE_3_1_CUSTOM_PROGRAM_PLAN.md §9.
 */

export const manualExerciseSchema = z.object({
  exerciseVariantId: z.string().min(1),
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

export const manualDaySchema = z.object({
  name: z.string().trim().min(1, "El día necesita un nombre").max(60),
  exercises: z
    .array(manualExerciseSchema)
    .min(1, "Cada día necesita al menos un ejercicio"),
});

export const manualProgramSchema = z.object({
  name: z.string().trim().min(1, "El programa necesita un nombre").max(80),
  days: z
    .array(manualDaySchema)
    .min(1, "El programa necesita al menos un día")
    .max(7, "Máximo 7 días"),
});

export type ManualExerciseInput = z.output<typeof manualExerciseSchema>;
export type ManualDayInput = z.output<typeof manualDaySchema>;
export type ManualProgramInput = z.output<typeof manualProgramSchema>;
