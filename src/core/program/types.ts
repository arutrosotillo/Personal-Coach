import type {
  Contraindication,
  Equipment,
  GoalType,
  MovementPattern,
  MuscleGroupCode,
  MuscleRole,
  PriorityTier,
} from "@/core/enums";

/** Vista del catálogo que consume el generador (independiente de Prisma). */
export interface CatalogVariant {
  id: string;
  name: string;
  equipment: Equipment;
  loadStepKg: number;
  repRangeMin: number;
  repRangeMax: number;
  defaultRestSeconds: number;
  contraindications: Contraindication[];
  isDefault: boolean;
}

export interface CatalogExercise {
  id: string;
  name: string;
  movementPattern: MovementPattern;
  systemicFatigue: number;
  contributions: Array<{
    group: MuscleGroupCode;
    role: MuscleRole;
    factor: number;
  }>;
  variants: CatalogVariant[];
}

export interface GeneratorInput {
  daysPerWeek: number; // 2..6
  minutesPerSession: number;
  equipment: Equipment[];
  contraindications: Contraindication[];
  excludedExerciseNames: string[];
  /** Prioridades elegidas por el usuario; se suman al Tier A por defecto. */
  priorityMuscles: MuscleGroupCode[];
  goalType: GoalType;
  catalog: CatalogExercise[];
}

export type SlotKind = "COMPOUND" | "ISOLATION";

export interface SplitSlot {
  group: MuscleGroupCode;
  kind: SlotKind;
  sets: number;
}

export interface SplitDay {
  name: string;
  slots: SplitSlot[];
}

export interface GeneratedExercise {
  exerciseId: string;
  exerciseName: string;
  variantId: string;
  variantName: string;
  muscleGroup: MuscleGroupCode;
  sets: number;
  repRangeMin: number;
  repRangeMax: number;
  targetRir: number;
  restSeconds: number;
}

export interface GeneratedDay {
  name: string;
  ordinal: number;
  exercises: GeneratedExercise[];
  estimatedMinutes: number;
}

export interface GeneratedProgram {
  name: string;
  splitType: string;
  daysPerWeek: number;
  days: GeneratedDay[];
  /** Series semanales planificadas por grupo (conteo fraccional). */
  weeklySetsByGroup: Partial<Record<MuscleGroupCode, number>>;
  explanation: string;
  warnings: string[];
  ruleId: string;
  version: string;
}

export interface EffectiveTiers {
  tiers: Record<MuscleGroupCode, PriorityTier>;
}
