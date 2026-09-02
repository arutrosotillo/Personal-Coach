import {
  analyzeBody,
  BODY_ENGINE_VERSION,
  classifyGoalChange,
  evaluateCheckIn,
} from "@/core/body";
import type {
  BodyAnalysis,
  BodyGoalInput,
  BodyMeasurementPoint,
  CheckInEvaluation,
  GoalChangeKind,
  SmoothedPoint,
} from "@/core/body";
import { cm, kg, pctPoints } from "@/core/body";
import { addDays, DEFAULT_TIMEZONE, diffDays, toLocalDate } from "@/core/dates";
import { GoalStrategy, GoalType, STRATEGY_TO_GOAL_TYPE } from "@/core/enums";
import type {
  BodyCheckInData,
  BodyMeasurementData,
  QuickWeightData,
} from "@/core/schemas/body-measurement";
import {
  analyzeBodyPerformance,
  assessPerformance,
  type BodyPerformanceInsight,
} from "@/core/insights";
import type { GoalUpdateData } from "@/core/schemas/goal-update";
import { getTrainingAnalysis } from "@/server/services/fatigue.service";
import type { TrainingAnalysis } from "@/core/training/analysis";

import { prisma } from "@/server/db";
import { getActiveGoal } from "@/server/repositories/profile.repo";
import {
  deleteMeasurementOwnedBy,
  findMeasurementByDate,
  HISTORY_WINDOW_DAYS,
  listMeasurements,
  upsertMeasurement,
  upsertMeasurementFields,
  upsertWeight,
  type BodyMeasurementRecord,
} from "@/server/repositories/body-measurement.repo";

/**
 * Servicio de seguimiento corporal: orquesta el repositorio y el motor puro de
 * `src/core/body`.
 *
 * TODAS las funciones reciben el `profileId` YA RESUELTO. No leen la sesión, no
 * la adivinan y no aceptan un perfil elegido por quien llama desde fuera: quien
 * lo resuelve es `requireProfileId()` en la server action, a partir de la
 * cookie. Un `profileId` que viaje desde el cliente no llega nunca hasta aquí.
 *
 * El servicio NO escribe nada fuera de `BodyMeasurement`: no toca el objetivo,
 * ni la nutrición, ni el programa. Y no lee `DailyCheckIn.weightKg`, que está
 * obsoleta.
 */

/** Se intenta borrar una medición que no existe o que es de otra persona. */
export class MeasurementNotFoundError extends Error {
  constructor() {
    // Mismo mensaje en los dos casos, a propósito: distinguirlos confirmaría
    // la existencia del dato de otra persona.
    super("Esa medición no existe o no es tuya.");
    this.name = "MeasurementNotFoundError";
  }
}

/** Se intenta registrar una medición con fecha futura. */
export class FutureMeasurementError extends Error {
  constructor() {
    super("No puedes registrar una medición con fecha futura.");
    this.name = "FutureMeasurementError";
  }
}

/**
 * Lo que la pantalla de progreso necesita, y nada más.
 *
 * Deliberadamente NO expone tipos de Prisma. `analysis` es el resultado del
 * motor puro (ya desacoplado de la base de datos por construcción) e `history`
 * son registros del repositorio, que es un tipo propio. Cambiar el schema —
 * añadir columnas, renombrar— no obliga a tocar la interfaz.
 *
 * `history` incluye `id` porque la lista es editable y borrar necesita un id;
 * `analysis.weight.series` no lo lleva porque es para dibujar.
 */
