import type {
  BodyFatReliability,
  GoalStrategy,
  GoalType,
  WaistProtocol,
} from "@/core/enums";

/**
 * Tipos del motor de seguimiento corporal.
 *
 * UNIDADES POR TIPO, no por convención. `Kg` y `Cm` son números "marcados":
 * en tiempo de ejecución son un `number` normal y no cuestan nada, pero el
 * compilador impide pasar centímetros donde van kilos. La frontera —el
 * repositorio que lee de Prisma— tiene que marcarlos explícitamente con `kg()`
 * y `cm()`, y ese acto deliberado es justo donde se detectaría el error.
 *
 * Lo que la marca SÍ evita: confundir dos campos del mismo tipo primitivo
 * (`waistCm` donde iba `weightKg`). Lo que NO evita: que alguien construya
 * `kg(185)` con un peso en libras. Contra eso solo hay validación de rango, que
 * vive en el schema Zod de la frontera, no aquí: el motor es total y no lanza.
 */

declare const unit: unique symbol;
type Unit<T, U extends string> = T & { readonly [unit]: U };

/** Kilogramos. La base de datos SIEMPRE es métrica (ver CLAUDE.md). */
export type Kg = Unit<number, "kg">;
/** Centímetros. */
export type Cm = Unit<number, "cm">;
/** Puntos porcentuales de grasa corporal (no una fracción: 15,5 es 15,5 %). */
export type PctPoints = Unit<number, "pctPoints">;

export const kg = (value: number): Kg => value as Kg;
export const cm = (value: number): Cm => value as Cm;
export const pctPoints = (value: number): PctPoints => value as PctPoints;

/**
 * Una fila de `BodyMeasurement` tal como la ve el motor.
 *
 * `localDate` es "YYYY-MM-DD" (día del usuario). El motor NUNCA construye
 * fechas: todo lo que necesita saber del calendario entra por aquí y por
 * `todayLocalDate`.
 *
 * CINTURA: el motor asume que `waistCm` YA es el valor representativo del día.
 * Hoy eso es una única toma, que es lo que guarda el modelo de datos; el día
 * que el check-in pida tres tomas y guarde su media, el motor no cambia —
 * cambia `BODY_CONFIG.waistMinDetectableChangeCm`.
 */
export interface BodyMeasurementPoint {
  localDate: string;
  weightKg: Kg | null;
  waistCm: Cm | null;
  /**
   * Con cuántas tomas se obtuvo `waistCm`. `null` = desconocido, y se trata
   * como `SINGLE`: es el caso de todo lo anterior a B4 y de lo anotado a mano.
   */
  waistProtocol: WaistProtocol | null;
  bodyFatPct: PctPoints | null;
  /** enum BodyFatReliability. `null` cuando no hay `bodyFatPct`. */
  bodyFatReliability: BodyFatReliability | null;
}

/** Objetivo activo, solo para COMPARAR. El motor jamás lo modifica. */
export interface BodyGoalInput {
  type: GoalType;
  strategy: GoalStrategy;
  /** % del peso corporal por semana. Negativo = pérdida. */
  weeklyRatePct: number;
  startWeightKg: Kg;
  targetWeightKg: Kg | null;
}

export interface BodyAnalysisInput {
  /** Historial completo. Puede venir en cualquier orden y con huecos. */
  measurements: readonly BodyMeasurementPoint[];
  /**
   * Fecha de corte. Obligatoria y explícita: el motor no lee el reloj del
   * sistema. Nada posterior a este día entra en el análisis.
   */
  todayLocalDate: string;
  goal: BodyGoalInput | null;
  /**
   * Inicio de la FASE que se está analizando. Opcional; si va, nada anterior a
   * este día entra en ningún cálculo.
   *
   * Existe para que una tendencia de una etapa anterior no contamine la
   * actual: los 6 kg que perdiste en definición no deben seguir tirando de la
   * pendiente cuando ya llevas tres semanas de volumen. El consumidor natural
   * es `Goal.startDate` —cambiar de objetivo abre una fase nueva—, pero el
   * motor no sabe nada de objetivos: recibe una fecha y punto.
   *
   * Sin él, el análisis abarca todo el historial (recortado por las ventanas y
   * los horizontes máximos de cada métrica).
   */
  analysisStartLocalDate?: string | null;
}

