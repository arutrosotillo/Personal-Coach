import { z } from "zod";

/**
 * Validación de las peticiones a Coach AI. La pregunta libre se acota en
 * longitud y se limpia de caracteres de control: viaja a un modelo, así que
 * entra por la frontera de confianza como cualquier otro input.
 */

export const coachTaskSchema = z.enum(["WEEKLY", "EXERCISE", "EXPLAIN", "ASK"]);

/** Elimina caracteres de control (posible vector de inyección/formato). */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export const coachRequestSchema = z
  .object({
    task: coachTaskSchema,
    variantId: z.string().min(1).max(64).nullable().optional(),
    question: z
      .string()
      .trim()
      .min(3, "Escribe una pregunta un poco más larga")
      .max(500, "Máximo 500 caracteres")
      .transform((s) => s.replace(CONTROL_CHARS, " "))
      .nullable()
      .optional(),
  })
  .refine((v) => v.task !== "ASK" || (v.question?.length ?? 0) >= 3, {
    message: "Escribe una pregunta",
    path: ["question"],
  })
  .refine(
    (v) => (v.task !== "EXERCISE" && v.task !== "EXPLAIN") || !!v.variantId,
    { message: "Falta el ejercicio", path: ["variantId"] },
  );

export type CoachRequestInput = z.input<typeof coachRequestSchema>;
export type CoachRequestData = z.output<typeof coachRequestSchema>;
