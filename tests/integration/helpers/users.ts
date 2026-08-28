import type { PrismaClient } from "@/generated/prisma/client";

import { hashPassword } from "@/server/auth/password";

/**
 * Crea una cuenta para las suites de integración.
 *
 * Usa un hash barato a propósito: los parámetros reales de scrypt cuestan
 * ~250 ms por llamada y una suite que crea varios usuarios se iría de tiempo
 * sin ganar nada. Lo que se prueba aquí es el AISLAMIENTO, no la dureza del
 * hashing —de eso se encargan los tests unitarios de `password.ts`—.
 */
export async function createTestUser(
  prisma: PrismaClient,
  username: string,
  password = "contrasena-de-prueba",
): Promise<string> {
  const user = await prisma.user.create({
    data: { username, passwordHash: await hashPassword(password) },
  });
  return user.id;
}

/** Cuenta sin perfil todavía: sirve para probar el estado "recién creada". */
export async function createTestUserId(
  prisma: PrismaClient,
  username: string,
): Promise<string> {
  const user = await prisma.user.create({
    data: { username, passwordHash: "!" },
  });
  return user.id;
}
