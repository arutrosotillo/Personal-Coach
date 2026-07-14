import "dotenv/config";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../../src/generated/prisma/client";
import { runSeed, SEED_VERSION } from "./run-seed";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida");
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url }),
  });

  try {
    const counts = await runSeed(prisma);
    console.log(
      `Seed OK (v${SEED_VERSION}): ${counts.muscleGroups} grupos, ${counts.exercises} ejercicios, ` +
        `${counts.variants} variantes, ${counts.contributions} contribuciones.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Seed falló:", error);
  process.exit(1);
});
