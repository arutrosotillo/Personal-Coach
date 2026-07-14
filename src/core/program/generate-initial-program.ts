import type { MuscleGroupCode, PriorityTier } from "@/core/enums";
import { MUSCLE_GROUPS } from "@/core/catalog/muscle-groups";
import { splitForDays } from "@/core/program/splits";
import type {
  CatalogExercise,
  CatalogVariant,
  GeneratedDay,
  GeneratedExercise,
  GeneratedProgram,
  GeneratorInput,
  SplitSlot,
} from "@/core/program/types";

/**
 * Generador del programa inicial (F1) — docs/TRAINING_ENGINE.md §1.
 * Función pura y determinista: reglas simples y explícitas, sin progresión
 * dinámica de volumen (eso llega con los motores de F3).
 */

export const PROGRAM_GENERATOR_VERSION = "1.0.0";

/** Coste en minutos por serie según tipo de slot (incluye descanso). */
const SLOT_COST_MIN = { COMPOUND_HEAVY: 4, COMPOUND: 3, ISOLATION: 2 } as const;
const SESSION_OVERHEAD_MIN = 10;
const COMPOUND_PATTERNS = new Set([
  "HORIZONTAL_PUSH",
  "VERTICAL_PUSH",
  "HORIZONTAL_PULL",
  "VERTICAL_PULL",
  "SQUAT",
  "HINGE",
  "LUNGE",
]);

const DEFAULT_TIERS: Record<MuscleGroupCode, PriorityTier> = Object.fromEntries(
  MUSCLE_GROUPS.map((g) => [g.code, g.tier]),
) as Record<MuscleGroupCode, PriorityTier>;

interface ResolvedSlot {
  slot: SplitSlot;
  exercise: CatalogExercise;
  variant: CatalogVariant;
  sets: number;
}

export function generateInitialProgram(
  input: GeneratorInput,
): GeneratedProgram {
  const warnings: string[] = [];
  const split = splitForDays(input.daysPerWeek);

  // Tiers efectivos: las prioridades del usuario se elevan a Tier A.
  const tiers: Record<MuscleGroupCode, PriorityTier> = { ...DEFAULT_TIERS };
  for (const group of input.priorityMuscles) tiers[group] = "A";

  const equipmentSet = new Set(input.equipment);
  const userContras = new Set(input.contraindications);
  const excluded = new Set(
    input.excludedExerciseNames.map((n) => n.toLowerCase()),
  );
  const usedExerciseIds = new Set<string>();

  const days: GeneratedDay[] = split.days.map((day, dayIndex) => {
    const resolved: ResolvedSlot[] = [];
    const usedToday = new Set<string>();

    for (const slot of day.slots) {
      const pick = pickExercise(input.catalog, slot, {
        equipmentSet,
        userContras,
        excluded,
        usedToday,
        usedExerciseIds,
      });
      if (!pick) {
        warnings.push(
          `Sin ejercicio disponible para ${labelOf(slot.group)} (${slot.kind === "COMPOUND" ? "compuesto" : "aislamiento"}) con tu equipamiento y restricciones; hueco omitido en ${day.name}.`,
        );
        continue;
      }
      usedToday.add(pick.exercise.id);
      usedExerciseIds.add(pick.exercise.id);
      resolved.push({
        slot,
        exercise: pick.exercise,
        variant: pick.variant,
        sets: slot.sets,
      });
    }

    // Presupuesto de tiempo: recortar Tier C → aislamiento Tier B; nunca Tier A.
    trimToBudget(resolved, input.minutesPerSession, tiers, warnings, day.name);

    const exercises: GeneratedExercise[] = resolved.map((r) => ({
      exerciseId: r.exercise.id,
      exerciseName: r.exercise.name,
      variantId: r.variant.id,
      variantName: r.variant.name,
      muscleGroup: r.slot.group,
      sets: r.sets,
      repRangeMin: r.variant.repRangeMin,
      repRangeMax: r.variant.repRangeMax,
      targetRir: r.slot.kind === "COMPOUND" ? 2 : 1,
      restSeconds: r.variant.defaultRestSeconds,
    }));

    return {
      name: day.name,
      ordinal: dayIndex + 1,
      exercises,
      estimatedMinutes: estimateMinutes(resolved),
    };
  });

  const weeklySetsByGroup = countWeeklySets(days, input.catalog);

  const priorityLabels = [
    "DELT_LATERAL",
    "DELT_POSTERIOR",
    "DORSAL",
    "PECHO_SUPERIOR",
  ]
    .concat(input.priorityMuscles.filter((g) => DEFAULT_TIERS[g] !== "A"))
    .map((g) => labelOf(g as MuscleGroupCode));

  const explanation =
    `Programa inicial de ${input.daysPerWeek} días (${split.label}), elegido por tus días disponibles. ` +
    `Volumen de partida conservador con énfasis en ${[...new Set(priorityLabels)].join(", ")}, sin descuidar piernas. ` +
    `Filtrado por tu equipamiento${userContras.size > 0 ? ", tus molestias declaradas" : ""}${excluded.size > 0 ? " y tus ejercicios excluidos" : ""}. ` +
    `Es un punto de partida: los motores de progresión y volumen lo refinarán con tus datos reales.`;

  return {
    name: split.label,
    splitType: split.type,
    daysPerWeek: input.daysPerWeek,
    days,
    weeklySetsByGroup,
    explanation,
    warnings,
    ruleId: `program.initial.${split.type.toLowerCase()}`,
    version: PROGRAM_GENERATOR_VERSION,
  };
}

