import { z } from "zod";

/**
 * Fuente de verdad de todos los "enums" del dominio.
 * Las columnas de enum no son enums nativos de la base de datos: son String
 * y se validan SIEMPRE contra estos schemas en la frontera (actions/repos).
 * Ver docs/DATA_MODEL.md.
 */

export const Sex = z.enum(["MALE", "FEMALE"]);
export type Sex = z.infer<typeof Sex>;

export const UnitSystem = z.enum(["METRIC", "IMPERIAL"]);
export type UnitSystem = z.infer<typeof UnitSystem>;

export const WorkActivity = z.enum(["SEDENTARY", "LIGHT", "MODERATE", "HIGH"]);
export type WorkActivity = z.infer<typeof WorkActivity>;

/**
 * Comportamiento calórico interno del objetivo (lo que hace el motor con las kcal).
 * NO es lo que elige el usuario directamente: eso es GoalStrategy (ver abajo).
 */
export const GoalType = z.enum([
  "FAT_LOSS",
  "RECOMP",
  "LEAN_GAIN",
  "MAINTENANCE",
]);
export type GoalType = z.infer<typeof GoalType>;

/** Nivel de experiencia de entrenamiento (calibra el volumen inicial). */
export const ExperienceLevel = z.enum(["beginner", "intermediate", "advanced"]);
export type ExperienceLevel = z.infer<typeof ExperienceLevel>;

/**
 * Estrategia que elige el usuario en lenguaje natural. Separa la INTENCIÓN
 * (p. ej. "perder grasa conservando músculo") del comportamiento calórico
 * interno, para que "recomposición" no se confunda nunca con "mantenimiento"
 * cuando el usuario en realidad quiere perder peso.
 */
export const GoalStrategy = z.enum([
  "FAT_LOSS_MUSCLE_PRESERVATION", // déficit conservador
  "RECOMP_MAINTAIN_WEIGHT", // mantenimiento estimado, peso estable
  "LEAN_GAIN", // superávit controlado
  "MAINTENANCE", // mantener
]);
export type GoalStrategy = z.infer<typeof GoalStrategy>;

/** Mapea la estrategia del usuario al comportamiento calórico interno. */
export const STRATEGY_TO_GOAL_TYPE: Record<GoalStrategy, GoalType> = {
  FAT_LOSS_MUSCLE_PRESERVATION: "FAT_LOSS",
  RECOMP_MAINTAIN_WEIGHT: "RECOMP",
  LEAN_GAIN: "LEAN_GAIN",
  MAINTENANCE: "MAINTENANCE",
};

/**
 * Estado de un objetivo. Las filas de `Goal` SON el historial de fases: nunca
 * se borra una, se cierra y se crea la siguiente.
 *
 * `SUPERSEDED` se añadió en B4 para el caso normal de cambiar de fase —
 * terminar una definición y pasar a mantenimiento, por ejemplo—. `ABANDONED`
 * decía que te habías rendido y `COMPLETED` que habías llegado al objetivo, y
 * ninguna de las dos es cierta cuando simplemente se pasa a otra cosa.
 */
export const GoalStatus = z.enum([
  "ACTIVE",
  "COMPLETED",
  "ABANDONED",
  "SUPERSEDED",
]);
export type GoalStatus = z.infer<typeof GoalStatus>;

/**
 * Cómo se obtuvo un `bodyFatPct`. La cifra por sí sola no dice nada: una
 * báscula de bioimpedancia doméstica tiene un error estándar de 3,1–7,5 puntos
 * porcentuales frente a un modelo de 4 compartimentos, así que guardar el
 * número sin su procedencia haría imposible saber si dos lecturas son
 * comparables.
 *
 * De momento solo dos valores, que es exactamente lo que el onboarding
 * pregunta (`bodyFatMeasured`): MEASURED = DEXA o plicómetro; ESTIMATED =
 * báscula o estimación visual. La columna es `String`, así que afinar esto a
 * métodos concretos (BIA_SCALE, SKINFOLD, DXA…) cuando el check-in los
 * pregunte no exigirá migración.
 */
export const BodyFatReliability = z.enum(["MEASURED", "ESTIMATED"]);
export type BodyFatReliability = z.infer<typeof BodyFatReliability>;

/**
 * Con cuántas tomas se obtuvo una medida de cintura.
 *
 * NO es un adorno: cambia el umbral de lo que el motor puede afirmar. En
 * automedición doméstica el error técnico de una sola toma llega a 1,93 cm, que
 * propagado da un cambio mínimo detectable de ~5,4 cm; con la media de tres
 * baja a ~1,11 cm y ~3,1 cm (Barrios 2016, `doi:10.1186/s12874-016-0150-2`).
 *
 * `null` = desconocido, y se trata como `SINGLE`. Es el caso de todo lo
 * registrado antes de B4 (onboarding incluido) y de la cintura anotada a mano
 * desde el historial: no se puede saber cómo se tomó, así que se aplica el
 * umbral conservador. Subir el listón de precisión a mediciones antiguas sería
 * inventarse una calidad que esos datos no tienen.
 */
export const WaistProtocol = z.enum(["SINGLE", "MEAN_OF_THREE"]);
export type WaistProtocol = z.infer<typeof WaistProtocol>;

export const PhotoPose = z.enum(["FRONT", "SIDE", "BACK"]);
export type PhotoPose = z.infer<typeof PhotoPose>;

