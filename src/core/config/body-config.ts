/**
 * Umbrales y defaults del motor de seguimiento corporal (`src/core/body/`).
 * Ningún número de este dominio debe estar hardcodeado fuera de este archivo.
 *
 * PRINCIPIO: la báscula no afirma nada por sí sola. Solo una TENDENCIA con su
 * incertidumbre declarada puede afirmar algo, y cuando el intervalo de
 * confianza no excluye el cero la respuesta correcta es "todavía no lo sé".
 *
 * FUERZA DE LA EVIDENCIA de cada número, con el mismo criterio que
 * `src/core/science`:
 *   · [FUERTE]     revisión sistemática, meta-análisis o ECA replicado.
 *   · [RAZONABLE]  ECA único, consenso o estudio de validación sólido.
 *   · [HEURÍSTICA] extrapolación, aritmética derivada o decisión de producto.
 */

/** Un escalón de la escalera de ventanas de tendencia. */
export interface TrendWindow {
  readonly days: number;
  readonly minMeasurements: number;
  readonly minSpanDays: number;
}

/**
 * Forma de la configuración del motor. Se declara explícitamente (en vez de
 * inferirla con `as const`) para que los tests puedan construir variantes
 * —otra escalera de ventanas, otro umbral— y comparar políticas sobre el
 * MISMO código, en lugar de reimplementar el algoritmo en el test.
 */
export interface BodyConfig {
  readonly emaAlpha: number;
  readonly outlierClampPct: number;
  readonly trendWindows: readonly TrendWindow[];
  readonly confidenceLevel: number;
  readonly confidenceCiHalfWidthKgPerWeek: {
    readonly high: number;
    readonly medium: number;
  };
  readonly flatBandPctPerWeek: number;
  readonly waistMinDetectableChangeCm: number;
  readonly waistMinDetectableChangeCmMeanOfThree: number;
  readonly waistTakeMaxSpreadCm: number;
  readonly checkInIntervalDays: number;
  readonly waistMinSpanDays: number;
  readonly waistMinMeasurements: number;
  readonly waistLookbackDays: number;
  readonly bodyFatMinChangePp: number;
  readonly bodyFatMinSpanDays: number;
  readonly bodyFatMinMeasurements: number;
  readonly bodyFatLookbackDays: number;
}

