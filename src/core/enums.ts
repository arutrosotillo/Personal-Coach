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

export const GoalStatus = z.enum(["ACTIVE", "COMPLETED", "ABANDONED"]);
export type GoalStatus = z.infer<typeof GoalStatus>;

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
