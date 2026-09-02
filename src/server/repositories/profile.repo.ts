import { prisma } from "@/server/db";

/**
 * Lecturas del perfil y su estado actual.
 *
 * Estas funciones NO deciden de quién son los datos: reciben el `profileId` ya
 * resuelto. Quien lo resuelve es `src/server/auth/current-user.ts`, a partir de
 * la sesión. Antes vivía aquí un `findFirst` sin filtro que devolvía "el primer
 * perfil": con varios usuarios eso significaba que todos veían los datos del
 * más antiguo.
 */

export async function getProfileById(profileId: string) {
  return prisma.userProfile.findUnique({ where: { id: profileId } });
}

/** Perfil de un usuario concreto. `null` si aún no ha hecho el onboarding. */
export async function getProfileByUserId(userId: string) {
  return prisma.userProfile.findUnique({ where: { userId } });
}

/** Última medición corporal registrada (para el resumen de progreso). */
export async function getLatestMeasurement(profileId: string) {
  return prisma.bodyMeasurement.findFirst({
    where: { profileId },
    orderBy: { localDate: "desc" },
  });
}

/**
 * Objetivo ACTIVO del perfil. Lectura ligera: el seguimiento corporal solo
 * necesita el objetivo, y `getProfileOverview` se trae además el programa
 * entero con sus plantillas y ejercicios.
 */
export async function getActiveGoal(profileId: string) {
  return prisma.goal.findFirst({
    where: { profileId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      strategy: true,
      weeklyRatePct: true,
      startWeightKg: true,
      targetWeightKg: true,
      startDate: true,
    },
  });
}

export async function getProfileOverview(profileId: string) {
  const profile = await getProfileById(profileId);
  if (!profile) return null;

  const [goal, nutritionTarget, program, preferences] = await Promise.all([
    prisma.goal.findFirst({
      where: { profileId: profile.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.nutritionTarget.findFirst({
      where: { profileId: profile.id },
      orderBy: { effectiveFrom: "desc" },
    }),
    prisma.trainingProgram.findFirst({
      where: { profileId: profile.id, isActive: true, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        mesocycles: {
          orderBy: { ordinal: "asc" },
          include: {
            templates: {
              where: { deletedAt: null },
              orderBy: { ordinal: "asc" },
              include: {
                exercises: {
                  orderBy: { ordinal: "asc" },
                  include: { exerciseVariant: { include: { exercise: true } } },
                },
              },
            },
          },
        },
      },
    }),
    prisma.userPreference.findMany({ where: { profileId: profile.id } }),
  ]);

  return { profile, goal, nutritionTarget, program, preferences };
}

export type ProfileOverview = NonNullable<
  Awaited<ReturnType<typeof getProfileOverview>>
>;