export interface BodyProgressView {
  /**
   * Análisis de la FASE ACTUAL. Acotado por `Goal.startDate`: la tendencia que
   * evalúa un volumen no puede alimentarse de la definición anterior.
   */
  analysis: BodyAnalysis;
  /**
   * Serie suavizada de TODO el historial, solo para dibujar.
   *
   * Existe aparte porque acotar la tendencia a la fase no puede significar
   * borrar el gráfico: los kilos de hace tres meses siguen siendo tuyos y
   * verlos es la mitad del valor de la pantalla. Se calcula con una segunda
   * pasada del motor, sin objetivo y sin recorte de fase.
   */
  chartSeries: readonly SmoothedPoint[];
  /** Día en que empezó la fase actual, para marcarla en el gráfico. */
  phaseStartLocalDate: string | null;
  history: readonly BodyMeasurementRecord[];
  /** Cadencia del check-in corporal. */
  checkIn: CheckInEvaluation;
  /**
   * Cruce cuerpo × rendimiento. `null` cuando no hay ni programa ni historial
   * de entrenamiento con el que cruzar nada.
   *
   * Se calcula sobre el MISMO análisis corporal acotado a la fase: un insight
   * que mezclara la tendencia de la definición anterior con el entrenamiento
   * de esta semana sería justo lo que B4 vino a evitar.
   */
  insight: BodyPerformanceInsight | null;
  engineVersion: string;
}

/** Día de hoy en la zona del perfil. Único punto donde se mira el reloj. */
function today(now: Date): string {
  return toLocalDate(now, DEFAULT_TIMEZONE);
}

/**
 * Mapea del repositorio al motor. Aquí es donde los números sueltos se marcan
 * como kilos o centímetros: es un acto deliberado y en un solo sitio, que es
 * justo lo que hace útil el marcado de tipos.
 */
function toEnginePoints(
  records: readonly BodyMeasurementRecord[],
): BodyMeasurementPoint[] {
  return records.map((r) => ({
    localDate: r.localDate,
    weightKg: r.weightKg === null ? null : kg(r.weightKg),
    waistCm: r.waistCm === null ? null : cm(r.waistCm),
    waistProtocol: r.waistProtocol,
    bodyFatPct: r.bodyFatPct === null ? null : pctPoints(r.bodyFatPct),
    bodyFatReliability: r.bodyFatReliability,
  }));
}

/**
 * Objetivo activo en la forma que espera el motor, o `null`.
 *
 * `type` y `strategy` son columnas `String` (convención del proyecto), así que
 * se validan contra los enums antes de entrar. Si no encajan —dato corrupto o
 * un valor retirado— se descarta el objetivo entero en vez de propagar texto
 * arbitrario: el resto del análisis sigue siendo correcto sin él.
 */
type GoalRow = NonNullable<Awaited<ReturnType<typeof getActiveGoal>>>;

function toEngineGoal(goal: GoalRow | null): BodyGoalInput | null {
  if (!goal) return null;

  const type = GoalType.safeParse(goal.type);
  const strategy = GoalStrategy.safeParse(goal.strategy);
  if (!type.success || !strategy.success) return null;

  return {
    type: type.data,
    strategy: strategy.data,
    weeklyRatePct: goal.weeklyRatePct,
    startWeightKg: kg(goal.startWeightKg),
    targetWeightKg:
      goal.targetWeightKg === null ? null : kg(goal.targetWeightKg),
  };
}

/**
 * Todo lo que necesita la pantalla de progreso, para ESTE perfil.
 *
 * El análisis se calcula SIEMPRE sobre las mediciones de este perfil y con la
 * fecha de corte explícita: el motor es puro y no sabe de usuarios, así que la
 * garantía de aislamiento está entera en la consulta de arriba.
 */