// ── Estados ──────────────────────────────────────────────────────────────────

/**
 * Veredicto de la tendencia de peso.
 *
 * `INCONCLUSIVE` no es un fallo: es el resultado honesto cuando hay datos
 * suficientes pero el intervalo de confianza no excluye el cero. Se distingue a
 * propósito de `INSUFFICIENT_DATA`, que significa "ni siquiera puedo calcular".
 */
export type WeightTrendStatus =
  "INSUFFICIENT_DATA" | "INCONCLUSIVE" | "LOSING" | "MAINTAINING" | "GAINING";

export type WaistTrendStatus =
  | "INSUFFICIENT_DATA"
  | "WITHIN_MEASUREMENT_ERROR"
  | "DECREASING"
  | "INCREASING";

export type BodyFatTrendStatus =
  | "NOT_RECORDED"
  | "INSUFFICIENT_DATA"
  /** Hay lecturas, pero de procedencias distintas: no son comparables. */
  | "MIXED_RELIABILITY"
  | "NOT_INTERPRETABLE"
  | "DECREASING"
  | "INCREASING";

/**
 * Por qué el motor dijo lo que dijo. Uno por veredicto, para que la capa de
 * presentación (B3/B5) nunca tenga que reconstruir el razonamiento a partir de
 * los números.
 */
export type BodyReasonCode =
  | "NO_MEASUREMENTS"
  | "TOO_FEW_MEASUREMENTS"
  | "SPARSE_MEASUREMENTS"
  | "SPAN_TOO_SHORT"
  | "CONFIDENCE_INTERVAL_INCLUDES_ZERO"
  | "CONFIDENCE_INTERVAL_WITHIN_FLAT_BAND"
  | "CONFIDENCE_INTERVAL_BELOW_ZERO"
  | "CONFIDENCE_INTERVAL_ABOVE_ZERO"
  | "CHANGE_BELOW_MEASUREMENT_ERROR"
  | "CHANGE_ABOVE_MEASUREMENT_ERROR"
  | "BODY_FAT_RELIABILITY_CHANGED"
  | "BODY_FAT_CHANGE_BELOW_ERROR";

/**
 * Confianza en tres niveles. Nunca porcentajes (CLAUDE.md).
 *
 * OJO CON LA LECTURA: mide la PRECISIÓN de la estimación, no la seguridad del
 * veredicto. Un `INCONCLUSIVE` con confianza `HIGH` no es una contradicción:
 * significa "tengo una estimación precisa y aun así no puedo darte una
 * dirección", es decir, sé con bastante certeza que no hay una tendencia
 * grande en ningún sentido. Quien lo pinte tiene que redactarlo así.
 */
export type BodyConfidence = "LOW" | "MEDIUM" | "HIGH";

// ── Salidas ──────────────────────────────────────────────────────────────────

/** Un punto de la serie tal como se dibujaría. El crudo va SIEMPRE intacto. */
export interface SmoothedPoint {
  localDate: string;
  /** El valor original, sin tocar. */
  rawKg: Kg;
  /** El valor usado en los cálculos: igual al crudo salvo que se winsorizara. */
  usedKg: Kg;
  /** Media móvil exponencial. SOLO para dibujar: no decide nada. */
  emaKg: Kg;
  /** `true` si el crudo se salía de la banda y se acotó. */
  winsorized: boolean;
  /** Días transcurridos desde el punto anterior de la serie (0 en el primero). */
  gapDays: number;
}

export interface LinearTrend {
  /** Pendiente, en unidades por SEMANA. */
  slopePerWeek: number;
  /** Extremos del intervalo de confianza de la pendiente, por semana. */
  ciLowPerWeek: number;
  ciHighPerWeek: number;
  /** Semianchura del intervalo (`slope ± halfWidth`). */
  ciHalfWidthPerWeek: number;
  /** Desviación típica de los residuos, en unidades de la medida. */
  residualSd: number;
  /** Puntos usados. */
  n: number;
  /** Días entre la primera y la última medición usadas. */
  spanDays: number;
}

