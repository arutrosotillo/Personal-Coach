import {
  BASELINE_WEEKLY_SETS,
  COMPOUND_PATTERNS,
  FAT_LOSS_VOLUME_FACTOR,
  MAX_SETS_PER_GROUP_PER_SESSION,
  MAX_WEEKLY_SETS,
  MIN_WEEKLY_SETS,
  PRIORITY_BONUS_SETS,
  SESSION_OVERHEAD_MIN,
  SETS_PER_EXERCISE,
  TARGET_RIR,
  TIME_COST_MIN,
} from "@/core/config/training-config";
import {
  MUSCLE_GROUPS,
  MUSCLE_GROUP_BY_CODE,
} from "@/core/catalog/muscle-groups";
import type { MuscleGroupCode } from "@/core/enums";
import { splitForDays } from "@/core/program/splits";
import type {
  CatalogExercise,
  CatalogVariant,
  GeneratedDay,
  GeneratedExercise,
  GeneratedProgram,
  GeneratorInput,
  GroupVolume,
} from "@/core/program/types";

/**
 * Generador del programa inicial (docs/TRAINING_ENGINE.md §1).
 * Función pura y determinista. Reparte un objetivo de volumen semanal por grupo
 * sobre los menús de la división elegida, con contabilidad fraccional del
 * volumen indirecto. Equilibrado por defecto; el único sesgo es la prioridad
 * que elige el usuario. NO incluye progresión ni ajuste adaptativo (Fase 3).
 */

export const PROGRAM_GENERATOR_VERSION = "2.0.0";

const ALL_GROUPS: MuscleGroupCode[] = MUSCLE_GROUPS.map((g) => g.code);

interface Filters {
  equipment: Set<string>;
  contraindications: Set<string>;
  excluded: Set<string>;
}

type CostKind = "compoundHeavy" | "compound" | "isolation";

function costKindOf(exercise: CatalogExercise): CostKind {
  if (!COMPOUND_PATTERNS.has(exercise.movementPattern)) return "isolation";
  return exercise.systemicFatigue >= 3 ? "compoundHeavy" : "compound";
}

function isCompound(exercise: CatalogExercise): boolean {
  return COMPOUND_PATTERNS.has(exercise.movementPattern);
}

/** ¿Ya hay un ejercicio compuesto para este grupo hoy? (para no encadenar compuestos). */
function hasCompoundToday(
  exercises: GeneratedExercise[],
  group: MuscleGroupCode,
): boolean {
  return exercises.some((e) => e.muscleGroup === group && e.isCompound);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Objetivo de series directas semanales por grupo (base equilibrada + prioridad). */
export function computeWeeklyTargets(
  priorityMuscles: MuscleGroupCode[],
  goalType: GeneratorInput["goalType"],
): Record<MuscleGroupCode, number> {
  const priority = new Set(priorityMuscles);
  const fatLoss = goalType === "FAT_LOSS";
  const targets = {} as Record<MuscleGroupCode, number>;
  for (const group of ALL_GROUPS) {
    let base = BASELINE_WEEKLY_SETS[group];
    if (fatLoss) base = Math.round(base * FAT_LOSS_VOLUME_FACTOR);
    const bonus = priority.has(group) ? PRIORITY_BONUS_SETS : 0;
    targets[group] = Math.min(base + bonus, MAX_WEEKLY_SETS);
  }
  return targets;
}

function pickVariant(
  exercise: CatalogExercise,
  filters: Filters,
): CatalogVariant | null {
  const viable = exercise.variants.filter(
    (v) =>
      filters.equipment.has(v.equipment) &&
      !v.contraindications.some((c) => filters.contraindications.has(c)),
  );
  if (viable.length === 0) return null;
  viable.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name, "es");
  });
  return viable[0];
}

function pickExercise(
  catalog: CatalogExercise[],
  group: MuscleGroupCode,
  filters: Filters,
  usedInDay: Set<string>,
  usedInProgram: Set<string>,
  preferCompound: boolean,
): { exercise: CatalogExercise; variant: CatalogVariant } | null {
  const candidates = catalog
    .filter((e) => !filters.excluded.has(e.name.toLowerCase()))
    // no repetir el MISMO ejercicio el mismo día (evita redundancia idéntica)
    .filter((e) => !usedInDay.has(e.id))
    .filter((e) =>
      e.contributions.some((c) => c.group === group && c.role === "PRIMARY"),
    )
    .map((e) => ({ exercise: e, variant: pickVariant(e, filters) }))
    .filter(
      (p): p is { exercise: CatalogExercise; variant: CatalogVariant } =>
        p.variant !== null,
    );

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    // 1) el tipo preferido (compuesto o aislamiento) primero
    const aPref = isCompound(a.exercise) === preferCompound ? 0 : 1;
    const bPref = isCompound(b.exercise) === preferCompound ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    // 2) variedad: ejercicios aún no usados en el programa
    const aUsed = usedInProgram.has(a.exercise.id) ? 1 : 0;
    const bUsed = usedInProgram.has(b.exercise.id) ? 1 : 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    // 3) menor fatiga sistémica, luego alfabético (determinismo)
    if (a.exercise.systemicFatigue !== b.exercise.systemicFatigue) {
      return a.exercise.systemicFatigue - b.exercise.systemicFatigue;
    }
    return a.exercise.name.localeCompare(b.exercise.name, "es");
  });

  return candidates[0];
}

