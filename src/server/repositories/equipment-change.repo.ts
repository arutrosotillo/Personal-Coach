import type { EquipmentChangePoint } from "@/core/training/equipment";
import { prisma } from "@/server/db";

/**
 * Lecturas del cambio de gimnasio (`PersonalEvent` GYM_CHANGE +
 * `EquipmentChange` por variante). Los motores solo necesitan los PUNTOS
 * (variante + fecha); la interfaz, el evento con sus ejercicios.
 */

/**
 * Puntos de cambio de equipamiento del perfil, opcionalmente acotados a unas
 * variantes. Es lo único que leen los motores: el tramo vigente de cada
 * variante se calcula en `src/core/training/equipment.ts`.
 */
export async function listEquipmentChangePoints(
  profileId: string,
  variantIds?: readonly string[],
): Promise<EquipmentChangePoint[]> {
  if (variantIds && variantIds.length === 0) return [];
  const rows = await prisma.equipmentChange.findMany({
    where: {
      profileId,
      ...(variantIds ? { exerciseVariantId: { in: [...variantIds] } } : {}),
    },
    select: { exerciseVariantId: true, localDate: true },
  });
  return rows.map((r) => ({
    variantId: r.exerciseVariantId,
    sinceLocalDate: r.localDate,
  }));
}

export interface GymChangeExercise {
  variantId: string;
  exerciseName: string;
  variantName: string;
  equipment: string;
}

export interface GymChangeRecord {
  id: string;
  localDate: string;
  label: string | null;
  exercises: GymChangeExercise[];
}

/** Cambios de gimnasio del perfil, del más reciente al más antiguo. */
export async function listGymChanges(
  profileId: string,
): Promise<GymChangeRecord[]> {
  const events = await prisma.personalEvent.findMany({
    where: { profileId, type: "GYM_CHANGE" },
    orderBy: [{ localDate: "desc" }, { createdAt: "desc" }],
    include: {
      equipmentChanges: {
        include: {
          exerciseVariant: {
            select: {
              name: true,
              equipment: true,
              exercise: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  return events.map((e) => ({
    id: e.id,
    localDate: e.localDate,
    label: e.note,
    exercises: e.equipmentChanges
      .map((c) => ({
        variantId: c.exerciseVariantId,
        exerciseName: c.exerciseVariant.exercise.name,
        variantName: c.exerciseVariant.name,
        equipment: c.exerciseVariant.equipment,
      }))
      .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName, "es")),
  }));
}

export interface GymChangeFormDay {
  name: string;
  exercises: GymChangeExercise[];
}

/**
 * Ejercicios entre los que elegir: los del programa ACTIVO, por día y sin
 * repetir variante. Si se edita un cambio, se añaden al final los que ya
 * estaban marcados y ya no están en el programa, para poder desmarcarlos.
 */
export async function getGymChangeFormData(
  profileId: string,
  eventId?: string,
): Promise<{ days: GymChangeFormDay[]; change: GymChangeRecord | null }> {
  const program = await prisma.trainingProgram.findFirst({
    where: { profileId, isActive: true, deletedAt: null },
    include: {
      mesocycles: {
        orderBy: { ordinal: "asc" },
        take: 1,
        include: {
          templates: {
            where: { deletedAt: null },
            orderBy: { ordinal: "asc" },
            include: {
              exercises: {
                orderBy: { ordinal: "asc" },
                include: {
                  exerciseVariant: {
                    select: {
                      id: true,
                      name: true,
                      equipment: true,
                      exercise: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const seen = new Set<string>();
  const days: GymChangeFormDay[] = [];
  for (const template of program?.mesocycles[0]?.templates ?? []) {
    const exercises: GymChangeExercise[] = [];
    for (const te of template.exercises) {
      const v = te.exerciseVariant;
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      exercises.push({
        variantId: v.id,
        exerciseName: v.exercise.name,
        variantName: v.name,
        equipment: v.equipment,
      });
    }
    if (exercises.length > 0) days.push({ name: template.name, exercises });
  }

  const change = eventId
    ? ((await listGymChanges(profileId)).find((c) => c.id === eventId) ?? null)
    : null;
  const outside = (change?.exercises ?? []).filter(
    (e) => !seen.has(e.variantId),
  );
  if (outside.length > 0) {
    days.push({ name: "Fuera de tu programa actual", exercises: outside });
  }
  return { days, change };
}
