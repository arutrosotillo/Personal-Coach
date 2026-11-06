import { MUSCLE_GROUPS } from "@/core/catalog/muscle-groups";
import { BLOCK_STATS, COMPOUND_PATTERNS } from "@/core/config/training-config";
import { addDays, diffDays, isoWeekOf, weekIndexSince } from "@/core/dates";
import type { MuscleGroupCode } from "@/core/enums";
import { computeWeeklyVolume } from "@/core/program/weekly-volume";
import type { CatalogExercise } from "@/core/program/types";
import {
  loadSegmentOn,
  type EquipmentChangePoint,
} from "@/core/training/equipment";
import { equivalentLoad } from "@/core/training/progression";

/**
 * Estadísticas de un bloque de entrenamiento: qué pasó entre su primera y su
 * última sesión. Puro y determinista: mismos hechos → mismos números, sin base
 * de datos ni reloj.
 *
 * DESCRIBE, NO DECIDE. Ningún motor lee esto, y por eso no vive en `analysis.ts`.
 *
 * Tres reglas, las mismas del resto de la app:
 *
 *   · Lo registrado y lo estimado no se mezclan. Cargas, repeticiones, RIR y
 *     valoraciones son lo que anotaste. La carga equivalente y el e1RM~ salen de
 *     una fórmula, y cada campo lo dice en su nombre.
 *   · No se inventa. Una semana sin sesiones es un hueco (`null`), no un cero; un
 *     ejercicio con pocas sesiones no se compara; sin RIR no hay media de RIR.
 *   · Nunca se compara entre tramos de equipamiento ni entre variantes: 100 kg en
 *     una máquina y 70 kg en otra no son una bajada del 30 %.
 */

type Config = typeof BLOCK_STATS;

export interface BlockSetInput {
  weightKg: number;
  reps: number;
  /** `null` = no se registró. Jamás se imputa. */
  rir: number | null;
  estimated1Rm: number | null;
}

export interface BlockExerciseInput {
  variantId: string;
  exerciseName: string;
  variantName: string;
  equipment: string;
  movementPattern: string;
  ordinal: number;
  plannedSets: number;
  targetRir: number;
  /** Solo series de TRABAJO completadas. */
  sets: BlockSetInput[];
}

export interface BlockSessionInput {
  id: string;
  localDate: string;
  deload: boolean;
  perceivedPerformance: number | null;
  fatigue: number | null;
  jointPain: number | null;
  motivation: number | null;
  durationMin: number | null;
  exercises: BlockExerciseInput[];
}

export interface BlockStatsInput {
  daysPerWeek: number;
  /** Sesiones COMPLETADAS del bloque, en cualquier orden. */
  sessions: BlockSessionInput[];
  catalog: CatalogExercise[];
  equipmentChanges: readonly EquipmentChangePoint[];
}

export interface BlockWeekAdherence {
  week: number;
  weekStartDate: string;
  completed: number;
  expected: number;
}

export interface BlockAdherence {
  completed: number;
  expected: number;
  /** Sesiones hechas ÷ previstas, en %. Puede pasar de 100 con semanas extra. */
  pct: number;
  weeks: BlockWeekAdherence[];
  setsPlanned: number;
  setsLogged: number;
  /** Series registradas ÷ previstas en las sesiones hechas, en %. */
  setCompletionPct: number | null;
  medianDurationMin: number | null;
}

/** Una sesión de un ejercicio. */
export interface ExercisePoint {
  localDate: string;
  /** REGISTRADO. Peso de la mayoría de las series (mediana baja). */
  workWeightKg: number;
  /** REGISTRADO. Repeticiones de las series hechas a ese peso, en orden. */
  repsAtWork: number[];
  bestReps: number;
  totalReps: number;
  sets: number;
  /** REGISTRADO. Media del RIR anotado; `null` si no se anotó ninguno. */
  avgRir: number | null;
  /**
   * ESTIMADO. Carga equivalente a `EQUIVALENT_REFERENCE_REPS` repeticiones de la
   * mejor serie. `null` con peso corporal: la carga anotada es solo el lastre,
   * así que la fórmula daría un número sin sentido.
   */
  equivalentLoadKg: number | null;
  /** ESTIMADO. Mejor e1RM~ guardado; `null` si no era calculable. */
  e1rmKg: number | null;
  /**
   * Lo que se compara entre sesiones: la carga equivalente o, con peso corporal,
   * lastre × repeticiones. Es la misma medida del veredicto del ejercicio, para
   * que su miniatura no diga otra cosa.
   */
  trendValue: number;
  /** Sesión de descarga: se enseña, pero no entra en la comparación. */
  deload: boolean;
}