export async function getBodyProgress(
  profileId: string,
  now: Date = new Date(),
  /**
   * Análisis de entrenamiento ya calculado, si quien llama lo tiene a mano.
   *
   * Existe solo para que el Coach no lo lea dos veces: `askCoach` ya lo
   * necesita para su propio contexto, y sin esto la misma consulta se hacía
   * dos veces por pregunta. Cuando no se pasa, se lee aquí como siempre.
   */
  trainingAnalysis?: TrainingAnalysis | null,
): Promise<BodyProgressView> {
  const todayLocalDate = today(now);
  const [records, goalRow, training] = await Promise.all([
    listMeasurements(
      profileId,
      addDays(todayLocalDate, -HISTORY_WINDOW_DAYS),
      todayLocalDate,
    ),
    getActiveGoal(profileId),
    // El análisis de entrenamiento ya existente. No se recalcula progresión ni
    // fatiga: el motor de insights solo AGREGA lo que este afirma.
    trainingAnalysis !== undefined
      ? Promise.resolve(trainingAnalysis)
      : getTrainingAnalysis(profileId, now).catch(() => null),
  ]);
  const goal = toEngineGoal(goalRow);

  const points = toEnginePoints(records);

  // El análisis se acota a la FASE ACTUAL. `Goal.startDate` es la fecha en que
  // empezó: para un perfil que nunca ha cambiado de objetivo es la del
  // onboarding, y como no hay mediciones anteriores no recorta nada. Cuando sí
  // se ha cambiado de fase, impide que la tendencia de la etapa anterior
  // evalúe la nueva.
  const analysis = analyzeBody({
    measurements: points,
    todayLocalDate,
    goal,
    analysisStartLocalDate: goalRow?.startDate ?? null,
  });

  // Segunda pasada SIN recorte, solo para el gráfico: acotar lo que se afirma
  // no es lo mismo que borrar lo que se ve.
  const full = analyzeBody({
    measurements: points,
    todayLocalDate,
    goal: null,
  });

  // Más reciente primero: la lista editable se lee de arriba abajo.
  const history = [...records].reverse();
  const insight =
    training === null
      ? null
      : analyzeBodyPerformance({
          bodyAnalysis: analysis,
          performance: assessPerformance(training),
        });

  return {
    analysis,
    chartSeries: full.weight.series,
    phaseStartLocalDate: goalRow?.startDate ?? null,
    history,
    checkIn: evaluateCheckIn(points, todayLocalDate),
    insight,
    engineVersion: BODY_ENGINE_VERSION,
  };
}

/**
 * Guarda la medición de un día. Crea o actualiza según haya fila o no: una
 * fila por perfil y día, garantizado por la clave única de la base.
 *
 * No recibe id ni perfil desde fuera. La identidad de lo que se escribe es
 * (perfil de la sesión, fecha), así que no hay forma de apuntar la escritura a
 * la fila de otra persona.
 */
export async function saveMeasurement(
  profileId: string,
  data: BodyMeasurementData,
  now: Date = new Date(),
): Promise<BodyMeasurementRecord> {
  // El futuro no se puede medir. Zod no puede comprobarlo porque no sabe qué
  // día es hoy: eso es I/O y vive aquí.
  if (diffDays(data.localDate, today(now)) < 0) {
    throw new FutureMeasurementError();
  }

  return upsertMeasurement(profileId, data.localDate, {
    weightKg: data.weightKg,
    waistCm: data.waistCm,
    // Editar a mano una cintura no dice cómo se tomó, así que se marca como
    // desconocida y el motor le aplica el umbral conservador. Solo el
    // check-in, que pide las tres tomas, puede declarar MEAN_OF_THREE.
    waistProtocol: data.waistCm === null ? null : (data.waistProtocol ?? null),
    bodyFatPct: data.bodyFatPct,
    bodyFatReliability: data.bodyFatReliability,
  });
}

/**
 * Guarda SOLO el peso de un día, sin tocar cintura ni % graso.
 *
 * La operación de la tarjeta rápida de "Hoy". Que sea una función distinta —y
 * no `saveMeasurement` con los demás campos a null— es deliberado: un
 * formulario de un solo campo no puede borrar datos que ni siquiera enseña.
 */
export async function saveWeight(
  profileId: string,
  data: QuickWeightData,
  now: Date = new Date(),
): Promise<BodyMeasurementRecord> {
  if (diffDays(data.localDate, today(now)) < 0) {
    throw new FutureMeasurementError();
  }
  return upsertWeight(profileId, data.localDate, data.weightKg);
}