export interface WeightAnalysis {
  status: WeightTrendStatus;
  reasonCode: BodyReasonCode;
  confidence: BodyConfidence;
  /** Ventana en días efectivamente usada, o `null` si no se pudo elegir. */
  windowDays: number | null;
  /** `null` cuando no hay tendencia calculable. */
  trend: LinearTrend | null;
  /** Última medición dentro del corte. */
  latestKg: Kg | null;
  latestLocalDate: string | null;
  /** Valor suavizado en la última medición. Para mostrar, no para decidir. */
  latestEmaKg: Kg | null;
  /** Diferencia entre la primera y la última medición de TODO el historial. */
  totalChangeKg: number | null;
  /** Serie completa suavizada, en orden cronológico. */
  series: readonly SmoothedPoint[];
  /** Mediciones dentro de la ventana elegida (o de la más corta, si ninguna). */
  measurementsInWindow: number;
}

export interface WaistAnalysis {
  status: WaistTrendStatus;
  reasonCode: BodyReasonCode;
  confidence: BodyConfidence;
  trend: LinearTrend | null;
  /** Cambio AJUSTADO sobre el span (pendiente × span), no la resta de extremos. */
  fittedChangeCm: number | null;
  /** El umbral contra el que se comparó, para que la UI pueda dibujarlo. */
  minDetectableChangeCm: number;
  /**
   * Qué protocolo respalda ese umbral. `MIXED` cuando en la ventana conviven
   * medidas de una toma y de tres: entonces manda el peor de los dos, porque
   * una serie no puede ser más precisa que su medida más burda.
   */
  protocol: WaistProtocol | "MIXED" | null;
  latestCm: Cm | null;
  latestLocalDate: string | null;
  measurementsUsed: number;
}

export interface BodyFatAnalysis {
  status: BodyFatTrendStatus;
  reasonCode: BodyReasonCode | null;
  confidence: BodyConfidence;
  /**
   * Cambio en puntos porcentuales entre la primera y la última lectura
   * COMPARABLES (misma procedencia). El dato principal: el valor absoluto de
   * una estimación de grasa no es un dato clínico y no debe presentarse como
   * tal.
   */
  changePp: number | null;
  /** Umbral de interpretabilidad aplicado. */
  minInterpretableChangePp: number;
  /**
   * Último valor. Se expone porque la UI lo necesita, SIEMPRE junto a su
   * procedencia y su error. Nunca como cifra exacta.
   */
  latestPct: PctPoints | null;
  latestReliability: BodyFatReliability | null;
  latestLocalDate: string | null;
  /** Procedencia común de las lecturas comparadas. */
  comparedReliability: BodyFatReliability | null;
  /** Había lecturas de otra procedencia y se dejaron fuera. */
  excludedByReliability: number;
  spanDays: number | null;
  measurementsUsed: number;
}

/**
 * Comparación con el objetivo. SOLO números: el motor no juzga ni redacta.
 * Los mensajes son de B5, no de aquí.
 */
export interface GoalComparison {
  goalType: GoalType;
  strategy: GoalStrategy;
  /** Ritmo objetivo del `Goal`, en % del peso por semana. */
  targetPctPerWeek: number;
  /** El mismo ritmo en kg/semana, sobre el peso suavizado actual. */
  targetKgPerWeek: number | null;
  /** Peso de referencia usado para convertir el % en kg. */
  referenceWeightKg: Kg | null;
  /** Dirección que el objetivo espera del peso. */
  expectedDirection: "DOWN" | "UP" | "FLAT";
  /** Pendiente observada, o `null` si la tendencia no es afirmable. */
  observedKgPerWeek: number | null;
  /** observado / objetivo. `null` si el objetivo es 0 o no hay tendencia. */
  ratio: number | null;
  targetWeightKg: Kg | null;
  /** Kg que faltan hasta el peso objetivo (positivo = hay que subir). */
  kgToTargetWeight: number | null;
}

export interface BodyAnalysis {
  /** Eco de la fecha de corte con la que se calculó todo. */
  todayLocalDate: string;
  /** Eco del inicio de fase aplicado, o `null` si se analizó todo el historial. */
  analysisStartLocalDate: string | null;
  engineVersion: string;
  weight: WeightAnalysis;
  waist: WaistAnalysis;
  bodyFat: BodyFatAnalysis;
  /** `null` si no hay objetivo activo. */
  goal: GoalComparison | null;
}