export type ExerciseVerdict = "UP" | "FLAT" | "DOWN";

export interface ExerciseWindow {
  fromDate: string;
  toDate: string;
  sessions: number;
  /** REGISTRADO. Mediana del peso de trabajo de esas sesiones. */
  workWeightKg: number;
  /** REGISTRADO. Media de repeticiones por serie al peso de trabajo. */
  avgReps: number;
  /** REGISTRADO. Media de RIR; `null` si no se anotó. */
  avgRir: number | null;
  /** ESTIMADO. Media de la carga equivalente; `null` con peso corporal. */
  equivalentLoadKg: number | null;
  /** ESTIMADO. Mejor e1RM~ de esas sesiones; `null` si no era calculable. */
  e1rmKg: number | null;
}

export interface ExerciseComparison {
  start: ExerciseWindow;
  end: ExerciseWindow;
  /** Cambio de la carga equivalente (o del tonelaje con peso corporal), en %. */
  changePct: number;
  verdict: ExerciseVerdict;
  /** Qué se ha comparado para decidirlo. */
  basis: "EQUIVALENT_LOAD" | "VOLUME_LOAD";
}

export interface ExerciseStats {
  variantId: string;
  exerciseName: string;
  variantName: string;
  equipment: string;
  isCompound: boolean;
  sessions: number;
  points: ExercisePoint[];
  bestWorkWeightKg: number;
  /** Ordinal medio en sesión: mantiene el orden natural del programa. */
  averageOrdinal: number;
  /** `null` = pocas sesiones comparables para afirmar nada. */
  comparison: ExerciseComparison | null;
  /** Si cambió de máquina dentro del bloque, solo se compara desde esa fecha. */
  comparableSince: string | null;
}

export interface MuscleWeeklyStats {
  code: MuscleGroupCode;
  nameEs: string;
  /** Media semanal, contando también las semanas sin ese músculo. */
  avgEffectiveSets: number;
  avgDirectSets: number;
  /** Series efectivas por semana, en orden. `null` = semana sin sesiones. */
  weeks: Array<number | null>;
}

export interface BlockVolume {
  muscles: MuscleWeeklyStats[];
  /** Series sin músculo al que atribuirlas (ejercicio propio ya borrado). */
  unattributedSets: number;
}

export interface WeekEffort {
  week: number;
  /** REGISTRADO. Medias de RIR; `null` si esa semana no se anotó ninguno. */
  avgRirCompound: number | null;
  avgRirIsolation: number | null;
  /** Series con RIR anotado, para leer el dato con su tamaño. */
  setsWithRir: number;
  setsWithoutRir: number;
  /** % de las series con RIR anotado que fueron al fallo (RIR 0). */
  failurePct: number | null;
}

export interface WeekRecovery {
  week: number;
  sessions: number;
  /** REGISTRADO. Media de las valoraciones 1..5; `null` si no hay ninguna. */
  fatigue: number | null;
  perceivedPerformance: number | null;
  jointPain: number | null;
  motivation: number | null;
}

/** Una fila de la comparación entre las primeras y las últimas semanas. */
export interface StartEndMetric {
  key:
    | "SESSIONS_PER_WEEK"
    | "SETS_PER_WEEK"
    | "AVG_RIR"
    | "FATIGUE"
    | "PERCEIVED_PERFORMANCE"
    | "JOINT_PAIN"
    | "MOTIVATION"
    | "DURATION";
  start: number | null;
  end: number | null;
}

export interface BlockStartEnd {
  /** Semanas por extremo; `null` si el bloque es demasiado corto para separarlas. */
  windowWeeks: number;
  metrics: StartEndMetric[];
}

export interface ExerciseComparisonTotals {
  compared: number;
  up: number;
  flat: number;
  down: number;
  /** Mediana del cambio de los comparados, en %. */
  medianChangePct: number | null;
  notCompared: number;
}

