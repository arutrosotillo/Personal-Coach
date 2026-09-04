import { COMPOUND_PATTERNS } from "@/core/config/training-config";
import type {
  Contraindication,
  Equipment,
  ExerciseStability,
  MovementPattern,
  MuscleGroupCode,
} from "@/core/enums";
import type {
  ContributionSeed,
  ExerciseSeed,
  VariantSeed,
} from "@/core/catalog/exercises";

/**
 * Constructores del catálogo.
 *
 * Existen por una razón concreta y acotada: el paso de carga, el rango de
 * repeticiones y el descanso de una variante son, casi siempre, una función del
 * MATERIAL y del ROL del ejercicio. Escribir eso a mano doscientas veces no es
 * "explícito", es una invitación a que la variante 137 lleve un `loadStepKg` de
 * 25 kg porque alguien copió mal la de arriba.
 *
 * Lo que NO hacen: inventar nada que importe de verdad. El patrón de
 * movimiento, los músculos y sus factores, la fatiga sistémica y las
 * contraindicaciones se declaran SIEMPRE ejercicio a ejercicio. La tabla de
 * defaults solo rellena números de material, y cualquiera de ellos se puede
 * sobrescribir en el sitio.
 */

/** Rol operativo, derivado del patrón. Decide los defaults de la variante. */
type Role = "COMPOUND" | "ISOLATION" | "CORE";

function roleOf(pattern: MovementPattern): Role {
  if (pattern === "CORE") return "CORE";
  return COMPOUND_PATTERNS.has(pattern) ? "COMPOUND" : "ISOLATION";
}

interface EquipmentDefaults {
  loadStepKg: number;
  repRangeMin: number;
  repRangeMax: number;
  defaultRestSeconds: number;
}

/**
 * Números por (rol, material). Salen de los 45 ejercicios que ya había en el
 * catálogo, no de la nada: son la mediana de lo que ya estaba escrito a mano.
 *
 * `loadStepKg` es el incremento REAL del material, y de él depende que el motor
 * de progresión proponga cargas que existan. `0` significa "sin carga externa
 * cuantificable": el motor lo detecta y progresa por repeticiones.
 */
const DEFAULTS: Record<Role, Record<Equipment, EquipmentDefaults>> = {
  COMPOUND: {
    BARBELL: { loadStepKg: 2.5, repRangeMin: 6, repRangeMax: 10, defaultRestSeconds: 180 },
    EZ_BAR: { loadStepKg: 2.5, repRangeMin: 8, repRangeMax: 12, defaultRestSeconds: 150 },
    DUMBBELL: { loadStepKg: 2, repRangeMin: 8, repRangeMax: 12, defaultRestSeconds: 150 },
    SMITH_MACHINE: { loadStepKg: 2.5, repRangeMin: 8, repRangeMax: 12, defaultRestSeconds: 150 },
    MACHINE: { loadStepKg: 5, repRangeMin: 8, repRangeMax: 12, defaultRestSeconds: 120 },
    CABLE: { loadStepKg: 2.5, repRangeMin: 10, repRangeMax: 15, defaultRestSeconds: 120 },
    BODYWEIGHT: { loadStepKg: 2.5, repRangeMin: 6, repRangeMax: 12, defaultRestSeconds: 150 },
    BAND: { loadStepKg: 0, repRangeMin: 10, repRangeMax: 20, defaultRestSeconds: 90 },
  },
  ISOLATION: {
    BARBELL: { loadStepKg: 2.5, repRangeMin: 8, repRangeMax: 12, defaultRestSeconds: 90 },
    EZ_BAR: { loadStepKg: 2.5, repRangeMin: 8, repRangeMax: 12, defaultRestSeconds: 90 },
    DUMBBELL: { loadStepKg: 2, repRangeMin: 10, repRangeMax: 15, defaultRestSeconds: 90 },
    SMITH_MACHINE: { loadStepKg: 2.5, repRangeMin: 10, repRangeMax: 15, defaultRestSeconds: 90 },
    MACHINE: { loadStepKg: 5, repRangeMin: 10, repRangeMax: 15, defaultRestSeconds: 90 },
    CABLE: { loadStepKg: 2.5, repRangeMin: 12, repRangeMax: 20, defaultRestSeconds: 75 },
    BODYWEIGHT: { loadStepKg: 2.5, repRangeMin: 10, repRangeMax: 20, defaultRestSeconds: 75 },
    BAND: { loadStepKg: 0, repRangeMin: 12, repRangeMax: 20, defaultRestSeconds: 60 },
  },
  CORE: {
    BARBELL: { loadStepKg: 2.5, repRangeMin: 8, repRangeMax: 15, defaultRestSeconds: 75 },
    EZ_BAR: { loadStepKg: 2.5, repRangeMin: 8, repRangeMax: 15, defaultRestSeconds: 75 },
    DUMBBELL: { loadStepKg: 2, repRangeMin: 10, repRangeMax: 20, defaultRestSeconds: 75 },
    SMITH_MACHINE: { loadStepKg: 2.5, repRangeMin: 10, repRangeMax: 20, defaultRestSeconds: 75 },
    MACHINE: { loadStepKg: 5, repRangeMin: 10, repRangeMax: 20, defaultRestSeconds: 75 },
    CABLE: { loadStepKg: 2.5, repRangeMin: 10, repRangeMax: 20, defaultRestSeconds: 75 },
    BODYWEIGHT: { loadStepKg: 2.5, repRangeMin: 10, repRangeMax: 20, defaultRestSeconds: 60 },
    BAND: { loadStepKg: 0, repRangeMin: 12, repRangeMax: 20, defaultRestSeconds: 60 },
  },
};

