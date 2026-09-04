import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client";
import { runSeed, SEED_VERSION } from "./run-seed";

/**
 * Siembra el catálogo. Lo ejecuta `vercel-build` en CADA despliegue, y también
 * se puede lanzar a mano (`pnpm db:seed`).
 *
 * Al correr dentro del build usa la cadena DIRECTA si está —es la misma que
 * usan las migraciones, y en el build no hay concurrencia que justifique el
 * pooler—. Si no, la normal.
 */
async function main() {
  const connectionString =
    process.env.DIRECT_DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no está definida");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const counts = await runSeed(prisma);
    console.log(
      `Seed OK (v${SEED_VERSION}): ${counts.muscleGroups} grupos, ${counts.exercises} ejercicios, ` +
        `${counts.variants} variantes, ${counts.contributions} contribuciones. ` +
        `Filas escritas: ${counts.written}.`,
    );
    if (counts.skipped.length > 0) {
      // No es un fallo: alguien tiene un ejercicio propio con ese nombre y el
      // suyo manda. Pero hay que verlo en los logs del despliegue.
      console.warn(
        `Seed: ${counts.skipped.length} ejercicio(s) del catálogo no sembrados ` +
          `porque el nombre ya lo usa un ejercicio propio: ${counts.skipped.join(", ")}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Seed falló:", error);
  process.exit(1);
});