export interface BlockStats {
  startLocalDate: string;
  endLocalDate: string;
  /** Días de la primera a la última sesión, ambas incluidas. */
  days: number;
  /** Semanas de calendario que abarca (la numeración de la app). */
  weeks: number;
  totalWorkingSets: number;
  totalReps: number;
  deloadSessions: number;
  adherence: BlockAdherence;
  exercises: ExerciseStats[];
  comparison: ExerciseComparisonTotals;
  volume: BlockVolume;
  effort: WeekEffort[];
  recovery: WeekRecovery[];
  startEnd: BlockStartEnd | null;
}

// ── Utilidades puras ──────────────────────────────────────────────────────

const round1 = (n: number): number => Math.round(n * 10) / 10;

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const roundOrNull = (n: number | null): number | null =>
  n === null ? null : round1(n);

/** Mediana BAJA, la misma que usa el motor para el peso de trabajo. */
function lowerMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function medianOrNull(values: readonly number[]): number | null {
  return values.length === 0 ? null : lowerMedian(values);
}

const rirsOf = (sets: readonly BlockSetInput[]): number[] =>
  sets.map((s) => s.rir).filter((r): r is number => r !== null);

/**
 * Carga × repeticiones por serie: lo único comparable con peso corporal. El +1
 * es para que hacerlas sin lastre (0 kg) también cuente sus repeticiones.
 */
function volumeLoad(
  workWeightKg: number,
  repsAtWork: readonly number[],
): number {
  return (workWeightKg + 1) * (mean(repsAtWork) ?? 0);
}

function toPoint(
  localDate: string,
  deload: boolean,
  ex: BlockExerciseInput,
  config: Config,
): ExercisePoint {
  const workWeightKg = lowerMedian(ex.sets.map((s) => s.weightKg));
  const repsAtWork = ex.sets
    .filter((s) => s.weightKg === workWeightKg)
    .map((s) => s.reps);
  const e1rms = ex.sets
    .map((s) => s.estimated1Rm)
    .filter((v): v is number => v !== null);
  // Con peso corporal la carga anotada es solo el lastre: ni la carga
  // equivalente ni el e1RM dicen nada, aunque el segundo esté guardado.
  const bodyweight = ex.equipment === "BODYWEIGHT";
  const equivalents = ex.sets
    .filter((s) => s.weightKg > 0)
    .map((s) =>
      equivalentLoad(s.weightKg, s.reps, config.EQUIVALENT_REFERENCE_REPS),
    );
  const equivalentLoadKg =
    bodyweight || equivalents.length === 0
      ? null
      : round1(Math.max(...equivalents));
  return {
    localDate,
    workWeightKg,
    repsAtWork,
    bestReps: Math.max(...repsAtWork),
    totalReps: ex.sets.reduce((a, s) => a + s.reps, 0),
    sets: ex.sets.length,
    avgRir: roundOrNull(mean(rirsOf(ex.sets))),
    equivalentLoadKg,
    e1rmKg: bodyweight || e1rms.length === 0 ? null : Math.max(...e1rms),
    trendValue: equivalentLoadKg ?? volumeLoad(workWeightKg, repsAtWork),
    deload,
  };
}

function toWindow(points: readonly ExercisePoint[]): ExerciseWindow {
  const equivalents = points
    .map((p) => p.equivalentLoadKg)
    .filter((v): v is number => v !== null);
  const e1rms = points
    .map((p) => p.e1rmKg)
    .filter((v): v is number => v !== null);
  const rirs = points
    .map((p) => p.avgRir)
    .filter((v): v is number => v !== null);
  return {
    fromDate: points[0].localDate,
    toDate: points[points.length - 1].localDate,
    sessions: points.length,
    workWeightKg: lowerMedian(points.map((p) => p.workWeightKg)),
    avgReps: round1(mean(points.flatMap((p) => p.repsAtWork)) ?? 0),
    avgRir: roundOrNull(mean(rirs)),
    equivalentLoadKg: roundOrNull(mean(equivalents)),
    e1rmKg: e1rms.length === 0 ? null : Math.max(...e1rms),
  };
}

