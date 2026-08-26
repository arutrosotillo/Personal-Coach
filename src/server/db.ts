import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Único punto de acceso a la base de datos (docs/ARCHITECTURE.md).
 * Singleton para sobrevivir al hot-reload de Next.js en desarrollo y para
 * reutilizar el pool entre invocaciones calientes de una función serverless.
 *
 * Prisma 7 usa driver adapters: la URL viene de DATABASE_URL, siempre
 * server-side. El mismo adapter sirve para el Postgres local de desarrollo y
 * para Neon en producción, así que no hay ramas por entorno.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida (ver .env.example)");
  }
  // En serverless cada instancia abre su propio pool y muchas quedan
  // congeladas entre peticiones. Un pool pequeño evita agotar el límite de
  // conexiones de Neon; el pooler (pgbouncer) hace el reparto real.
  const adapter = new PrismaPg({ connectionString, max: 5 });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
