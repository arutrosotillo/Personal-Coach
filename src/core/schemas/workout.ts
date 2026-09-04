import { z } from "zod";

import { SetType } from "@/core/enums";
import { exerciseNoteSchema } from "@/core/schemas/exercise-note";

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

/**
 * Lote de sincronización de una sesión en curso.
 *
 * Es UNA petición con todas las operaciones que quedaron pendientes, no una por
 * operación: con la cobertura de un gimnasio, veinte round-trips secuenciales
 * son veinte oportunidades de que se caiga a medias.
 *
 * `key` y `seq` son opacos para el servidor: los genera el cliente, los devuelve
 * tal cual y sirven para que la cola sepa QUÉ operación confirmó (y no borre una
 * que el usuario reeditó mientras el lote volaba).
 */
const opEnvelope = {
  key: z.string().min(1).max(120),
  seq: z.number().int().min(0),
};

export const setPlannedSetsSchema = z.object({
  workoutExerciseId: z.string().min(1),
  plannedSets: z.number().int().min(1).max(20),
});
export type SetPlannedSetsData = z.output<typeof setPlannedSetsSchema>;

/**
 * El token de idempotencia del cierre. Lo genera el cliente UNA vez al pulsar
 * "Guardar y finalizar" y lo repite en cada reintento; el servidor lo usa para
 * reconocer su propio reintento en vez de contestar "esta valoración no se ha
 * guardado" habiéndose guardado.
 */
export const finishTokenSchema = z.string().min(8).max(64);

export const finishSessionSchema = sessionFeedbackSchema.extend({
  token: finishTokenSchema,
});

/**
 * Guardar la nota personal de una variante desde la sesión. Es el MISMO esquema
 * que usa la ruta online (`exerciseNoteSchema`), reexportado aquí para que el
 * lote lo valide igual: texto completo, vacío = borrar.
 */
export const saveExerciseNoteOpSchema = exerciseNoteSchema;

export const syncOpSchema = z.discriminatedUnion("kind", [
  z.object({
    ...opEnvelope,
    kind: z.literal("LOG_SET"),
    payload: logSetSchema,
  }),
  z.object({
    ...opEnvelope,
    kind: z.literal("SET_PLANNED_SETS"),
    payload: setPlannedSetsSchema,
  }),
  z.object({
    ...opEnvelope,
    kind: z.literal("SAVE_EXERCISE_NOTE"),
    payload: saveExerciseNoteOpSchema,
  }),
  z.object({
    ...opEnvelope,
    kind: z.literal("FINISH_SESSION"),
    payload: finishSessionSchema,
  }),
]);
export type SyncOpInput = z.input<typeof syncOpSchema>;
export type SyncOpData = z.output<typeof syncOpSchema>;

export const syncBatchSchema = z.object({
  sessionId: z.string().min(1),
  // Tope generoso: una sesión larga sin cobertura son decenas de series, no
  // cientos. Un lote mayor que esto no es un entrenamiento.
  ops: z.array(syncOpSchema).min(1).max(200),
});
export type SyncBatchInput = z.input<typeof syncBatchSchema>;
export type SyncBatchData = z.output<typeof syncBatchSchema>;
