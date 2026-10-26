/**
 * Cambio de equipamiento: tramos de cargas COMPARABLES por variante. Puro.
 *
 * Al cambiar de gimnasio, "Prensa 45°" sigue siendo la misma variante —el
 * mismo movimiento, el mismo historial—, pero la máquina es otra y 100 kg en
 * una no son 100 kg en la otra. Comparar esas cargas es lo que fabricaba
 * cargas atípicas, regresiones y descargas falsas.
 *
 * El modelo es mínimo a propósito: cada `EquipmentChange` de una variante abre
 * un tramo nuevo, que dura hasta el siguiente cambio de esa variante. Dentro
 * de un tramo las cargas se comparan; entre tramos, nunca. No hay "gimnasios"
 * que mantener: cambiar otra vez es otro punto más, y el historial entero
 * sigue ahí.
 */

/** Primer día de una variante con un equipamiento nuevo. */
export interface EquipmentChangePoint {
  variantId: string;
  /** localDate, inclusive. */
  sinceLocalDate: string;
}

/** Tramo de cargas comparables de una variante, visto en un día concreto. */
export interface LoadSegment {
  /** Inicio del tramo vigente; `null` = sin cambios vigentes (todo comparable). */
  since: string | null;
  /**
   * Inicio del tramo ANTERIOR, si lo hay. `null` con `since` puesto significa
   * que el tramo anterior viene desde el principio del historial.
   */
  previousSince: string | null;
}

export const NO_SEGMENT: LoadSegment = { since: null, previousSince: null };

/**
 * Tramo vigente de `variantId` el día `onLocalDate`. Un cambio con fecha
 * posterior todavía no está en vigor: se puede registrar la mudanza por
 * adelantado y hasta ese día no cambia nada.
 */
export function loadSegmentOn(
  changes: readonly EquipmentChangePoint[],
  variantId: string,
  onLocalDate: string,
): LoadSegment {
  const dates = changes
    .filter((c) => c.variantId === variantId && c.sinceLocalDate <= onLocalDate)
    .map((c) => c.sinceLocalDate)
    .sort();
  if (dates.length === 0) return NO_SEGMENT;
  return {
    since: dates[dates.length - 1],
    previousSince: dates.length >= 2 ? dates[dates.length - 2] : null,
  };
}

/**
 * Reparte las exposiciones (cualquier cosa con `localDate`) entre el tramo
 * vigente (`comparable`) y el inmediatamente anterior (`previous`). Lo que
 * queda más atrás no se compara con ninguno de los dos y no se devuelve.
 * Conserva el orden de entrada.
 */
export function splitBySegment<T extends { localDate: string }>(
  items: readonly T[],
  segment: LoadSegment,
): { comparable: T[]; previous: T[] } {
  if (segment.since === null) return { comparable: [...items], previous: [] };
  const since = segment.since;
  const previousSince = segment.previousSince;
  return {
    comparable: items.filter((x) => x.localDate >= since),
    previous: items.filter(
      (x) =>
        x.localDate < since &&
        (previousSince === null || x.localDate >= previousSince),
    ),
  };
}
