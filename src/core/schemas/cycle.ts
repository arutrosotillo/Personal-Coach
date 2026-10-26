import { z } from "zod";

import { CYCLE_CONFIG } from "@/core/config/cycle-config";
import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import {
  CycleOutcome,
  GoalStrategy,
  InterimNutrition,
  STRATEGY_TO_GOAL_TYPE,
  WorkActivity,
} from "@/core/enums";
import { BODY_RANGES } from "@/core/schemas/body-measurement";

/**
 * Frontera de validación de los ciclos (docs/CYCLES.md). Como el resto: sin
 * `profileId` —sale de la sesión— y con los rangos leídos de su configuración.
 *
 * El único id que viaja es el del ciclo que se cierra, y el servicio comprueba
 * que es del perfil de la sesión en la misma consulta. `requestId` es la clave
 * de idempotencia que genera el cliente al pulsar "Empezar": repetir el envío
 * devuelve el mismo ciclo en vez de crear dos.
 */

const kcal = z.number().int().min(800).max(6000);

const nullableNumber = (min: number, max: number, message: string) =>
  z
    .number()
    .min(min, message)
    .max(max, message)
    .nullish()
    .transform((v) => v ?? null);

export const cycleCloseSchema = z.object({
  goalId: z.string().min(1).max(64),
  outcome: CycleOutcome,
  interimNutrition: InterimNutrition,
  /** kcal que vio la persona si eligió mantenimiento: guarda de obsolescencia. */
  expectedKcal: kcal.nullish().transform((v) => v ?? null),
});
export type CycleCloseInput = z.input<typeof cycleCloseSchema>;
export type CycleCloseData = z.output<typeof cycleCloseSchema>;

const planFields = {
  strategy: GoalStrategy,
  /** % del peso por semana. Negativo = pérdida. */
  weeklyRatePct: z.number(),
  targetWeightKg: nullableNumber(
    30,
    300,
    "El peso objetivo debe estar entre 30 y 300 kg",
  ),
  /** Peso de hoy confirmado o corregido. `null` = el último registrado. */
  weightKg: nullableNumber(
    BODY_RANGES.weightKg.min,
    BODY_RANGES.weightKg.max,
    "El peso debe estar entre 30 y 300 kg. ¿Sobra un dígito?",
  ),
  waistCm: nullableNumber(
    BODY_RANGES.waistCm.min,
    BODY_RANGES.waistCm.max,
    "La cintura debe estar entre 40 y 200 cm",
  ),
  dailySteps: z.number().int().min(0).max(60000),
  workActivity: WorkActivity,
  /** Preferencia "% graso máximo" (solo en ganancia; orienta, no limita). */
  bodyFatCeilingPct: nullableNumber(
    CYCLE_CONFIG.bodyFatCeilingPct.min,
    CYCLE_CONFIG.bodyFatCeilingPct.max,
    `El % graso de referencia debe estar entre ${CYCLE_CONFIG.bodyFatCeilingPct.min} y ${CYCLE_CONFIG.bodyFatCeilingPct.max}`,
  ),
};

function rateInRange(
  data: { strategy: GoalStrategy; weeklyRatePct: number },
  ctx: z.RefinementCtx,
) {
  const range =
    NUTRITION_CONFIG.weeklyRatePct[STRATEGY_TO_GOAL_TYPE[data.strategy]];
  if (data.weeklyRatePct < range.min || data.weeklyRatePct > range.max) {
    ctx.addIssue({
      code: "custom",
      path: ["weeklyRatePct"],
      message:
        range.min === 0 && range.max === 0
          ? "Esta estrategia mantiene el peso: su ritmo es 0."
          : `El ritmo de esta estrategia va de ${range.min} a ${range.max} % del peso por semana.`,
    });
  }
}

/** Lo que hace falta para calcular (sin guardar) el plan de un ciclo nuevo. */
export const cyclePlanSchema = z.object(planFields).superRefine(rateInRange);
export type CyclePlanRequestInput = z.input<typeof cyclePlanSchema>;
export type CyclePlanRequest = z.output<typeof cyclePlanSchema>;

/** Confirmación: el plan + guardas de idempotencia y de obsolescencia. */
export const cycleStartSchema = z
  .object({
    ...planFields,
    requestId: z.uuid(),
    /** El ciclo activo que la persona vio al empezar el flujo (o ninguno). */
    expectedActiveGoalId: z.string().min(1).max(64).nullable(),
    /** Cómo se cierra el ciclo activo, si lo hay. */
    closeOutcome: CycleOutcome.nullable(),
    /** kcal del plan que vio la persona. El servidor recalcula y compara. */
    expectedKcal: kcal,
  })
  .superRefine(rateInRange);
export type CycleStartInput = z.input<typeof cycleStartSchema>;
export type CycleStartData = z.output<typeof cycleStartSchema>;
