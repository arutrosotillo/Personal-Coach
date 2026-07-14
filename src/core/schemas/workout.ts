import { z } from "zod";

import { SetType } from "@/core/enums";

/** Registro de una serie durante la ejecución. Validado en cliente y servidor. */
export const logSetSchema = z.object({
  workoutExerciseId: z.string().min(1),
  setNumber: z.number().int().min(1).max(20),
  setType: SetType.default("WORKING"),
  weightKg: z.number().min(0).max(500),
  reps: z.number().int().min(0).max(100),
  rir: z.number().int().min(0).max(10).nullable().optional(),
  technique: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
});
export type LogSetInput = z.input<typeof logSetSchema>;
export type LogSetData = z.output<typeof logSetSchema>;

/** Feedback rápido al terminar la sesión (todo opcional salvo intención). */
export const sessionFeedbackSchema = z.object({
  perceivedPerformance: z.number().int().min(1).max(5).nullable().optional(),
  pump: z.number().int().min(1).max(5).nullable().optional(),
  jointPain: z.number().int().min(1).max(5).nullable().optional(),
  fatigue: z.number().int().min(1).max(5).nullable().optional(),
  motivation: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type SessionFeedbackData = z.output<typeof sessionFeedbackSchema>;
