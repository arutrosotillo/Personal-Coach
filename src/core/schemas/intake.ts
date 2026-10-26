import { z } from "zod";

import { isLocalDate } from "@/core/dates";

/**
 * Registro de ingesta diario (docs/CYCLES.md §3): el TOTAL comido un día.
 * Opcional, rápido y sin base de datos de alimentos. Sin `profileId` ni `id`:
 * la fila se identifica por (perfil de la sesión, fecha).
 */

export const INTAKE_RANGES = {
  kcal: { min: 300, max: 10000 },
  proteinG: { min: 0, max: 600 },
} as const;

const localDate = z
  .string()
  .refine(isLocalDate, "Fecha inválida (formato AAAA-MM-DD)");

export const intakeSchema = z.object({
  localDate,
  kcal: z
    .number()
    .int("Las kcal van sin decimales")
    .min(
      INTAKE_RANGES.kcal.min,
      "Las kcal del día deben estar entre 300 y 10.000",
    )
    .max(
      INTAKE_RANGES.kcal.max,
      "Las kcal del día deben estar entre 300 y 10.000",
    ),
  proteinG: z
    .number()
    .int("Los gramos van sin decimales")
    .min(INTAKE_RANGES.proteinG.min, "La proteína debe estar entre 0 y 600 g")
    .max(INTAKE_RANGES.proteinG.max, "La proteína debe estar entre 0 y 600 g")
    .nullish()
    .transform((v) => v ?? null),
});
export type IntakeInput = z.input<typeof intakeSchema>;
export type IntakeData = z.output<typeof intakeSchema>;

export const clearIntakeSchema = z.object({ localDate });
