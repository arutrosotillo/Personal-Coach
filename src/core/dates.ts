/**
 * Único módulo autorizado para calcular fechas de calendario del usuario.
 * `localDate` = "YYYY-MM-DD" en la timezone del perfil: un registro a las 00:30
 * cuenta para el día correcto según la zona, no según UTC.
 * Ver docs/ARCHITECTURE.md — Fechas y unidades.
 */

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: string): boolean {
  if (!LOCAL_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d >= 1 && d <= daysInMonth;
}

/** Convierte un instante concreto a localDate en la timezone dada (IANA). */
export function toLocalDate(instant: Date, timezone: string): string {
  // en-CA produce YYYY-MM-DD de forma estable.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Suma días de calendario a un localDate (aritmética pura, sin timezone). */
export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Diferencia en días de calendario (b − a). */
export function diffDays(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Edad en años cumplidos a fecha `onDate`. */
export function ageInYears(birthDate: string, onDate: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [oy, om, od] = onDate.split("-").map(Number);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

/** Semana ISO-8601 { isoYear, isoWeek } y lunes de esa semana. */
export function isoWeekOf(localDate: string): {
  isoYear: number;
  isoWeek: number;
  weekStartDate: string;
} {
  const [y, m, d] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = date.getUTCDay() || 7; // lunes=1 … domingo=7
  // Jueves de la misma semana ISO determina el año ISO.
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - (dayOfWeek - 1));
  return { isoYear, isoWeek, weekStartDate: monday.toISOString().slice(0, 10) };
}
