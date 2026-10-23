import { FATIGUE } from "@/core/config/training-config";
import { diffDays } from "@/core/dates";

/**
 * ¿En qué punto de una descarga estás? (Fase 3.3). Puro y determinista: lo
 * deriva de las sesiones ya marcadas como descarga (`weekKind: "DELOAD"`), sin
 * migración y sin una fila de "descarga" que nadie mantendría.
 *
 * Hacía falta porque la app sabía cuándo EMPEZABA una descarga pero no cuándo
 * TERMINABA, y eso rompía la vuelta de dos maneras:
 *
 *  · **La recomendación no se apagaba.** Las sesiones de descarga no cuentan
 *    como exposición, así que al volver el motor de fatiga seguía viendo las
 *    MISMAS caídas que la habían motivado y volvía a pedir una descarga —con
 *    el veto de subidas puesto— el primer día de vuelta. La evidencia que
 *    justificó la descarga ya se ha gastado en ella: usarla otra vez es
 *    contarla dos veces.
 *  · **El mensaje se equivocaba.** "Estás haciendo la descarga" se decidía
 *    mirando si la ÚLTIMA sesión era de descarga, así que seguía saliendo con
 *    la semana ya completa y, al volver, saltaba directamente a "te recomiendo
 *    una semana de descarga".
 */

/** Una sesión completada, reducida a lo que importa aquí. */
export interface TimelineSession {
  localDate: string;
  deload: boolean;
}

/** Una tanda de sesiones de descarga seguidas. */
export interface DeloadBatch {
  startLocalDate: string;
  endLocalDate: string;
  sessions: number;
}

export type DeloadPhase =
  /** No hay descarga en curso ni recién terminada. */
  | "NONE"
  /** Has empezado la descarga y todavía no has completado su semana. */
  | "IN_PROGRESS"
  /** La has completado y aún no has vuelto a entrenar normal. */
  | "FINISHED";

export interface DeloadStatus {
  phase: DeloadPhase;
  /** La tanda que describe `phase`; `null` en `NONE`. */
  current: DeloadBatch | null;
  /**
   * La última descarga COMPLETA (la que está en curso no cuenta). Cada
   * ejercicio se juzga, para la fatiga, solo con lo que has hecho después de
   * su última sesión. Sigue vigente después de volver a entrenar: no es un
   * estado de la pantalla, es el punto desde el que los datos son nuevos.
   */
  lastCompleted: DeloadBatch | null;
  sessionsPerWeek: number;
}

/**
 * Sitúa la descarga en `todayLocalDate`.
 *
 * **Tanda**: sesiones de descarga seguidas en el orden real de tus sesiones.
 * Una sesión normal en medio la corta —has vuelto a entrenar—, y también un
 * hueco de `WINDOW_DAYS` entre dos descargas, que ya no son la misma semana.
 *
 * **En curso**: la última tanda, si no la ha cortado una sesión normal,
 * mientras no hayas hecho tantas sesiones como días entrenas por semana NI
 * haya pasado la semana del plan (`DELOAD_PLAN.DAYS`) desde la primera.
 *
 * **Completa**: una tanda que ya no está en curso y tiene al menos
 * `MIN_SESSIONS_TO_RESET` sesiones (o tantas como días entrenas, si entrenas
 * menos). Es el mismo umbral que reinicia el contador de acumulación: una sola
 * sesión recortada no es una descarga, y no puede borrar las caídas que la
 * pedían.
 */
export function deloadStatus(
  timeline: TimelineSession[],
  todayLocalDate: string,
  sessionsPerWeek: number,
  config = FATIGUE,
): DeloadStatus {
  const perWeek = Math.max(1, sessionsPerWeek);
  const { WINDOW_DAYS, MIN_SESSIONS_TO_RESET } = config.DELOAD_DETECTION;

  // Tandas, de la más antigua a la más reciente. `closed` = ya no puede seguir:
  // la cortó una sesión normal posterior, o detrás empezó otra tanda.
  const batches: Array<DeloadBatch & { closed: boolean }> = [];
  let open: (DeloadBatch & { closed: boolean }) | null = null;
  // `sort` es estable: dos sesiones del mismo día conservan el orden en que
  // llegan (el repositorio las ordena por hora de cierre).
  const ordered = [...timeline].sort((a, b) =>
    a.localDate.localeCompare(b.localDate),
  );
  for (const s of ordered) {
    if (s.localDate > todayLocalDate) continue;
    if (!s.deload) {
      if (open) open.closed = true;
      open = null;
      continue;
    }
    if (open && diffDays(open.endLocalDate, s.localDate) < WINDOW_DAYS) {
      open.endLocalDate = s.localDate;
      open.sessions += 1;
      continue;
    }
    if (open) open.closed = true;
    open = {
      startLocalDate: s.localDate,
      endLocalDate: s.localDate,
      sessions: 1,
      closed: false,
    };
    batches.push(open);
  }

  const complete = (b: DeloadBatch) =>
    b.sessions >= Math.min(MIN_SESSIONS_TO_RESET, perWeek);
  const plain = ({ startLocalDate, endLocalDate, sessions }: DeloadBatch) => ({
    startLocalDate,
    endLocalDate,
    sessions,
  });

  const latest = batches.at(-1);
  const inProgress =
    latest !== undefined &&
    !latest.closed &&
    latest.sessions < perWeek &&
    diffDays(latest.startLocalDate, todayLocalDate) < config.DELOAD_PLAN.DAYS;

  const lastCompleted = [...batches]
    .reverse()
    .find((b) => !(inProgress && b === latest) && complete(b));

  const phase: DeloadPhase = inProgress
    ? "IN_PROGRESS"
    : latest !== undefined && !latest.closed && complete(latest)
      ? "FINISHED"
      : "NONE";

  return {
    phase,
    current: phase === "NONE" || latest === undefined ? null : plain(latest),
    lastCompleted: lastCompleted ? plain(lastCompleted) : null,
    sessionsPerWeek: perWeek,
  };
}