export const PersonalEventType = z.enum([
  "TRAVEL",
  "ILLNESS",
  "HIGH_STRESS",
  "POOR_SLEEP_WEEK",
  "ALCOHOL",
  "GYM_CHANGE",
  "MACHINE_CHANGE",
  "INJURY",
  "EXAMS",
  "INTENSE_WORK",
  "SOCIAL_EVENT",
  "OTHER",
]);
export type PersonalEventType = z.infer<typeof PersonalEventType>;

export const BodyRegion = z.enum(["UPPER", "LOWER", "CORE"]);
export type BodyRegion = z.infer<typeof BodyRegion>;

/** Códigos de los 16 grupos musculares del seed (MuscleGroup.code). */
export const MuscleGroupCode = z.enum([
  "PECHO_SUPERIOR",
  "PECHO_MEDIO_INFERIOR",
  "DELT_ANTERIOR",
  "DELT_LATERAL",
  "DELT_POSTERIOR",
  "DORSAL",
  "ESPALDA_ALTA",
  "TRAPECIO_SUPERIOR",
  "BICEPS",
  "TRICEPS",
  "ANTEBRAZO",
  "CUADRICEPS",
  "ISQUIOS",
  "GLUTEO",
  "GEMELO",
  "CORE",
]);
export type MuscleGroupCode = z.infer<typeof MuscleGroupCode>;

export const MovementPattern = z.enum([
  "HORIZONTAL_PUSH",
  "VERTICAL_PUSH",
  "HORIZONTAL_PULL",
  "VERTICAL_PULL",
  "SQUAT",
  "HINGE",
  "LUNGE",
  "ISOLATION",
  "CORE",
]);
export type MovementPattern = z.infer<typeof MovementPattern>;

export const Equipment = z.enum([
  "BARBELL",
  "EZ_BAR",
  "DUMBBELL",
  "MACHINE",
  "SMITH_MACHINE",
  "CABLE",
  "BODYWEIGHT",
  "BAND",
]);
export type Equipment = z.infer<typeof Equipment>;

/**
 * Cuánto sostiene la trayectoria de la carga algo que no seas tú. Es una
 * propiedad de la VARIANTE, no del ejercicio: la sentadilla en multipower y la
 * sentadilla con barra libre son el mismo movimiento y no se acercan al fallo
 * igual.
 *
 *  · FREE       — carga libre y sin apoyo, con la barra encima o sobre la
 *                 espalda. Fallar cuesta técnica y, a veces, quedar atrapado:
 *                 sentadilla con barra, press banca con barra, remo con barra.
 *  · SUPPORTED  — carga libre pero con el cuerpo apoyado o con salida fácil:
 *                 mancuernas, peso corporal, hip thrust. Fallar es soltar.
 *  · GUIDED     — la máquina, el multipower o la polea sostienen la
 *                 trayectoria. Fallar es apoyar las placas.
 *
 * Decide el RIR objetivo junto al rol y la fatiga sistémica
 * (`defaultTargetRir`), no por sí sola: "máquina" nunca significa "al fallo".
 */
export const ExerciseStability = z.enum(["FREE", "SUPPORTED", "GUIDED"]);
export type ExerciseStability = z.infer<typeof ExerciseStability>;

export const MuscleRole = z.enum(["PRIMARY", "SECONDARY"]);
export type MuscleRole = z.infer<typeof MuscleRole>;

/** Contraindicaciones declarables en onboarding y en variantes de ejercicio. */
export const Contraindication = z.enum([
  "SHOULDER",
  "ELBOW",
  "WRIST",
  "LOWER_BACK",
  "HIP",
  "KNEE",
  "ANKLE",
]);
export type Contraindication = z.infer<typeof Contraindication>;

export const MesocycleStatus = z.enum([
  "PLANNED",
  "ACTIVE",
  "COMPLETED",
  "ABORTED",
]);
export type MesocycleStatus = z.infer<typeof MesocycleStatus>;

export const WeekKind = z.enum(["ACCUMULATION", "DELOAD"]);
export type WeekKind = z.infer<typeof WeekKind>;

export const SessionStatus = z.enum([
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "ABORTED",
  "SKIPPED",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SetType = z.enum(["WARMUP", "WORKING"]);
export type SetType = z.infer<typeof SetType>;

export const TargetSource = z.enum(["MANUAL", "ALGORITHM", "ONBOARDING"]);
export type TargetSource = z.infer<typeof TargetSource>;

export const RecommendationType = z.enum([
  "INITIAL_PROGRAM",
  "INCREASE_LOAD",
  "ADD_REP",
  "KEEP",
  "DECREASE_LOAD",
  "SWAP_EXERCISE",
  "ADD_SET",
  "REMOVE_SET",
  "START_DELOAD",
  "ADJUST_CALORIES",
  "ADD_STEPS",
  "SAFETY_HOLD",
]);
export type RecommendationType = z.infer<typeof RecommendationType>;

export const RecommendationScope = z.enum([
  "PROGRAM",
  "WORKOUT_EXERCISE",
  "MESOCYCLE",
  "NUTRITION",
  "RECOVERY",
  "GLOBAL",
]);
export type RecommendationScope = z.infer<typeof RecommendationScope>;

export const Priority = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type Priority = z.infer<typeof Priority>;

export const RecommendationStatus = z.enum([
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
]);
export type RecommendationStatus = z.infer<typeof RecommendationStatus>;

export const Confidence = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type Confidence = z.infer<typeof Confidence>;
