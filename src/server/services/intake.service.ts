import { DEFAULT_TIMEZONE, diffDays, toLocalDate } from "@/core/dates";
import type { IntakeData } from "@/core/schemas/intake";
import {
  clearIntake as clearIntakeRow,
  upsertIntake,
  type IntakeRecord,
} from "@/server/repositories/intake.repo";

/**
 * Registro de ingesta diario (docs/CYCLES.md §3). Opcional: la app funciona
 * entera sin él; con él, el mantenimiento se estima con lo COMIDO en vez de
 * suponer que se comió el objetivo.
 */

export class FutureIntakeError extends Error {
  constructor() {
    super("No puedes registrar lo que comerás mañana.");
    this.name = "FutureIntakeError";
  }
}

function assertNotFuture(localDate: string, now: Date) {
  if (diffDays(localDate, toLocalDate(now, DEFAULT_TIMEZONE)) < 0) {
    throw new FutureIntakeError();
  }
}

export async function saveIntake(
  profileId: string,
  data: IntakeData,
  now: Date = new Date(),
): Promise<IntakeRecord> {
  assertNotFuture(data.localDate, now);
  return upsertIntake(profileId, data.localDate, {
    kcal: data.kcal,
    proteinG: data.proteinG,
  });
}

export async function clearIntake(
  profileId: string,
  localDate: string,
  now: Date = new Date(),
): Promise<void> {
  assertNotFuture(localDate, now);
  await clearIntakeRow(profileId, localDate);
}
