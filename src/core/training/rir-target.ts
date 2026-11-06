import { PROGRESSION } from "@/core/config/training-config";

/**
 * Objetivo de RIR en rango ("RIR 1–2"). Puro.
 *
 * No hay lógica nueva en el motor, y es deliberado. El motor razona con un solo
 * número, `targetRir`, y su banda (`PROGRESSION.RIR_BAND`) ya considera compatible
 * cualquier esfuerzo con `rir >= targetRir − 1`. Un rango de anchura 1 es
 * exactamente eso visto desde quien entrena:
 *
 *   rango 1–2 → targetRir 2 → acepta RIR 1; con RIR 0 frena (esfuerzo mayor).
 *   rango 2–3 → targetRir 3 → acepta RIR 2; con RIR 1 frena.
 *   rango 0–1 → targetRir 1 → acepta RIR 0.
 *
 * Por eso se guarda el extremo SUPERIOR en `targetRir`. Guardar el inferior
 * (RIR 1 para un 1–2) quitaría el freno: con objetivo 1 el motor no marca nunca
 * "esfuerzo mayor", así que llegar al fallo en un básico pasaría sin decir nada.
 *
 * Solo se admiten rangos de anchura `RIR_BAND`. Uno más ancho prometería en
 * pantalla algo que el motor no hace cumplir.
 */

export const RIR_RANGE_ERROR =
  "El rango de RIR tiene que ser de un punto (1–2).";

/** ¿`targetRirMin` describe un rango que el motor hace cumplir? */
export function isValidRirRange(
  targetRir: number,
  targetRirMin: number | null | undefined,
): boolean {
  if (targetRirMin === null || targetRirMin === undefined) return true;
  return targetRirMin === targetRir - PROGRESSION.RIR_BAND;
}

/**
 * El objetivo tal y como se enseña: "2" o "1–2". `targetRirMin` puede faltar en
 * una sesión guardada en el móvil antes de que existiera el rango.
 */
export function formatTargetRir(
  targetRir: number,
  targetRirMin?: number | null,
): string {
  return targetRirMin === null || targetRirMin === undefined
    ? String(targetRir)
    : `${targetRirMin}–${targetRir}`;
}

/** ¿Este RIR cae dentro del objetivo? Sin rango, tiene que ser el valor exacto. */
export function isWithinTargetRir(
  rir: number,
  targetRir: number,
  targetRirMin?: number | null,
): boolean {
  return rir <= targetRir && rir >= (targetRirMin ?? targetRir);
}
