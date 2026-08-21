/**
 * Resúmenes deterministas del historial de una variante para el mini-historial
 * del ejercicio (mejor set, e1RM~ actual, tendencia). Puro: opera sobre los
 * datos ya cargados, sin DB ni fechas del sistema. Ver docs/PHASE_2B_PLAN.md.
 */

export interface HistorySet {
  weightKg: number;
  reps: number;
  rir: number | null;
  estimated1Rm: number | null;
}

export interface HistorySession {
  localDate: string;
  sets: HistorySet[];
}

export interface BestSet {
  weightKg: number;
  reps: number;
  localDate: string;
  /** e1RM~ si la serie estaba dentro del rango de Epley; si no, null. */
  e1rm: number | null;
  /** Criterio con el que se eligió: por e1RM~ o, si no hay, por tonelaje. */
  metric: "E1RM" | "TONNAGE";
}

/**
 * Mejor serie del historial: la de mayor e1RM~ si alguna lo tiene; si ninguna
 * (reps altas fuera del rango de Epley), la de mayor tonelaje (peso × reps).
 */
export function bestSet(sessions: HistorySession[]): BestSet | null {
  const flat = sessions.flatMap((s) =>
    s.sets.map((set) => ({ ...set, localDate: s.localDate })),
  );
  if (flat.length === 0) return null;

  const withE1rm = flat.filter((s) => s.estimated1Rm !== null);
  if (withE1rm.length > 0) {
    const best = withE1rm.reduce((a, b) =>
      (b.estimated1Rm ?? 0) > (a.estimated1Rm ?? 0) ? b : a,
    );
    return {
      weightKg: best.weightKg,
      reps: best.reps,
      localDate: best.localDate,
      e1rm: best.estimated1Rm,
      metric: "E1RM",
    };
  }
  const best = flat.reduce((a, b) =>
    b.weightKg * b.reps > a.weightKg * a.reps ? b : a,
  );
  return {
    weightKg: best.weightKg,
    reps: best.reps,
    localDate: best.localDate,
    e1rm: null,
    metric: "TONNAGE",
  };
}

/** e1RM~ actual: el mejor e1RM de la sesión más reciente (o null). */
export function currentE1rm(sessions: HistorySession[]): number | null {
  const last = sessions[sessions.length - 1];
  if (!last) return null;
  const values = last.sets
    .map((s) => s.estimated1Rm)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return Math.max(...values);
}

export type TrendDirection = "UP" | "FLAT" | "DOWN" | "INSUFFICIENT";

export interface Trend {
  direction: TrendDirection;
  metric: "E1RM" | "TONNAGE" | null;
  fromValue: number | null;
  toValue: number | null;
  fromDate: string | null;
  toDate: string | null;
}

/**
 * Tendencia entre la sesión más antigua y la más reciente de la ventana dada
 * (nunca por un dato aislado: <2 sesiones → INSUFFICIENT). Compara por e1RM~ si
 * ambos extremos lo tienen; si no, por tonelaje de la mejor serie. Umbral ±1%.
 */
export function trend(sessions: HistorySession[]): Trend {
  const insufficient: Trend = {
    direction: "INSUFFICIENT",
    metric: null,
    fromValue: null,
    toValue: null,
    fromDate: null,
    toDate: null,
  };
  if (sessions.length < 2) return insufficient;

  const point = (s: HistorySession) => {
    const e1rms = s.sets
      .map((x) => x.estimated1Rm)
      .filter((v): v is number => v !== null);
    const bestE1rm = e1rms.length > 0 ? Math.max(...e1rms) : null;
    const bestTonnage = Math.max(...s.sets.map((x) => x.weightKg * x.reps));
    return { localDate: s.localDate, bestE1rm, bestTonnage };
  };
  const first = point(sessions[0]);
  const last = point(sessions[sessions.length - 1]);

  const useE1rm = first.bestE1rm !== null && last.bestE1rm !== null;
  const metric = useE1rm ? "E1RM" : "TONNAGE";
  const fromValue = useE1rm ? first.bestE1rm! : first.bestTonnage;
  const toValue = useE1rm ? last.bestE1rm! : last.bestTonnage;

  const pct = fromValue === 0 ? 0 : (toValue - fromValue) / fromValue;
  const direction: TrendDirection =
    pct > 0.01 ? "UP" : pct < -0.01 ? "DOWN" : "FLAT";

  return {
    direction,
    metric,
    fromValue,
    toValue,
    fromDate: first.localDate,
    toDate: last.localDate,
  };
}
