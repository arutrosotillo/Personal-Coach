import {
  COMPOUND_PATTERNS,
  DAY_MULT,
  DIRECT_MIN,
  EFFECTIVE_TARGET,
  EXPERIENCE_MULT,
  FAT_LOSS_VOLUME_FACTOR,
  MAX_SETS_PER_GROUP_PER_SESSION,
  MAX_WEEKLY_SETS,
  PRIORITY_BONUS_EFFECTIVE,
  SESSION_OVERHEAD_MIN,
  SESSION_SET_CAP,
  SETS_PER_EXERCISE,
  TARGET_RIR,
  TIME_COST_MIN,
  WARN_FRACTION,
} from "@/core/config/training-config";
import {
  MUSCLE_GROUPS,
  MUSCLE_GROUP_BY_CODE,
} from "@/core/catalog/muscle-groups";
import type { ExperienceLevel, MuscleGroupCode } from "@/core/enums";
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

export const PROGRAM_GENERATOR_VERSION = "3.0.0";

const ALL_GROUPS: MuscleGroupCode[] = MUSCLE_GROUPS.map((g) => g.code);

/** Deriva el nivel de experiencia de los años entrenando (banda conservadora). */
export function experienceFromYears(years: number): ExperienceLevel {
  if (years < 2) return "beginner";
  if (years >= 5) return "advanced";
  return "intermediate";
}

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

/**
 * Objetivo de VOLUMEN EFECTIVO semanal por grupo: base conservadora × experiencia
 * × días (+ bonus de prioridad al objetivo semanal, no a las series por ejercicio),
 * con factor de déficit y techo duro de seguridad. Ver PHASE_3_2_VOLUME_PLAN §2–§3.
 */
export function computeWeeklyTargets(
  priorityMuscles: MuscleGroupCode[],
  goalType: GeneratorInput["goalType"],
  experienceLevel: ExperienceLevel,
  daysPerWeek: number,
): Record<MuscleGroupCode, number> {
  const priority = new Set(priorityMuscles);
  const fatLoss = goalType === "FAT_LOSS";
  const expMult = EXPERIENCE_MULT[experienceLevel];
  const dayMult = DAY_MULT[daysPerWeek] ?? 1;
  const targets = {} as Record<MuscleGroupCode, number>;
  for (const group of ALL_GROUPS) {
    let base = EFFECTIVE_TARGET[group] * expMult * dayMult;
    if (fatLoss) base *= FAT_LOSS_VOLUME_FACTOR;
    const bonus = priority.has(group) ? PRIORITY_BONUS_EFFECTIVE : 0;
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
  const experienceLevel = input.experienceLevel ?? "intermediate";

  const targets = computeWeeklyTargets(
    input.priorityMuscles,
    input.goalType,
    experienceLevel,
    input.daysPerWeek,
  );
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

  // Necesitado = aún no alcanza su volumen EFECTIVO objetivo, o le falta el suelo
  // de series DIRECTAS (estímulo directo mínimo). El indirecto NO cuenta para el
  // suelo directo, pero SÍ para el objetivo (vía `remaining`).
  const isNeedy = (group: MuscleGroupCode): boolean =>
    remaining[group] > 0.5 || directSets[group] < DIRECT_MIN[group];
  const groupDayCap = (group: MuscleGroupCode): number =>
    priority.has(group)
      ? MAX_SETS_PER_GROUP_PER_SESSION.priority
      : MAX_SETS_PER_GROUP_PER_SESSION.standard;

  const days: GeneratedDay[] = split.days.map((menu, dayIndex) => {
    const exercises: GeneratedExercise[] = [];
    const usedInDay = new Set<string>();
    const setsForGroupToday: Record<string, number> = {};
    // Grupos que ya no admiten más trabajo HOY (tope alcanzado o sin ejercicio
    // elegible); se excluyen de los candidatos sin cerrar la sesión entera.
    const blockedToday = new Set<MuscleGroupCode>();
    let minutes = SESSION_OVERHEAD_MIN;
    let sessionSets = 0; // tope blando de densidad por sesión (SESSION_SET_CAP)

    // Se rellena el día añadiendo ejercicios uno a uno, siempre al grupo más
    // necesitado (prioridad primero), hasta que no cabe nada más (tiempo,
    // topes por grupo, densidad o falta de ejercicios disponibles).
    // Backstop de iteraciones muy por encima de cualquier día real.
    for (let guard = 0; guard < 60; guard++) {
      if (sessionSets >= SESSION_SET_CAP) break;
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
        return EFFECTIVE_TARGET[b.group] - EFFECTIVE_TARGET[a.group];
      });

      const { group, pick } = candidates[0];
      const kind = costKindOf(pick.exercise);
      const cost = TIME_COST_MIN[kind];

      const usedForGroup = setsForGroupToday[group] ?? 0;
      // Cuánto falta: el hueco de volumen efectivo, o el suelo directo pendiente.
      const need =
        remaining[group] > 0
          ? remaining[group]
          : DIRECT_MIN[group] - directSets[group];
      let sets = clamp(
        Math.ceil(need),
        SETS_PER_EXERCISE.min,
        SETS_PER_EXERCISE.max,
      );
      sets = Math.min(
        sets,
        groupDayCap(group) - usedForGroup,
        SESSION_SET_CAP - sessionSets,
      );

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
      sessionSets += sets;
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

  // Aviso de músculo DESATENDIDO en volumen EFECTIVO (no en directo): solo para
  // músculos con estímulo directo requerido (DIRECT_MIN>0) cuyo efectivo queda por
  // debajo de WARN_FRACTION del objetivo. Así nunca se avisa por pocas series
  // directas cuando el indirecto ya cubre al músculo (p.ej. glúteo).
  for (const group of ALL_GROUPS) {
    if (DIRECT_MIN[group] <= 0) continue;
    if (fractionalSets[group] < WARN_FRACTION * targets[group]) {
      warnings.push(
        `${MUSCLE_GROUP_BY_CODE[group].nameEs}: ${round1(fractionalSets[group])} series efectivas/semana (objetivo ${round1(targets[group])}). Valora más tiempo por sesión o más días.`,
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
