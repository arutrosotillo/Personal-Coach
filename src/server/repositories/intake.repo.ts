import { prisma } from "@/server/db";

/**
 * Registro de ingesta diario: el total de kcal y proteína COMIDOS un día.
 *
 * Vive en `DailyCheckIn.kcal` / `proteinG`, que existían desde F1 para esto y
 * estaban vacías: una fila por persona y día, así que registrar dos veces el
 * mismo día corrige en vez de duplicar, y como el cliente identifica la fila
 * por FECHA y el perfil sale de la sesión, la escritura no tiene superficie
 * IDOR. No toca las demás columnas del check-in (y nunca `weightKg`, que está
 * obsoleta: el peso vive en `BodyMeasurement`).
 */

export interface IntakeRecord {
  localDate: string;
  kcal: number;
  proteinG: number | null;
}

export async function upsertIntake(
  profileId: string,
  localDate: string,
  data: { kcal: number; proteinG: number | null },
): Promise<IntakeRecord> {
  const row = await prisma.dailyCheckIn.upsert({
    where: { profileId_localDate: { profileId, localDate } },
    create: { profileId, localDate, kcal: data.kcal, proteinG: data.proteinG },
    update: { kcal: data.kcal, proteinG: data.proteinG },
    select: { localDate: true, kcal: true, proteinG: true },
  });
  return { localDate: row.localDate, kcal: row.kcal!, proteinG: row.proteinG };
}

/** Quita el registro de un día (deja la fila si tiene otros datos del check-in). */
export async function clearIntake(
  profileId: string,
  localDate: string,
): Promise<void> {
  await prisma.dailyCheckIn.updateMany({
    where: { profileId, localDate },
    data: { kcal: null, proteinG: null },
  });
}

export async function listIntake(
  profileId: string,
  fromLocalDate: string,
  toLocalDate: string,
): Promise<IntakeRecord[]> {
  const rows = await prisma.dailyCheckIn.findMany({
    where: {
      profileId,
      localDate: { gte: fromLocalDate, lte: toLocalDate },
      kcal: { not: null },
    },
    orderBy: { localDate: "asc" },
    select: { localDate: true, kcal: true, proteinG: true },
  });
  return rows.map((r) => ({
    localDate: r.localDate,
    kcal: r.kcal!,
    proteinG: r.proteinG,
  }));
}

export async function findIntake(
  profileId: string,
  localDate: string,
): Promise<IntakeRecord | null> {
  const row = await prisma.dailyCheckIn.findUnique({
    where: { profileId_localDate: { profileId, localDate } },
    select: { localDate: true, kcal: true, proteinG: true },
  });
  if (!row || row.kcal === null) return null;
  return { localDate: row.localDate, kcal: row.kcal, proteinG: row.proteinG };
}
