import { BODY_CONFIG, type BodyConfig } from "@/core/config/body-config";
import { addDays, diffDays, isLocalDate } from "@/core/dates";
import type { WaistProtocol } from "@/core/enums";

import type { BodyMeasurementPoint } from "@/core/body/types";

/**
 * ¿Toca check-in corporal?
 *
 * QUÉ ES UN CHECK-IN, exactamente: una medición de cintura. No hay tabla, ni
 * estado, ni marca aparte. El peso ya tiene su vía rápida y se registra cuando
 * apetece; lo que el check-in aporta de verdad es la cintura, que es la métrica
 * de cadencia lenta. Definirlo así tiene tres consecuencias buenas:
 *
 *   · Cero esquema nuevo. La cadencia se deriva de los datos que ya hay.
 *   · Se auto-corrige. Si borras la medición, el check-in "no ocurrió", que es
 *     exactamente lo que debe pasar.
 *   · Funciona con los perfiles que ya existen, sin inventarles historial: si
 *     nunca han medido cintura, están en `NEVER_DONE` desde hoy, no en deuda
 *     desde el día que se dieron de alta.
 *
 * Función PURA: la fecha de corte entra por parámetro y nada se lee del reloj.
 */

export type CheckInStatus =
  /** Nunca se ha medido la cintura. No es una deuda: es un primer paso. */
  | "NEVER_DONE"
  /** Se midió hace poco; todavía no toca. */
  | "NOT_DUE"
  /** Ha pasado el intervalo. */
  | "DUE";

export interface CheckInEvaluation {
  status: CheckInStatus;
  /** Día del último check-in (última medición con cintura), o `null`. */
  lastLocalDate: string | null;
  /** Con qué protocolo se hizo. `null` si se desconoce o no hay ninguno. */
  lastProtocol: WaistProtocol | null;
  /** Día en que toca el siguiente. Con `NEVER_DONE` es hoy. */
  nextDueLocalDate: string;
  /** Días transcurridos desde el último. `null` si no hay ninguno. */
  daysSinceLast: number | null;
  /** Días que faltan (0 si toca hoy o ya venció). */
  daysUntilDue: number;
  /** Días de retraso (0 si no ha vencido). */
  daysOverdue: number;
  /** Cadencia aplicada, para que la interfaz no la duplique. */
  intervalDays: number;
}

export function evaluateCheckIn(
  measurements: readonly BodyMeasurementPoint[],
  todayLocalDate: string,
  config: BodyConfig = BODY_CONFIG,
): CheckInEvaluation {
  const intervalDays = config.checkInIntervalDays;

  // Solo cuentan las mediciones de cintura hasta hoy. Igual que en el motor,
  // nada del futuro entra ni una fecha con formato inválido rompe nada.
  const conCintura = measurements
    .filter(
      (m) =>
        m.waistCm !== null &&
        isLocalDate(m.localDate) &&
        diffDays(m.localDate, todayLocalDate) >= 0,
    )
    .sort((a, b) => a.localDate.localeCompare(b.localDate));

  const ultima = conCintura[conCintura.length - 1];

  if (!ultima) {
    return {
      status: "NEVER_DONE",
      lastLocalDate: null,
      lastProtocol: null,
      // Hoy, no "ayer": a quien nunca lo ha hecho no se le debe presentar una
      // deuda acumulada desde que se dio de alta.
      nextDueLocalDate: todayLocalDate,
      daysSinceLast: null,
      daysUntilDue: 0,
      daysOverdue: 0,
      intervalDays,
    };
  }

  const daysSinceLast = diffDays(ultima.localDate, todayLocalDate);
  const nextDueLocalDate = addDays(ultima.localDate, intervalDays);
  const restantes = diffDays(todayLocalDate, nextDueLocalDate);

  return {
    status: daysSinceLast >= intervalDays ? "DUE" : "NOT_DUE",
    lastLocalDate: ultima.localDate,
    lastProtocol: ultima.waistProtocol,
    nextDueLocalDate,
    daysUntilDue: Math.max(0, restantes),
    daysOverdue: Math.max(0, -restantes),
    daysSinceLast,
    intervalDays,
  };
}
