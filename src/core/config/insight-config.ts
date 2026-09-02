/**
 * Umbrales del motor de insights cuerpo × rendimiento (`src/core/insights/`).
 *
 * PRINCIPIO: este motor OBSERVA. Puede afirmar que dos cosas ocurren a la vez;
 * no puede afirmar que una explique la otra. Todos los números de abajo están
 * calibrados para callarse antes que para hablar de más.
 */
export const INSIGHT_CONFIG = {
  // ── Cuándo un ejercicio puede juzgarse ─────────────────────────────────────
  /**
   * Exposiciones mínimas de una variante para que su estado cuente.
   *
   * [HEURÍSTICA] Tres es el mínimo con el que se puede hablar de dirección:
   * con dos, cualquier oscilación normal de la doble progresión parece una
   * tendencia. Es además lo que hace que un CAMBIO DE EJERCICIO no genere
   * ruido: la variante nueva simplemente no cuenta hasta su tercera sesión.
   */
  minExposuresPerVariant: 3,

  /**
   * Días desde la última exposición a partir de los cuales una variante deja
   * de decir nada del presente. [HEURÍSTICA] Tres semanas: por encima de eso
   * el motor de progresión ya marca el historial como rancio.
   */
  staleVariantDays: 21,

  // ── Agregación ─────────────────────────────────────────────────────────────
  /**
   * Variantes juzgables mínimas para emitir un veredicto global. Con menos, el
   * rendimiento es `INSUFFICIENT_DATA`: no se puede resumir un entrenamiento
   * entero mirando uno o dos ejercicios.
   */
  minJudgedVariants: 3,

  /**
   * Para declarar DECLINING hacen falta las DOS cosas: al menos este número de
   * variantes en retroceso Y al menos esta proporción del total juzgado.
   *
   * Es la regla que impide que un curl de bíceps estancado convierta todo el
   * entrenamiento en "rendimiento cayendo". Con 8 variantes juzgadas, una sola
   * en retroceso es el 12 %: no basta ni por número ni por proporción.
   */
  decliningMinCount: 2,
  decliningMinShare: 1 / 3,

  /**
   * Para declarar IMPROVING: esta proporción progresando Y ninguna en
   * retroceso. Si algo va hacia atrás, el veredicto global no puede ser
   * "mejorando" por mucho que el resto suba.
   */
  improvingMinShare: 0.5,

  /**
   * Ventana en la que una descarga BLOQUEA el veredicto DECLINING.
   *
   * Una semana de descarga tiene menos series y menos carga A PROPÓSITO.
   * Leerla como caída de rendimiento sería confundir el tratamiento con la
   * enfermedad. Catorce días cubren la descarga y la semana siguiente, que es
   * cuando el rendimiento todavía se está recuperando.
   */
  deloadBlockWindowDays: 14,
} as const;

export type InsightConfig = typeof INSIGHT_CONFIG;