function compareExercise(
  points: readonly ExercisePoint[],
  config: Config,
): ExerciseComparison | null {
  const comparable = points.filter((p) => !p.deload);
  const k = Math.min(
    config.COMPARISON_SESSIONS,
    Math.floor(comparable.length / 2),
  );
  if (k < config.MIN_COMPARISON_SESSIONS) return null;

  const first = comparable.slice(0, k);
  const last = comparable.slice(-k);
  const start = toWindow(first);
  const end = toWindow(last);

  const useEquivalent =
    start.equivalentLoadKg !== null && end.equivalentLoadKg !== null;
  const trend = (points: readonly ExercisePoint[]) =>
    mean(points.map((p) => p.trendValue)) ?? 0;
  const from = useEquivalent
    ? (start.equivalentLoadKg as number)
    : trend(first);
  const to = useEquivalent ? (end.equivalentLoadKg as number) : trend(last);
  const changePct = from === 0 ? 0 : round1(((to - from) / from) * 100);
  return {
    start,
    end,
    changePct,
    verdict:
      changePct > config.FLAT_BAND_PCT
        ? "UP"
        : changePct < -config.FLAT_BAND_PCT
          ? "DOWN"
          : "FLAT",
    basis: useEquivalent ? "EQUIVALENT_LOAD" : "VOLUME_LOAD",
  };
}

function buildExercises(
  sessions: readonly BlockSessionInput[],
  changes: readonly EquipmentChangePoint[],
  endLocalDate: string,
  config: Config,
): ExerciseStats[] {
  const byVariant = new Map<
    string,
    {
      head: BlockExerciseInput;
      points: ExercisePoint[];
      ordinals: number[];
    }
  >();
  for (const session of sessions) {
    // Una sesión aporta UNA exposición por variante: si aparece dos veces el
    // mismo día, la de menor `ordinal`, igual que hace el motor.
    const chosen = new Map<string, BlockExerciseInput>();
    for (const ex of session.exercises) {
      if (ex.sets.length === 0) continue;
      const current = chosen.get(ex.variantId);
      if (!current || ex.ordinal < current.ordinal) {
        chosen.set(ex.variantId, ex);
      }
    }
    for (const ex of chosen.values()) {
      const entry = byVariant.get(ex.variantId) ?? {
        head: ex,
        points: [],
        ordinals: [],
      };
      entry.points.push(toPoint(session.localDate, session.deload, ex, config));
      entry.ordinals.push(ex.ordinal);
      byVariant.set(ex.variantId, entry);
    }
  }

  const out: ExerciseStats[] = [];
  for (const [variantId, { head, points, ordinals }] of byVariant) {
    const since = loadSegmentOn(changes, variantId, endLocalDate).since;
    // El cambio dentro del bloque parte la serie: solo se compara el último
    // tramo. Si el cambio es anterior a todo el bloque, no recorta nada.
    const comparableSince =
      since !== null && since > points[0].localDate ? since : null;
    const comparable = comparableSince
      ? points.filter((p) => p.localDate >= comparableSince)
      : points;
    out.push({
      variantId,
      exerciseName: head.exerciseName,
      variantName: head.variantName,
      equipment: head.equipment,
      isCompound: COMPOUND_PATTERNS.has(head.movementPattern),
      sessions: points.length,
      points,
      bestWorkWeightKg: Math.max(...points.map((p) => p.workWeightKg)),
      averageOrdinal: mean(ordinals) ?? 0,
      comparison: compareExercise(comparable, config),
      comparableSince,
    });
  }
  // Primero lo que de verdad fue el programa; lo que se probó dos días, al final.
  return out.sort(
    (a, b) =>
      b.sessions - a.sessions ||
      a.averageOrdinal - b.averageOrdinal ||
      a.exerciseName.localeCompare(b.exerciseName, "es"),
  );
}

function summarizeComparison(
  exercises: readonly ExerciseStats[],
): ExerciseComparisonTotals {
  const compared = exercises
    .map((e) => e.comparison)
    .filter((c): c is ExerciseComparison => c !== null);
  const changes = compared.map((c) => c.changePct);
  return {
    compared: compared.length,
    up: compared.filter((c) => c.verdict === "UP").length,
    flat: compared.filter((c) => c.verdict === "FLAT").length,
    down: compared.filter((c) => c.verdict === "DOWN").length,
    medianChangePct: medianOrNull(changes),
    notCompared: exercises.length - compared.length,
  };
}

