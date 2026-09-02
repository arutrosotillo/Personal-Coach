import { z } from "zod";

import { BodyFatReliability, WaistProtocol } from "@/core/enums";
import { isLocalDate } from "@/core/dates";

/**
 * Frontera de validación del seguimiento corporal. Se usa en la server action
 * y —cuando llegue B3— también en el formulario, con el mismo schema.
 *
 * DOS COSAS QUE NO ESTÁN AQUÍ, a propósito:
 *
 *   · No hay `profileId`. El dueño de una medición NUNCA lo elige el cliente:
 *     sale de la cookie de sesión vía `requireProfileId()`. Si este schema lo
 *     aceptara, aunque fuera opcional, existiría la posibilidad de escribirlo
 *     desde fuera.
 *   · No hay `id` en el guardado. La identidad de una medición es
 *     (perfil, día), así que guardar es un upsert contra esa clave natural y
 *     no hay ningún id que el cliente pueda apuntar a otro sitio. Solo el
 *     borrado necesita id, y ese va por su propio schema con su guarda.
 *
 * Los rangos replican los del onboarding (`schemas/onboarding.ts`)
 * deliberadamente: son la misma pregunta hecha en dos sitios y deben aceptar
 * exactamente lo mismo. Están duplicados y no importados porque el onboarding
 * ya está en producción con sus propios tests, y acoplarlos haría que tocar uno
 * moviera el otro en silencio.
 */

/** Límites plausibles. Fuera de esto es casi seguro un error de tecleo. */
export const BODY_RANGES = {
  weightKg: { min: 30, max: 300 },
  waistCm: { min: 40, max: 200 },
  bodyFatPct: { min: 3, max: 60 },
} as const;

const localDate = z
  .string()
  .refine(isLocalDate, "Fecha inválida (formato AAAA-MM-DD)");

const optionalNumber = (range: { min: number; max: number }, message: string) =>
  z
    .number()
    .min(range.min, message)
    .max(range.max, message)
    .nullish()
    .transform((v) => v ?? null);

export const bodyMeasurementSchema = z
  .object({
    localDate,
    weightKg: optionalNumber(
      BODY_RANGES.weightKg,
      "El peso debe estar entre 30 y 300 kg. ¿Sobra un dígito?",
    ),
    waistCm: optionalNumber(
      BODY_RANGES.waistCm,
      "La cintura debe estar entre 40 y 200 cm",
    ),
    bodyFatPct: optionalNumber(
      BODY_RANGES.bodyFatPct,
      "El % de grasa debe estar entre 3 y 60",
    ),
    bodyFatReliability: BodyFatReliability.nullish().transform(
      (v) => v ?? null,
    ),
    /**
     * Protocolo de la cintura. Lo pone el SERVIDOR, no el formulario del
     * historial: editar una medida a mano no dice con cuántas tomas se
     * obtuvo. Solo el check-in, que pide las tres, lo declara.
     */
    waistProtocol: WaistProtocol.nullish().transform((v) => v ?? null),
  })
  .superRefine((data, ctx) => {
    // Una fila con todo a null no es una medición: sería una fecha vacía
    // ocupando el hueco del día y desplazando lo que se registre después.
    if (
      data.weightKg === null &&
      data.waistCm === null &&
      data.bodyFatPct === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["weightKg"],
        message: "Anota al menos un dato: peso, cintura o % de grasa.",
      });
    }

    // El % graso y su procedencia van juntos o no van. Un porcentaje sin saber
    // de dónde sale no es comparable con ninguna otra lectura, así que no
    // sirve para una serie temporal; y una procedencia sin porcentaje es un
    // valor huérfano que el motor tendría que ignorar de todas formas.
    if (data.bodyFatPct !== null && data.bodyFatReliability === null) {
      ctx.addIssue({
        code: "custom",
        path: ["bodyFatReliability"],
        message:
          "Indica cómo obtuviste el % de grasa: sin saberlo, dos lecturas no son comparables.",
      });
    }
    if (data.bodyFatPct === null && data.bodyFatReliability !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["bodyFatPct"],
        message: "Has indicado el método pero falta el % de grasa.",
      });
    }
  });

export type BodyMeasurementInput = z.input<typeof bodyMeasurementSchema>;
export type BodyMeasurementData = z.output<typeof bodyMeasurementSchema>;

/**
 * ENTRADA RÁPIDA de peso, la de la tarjeta de "Hoy".
 *
 * Existe aparte de `bodyMeasurementSchema` por una razón concreta, no por
 * comodidad: guardar con el schema completo DECLARA EL DÍA ENTERO, así que un
 * formulario de un solo campo borraría la cintura y el % graso que se hubieran
 * anotado ese mismo día. Se podría haber pedido al cliente que devolviera esos
 * valores intactos, pero entonces no perder datos dependería de que la
 * interfaz se acuerde de reenviarlos. La invariante vive en el servidor:
 * `saveWeight` toca EXCLUSIVAMENTE la columna del peso.
 */