export function generateInitialProgram(
  input: GeneratorInput,
): GeneratedProgram {
  const warnings: string[] = [];
  const split = splitForDays(input.daysPerWeek);
  const priority = new Set(input.priorityMuscles);

  const targets = computeWeeklyTargets(input.priorityMuscles, input.goalType);
  const remaining: Record<MuscleGroupCode, number> = { ...targets };

  const filters: Filters = {
    equipment: new Set(input.equipment),
    contraindications: new Set(input.contraindications),
    excluded: new Set(input.excludedExerciseNames.map((n) => n.toLowerCase())),
  };

  const usedInProgram = new Set<string>();
  // Series directas por grupo acumuladas en todo el programa.
  const directSets: Record<MuscleGroupCode, number> = Object.fromEntries(
    ALL_GROUPS.map((g) => [g, 0]),
  ) as Record<MuscleGroupCode, number>;
  const fractionalSets: Record<MuscleGroupCode, number> = Object.fromEntries(
    ALL_GROUPS.map((g) => [g, 0]),
  ) as Record<MuscleGroupCode, number>;
  // Frecuencia = días con trabajo DIRECTO del grupo (no cuenta el estímulo
  // indirecto, que ya se refleja en fractionalSets).
  const directDaysTrainingGroup: Record<
    MuscleGroupCode,
    Set<number>
  > = Object.fromEntries(
    ALL_GROUPS.map((g) => [g, new Set<number>()]),
  ) as Record<MuscleGroupCode, Set<number>>;

  const isNeedy = (group: MuscleGroupCode): boolean =>
    remaining[group] > 0.5 || directSets[group] < MIN_WEEKLY_SETS[group];
  const groupDayCap = (group: MuscleGroupCode): number =>
    priority.has(group)
      ? MAX_SETS_PER_GROUP_PER_SESSION.priority
      : MAX_SETS_PER_GROUP_PER_SESSION.standard;
  const exerciseSetsMax = (group: MuscleGroupCode): number =>
    priority.has(group) ? SETS_PER_EXERCISE.maxPriority : SETS_PER_EXERCISE.max;

  const days: GeneratedDay[] = split.days.map((menu, dayIndex) => {
    const exercises: GeneratedExercise[] = [];
    const usedInDay = new Set<string>();
    const setsForGroupToday: Record<string, number> = {};
    // Grupos que ya no admiten más trabajo HOY (tope alcanzado o sin ejercicio
    // elegible); se excluyen de los candidatos sin cerrar la sesión entera.
    const blockedToday = new Set<MuscleGroupCode>();
    let minutes = SESSION_OVERHEAD_MIN;

    // Se rellena el día añadiendo ejercicios uno a uno, siempre al grupo más
    // necesitado (prioridad primero), hasta que no cabe nada más (tiempo,
    // topes por grupo o falta de ejercicios disponibles).
    // Backstop de iteraciones muy por encima de cualquier día real.
    for (let guard = 0; guard < 60; guard++) {
      // Candidatos: en el menú, necesitados, no bloqueados hoy, con margen de
      // series y con un ejercicio elegible que no se haya usado hoy.
      const candidates = menu.groups
        .filter((g) => isNeedy(g) && !blockedToday.has(g))
        .filter((g) => (setsForGroupToday[g] ?? 0) < groupDayCap(g))
        .map((g) => ({
          group: g,
          pick: pickExercise(
            input.catalog,
            g,
            filters,
            usedInDay,
            usedInProgram,
            remaining[g] >= 3 && !hasCompoundToday(exercises, g),
          ),
        }))
        .filter(
          (
            c,
          ): c is {
            group: MuscleGroupCode;
            pick: NonNullable<typeof c.pick>;
          } => c.pick !== null,
        );

      if (candidates.length === 0) break;

      candidates.sort((a, b) => {
        const pa = priority.has(a.group) ? 0 : 1;
        const pb = priority.has(b.group) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        if (remaining[b.group] !== remaining[a.group])
          return remaining[b.group] - remaining[a.group];
        return BASELINE_WEEKLY_SETS[b.group] - BASELINE_WEEKLY_SETS[a.group];
      });

      const { group, pick } = candidates[0];
      const kind = costKindOf(pick.exercise);
      const cost = TIME_COST_MIN[kind];

      const usedForGroup = setsForGroupToday[group] ?? 0;
      const need =
        remaining[group] > 0
          ? remaining[group]
          : MIN_WEEKLY_SETS[group] - directSets[group];
      let sets = clamp(
        Math.ceil(need),
        SETS_PER_EXERCISE.min,
        exerciseSetsMax(group),
      );
      sets = Math.min(sets, groupDayCap(group) - usedForGroup);

      // Si a este grupo ya no le caben las series mínimas por su tope diario,
      // se bloquea HOY y se sigue con otros grupos (no se cierra la sesión).
      if (sets < SETS_PER_EXERCISE.min) {
        blockedToday.add(group);
        continue;
      }

      // Presupuesto de tiempo: recortar; si no cabe ni el mínimo, la sesión
      // está llena y se cierra el día.
      if (minutes + sets * cost > input.minutesPerSession) {
        const affordable = Math.floor(
          (input.minutesPerSession - minutes) / cost,
        );
        if (affordable < SETS_PER_EXERCISE.min) break;
        sets = Math.min(sets, affordable);
      }

      exercises.push({
        exerciseId: pick.exercise.id,
        exerciseName: pick.exercise.name,
        variantId: pick.variant.id,
        variantName: pick.variant.name,
        muscleGroup: group,
        isCompound: isCompound(pick.exercise),
        sets,
        repRangeMin: pick.variant.repRangeMin,
        repRangeMax: pick.variant.repRangeMax,
        targetRir: TARGET_RIR[kind],
        restSeconds: pick.variant.defaultRestSeconds,
      });

      minutes += sets * cost;
      usedInDay.add(pick.exercise.id);
      usedInProgram.add(pick.exercise.id);
      setsForGroupToday[group] = usedForGroup + sets;
      directSets[group] += sets;
      directDaysTrainingGroup[group].add(dayIndex);

      for (const contribution of pick.exercise.contributions) {
        remaining[contribution.group] -= sets * contribution.factor;
        fractionalSets[contribution.group] += sets * contribution.factor;
      }
    }

    return {
      name: menu.name,
      ordinal: dayIndex + 1,
      exercises,
      estimatedMinutes: minutes,
    };
  });

  // Aviso si algún grupo prioritario o principal quedó por debajo del suelo.
  for (const group of ALL_GROUPS) {
    if (directSets[group] < MIN_WEEKLY_SETS[group]) {
      warnings.push(
        `${MUSCLE_GROUP_BY_CODE[group].nameEs}: solo caben ${directSets[group]} series directas (mínimo recomendado ${MIN_WEEKLY_SETS[group]}). Valora más tiempo por sesión o más días.`,
      );
    }
  }

  const volumeByGroup: GroupVolume[] = ALL_GROUPS.map((group) => ({
    group,
    directSets: directSets[group],
    fractionalSets: round1(fractionalSets[group]),
    frequency: directDaysTrainingGroup[group].size,
    isPriority: priority.has(group),
    targetSets: targets[group],
  }));

  const priorityLabels = input.priorityMuscles.map(
    (g) => MUSCLE_GROUP_BY_CODE[g].nameEs,
  );
  const explanation =
    priorityLabels.length > 0
      ? `Programa inicial de ${input.daysPerWeek} días (${split.label}). Volumen de partida conservador y equilibrado, con más trabajo en tus prioridades: ${priorityLabels.join(", ")}. Ningún grupo se abandona. Se refinará con tus datos en las siguientes fases.`
      : `Programa inicial de ${input.daysPerWeek} días (${split.label}). Volumen de partida conservador y equilibrado, sin prioridad especial: todos los grupos reciben un reparto estándar. Se refinará con tus datos en las siguientes fases.`;

  return {
    name: split.label,
    splitType: split.type,
    daysPerWeek: input.daysPerWeek,
    minutesPerSession: input.minutesPerSession,
    priorityMuscles: input.priorityMuscles,
    days,
    volumeByGroup,
    explanation,
    warnings,
    ruleId: `program.initial.${split.type.toLowerCase()}`,
    version: PROGRAM_GENERATOR_VERSION,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