function pickExercise(
  catalog: CatalogExercise[],
  slot: SplitSlot,
  ctx: {
    equipmentSet: Set<string>;
    userContras: Set<string>;
    excluded: Set<string>;
    usedToday: Set<string>;
    usedExerciseIds: Set<string>;
  },
): { exercise: CatalogExercise; variant: CatalogVariant } | null {
  const isCompoundPattern = (e: CatalogExercise) =>
    COMPOUND_PATTERNS.has(e.movementPattern);
  const kindMatches = (e: CatalogExercise) =>
    slot.kind === "COMPOUND" ? isCompoundPattern(e) : !isCompoundPattern(e);

  const candidates = catalog
    .filter((e) => !ctx.excluded.has(e.name.toLowerCase()))
    .filter((e) => !ctx.usedToday.has(e.id))
    .filter((e) =>
      e.contributions.some(
        (c) => c.group === slot.group && c.role === "PRIMARY",
      ),
    )
    .filter(kindMatches)
    .map((e) => ({ exercise: e, variant: pickVariant(e, ctx) }))
    .filter(
      (p): p is { exercise: CatalogExercise; variant: CatalogVariant } =>
        p.variant !== null,
    );

  if (candidates.length === 0) return null;

  // Determinista: preferir ejercicios aún no usados en el programa (variedad),
  // después menor fatiga sistémica, después orden alfabético.
  candidates.sort((a, b) => {
    const aUsed = ctx.usedExerciseIds.has(a.exercise.id) ? 1 : 0;
    const bUsed = ctx.usedExerciseIds.has(b.exercise.id) ? 1 : 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    if (a.exercise.systemicFatigue !== b.exercise.systemicFatigue) {
      return a.exercise.systemicFatigue - b.exercise.systemicFatigue;
    }
    return a.exercise.name.localeCompare(b.exercise.name, "es");
  });

  return candidates[0];
}

function pickVariant(
  exercise: CatalogExercise,
  ctx: { equipmentSet: Set<string>; userContras: Set<string> },
): CatalogVariant | null {
  const viable = exercise.variants.filter(
    (v) =>
      ctx.equipmentSet.has(v.equipment) &&
      !v.contraindications.some((c) => ctx.userContras.has(c)),
  );
  if (viable.length === 0) return null;
  viable.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name, "es");
  });
  return viable[0];
}

function slotCost(resolved: ResolvedSlot): number {
  if (resolved.slot.kind === "ISOLATION")
    return resolved.sets * SLOT_COST_MIN.ISOLATION;
  return (
    resolved.sets *
    (resolved.exercise.systemicFatigue >= 3
      ? SLOT_COST_MIN.COMPOUND_HEAVY
      : SLOT_COST_MIN.COMPOUND)
  );
}

function estimateMinutes(resolved: ResolvedSlot[]): number {
  return (
    SESSION_OVERHEAD_MIN + resolved.reduce((sum, r) => sum + slotCost(r), 0)
  );
}

function trimToBudget(
  resolved: ResolvedSlot[],
  minutesPerSession: number,
  tiers: Record<MuscleGroupCode, PriorityTier>,
  warnings: string[],
  dayName: string,
): void {
  const tierOf = (r: ResolvedSlot) => tiers[r.slot.group];
  let trimmed = false;

  const overBudget = () => estimateMinutes(resolved) > minutesPerSession;

  // 1. Eliminar slots Tier C enteros (desde el final del día).
  for (let i = resolved.length - 1; i >= 0 && overBudget(); i--) {
    if (tierOf(resolved[i]) === "C") {
      resolved.splice(i, 1);
      trimmed = true;
    }
  }
  // 2. Reducir aislamientos Tier B a mínimo 2 series (desde el final).
  for (let i = resolved.length - 1; i >= 0 && overBudget(); i--) {
    const r = resolved[i];
    while (
      tierOf(r) === "B" &&
      r.slot.kind === "ISOLATION" &&
      r.sets > 2 &&
      overBudget()
    ) {
      r.sets -= 1;
      trimmed = true;
    }
  }
  // 3. Eliminar aislamientos Tier B enteros (desde el final).
  for (let i = resolved.length - 1; i >= 0 && overBudget(); i--) {
    const r = resolved[i];
    if (tierOf(r) === "B" && r.slot.kind === "ISOLATION") {
      resolved.splice(i, 1);
      trimmed = true;
    }
  }

  if (trimmed) {
    warnings.push(
      `${dayName}: sesión recortada para caber en ${minutesPerSession} min (se redujo trabajo no prioritario; los grupos prioritarios se mantienen).`,
    );
  }
  if (overBudget()) {
    warnings.push(
      `${dayName}: aun recortando, la sesión estimada (${estimateMinutes(resolved)} min) supera tus ${minutesPerSession} min. Valora más tiempo por sesión o menos días con sesiones más largas.`,
    );
  }
}

function countWeeklySets(
  days: GeneratedDay[],
  catalog: CatalogExercise[],
): Partial<Record<MuscleGroupCode, number>> {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const totals: Partial<Record<MuscleGroupCode, number>> = {};
  for (const day of days) {
    for (const ex of day.exercises) {
      const exercise = byId.get(ex.exerciseId);
      if (!exercise) continue;
      for (const contribution of exercise.contributions) {
        totals[contribution.group] =
          Math.round(
            ((totals[contribution.group] ?? 0) +
              ex.sets * contribution.factor) *
              100,
          ) / 100;
      }
    }
  }
  return totals;
}

function labelOf(code: MuscleGroupCode): string {
  return MUSCLE_GROUPS.find((g) => g.code === code)?.nameEs ?? code;
}