export const BODY_CONFIG: BodyConfig = {
  // ── Suavizado (SOLO para la línea del gráfico) ─────────────────────────────
  /**
   * Constante de la media móvil exponencial.
   *
   * [HEURÍSTICA] — y hay que decirlo. El α = 0,10 de la spec anterior viene de
   * "The Hacker's Diet" (John Walker, 1991), que es ingeniería de señal
   * razonable de un programador: no está revisado por pares, no tiene ensayo y
   * no está indexado. Aquí se sube a 0,15 por una razón funcional, no
   * científica: con α = 0,10 la EMA tarda 9 días en reaccionar a un cambio real
   * de pendiente y 28 en reflejarlo del todo, demasiado para una app que quiere
   * decir algo cada dos semanas. Con 0,15 el retardo baja a ~5,7 días
   * (≈12 días de media móvil equivalente) a cambio de algo más de ruido
   * residual (0,14 kg frente a 0,11 kg con una desviación diaria de 0,5 kg).
   *
   * La EMA NO decide nada: es la línea que se dibuja. Las afirmaciones salen de
   * la regresión.
   */
  emaAlpha: 0.15,

  /**
   * Winsorización de atípicos, en fracción del valor suavizado previo.
   * [HEURÍSTICA] Heredado de la spec anterior y mantenido: con una desviación
   * típica diaria de ~0,5 kg sobre 80 kg (≈0,6 %), un 2,5 % son ~2 kg. Deja
   * pasar el ruido fisiológico normal y corta el error de tecleo.
   *
   * Winsorizar ACOTA el valor, no lo descarta: un pesaje atípico sigue
   * arrastrando la serie en su dirección, solo que sin dominarla. Y nunca toca
   * la medición original: el crudo viaja intacto en la salida.
   */
  outlierClampPct: 0.025,

  // ── Ventanas de tendencia del peso ─────────────────────────────────────────
  /**
   * Escalera de ventanas candidatas, en días. SIEMPRE múltiplos de 7.
   *
   * [FUERTE] El peso tiene ritmo semanal: es más alto domingo y lunes y baja
   * durante la semana (Orsama 2014, `doi:10.1159/000356147`, n=80, 4.657
   * mediciones). Una ventana que no sea múltiplo de 7 mete ese ritmo dentro de
   * la pendiente como si fuera tendencia.
   *
   * ORDEN DE PREFERENCIA, y el array ESTÁ en ese orden: se recorre de arriba
   * abajo y gana la primera que cumple sus requisitos. La elección depende
   * SOLO de los datos disponibles, nunca del resultado: es una única prueba,
   * no un barrido hasta que algo salga significativo.
   *
   * 28 días es la primaria. 21 y 14 cubren a quien todavía no tiene 28 días de
   * historial. 56 es un último recurso para datos tan dispersos que ninguna
   * ventana corta reúne puntos suficientes — NUNCA el default de un usuario
   * maduro.
   *
   * Por qué 28 y no la más larga disponible: probando ambas políticas sobre
   * cambios de régimen simulados (ver `regime-change.test.ts`), recorrer la
   * escalera de mayor a menor deja 56 días como ventana permanente de
   * cualquier usuario con historial, y eso le hace DESCRIBIR EL PASADO. Quien
   * termina una definición y pasa a mantenimiento seguía leyendo "perdiendo
   * peso" durante 5 a 7 semanas. Con 28 primaria, deja de afirmarlo en 1 a 3.
   *
   * Por qué no la más corta: a 14 días el margen de error de la pendiente
   * (~±0,46 kg/sem) se traga cualquier objetivo lento, que saldría
   * INCONCLUSIVE por construcción hiciera lo que hiciera la persona. 28 es el
   * punto donde el margen (~±0,12) ya distingue los ritmos que la app propone.
   *
   * El precio: una ganancia muy conservadora (+0,10 %/semana) sigue sin ser
   * distinguible del cero a 28 días. Es cierto y hay que decirlo así, no
   * fingir precisión.
   *
   * Con 7 días el margen de error de la pendiente es de ±1,30 kg/semana
   * (desviación diaria de 0,5 kg), que no permite afirmar nada útil: por eso
   * 14 es el suelo.
   *
   * El requisito de cada escalón es NÚMERO DE MEDICIONES y SPAN, no densidad.
   * La precisión de una pendiente por mínimos cuadrados es
   * `SE ∝ s / √Sxx`, y `Sxx` crece con el CUADRADO del span: 8 pesajes
   * repartidos en 8 semanas dan un intervalo bastante más estrecho (±0,19
   * kg/sem con s = 0,5) que esos mismos 8 pesajes apretados en 2 semanas
   * (±0,68). Por eso el escalón largo pide POCOS puntos: quien se pesa una vez
   * por semana sí puede tener una tendencia afirmable, solo que a horizonte
   * largo. Exigir densidad le habría cerrado la puerta para siempre, y la
   * evidencia (Madigan 2015) dice justamente que pesarse a diario no supera a
   * pesarse semanalmente.
   */
  trendWindows: [
    /**
     * PRIMARIA. [FUERTE] 28 días es además el suelo del NIH para traducir peso
     * a energía (Hall & Chow 2011, `doi:10.3945/ajcn.111.014399`).
     */
    { days: 28, minMeasurements: 12, minSpanDays: 20 },
    /** Historial todavía corto, o pesajes con huecos. */
    { days: 21, minMeasurements: 10, minSpanDays: 15 },
    /** Historial corto con cadencia casi diaria. */
    { days: 14, minMeasurements: 8, minSpanDays: 10 },
    /**
     * ÚLTIMO RECURSO, no default: solo para datos tan dispersos que ninguna
     * ventana corta reúne puntos suficientes (cadencia semanal o quincenal).
     */
    { days: 56, minMeasurements: 8, minSpanDays: 42 },
  ],

  /** Nivel de confianza de todos los intervalos. */
  confidenceLevel: 0.95,

  /**
   * Corte de la confianza en tres niveles, por semianchura del intervalo de
   * confianza en kg/semana. [HEURÍSTICA de producto] 0,20 es aproximadamente
   * la mitad del objetivo típico de pérdida (−0,5 %/sem ≈ 0,4 kg/sem a 80 kg):
   * por debajo de eso la tendencia distingue de sobra el objetivo del cero.
   */
  confidenceCiHalfWidthKgPerWeek: { high: 0.2, medium: 0.4 },

  /**
   * Semianchura de la banda "prácticamente plano", en % del peso corporal por
   * semana. Si el intervalo de confianza ENTERO cae dentro de ±esta banda, se
   * puede afirmar estabilidad (MAINTAINING) en vez de rendirse.
   *
   * [HEURÍSTICA] 0,15 %/semana, acotada por arriba y por abajo:
   *
   *   · Por arriba, tiene que quedar claramente por debajo del objetivo de
   *     pérdida más suave que la app permite fijar (0,25 %/semana). Al 60 % de
   *     ese valor, alguien que pierde peso al ritmo que pidió NUNCA leerá
   *     "manteniendo".
   *   · Por abajo, tiene que ser ALCANZABLE en la ventana primaria. Este es el
   *     motivo de que no sean 0,10: la banda es un test de equivalencia, así
   *     que exige que el intervalo ENTERO quepa dentro, y a 28 días con ruido
   *     realista el intervalo mide ya ~±0,12 kg/sem. Con la banda en 0,10 %
   *     (0,08 kg/sem a 80 kg) MAINTAINING era inalcanzable salvo con ventanas
   *     de 56 días: en las simulaciones de cambio de régimen, un usuario que
   *     dejaba de perder peso se quedaba en INCONCLUSIVE más de 16 semanas.
   *
   * El precio, explícito: una ganancia muy conservadora (+0,10 %/semana, el
   * objetivo mínimo de LEAN_GAIN) cae dentro de la banda y se leerá como
   * mantenimiento. Es la lectura honesta —a 28 días ese ritmo no se distingue
   * del cero— y por eso `goal.observedKgPerWeek` sigue expuesto para que la
   * comparación con el objetivo la haga quien tenga el objetivo delante.
   */
  flatBandPctPerWeek: 0.15,

  // ── Cintura ────────────────────────────────────────────────────────────────
  /**
   * Cambio mínimo detectable de la cintura, en cm.
   *
   * [RAZONABLE] En automedición doméstica el error técnico de medida llega a
   * 1,93 cm en una sola toma (Barrios 2016, `doi:10.1186/s12874-016-0150-2`,
   * ICC 0,97 frente a técnico, sin sesgo sistemático). Propagado a la
   * diferencia entre dos medidas (1,96 · TEM · √2) da ≈5,4 cm.
   *
   * Se usa el valor de UNA TOMA a propósito: es lo que el modelo de datos
   * guarda hoy (`BodyMeasurement.waistCm`, un valor por día). Cuando el
   * check-in pida tres tomas y guarde su media, el TEM baja a ~1,11 cm y este
   * umbral pasa a 3,1 cm — se cambia AQUÍ, no en la lógica.
   */
  waistMinDetectableChangeCm: 5.4,
  /**
   * El mismo umbral cuando la medida es la MEDIA DE TRES TOMAS. Promediar
   * divide el error técnico por √3 (1,93 → 1,11 cm) y con él el cambio mínimo
   * detectable (5,4 → 3,1 cm).
   *
   * Cuál de los dos se aplica lo decide el protocolo GUARDADO EN CADA
   * MEDICIÓN, no una constante global: las mediciones anteriores a B4 y las
   * anotadas a mano son de una sola toma y no merecen esta precisión. Cuando
   * en la ventana conviven los dos protocolos, manda el peor.
   */
  waistMinDetectableChangeCmMeanOfThree: 3.1,

  /**
   * Diferencia máxima admisible entre la mayor y la menor de las tres tomas.
   * [HEURÍSTICA] Con un error técnico de ~1,9 cm por toma, tres medidas del
   * mismo sitio no deberían separarse 5 cm. Cuando lo hacen, casi siempre es
   * que se midió en puntos distintos o se leyó mal la cinta, y promediarlas
   * daría un número que no representa nada. Se rechaza y se pide repetir en
   * vez de guardar una media sin sentido.
   */
  waistTakeMaxSpreadCm: 5,

  /**
   * Cadencia del check-in corporal, en días.
   * [HEURÍSTICA derivada] A 0,5–0,7 % de peso/semana, superar el error de
   * medida de la cinta lleva de 4 a 8 semanas. Quincenal da unas cuantas
   * mediciones dentro de ese horizonte sin convertirse en una tarea semanal.
   */
  checkInIntervalDays: 14,
  /**
   * Horizonte mínimo para hablar de cintura, en días.
   * [HEURÍSTICA derivada] A 0,5–0,7 % de peso/semana, superar un umbral de
   * varios cm lleva de 4 a 8 semanas. Antes de eso no hay nada que decir.
   */
  waistMinSpanDays: 28,
  waistMinMeasurements: 3,
  /**
   * Horizonte máximo hacia atrás, en días (16 semanas).
   * [HEURÍSTICA] Sin este tope, una cintura medida hace dos años seguiría
   * tirando de la recta y el motor diría "bajando" a quien lleva un año
   * estable. La pregunta que responde el motor es "¿cómo voy AHORA?", no
   * "¿cómo he ido desde siempre".
   */
  waistLookbackDays: 112,

  // ── % graso ────────────────────────────────────────────────────────────────
  /**
   * Cambio mínimo interpretable, en puntos porcentuales.
   *
   * [FUERTE] Siedler & Tinsley 2023 (`doi:10.1017/S0007114522003749`, 15
   * dispositivos contra modelo de 4 compartimentos, n=73): el error estándar
   * del CAMBIO es de 1,7 a 2,6 pp, frente a 3,1–7,5 pp del valor absoluto —el
   * sesgo constante se cancela al restar dos lecturas del mismo aparato—. Por
   * debajo de 2 pp no hay nada que interpretar.
   */
  bodyFatMinChangePp: 2,
  /** [HEURÍSTICA] Es una métrica mensual: antes de un mes no hay señal. */
  bodyFatMinSpanDays: 28,
  bodyFatMinMeasurements: 2,
  /** Horizonte máximo hacia atrás, en días (24 semanas ≈ 6 lecturas mensuales). */
  bodyFatLookbackDays: 168,
};
