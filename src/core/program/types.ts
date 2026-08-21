import type {
  Contraindication,
  Equipment,
  ExperienceLevel,
  GoalType,
  MovementPattern,
  MuscleGroupCode,
  MuscleRole,
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
  /** Grupos que el usuario ha elegido priorizar. Vacío = programa equilibrado. */
  priorityMuscles: MuscleGroupCode[];
  goalType: GoalType;
  /** Calibra el volumen inicial (deriva de trainingYears). Default intermedio. */
  experienceLevel?: ExperienceLevel;
  catalog: CatalogExercise[];
}

export interface GeneratedExercise {
  exerciseId: string;
  exerciseName: string;
  variantId: string;
  variantName: string;
  muscleGroup: MuscleGroupCode;
  isCompound: boolean;
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

/** Volumen semanal resultante por grupo, separando directo de fraccional. */
export interface GroupVolume {
  group: MuscleGroupCode;
  directSets: number; // series cuyo grupo PRIMARIO es este
  fractionalSets: number; // suma ponderada por factor de contribución (directas + indirectas)
  frequency: number; // nº de días que trabajan el grupo
  isPriority: boolean;
  targetSets: number;
}

export interface GeneratedProgram {
  name: string;
  splitType: string;
  daysPerWeek: number;
  minutesPerSession: number;
  priorityMuscles: MuscleGroupCode[];
  days: GeneratedDay[];
  /** Volumen por grupo (directo + fraccional + frecuencia) para el bloque "por qué". */
  volumeByGroup: GroupVolume[];
  explanation: string;
  warnings: string[];
  ruleId: string;
  version: string;
}
