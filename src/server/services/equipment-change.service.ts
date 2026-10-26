import { EQUIPMENT_CHANGE } from "@/core/config/training-config";
import {
  addDays,
  DEFAULT_TIMEZONE,
  formatLocalDate,
  toLocalDate,
} from "@/core/dates";
import type {
  GymChangeCreateData,
  GymChangeData,
} from "@/core/schemas/gym-change";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { visibleExerciseWhere } from "@/server/repositories/exercise-library.repo";

/**
 * Cambio de gimnasio: un `PersonalEvent` GYM_CHANGE con la fecha y, por cada
 * ejercicio que pasa a usar OTRO equipamiento, un `EquipmentChange`.
 *
 * Lo que NO hace, y es la mitad del diseño: no toca el objetivo, ni el
 * programa, ni las prescripciones, ni una sola serie registrada. Solo dice
 * desde qué día las cargas de esos ejercicios dejan de compararse con las de
 * antes. Deshacerlo borra esas filas y nada más.
 */

/** Error esperable, con un mensaje que se puede enseñar tal cual. */
export class GymChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GymChangeError";
  }
}

type Tx = Prisma.TransactionClient;

function assertDateInRange(localDate: string, now: Date) {
  const today = toLocalDate(now, DEFAULT_TIMEZONE);
  const min = addDays(today, -EQUIPMENT_CHANGE.MAX_DAYS_BACK);
  const max = addDays(today, EQUIPMENT_CHANGE.MAX_DAYS_AHEAD);
  if (localDate < min || localDate > max) {
    throw new GymChangeError(
      `La fecha tiene que estar entre el ${formatLocalDate(min)} y el ${formatLocalDate(max)}.`,
    );
  }
}

/**
 * Las variantes tienen que ser VISIBLES para este perfil: sin esto, una
 * petición fabricada podía colgar el ejercicio personalizado de otra persona
 * de tu historial (el mismo agujero que ya se cerró en la sustitución).
 */
async function assertVisibleVariants(
  tx: Tx,
  profileId: string,
  variantIds: readonly string[],
) {
  if (variantIds.length === 0) return;
  const visible = await tx.exerciseVariant.count({
    where: {
      id: { in: [...variantIds] },
      exercise: visibleExerciseWhere(profileId),
    },
  });
  if (visible !== variantIds.length) {
    throw new GymChangeError("Algún ejercicio marcado ya no está disponible.");
  }
}

/**
 * Dos cambios de la MISMA variante el MISMO día no tienen sentido (y el
 * índice único lo impediría con un error opaco): se dice cuál choca.
 */
async function assertNoClash(
  tx: Tx,
  profileId: string,
  variantIds: readonly string[],
  localDate: string,
  ignoreEventId: string | null,
) {
  if (variantIds.length === 0) return;
  const clash = await tx.equipmentChange.findFirst({
    where: {
      profileId,
      localDate,
      exerciseVariantId: { in: [...variantIds] },
      ...(ignoreEventId ? { personalEventId: { not: ignoreEventId } } : {}),
    },
    include: {
      exerciseVariant: {
        select: { name: true, exercise: { select: { name: true } } },
      },
    },
  });
  if (clash) {
    throw new GymChangeError(
      `${clash.exerciseVariant.exercise.name} (${clash.exerciseVariant.name}) ya tiene otro cambio de equipamiento ese mismo día.`,
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Registra un cambio de gimnasio. Idempotente por `requestId`: repetir la
 * petición (doble toque, reintento con mala cobertura) devuelve el mismo
 * evento en vez de crear otro.
 */
export async function registerGymChange(
  profileId: string,
  input: GymChangeCreateData,
  now: Date = new Date(),
): Promise<{ eventId: string; replayed: boolean }> {
  const replay = async () => {
    const existing = await prisma.personalEvent.findUnique({
      where: { requestId: input.requestId },
      select: { id: true, profileId: true },
    });
    if (!existing) return null;
    if (existing.profileId !== profileId) {
      throw new GymChangeError("No se pudo registrar el cambio de gimnasio.");
    }
    return { eventId: existing.id, replayed: true };
  };

  const previous = await replay();
  if (previous) return previous;
  assertDateInRange(input.localDate, now);

  try {
    return await prisma.$transaction(async (tx) => {
      await assertVisibleVariants(tx, profileId, input.variantIds);
      await assertNoClash(
        tx,
        profileId,
        input.variantIds,
        input.localDate,
        null,
      );
      const event = await tx.personalEvent.create({
        data: {
          profileId,
          type: "GYM_CHANGE",
          localDate: input.localDate,
          note: input.label,
          requestId: input.requestId,
        },
      });
      if (input.variantIds.length > 0) {
        await tx.equipmentChange.createMany({
          data: input.variantIds.map((exerciseVariantId) => ({
            profileId,
            exerciseVariantId,
            personalEventId: event.id,
            localDate: input.localDate,
          })),
        });
      }
      return { eventId: event.id, replayed: false };
    });
  } catch (error) {
    // Dos envíos a la vez con la misma clave: el segundo choca con el índice
    // único de `requestId` y devuelve lo que creó el primero.
    if (isUniqueViolation(error)) {
      const raced = await replay();
      if (raced) return raced;
    }
    throw error;
  }
}

/** Evento GYM_CHANGE de este perfil, o error legible. */
async function ownedGymChange(tx: Tx, profileId: string, eventId: string) {
  const event = await tx.personalEvent.findFirst({
    where: { id: eventId, profileId, type: "GYM_CHANGE" },
  });
  if (!event) {
    throw new GymChangeError("Ese cambio de gimnasio no existe o no es tuyo.");
  }
  return event;
}

/**
 * Corrige un cambio ya registrado: la fecha, el nombre o qué ejercicios
 * cambian de equipamiento (lo normal es descubrir en el gimnasio nuevo que la
 * prensa también es distinta). Sustituye sus filas en una transacción.
 */
export async function updateGymChange(
  profileId: string,
  eventId: string,
  input: GymChangeData,
  now: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const event = await ownedGymChange(tx, profileId, eventId);
    // Un cambio antiguo se puede seguir corrigiendo sin mover su fecha.
    if (input.localDate !== event.localDate) {
      assertDateInRange(input.localDate, now);
    }
    await assertVisibleVariants(tx, profileId, input.variantIds);
    await assertNoClash(
      tx,
      profileId,
      input.variantIds,
      input.localDate,
      eventId,
    );
    await tx.personalEvent.update({
      where: { id: eventId },
      data: { localDate: input.localDate, note: input.label },
    });
    await tx.equipmentChange.deleteMany({
      where: { personalEventId: eventId },
    });
    if (input.variantIds.length > 0) {
      await tx.equipmentChange.createMany({
        data: input.variantIds.map((exerciseVariantId) => ({
          profileId,
          exerciseVariantId,
          personalEventId: eventId,
          localDate: input.localDate,
        })),
      });
    }
  });
}

/**
 * Deshace un cambio de gimnasio: borra el evento y sus `EquipmentChange`
 * (cascada). Ninguna serie, sesión ni prescripción depende de ellos.
 */
export async function deleteGymChange(
  profileId: string,
  eventId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await ownedGymChange(tx, profileId, eventId);
    await tx.personalEvent.delete({ where: { id: eventId } });
  });
}