function buildVolume(
  byWeek: ReadonlyMap<number, readonly BlockSessionInput[]>,
  weeks: number,
  catalog: CatalogExercise[],
): BlockVolume {
  const targets = Object.fromEntries(
    MUSCLE_GROUPS.map((g) => [g.code, 0]),
  ) as Record<MuscleGroupCode, number>;

  const perWeek = new Map<
    number,
    ReturnType<typeof computeWeeklyVolume> | null
  >();
  let unattributedSets = 0;
  for (let week = 1; week <= weeks; week++) {
    const sessions = byWeek.get(week);
    if (!sessions) {
      perWeek.set(week, null);
      continue;
    }
    const result = computeWeeklyVolume({
      entries: sessions.flatMap((s) =>
        s.exercises.map((e) => ({
          variantId: e.variantId,
          dayKey: s.localDate,
          sets: e.sets.length,
        })),
      ),
      catalog,
      targets,
      priorityMuscles: [],
    });
    unattributedSets += result.unattributedSets;
    perWeek.set(week, result);
  }

  const muscles: MuscleWeeklyStats[] = MUSCLE_GROUPS.map((group) => {
    const rows = [...perWeek.values()].map(
      (r) => r?.byGroup.find((g) => g.group === group.code) ?? null,
    );
    return {
      code: group.code,
      nameEs: group.nameEs,
      avgEffectiveSets: round1(
        rows.reduce((a, r) => a + (r?.fractionalSets ?? 0), 0) / weeks,
      ),
      avgDirectSets: round1(
        rows.reduce((a, r) => a + (r?.directSets ?? 0), 0) / weeks,
      ),
      weeks: rows.map((r) => (r ? r.fractionalSets : null)),
    };
  });
  return { muscles, unattributedSets };
}

function buildEffort(
  byWeek: ReadonlyMap<number, readonly BlockSessionInput[]>,
  weeks: number,
): WeekEffort[] {
  const out: WeekEffort[] = [];
  for (let week = 1; week <= weeks; week++) {
    const exercises = (byWeek.get(week) ?? []).flatMap((s) => s.exercises);
    const of = (compound: boolean) =>
      exercises
        .filter((e) => COMPOUND_PATTERNS.has(e.movementPattern) === compound)
        .flatMap((e) => rirsOf(e.sets));
    const sets = exercises.flatMap((e) => e.sets);
    const rirs = rirsOf(sets);
    out.push({
      week,
      avgRirCompound: roundOrNull(mean(of(true))),
      avgRirIsolation: roundOrNull(mean(of(false))),
      setsWithRir: rirs.length,
      setsWithoutRir: sets.length - rirs.length,
      failurePct:
        rirs.length === 0
          ? null
          : Math.round(
              (rirs.filter((r) => r === 0).length / rirs.length) * 100,
            ),
    });
  }
  return out;
}

const chips = (
  sessions: readonly BlockSessionInput[],
  pick: (s: BlockSessionInput) => number | null,
): number | null =>
  roundOrNull(mean(sessions.map(pick).filter((v): v is number => v !== null)));

function buildRecovery(
  byWeek: ReadonlyMap<number, readonly BlockSessionInput[]>,
  weeks: number,
): WeekRecovery[] {
  const out: WeekRecovery[] = [];
  for (let week = 1; week <= weeks; week++) {
    const sessions = byWeek.get(week) ?? [];
    out.push({
      week,
      sessions: sessions.length,
      fatigue: chips(sessions, (s) => s.fatigue),
      perceivedPerformance: chips(sessions, (s) => s.perceivedPerformance),
      jointPain: chips(sessions, (s) => s.jointPain),
      motivation: chips(sessions, (s) => s.motivation),
    });
  }
  return out;
}

