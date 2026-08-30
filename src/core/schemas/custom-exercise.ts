import { z } from "zod";

import {
  Contraindication,
  Equipment,
  MovementPattern,
  MuscleGroupCode,
} from "@/core/enums";

/**
 * Ejercicio propio: lo que una persona añade al banco cuando su gimnasio tiene
 * algo que el catálogo del seed no cubre.
 *
 * La validación es estricta a propósito. El ejercicio no es un adorno de la UI:
 * alimenta el conteo de VOLUMEN EFECTIVO por músculo, el RIR por defecto (vía
 * patrón + fatiga sistémica) y el presupuesto de tiempo de la sesión. Un
 * ejercicio sin músculo primario, o con factores inventados, contamina esos
 * motores en silencio. Por eso aquí se exige exactamente lo que el catálogo del
 * seed ya cumple, y no menos.
 */

/**
 * Factores permitidos para los músculos SECUNDARIOS: los mismos "cubos" que usa
 * el catálogo (`src/core/catalog/exercises.ts`), no un número libre. Es una
 * aproximación operativa para contar volumen, no fisiología medida: un slider
 * continuo daría una precisión que el dato no tiene.
 */
export const SECONDARY_FACTORS = [0.75, 0.5, 0.25] as const;
export type SecondaryFactor = (typeof SECONDARY_FACTORS)[number];

/** El músculo PRIMARIO siempre cuenta 1.0. No es configurable. */
export const PRIMARY_FACTOR = 1.0;

/** Cuántos secundarios admite un ejercicio. El del seed con más tiene 3. */
export const MAX_SECONDARY_MUSCLES = 5;

const secondaryMuscleSchema = z.object({
  group: MuscleGroupCode,
  factor: z
    .number()
    .refine(
      (f): f is (typeof SECONDARY_FACTORS)[number] =>
        (SECONDARY_FACTORS as readonly number[]).includes(f),
      "El factor de un músculo secundario solo puede ser 0,75 · 0,5 · 0,25",
    ),
});

export const customExerciseSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "El nombre necesita al menos 3 caracteres")
      .max(60, "Máximo 60 caracteres"),
    movementPattern: MovementPattern,
    /**
     * Coste sistémico 1..3. Decide el RIR por defecto (`defaultTargetRir`) y el
     * coste en minutos por serie: un 3 es una sentadilla o un peso muerto, no
     * "un ejercicio que me deja hecho polvo".
     */
    systemicFatigue: z
      .number()
      .int()
      .min(1, "La exigencia va de 1 a 3")
      .max(3, "La exigencia va de 1 a 3"),
    instructions: z.string().trim().max(400).optional(),

    primaryMuscle: MuscleGroupCode,
    secondaryMuscles: z
      .array(secondaryMuscleSchema)
      .max(
        MAX_SECONDARY_MUSCLES,
        `Máximo ${MAX_SECONDARY_MUSCLES} músculos secundarios`,
      )
      .default([]),

    // ── Variante única con la que nace el ejercicio ──────────────────────────
    variantName: z
      .string()
      .trim()
      .min(1, "La variante necesita un nombre")
      .max(40, "Máximo 40 caracteres"),
    equipment: Equipment,
    /**
     * Incremento REAL del material. Es el paso con el que el motor de
     * progresión sube la carga, así que un valor inventado produce
     * sugerencias imposibles ("sube a 63,7 kg"). `0` = sin carga externa
     * cuantificable (peso corporal, banda): el motor lo detecta y progresa
     * por repeticiones en vez de por kilos.
     */
    loadStepKg: z
      .number()
      .min(0, "El incremento no puede ser negativo")
      .max(25, "Un incremento mayor de 25 kg no es un incremento"),
    repRangeMin: z.number().int().min(1).max(50),
    repRangeMax: z.number().int().min(1).max(50),
    restSeconds: z.number().int().min(30).max(600),
    contraindications: z.array(Contraindication).default([]),
  })
  .refine((v) => v.repRangeMax >= v.repRangeMin, {
    message: "El techo del rango no puede ser menor que el mínimo",
    path: ["repRangeMax"],
  })
  .refine((v) => !v.secondaryMuscles.some((m) => m.group === v.primaryMuscle), {
    message: "El músculo principal no puede repetirse como secundario",
    path: ["secondaryMuscles"],
  })
  .refine(
    (v) =>
      new Set(v.secondaryMuscles.map((m) => m.group)).size ===
      v.secondaryMuscles.length,
    {
      message: "Hay un músculo secundario repetido",
      path: ["secondaryMuscles"],
    },
  );

export type CustomExerciseInput = z.output<typeof customExerciseSchema>;
