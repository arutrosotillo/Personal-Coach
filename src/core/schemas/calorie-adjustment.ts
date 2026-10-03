import { z } from "zod";

/**
 * Respuesta a una sugerencia de ajuste calórico. `expectedKcal` es lo que el
 * usuario vio: el servidor recalcula y solo lo usa como guarda.
 */
export const calorieAdjustmentAnswerSchema = z.object({
  accept: z.boolean(),
  expectedKcal: z.number().int().min(800).max(6000),
});

export type CalorieAdjustmentAnswerInput = z.input<
  typeof calorieAdjustmentAnswerSchema
>;