export const quickWeightSchema = z.object({
  localDate,
  weightKg: z
    .number({ error: "Indica tu peso en kg" })
    .min(
      BODY_RANGES.weightKg.min,
      "El peso debe estar entre 30 y 300 kg. ¿Sobra un dígito?",
    )
    .max(
      BODY_RANGES.weightKg.max,
      "El peso debe estar entre 30 y 300 kg. ¿Sobra un dígito?",
    ),
});

export type QuickWeightInput = z.input<typeof quickWeightSchema>;
export type QuickWeightData = z.output<typeof quickWeightSchema>;

/**
 * Borrado. Es la ÚNICA operación que acepta un id del cliente, y por eso el
 * service comprueba la propiedad antes de tocar nada.
 */
export const deleteBodyMeasurementSchema = z.object({
  id: z.string().min(1, "Falta la medición a borrar.").max(64),
});

export type DeleteBodyMeasurementInput = z.infer<
  typeof deleteBodyMeasurementSchema
>;

// ── Check-in corporal (B4) ───────────────────────────────────────────────────

/**
 * Check-in corporal quincenal.
 *
 * CINTURA CON TRES TOMAS. No es un capricho de precisión: el error técnico de
 * una automedición doméstica llega a 1,93 cm por toma, lo que deja el cambio
 * mínimo detectable en ~5,4 cm — tanto que casi ningún progreso real llegaría
 * a superarlo. Promediar tres tomas divide ese error por √3 y baja el umbral a
 * ~3,1 cm (Barrios 2016, `doi:10.1186/s12874-016-0150-2`). Es la intervención
 * de mayor rendimiento de todo el seguimiento corporal, y no cuesta nada.
 *
 * Las tres van juntas o no va ninguna: con dos no se puede promediar tres, y
 * dejar que se rellene una sola por aquí abriría una vía para marcar como
 * MEAN_OF_THREE algo que no lo es.
 *
 * ALCANCE DE LA ESCRITURA. El check-in escribe SOLO lo que enseña. Si no pides
 * el peso, no lo tocas; si no pides el % graso, tampoco. Es la misma regla que
 * gobierna los otros dos formularios de la app: el del historial enseña los
 * tres campos y por eso declara el día entero, y la tarjeta rápida enseña el
 * peso y por eso solo escribe el peso.
 */
const waistTake = (n: number) =>
  z
    .number({ error: `Falta la toma ${n} de cintura` })
    .min(BODY_RANGES.waistCm.min, "La cintura debe estar entre 40 y 200 cm")
    .max(BODY_RANGES.waistCm.max, "La cintura debe estar entre 40 y 200 cm");

/** Diferencia máxima admisible entre la mayor y la menor de las tres tomas. */
export const WAIST_TAKE_MAX_SPREAD_CM = 5;

export const bodyCheckInSchema = z
  .object({
    localDate,
    /** Opcional: si hoy ya hay peso, el check-in no vuelve a pedirlo. */
    weightKg: optionalNumber(
      BODY_RANGES.weightKg,
      "El peso debe estar entre 30 y 300 kg. ¿Sobra un dígito?",
    ),
    waist1: waistTake(1)
      .nullish()
      .transform((v) => v ?? null),
    waist2: waistTake(2)
      .nullish()
      .transform((v) => v ?? null),
    waist3: waistTake(3)
      .nullish()
      .transform((v) => v ?? null),
    bodyFatPct: optionalNumber(
      BODY_RANGES.bodyFatPct,
      "El % de grasa debe estar entre 3 y 60",
    ),
    bodyFatReliability: BodyFatReliability.nullish().transform(
      (v) => v ?? null,
    ),
  })
  .superRefine((data, ctx) => {
    const tomas = [data.waist1, data.waist2, data.waist3];
    const puestas = tomas.filter((t): t is number => t !== null);

    if (puestas.length > 0 && puestas.length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["waist1"],
        message:
          "Mide tres veces seguidas: con una sola toma el margen de error es tan grande que casi ningún cambio real se distingue.",
      });
    }

    if (puestas.length === 3) {
      const spread = Math.max(...puestas) - Math.min(...puestas);
      if (spread > WAIST_TAKE_MAX_SPREAD_CM) {
        ctx.addIssue({
          code: "custom",
          path: ["waist1"],
          message: `Tus tres tomas se diferencian en ${spread.toFixed(1).replace(".", ",")} cm. Suele significar que la cinta no pasó por el mismo sitio: vuelve a medir a la altura del ombligo, sin apretar.`,
        });
      }
    }

    // Un check-in sin nada que anotar no es un check-in.
    if (
      puestas.length === 0 &&
      data.weightKg === null &&
      data.bodyFatPct === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["waist1"],
        message: "Anota al menos un dato antes de guardar.",
      });
    }

    if (data.bodyFatPct !== null && data.bodyFatReliability === null) {
      ctx.addIssue({
        code: "custom",
        path: ["bodyFatReliability"],
        message:
          "Indica cómo obtuviste el % de grasa: sin saberlo, dos lecturas no son comparables.",
      });
    }
  });

export type BodyCheckInInput = z.input<typeof bodyCheckInSchema>;
export type BodyCheckInData = z.output<typeof bodyCheckInSchema>;
