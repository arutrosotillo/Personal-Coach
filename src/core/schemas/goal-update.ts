import { z } from "zod";

import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import { GoalStrategy, STRATEGY_TO_GOAL_TYPE } from "@/core/enums";

/**
 * Revisión del objetivo desde el check-in o desde Ajustes.
 *
 * Los tres campos que una persona puede querer tocar: la ESTRATEGIA (la fase),
 * el RITMO y el PESO OBJETIVO. Nada más — el sexo, la altura o los pasos no se
 * revisan aquí, y el objetivo calórico NO se recalcula: eso es F4 y tiene sus
 * propias reglas de seguridad.
 *
 * Qué pasa con cada cambio lo decide `classifyGoalChange` en `core/body`, no
 * este schema: aquí solo se valida que los números sean admisibles.
 *
 * El rango del ritmo se lee de `NUTRITION_CONFIG`, que es donde vive: si
 * mañana se acota el déficit máximo (ver la revisión pendiente documentada en
 * NUTRITION_ENGINE.md §2), este formulario se acota solo.
 */
export const goalUpdateSchema = z
  .object({
    strategy: GoalStrategy,
    /** % del peso corporal por semana. Negativo = pérdida. */
    weeklyRatePct: z.number(),
    targetWeightKg: z
      .number()
      .min(30, "El peso objetivo debe estar entre 30 y 300 kg")
      .max(300, "El peso objetivo debe estar entre 30 y 300 kg")
      .nullish()
      .transform((v) => v ?? null),
  })
  .superRefine((data, ctx) => {
    const rango =
      NUTRITION_CONFIG.weeklyRatePct[STRATEGY_TO_GOAL_TYPE[data.strategy]];
    if (data.weeklyRatePct < rango.min || data.weeklyRatePct > rango.max) {
      ctx.addIssue({
        code: "custom",
        path: ["weeklyRatePct"],
        message:
          rango.min === 0 && rango.max === 0
            ? "Esta estrategia mantiene el peso: su ritmo es 0."
            : `El ritmo de esta estrategia va de ${rango.min} a ${rango.max} % del peso por semana.`,
      });
    }
  });

export type GoalUpdateInput = z.input<typeof goalUpdateSchema>;
export type GoalUpdateData = z.output<typeof goalUpdateSchema>;
