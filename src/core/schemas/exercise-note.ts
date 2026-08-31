import { z } from "zod";

/**
 * Nota personal sobre un ejercicio: la señal técnica que uno se apunta para sí
 * ("piernas encogidas", "no bloquear el codo", "el asiento en el 4").
 *
 * A diferencia del resto de esquemas del banco, aquí la validación es mínima a
 * propósito: esto es texto para leer antes de una serie, no un dato que
 * alimente a ningún motor. Ni el conteo de volumen ni la progresión lo miran.
 */

/**
 * Tope de longitud. No es una restricción técnica: una nota que no se lee de un
 * vistazo entre serie y serie no cumple su función, y para lo que pasó un día
 * concreto ya están las notas de la sesión.
 */
export const EXERCISE_NOTE_MAX_LENGTH = 500;

export const exerciseNoteSchema = z.object({
  exerciseId: z.string().min(1, "Falta el ejercicio"),
  /**
   * Vacío es válido y significa BORRAR la nota: guardar un textarea vacío es
   * el gesto natural para quitarla, y no merece un botón aparte.
   */
  text: z
    .string()
    .trim()
    .max(
      EXERCISE_NOTE_MAX_LENGTH,
      `Máximo ${EXERCISE_NOTE_MAX_LENGTH} caracteres`,
    ),
});

export type ExerciseNoteInput = z.infer<typeof exerciseNoteSchema>;