function buildStartEnd(
  byWeek: ReadonlyMap<number, readonly BlockSessionInput[]>,
  weeks: number,
  config: Config,
): BlockStartEnd | null {
  const windowWeeks = Math.min(config.COMPARISON_WEEKS, Math.floor(weeks / 2));
  // Con una semana por extremo se compararían dos semanas sueltas.
  if (windowWeeks < 2) return null;

  const pickWeeks = (from: number, to: number): BlockSessionInput[] => {
    const out: BlockSessionInput[] = [];
    for (let w = from; w <= to; w++) out.push(...(byWeek.get(w) ?? []));
    return out;
  };
  const first = pickWeeks(1, windowWeeks);
  const last = pickWeeks(weeks - windowWeeks + 1, weeks);
  const setsOf = (s: readonly BlockSessionInput[]) =>
    s.flatMap((x) => x.exercises).flatMap((e) => e.sets);
  const metric = (
    key: StartEndMetric["key"],
    read: (s: readonly BlockSessionInput[]) => number | null,
  ): StartEndMetric => ({ key, start: read(first), end: read(last) });

  return {
    windowWeeks,
    metrics: [
      metric("SESSIONS_PER_WEEK", (s) => round1(s.length / windowWeeks)),
      metric("SETS_PER_WEEK", (s) => round1(setsOf(s).length / windowWeeks)),
      metric("AVG_RIR", (s) => roundOrNull(mean(rirsOf(setsOf(s))))),
      metric("FATIGUE", (s) => chips(s, (x) => x.fatigue)),
      metric("PERCEIVED_PERFORMANCE", (s) =>
        chips(s, (x) => x.perceivedPerformance),
      ),
      metric("JOINT_PAIN", (s) => chips(s, (x) => x.jointPain)),
      metric("MOTIVATION", (s) => chips(s, (x) => x.motivation)),
      metric("DURATION", (s) =>
        medianOrNull(
          s.map((x) => x.durationMin).filter((d): d is number => d !== null),
        ),
      ),
    ],
  };
}

/** Estadísticas de un bloque. `null` si no se llegó a entrenar. */
export function computeBlockStats(
  input: BlockStatsInput,
  config: Config = BLOCK_STATS,
): BlockStats | null {
  const sessions = [...input.sessions].sort((a, b) =>
    a.localDate.localeCompare(b.localDate),
  );
  if (sessions.length === 0) return null;

  const startLocalDate = sessions[0].localDate;
  const endLocalDate = sessions[sessions.length - 1].localDate;
  const weeks = weekIndexSince(startLocalDate, endLocalDate);

  const byWeek = new Map<number, BlockSessionInput[]>();
  for (const session of sessions) {
    const week = weekIndexSince(startLocalDate, session.localDate);
    byWeek.set(week, [...(byWeek.get(week) ?? []), session]);
  }

  const firstWeekStart = isoWeekOf(startLocalDate).weekStartDate;
  const adherenceWeeks: BlockWeekAdherence[] = [];
  for (let week = 1; week <= weeks; week++) {
    adherenceWeeks.push({
      week,
      weekStartDate: addDays(firstWeekStart, (week - 1) * 7),
      completed: byWeek.get(week)?.length ?? 0,
      expected: input.daysPerWeek,
    });
  }

  const allExercises = sessions.flatMap((s) => s.exercises);
  const allSets = allExercises.flatMap((e) => e.sets);
  const setsPlanned = allExercises.reduce((a, e) => a + e.plannedSets, 0);
  const expected = input.daysPerWeek * weeks;
  const exercises = buildExercises(
    sessions,
    input.equipmentChanges,
    endLocalDate,
    config,
  );

  return {
    startLocalDate,
    endLocalDate,
    days: diffDays(startLocalDate, endLocalDate) + 1,
    weeks,
    totalWorkingSets: allSets.length,
    totalReps: allSets.reduce((a, s) => a + s.reps, 0),
    deloadSessions: sessions.filter((s) => s.deload).length,
    adherence: {
      completed: sessions.length,
      expected,
      pct: expected === 0 ? 0 : Math.round((sessions.length / expected) * 100),
      weeks: adherenceWeeks,
      setsPlanned,
      setsLogged: allSets.length,
      setCompletionPct:
        setsPlanned === 0
          ? null
          : Math.round((allSets.length / setsPlanned) * 100),
      medianDurationMin: medianOrNull(
        sessions
          .map((s) => s.durationMin)
          .filter((d): d is number => d !== null),
      ),
    },
    exercises,
    comparison: summarizeComparison(exercises),
    volume: buildVolume(byWeek, weeks, input.catalog),
    effort: buildEffort(byWeek, weeks),
    recovery: buildRecovery(byWeek, weeks),
    startEnd: buildStartEnd(byWeek, weeks, config),
  };
}
