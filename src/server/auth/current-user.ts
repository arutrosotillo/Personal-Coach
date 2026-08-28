import { cookies } from "next/headers";

import { prisma } from "@/server/db";
import { getProfileOverview } from "@/server/repositories/profile.repo";
import { SESSION_COOKIE, readSessionToken } from "@/server/auth/session";

/**
 * Resuelve QUIÉN está pidiendo las cosas. Es el único sitio de la app que
 * convierte una cookie en un usuario y un perfil.
 *
 * Antes esto no existía: `getProfile()` hacía `findFirst` sin filtro y
 * devolvía el perfil más antiguo de la base de datos, así que con varios
 * usuarios todos habrían visto los datos del primero. Todo el dominio ya
 * filtraba por `profileId` correctamente; lo que fallaba era de dónde salía
 * ese id.
 *
 * `isActive` se comprueba AQUÍ y no en el token: desactivar una cuenta tiene
 * que echarla fuera en el acto, no dentro de 90 días cuando caduque la cookie.
 */

export interface CurrentUser {
  userId: string;
  username: string;
}

/** Usuario de la sesión, o `null` si no hay sesión válida o está desactivado. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const session = readSessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session.valid || !session.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, username: true, isActive: true },
  });
  // Cuenta borrada o desactivada después de emitir la cookie.
  if (!user || !user.isActive) return null;

  return { userId: user.id, username: user.username };
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Sesión no válida. Vuelve a iniciar sesión.");
    this.name = "NotAuthenticatedError";
  }
}

export class NoProfileError extends Error {
  constructor() {
    super("No hay perfil: completa el onboarding primero.");
    this.name = "NoProfileError";
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new NotAuthenticatedError();
  return user;
}

/** Perfil del usuario de la sesión. `null` si aún no ha hecho el onboarding. */
export async function getCurrentProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  return prisma.userProfile.findUnique({ where: { userId: user.userId } });
}

/**
 * `profileId` del usuario de la sesión. Es el que reciben todos los services,
 * que ya filtran por él en cada query.
 */
export async function requireProfileId(): Promise<string> {
  const user = await requireUser();
  const profile = await prisma.userProfile.findUnique({
    where: { userId: user.userId },
    select: { id: true },
  });
  if (!profile) throw new NoProfileError();
  return profile.id;
}

/**
 * Resumen del perfil del usuario de la sesión (objetivo, programa activo,
 * preferencias). `null` si no hay sesión o no ha hecho el onboarding.
 */
export async function getCurrentProfileOverview() {
  const user = await getCurrentUser();
  if (!user) return null;
  const profile = await prisma.userProfile.findUnique({
    where: { userId: user.userId },
    select: { id: true },
  });
  if (!profile) return null;
  return getProfileOverview(profile.id);
}