/**
 * Borra una medición propia. La comprobación de propiedad y el borrado son la
 * misma consulta (`deleteMany` filtrando por perfil), así que no hay ventana
 * entre comprobar y actuar.
 */
export async function deleteMeasurement(
  profileId: string,
  id: string,
): Promise<void> {
  const deleted = await deleteMeasurementOwnedBy(profileId, id);
  if (deleted === 0) throw new MeasurementNotFoundError();
}

/** La medición de un día, para pre-rellenar el formulario. */
export async function getMeasurementForDate(
  profileId: string,
  localDate: string,
): Promise<BodyMeasurementRecord | null> {
  return findMeasurementByDate(profileId, localDate);
}

/** El día de hoy en la zona del perfil, para que la UI no calcule fechas. */
export function todayForProfile(now: Date = new Date()): string {
  return today(now);
}

// ── Check-in corporal (B4) ───────────────────────────────────────────────────

/** No hay objetivo activo: no se puede revisar lo que no existe. */
export class NoActiveGoalError extends Error {
  constructor() {
    super("No tienes un objetivo activo. Completa el onboarding primero.");
    this.name = "NoActiveGoalError";
  }
}

/**
 * Guarda un check-in corporal.
 *
 * La cintura se guarda como la MEDIA de las tres tomas, marcada
 * `MEAN_OF_THREE`. Esa marca es lo que autoriza al motor a usar el umbral de
 * 3,1 cm en vez de 5,4: sin ella tendría que seguir aplicando el conservador,
 * y el protocolo no habría servido de nada.
 *
 * Las tres tomas crudas NO se guardan. Lo que cambia el comportamiento del
 * motor es el protocolo, no los valores sueltos: la media es el valor
 * representativo del día y la dispersión ya se validó en la frontera. Guardarlas
 * permitiría estimar el error de medida propio de cada persona, pero nada lo
 * consume y el motor no lo modela. Añadir esa columna después es aditivo.
 *
 * Escribe SOLO lo que el formulario pidió: si no se anotó peso, el peso del día
 * queda como estaba.
 */
export async function submitCheckIn(
  profileId: string,
  data: BodyCheckInData,
  now: Date = new Date(),
): Promise<BodyMeasurementRecord> {
  if (diffDays(data.localDate, today(now)) < 0) {
    throw new FutureMeasurementError();
  }

  const fields: Parameters<typeof upsertMeasurementFields>[2] = {};

  if (data.weightKg !== null) fields.weightKg = data.weightKg;

  if (data.waist1 !== null && data.waist2 !== null && data.waist3 !== null) {
    const tomas = [data.waist1, data.waist2, data.waist3];
    // Media, no mediana: con tres tomas de error independiente la media divide
    // el error por √3, que es exactamente el efecto que justifica el protocolo.
    // La mediana descartaría dos tercios de la información.
    const media = tomas.reduce((a, t) => a + t, 0) / 3;
    // Un decimal: la cinta no da más, y guardar 87,33333 sería falsa precisión.
    fields.waistCm = Math.round(media * 10) / 10;
    fields.waistProtocol = "MEAN_OF_THREE";
  }

  if (data.bodyFatPct !== null) {
    fields.bodyFatPct = data.bodyFatPct;
    fields.bodyFatReliability = data.bodyFatReliability;
  }

  return upsertMeasurementFields(profileId, data.localDate, fields);
}

// ── Objetivo y fases (B4) ────────────────────────────────────────────────────

export interface GoalUpdateResult {
  kind: GoalChangeKind;
  goalId: string;
  /** Fecha de inicio de la fase que queda activa. */
  startDate: string;
}

