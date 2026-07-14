import { prisma } from "@/server/db";

/**
 * Lecturas del perfil y su estado actual. En la práctica hay un único perfil
 * (app personal); todas las queries toman "el primero" de forma determinista.
 */

export async function getProfile() {
  return prisma.userProfile.findFirst({ orderBy: { createdAt: "asc" } });
}

/** id del perfil único (app personal). Lanza si aún no hay onboarding. */
export async function requireProfileId(): Promise<string> {
  const profile = await getProfile();
  if (!profile)
    throw new Error("No hay perfil: completa el onboarding primero.");
  return profile.id;
}

/** Última medición corporal registrada (para el resumen de progreso). */
export async function getLatestMeasurement(profileId: string) {
  return prisma.bodyMeasurement.findFirst({
    where: { profileId },
    orderBy: { localDate: "desc" },
  });
}

export async function getProfileOverview() {
  const profile = await getProfile();
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
    prisma.userPreference.findMany(),
  ]);

  return { profile, goal, nutritionTarget, program, preferences };
}

export type ProfileOverview = NonNullable<
  Awaited<ReturnType<typeof getProfileOverview>>
>;
