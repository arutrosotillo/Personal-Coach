import type {
  ProgressionSignal,
  ProgressionSuggestion,
} from "@/core/training/progression";

/**
 * Precedencia de la salud y la recuperación sobre la progresión
 * (COACH_PHILOSOPHY §2: "salud —dolor— veta todo lo demás", y un deload
 * recomendado suprime subidas de carga y volumen).
 *
 * Estaba escrito en la filosofía y no en el código: se podía leer "cambia o
 * retira el ejercicio que te duele" en la tarjeta de recuperación y "sube a
 * 85 kg" en la pantalla de sesión, en la misma visita. Esto lo cierra.
 *
 * Qué hace y qué NO hace:
 *   · convierte una SUBIDA DE CARGA en HOLD sobre el mismo peso de referencia;
 *   · no toca `ADD_REP` (progresar en repeticiones dentro del rango no añade
 *     carga y es justo lo que conviene hacer una semana de descarga);
 *   · nunca BAJA la carga: eso lo decide el rendimiento medido, no el ánimo;
 *   · conserva la decisión original en una señal, así que no se pierde nada.
 *
 * El veto se aplica DESPUÉS de que el motor de fatiga haya emitido su
 * veredicto y jamás realimenta su score: si lo hiciera, el propio veto
 * acabaría contando como evidencia de fatiga.
 */

export type RecoveryVeto =
  { kind: "JOINT_PAIN"; message: string } | { kind: "DELOAD"; message: string };

/** Acciones que añaden estímulo y que, por tanto, el veto suspende. */
const VETOABLE = new Set(["INCREASE_LOAD"]);

export function applyRecoveryVeto(
  suggestion: ProgressionSuggestion,
  veto: RecoveryVeto | null,
): ProgressionSuggestion {
  if (veto === null || !VETOABLE.has(suggestion.action)) return suggestion;

  const hold = suggestion.numbers.pesoRef;
  const original: ProgressionSignal = {
    code: "VETO_SUSPENDED_INCREASE",
    message: `Sin el aviso de recuperación, el motor te habría subido a ${suggestion.suggestedWeightKg} kg (${suggestion.reasonCode}). La subida no se pierde: en cuanto se resuelva, sigue ahí.`,
    numbers: { pesoSuspendido: suggestion.suggestedWeightKg ?? 0 },
  };

  return {
    ...suggestion,
    action: "HOLD",
    reasonCode: "RECOVERY_VETO",
    suggestedWeightKg: hold,
    suggestedReps: suggestion.setTargets
      ? Math.min(...suggestion.setTargets)
      : suggestion.suggestedReps,
    explanation: `${veto.message} Así que hoy no te subo la carga: quédate en ${hold} kg. ${
      veto.kind === "JOINT_PAIN"
        ? "El dolor manda sobre cualquier otra señal."
        : "Subir carga mientras acumulas fatiga es justo lo que la alarga."
    }`,
    signals: [...suggestion.signals, original],
  };
}