/**
 * Nombre por defecto de la variante según el material. Es el nombre que ya
 * usaban los 45 ejercicios originales, así que el catálogo se lee igual venga
 * de donde venga. Cuando el nombre importa —"Prensa 45°", "Polea con cuerda",
 * "Mancuernas · caminando"— se pasa a mano.
 */
const VARIANT_NAME: Record<Equipment, string> = {
  BARBELL: "Barra",
  EZ_BAR: "Barra EZ",
  DUMBBELL: "Mancuernas",
  SMITH_MACHINE: "Multipower",
  MACHINE: "Máquina",
  CABLE: "Polea",
  BODYWEIGHT: "Peso corporal",
  BAND: "Banda",
};

/** Variante tal y como se declara en el catálogo: material y lo que difiera. */
export interface VariantDraft {
  equipment: Equipment;
  /** Si se omite, el nombre estándar del material. */
  name?: string;
  /** Solo en las excepciones; si no, la deduce el material. */
  stability?: ExerciseStability;
  /** `[min, max]`. Si se omite, el del material y el rol. */
  reps?: [number, number];
  /** Incremento real del material. `0` = sin carga externa cuantificable. */
  step?: number;
  rest?: number;
  contra?: Contraindication[];
  isDefault?: boolean;
}

/** Ejercicio tal y como se declara: lo que importa, explícito; el resto, no. */
export interface ExerciseDraft {
  name: string;
  pattern: MovementPattern;
  /** Coste sistémico 1..3. Con el patrón, decide el RIR objetivo por defecto. */
  fatigue: 1 | 2 | 3;
  instructions: string;
  /** Músculo objetivo. Cuenta 1.0 y no es configurable. */
  primary: MuscleGroupCode;
  /** Trabajo indirecto: `[músculo, factor]` con factor ∈ {0.75, 0.5, 0.25}. */
  secondary?: Array<[MuscleGroupCode, 0.75 | 0.5 | 0.25]>;
  variants: VariantDraft[];
}

function toVariant(draft: VariantDraft, role: Role, index: number): VariantSeed {
  const base = DEFAULTS[role][draft.equipment];
  return {
    name: draft.name ?? VARIANT_NAME[draft.equipment],
    equipment: draft.equipment,
    ...(draft.stability ? { stability: draft.stability } : {}),
    loadStepKg: draft.step ?? base.loadStepKg,
    repRangeMin: draft.reps?.[0] ?? base.repRangeMin,
    repRangeMax: draft.reps?.[1] ?? base.repRangeMax,
    defaultRestSeconds: draft.rest ?? base.defaultRestSeconds,
    contraindications: draft.contra ?? [],
    // La primera variante es la de referencia salvo que otra lo reclame.
    isDefault: draft.isDefault ?? index === 0,
  };
}

/** Convierte una declaración en la fila del catálogo que consume el seed. */
export function ex(draft: ExerciseDraft): ExerciseSeed {
  const role = roleOf(draft.pattern);
  const contributions: ContributionSeed[] = [
    { group: draft.primary, role: "PRIMARY", factor: 1.0 },
    ...(draft.secondary ?? []).map(([group, factor]) => ({
      group,
      role: "SECONDARY" as const,
      factor,
    })),
  ];
  const variants = draft.variants.map((v, i) => toVariant(v, role, i));
  // Una sola variante por defecto: si dos la reclaman, el picker elegiría al
  // azar y el builder ofrecería una cosa distinta cada vez que se recarga.
  const defaults = variants.filter((v) => v.isDefault);
  if (defaults.length !== 1) {
    throw new Error(
      `"${draft.name}" declara ${defaults.length} variantes por defecto; debe haber exactamente 1.`,
    );
  }
  return {
    name: draft.name,
    movementPattern: draft.pattern,
    systemicFatigue: draft.fatigue,
    instructions: draft.instructions,
    contributions,
    variants,
  };
}

/**
 * Añade variantes a ejercicios que YA existen en el catálogo, sin tocar sus
 * filas originales.
 *
 * Es aditivo a propósito. Cambiar el rango de repeticiones o el paso de carga
 * de una variante existente altera lo que se ofrece al elegirla y al sustituir,
 * y esos números llevan meses en producción; añadir una variante nueva no
 * cambia nada de lo que ya hay. Falla si el ejercicio no existe o si el nombre
 * de la variante choca: un typo aquí sería una variante huérfana silenciosa.
 */
export function withExtraVariants(
  base: ExerciseSeed[],
  extras: Record<string, VariantDraft[]>,
): ExerciseSeed[] {
  const byName = new Map(base.map((e) => [e.name, e]));
  for (const name of Object.keys(extras)) {
    if (!byName.has(name)) {
      throw new Error(
        `No se pueden añadir variantes a "${name}": ese ejercicio no está en el catálogo.`,
      );
    }
  }
  return base.map((exercise) => {
    const drafts = extras[exercise.name];
    if (!drafts) return exercise;
    const role = roleOf(exercise.movementPattern);
    const existing = new Set(exercise.variants.map((v) => v.name));
    const added = drafts.map((d, i) => {
      // Nunca por defecto: la de referencia ya está elegida en el bloque base.
      const variant = toVariant({ ...d, isDefault: false }, role, i);
      if (existing.has(variant.name)) {
        throw new Error(
          `"${exercise.name}" ya tiene una variante llamada "${variant.name}".`,
        );
      }
      return variant;
    });
    return { ...exercise, variants: [...exercise.variants, ...added] };
  });
}
