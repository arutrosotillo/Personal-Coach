import "dotenv/config";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { EXERCISES } from "../../src/core/catalog/exercises";
import { MUSCLE_GROUPS } from "../../src/core/catalog/muscle-groups";
import { PrismaClient } from "../../src/generated/prisma/client";

/**
 * Seed idempotente del catálogo (docs/DATA_MODEL.md — Migraciones y seed).
 * Upsert por claves naturales: ejecutarlo N veces produce el mismo estado.
 * NO crea datos personales: el onboarding es el único camino para eso.
 */

const SEED_VERSION = 1;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida");
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

  try {
    // 1. Grupos musculares
    for (const group of MUSCLE_GROUPS) {
      await prisma.muscleGroup.upsert({
        where: { code: group.code },
        create: {
          code: group.code,
          nameEs: group.nameEs,
          region: group.region,
          tier: group.tier,
        },
        update: { nameEs: group.nameEs, region: group.region, tier: group.tier },
      });
    }
    const groupsByCode = new Map(
      (await prisma.muscleGroup.findMany()).map((g) => [g.code, g.id]),
    );

    // 2. Ejercicios + contribuciones + variantes
    for (const exercise of EXERCISES) {
      const dbExercise = await prisma.exercise.upsert({
        where: { name: exercise.name },
        create: {
          name: exercise.name,
          movementPattern: exercise.movementPattern,
          systemicFatigue: exercise.systemicFatigue,
          instructions: exercise.instructions,
        },
        update: {
          movementPattern: exercise.movementPattern,
          systemicFatigue: exercise.systemicFatigue,
          instructions: exercise.instructions,
        },
      });

      for (const contribution of exercise.contributions) {
        const muscleGroupId = groupsByCode.get(contribution.group);
        if (!muscleGroupId) {
          throw new Error(`Grupo desconocido en el catálogo: ${contribution.group}`);
        }
        await prisma.exerciseMuscleContribution.upsert({
          where: {
            exerciseId_muscleGroupId: { exerciseId: dbExercise.id, muscleGroupId },
          },
          create: {
            exerciseId: dbExercise.id,
            muscleGroupId,
            role: contribution.role,
            factor: contribution.factor,
          },
          update: { role: contribution.role, factor: contribution.factor },
        });
      }

      for (const variant of exercise.variants) {
        await prisma.exerciseVariant.upsert({
          where: {
            exerciseId_name: { exerciseId: dbExercise.id, name: variant.name },
          },
          create: {
            exerciseId: dbExercise.id,
            name: variant.name,
            equipment: variant.equipment,
            loadStepKg: variant.loadStepKg,
            repRangeMin: variant.repRangeMin,
            repRangeMax: variant.repRangeMax,
            defaultRestSeconds: variant.defaultRestSeconds,
            contraindications: variant.contraindications,
            isDefault: variant.isDefault ?? false,
          },
          update: {
            equipment: variant.equipment,
            loadStepKg: variant.loadStepKg,
            repRangeMin: variant.repRangeMin,
            repRangeMax: variant.repRangeMax,
            defaultRestSeconds: variant.defaultRestSeconds,
            contraindications: variant.contraindications,
            isDefault: variant.isDefault ?? false,
          },
        });
      }
    }

    await prisma.appSetting.upsert({
      where: { key: "seed_version" },
      create: { key: "seed_version", value: SEED_VERSION },
      update: { value: SEED_VERSION },
    });

    const counts = {
      muscleGroups: await prisma.muscleGroup.count(),
      exercises: await prisma.exercise.count(),
      variants: await prisma.exerciseVariant.count(),
      contributions: await prisma.exerciseMuscleContribution.count(),
    };
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