/**
 * Revisa el objetivo. Corrige la fase actual o abre una nueva, según qué haya
 * cambiado (`classifyGoalChange`).
 *
 * NUEVA FASE: se cierra la fila activa como `SUPERSEDED` —ni abandonada ni
 * completada: simplemente se pasó a otra cosa— y se crea otra con `startDate`
 * de HOY. Esa fecha es la que después acota la tendencia corporal, así que
 * abrir una fase es literalmente decirle al motor "empieza a contar desde
 * aquí". Nada se borra: las mediciones, el entrenamiento y el historial de
 * objetivos siguen enteros.
 *
 * LO QUE ESTA FUNCIÓN NO HACE, y es deliberado: no recalcula el objetivo
 * calórico, no toca el programa de entrenamiento y no crea recomendaciones.
 * Cambiar de fase es una declaración de intención del usuario, no una orden
 * para que los motores se reconfiguren solos.
 */
export async function updateGoal(
  profileId: string,
  data: GoalUpdateData,
  now: Date = new Date(),
): Promise<GoalUpdateResult> {
  const current = await getActiveGoal(profileId);
  if (!current) throw new NoActiveGoalError();

  const currentStrategy = GoalStrategy.safeParse(current.strategy);
  const kind = classifyGoalChange(
    {
      // Si la estrategia guardada no parsea (dato corrupto), se trata como
      // distinta: abrir fase nueva es la salida segura, no editar sobre algo
      // que no se sabe qué es.
      strategy: currentStrategy.success ? currentStrategy.data : data.strategy,
      weeklyRatePct: current.weeklyRatePct,
      targetWeightKg: current.targetWeightKg,
    },
    data,
  );

  if (kind === "NO_CHANGE") {
    return { kind, goalId: current.id, startDate: current.startDate };
  }

  if (kind === "EDIT_IN_PLACE") {
    // Se corrige la fila. `startDate` y `startWeightKg` NO se tocan: es la
    // misma fase, solo se mueve el listón contra el que se compara.
    const updated = await prisma.goal.update({
      where: { id: current.id },
      data: {
        weeklyRatePct: data.weeklyRatePct,
        targetWeightKg: data.targetWeightKg,
      },
      select: { id: true, startDate: true },
    });
    return { kind, goalId: updated.id, startDate: updated.startDate };
  }

  const startDate = today(now);
  // Peso con el que arranca la fase, solo para la traza. Se usa el último
  // pesaje y no la EMA a propósito: meter el motor dentro de una transacción
  // por un campo que nadie consume para decidir no compensa.
  const latest = await prisma.bodyMeasurement.findFirst({
    where: { profileId, weightKg: { not: null } },
    orderBy: { localDate: "desc" },
    select: { weightKg: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    await tx.goal.update({
      where: { id: current.id },
      data: { status: "SUPERSEDED" },
    });
    return tx.goal.create({
      data: {
        profileId,
        strategy: data.strategy,
        type: STRATEGY_TO_GOAL_TYPE[data.strategy],
        status: "ACTIVE",
        startDate,
        startWeightKg: latest?.weightKg ?? current.startWeightKg,
        weeklyRatePct: data.weeklyRatePct,
        targetWeightKg: data.targetWeightKg,
      },
      select: { id: true, startDate: true },
    });
  });

  return { kind, goalId: created.id, startDate: created.startDate };
}

/** El objetivo activo, en la forma que consume el formulario de revisión. */
export async function getGoalForEdit(profileId: string): Promise<{
  strategy: GoalStrategy;
  weeklyRatePct: number;
  targetWeightKg: number | null;
  startDate: string;
} | null> {
  const goal = await getActiveGoal(profileId);
  if (!goal) return null;
  const strategy = GoalStrategy.safeParse(goal.strategy);
  if (!strategy.success) return null;
  return {
    strategy: strategy.data,
    weeklyRatePct: goal.weeklyRatePct,
    targetWeightKg: goal.targetWeightKg,
    startDate: goal.startDate,
  };
}
