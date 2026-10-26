import { z } from "zod";

import { isLocalDate } from "@/core/dates";

/**
 * Frontera de validación del cambio de gimnasio. Sin `profileId` —sale de la
 * sesión— y sin decidir aquí qué variantes son visibles: eso lo comprueba el
 * servicio en la misma consulta que las escribe.
 *
 * El rango de fechas respecto a hoy (`EQUIPMENT_CHANGE.MAX_DAYS_*`) también es
 * del servicio: depende del reloj, y el schema no lo mira.
 */

export const GYM_CHANGE_LABEL_MAX = 60;
/** Más que cualquier programa razonable; es un tope contra peticiones absurdas. */
export const GYM_CHANGE_MAX_VARIANTS = 80;

export const gymChangeSchema = z.object({
  /** Primer día en el gimnasio nuevo. */
  localDate: z
    .string()
    .refine(isLocalDate, "Fecha inválida (formato AAAA-MM-DD)"),
  /** Nombre opcional del gimnasio, solo para reconocerlo en la lista. */
  label: z
    .string()
    .trim()
    .max(
      GYM_CHANGE_LABEL_MAX,
      `El nombre no puede pasar de ${GYM_CHANGE_LABEL_MAX} caracteres`,
    )
    .nullish()
    .transform((v) => (v ? v : null)),
  /**
   * Variantes que pasan a usar OTRO equipamiento. Puede ir vacía: el cambio
   * queda registrado y todas las cargas siguen siendo comparables.
   */
  variantIds: z
    .array(z.string().min(1).max(64))
    .max(GYM_CHANGE_MAX_VARIANTS)
    .transform((ids) => [...new Set(ids)]),
});
export type GymChangeInput = z.input<typeof gymChangeSchema>;
export type GymChangeData = z.output<typeof gymChangeSchema>;

/** Alta: lo mismo más la clave de idempotencia que genera el cliente. */
export const gymChangeCreateSchema = gymChangeSchema.extend({
  requestId: z.uuid(),
});
export type GymChangeCreateInput = z.input<typeof gymChangeCreateSchema>;
export type GymChangeCreateData = z.output<typeof gymChangeCreateSchema>;
