import { EXERCISES } from "../../src/core/catalog/exercises";
import { MUSCLE_GROUPS } from "../../src/core/catalog/muscle-groups";
import type { PrismaClient } from "../../src/generated/prisma/client";

/**
 * Seed idempotente del catálogo (docs/DATA_MODEL.md — Migraciones y seed).
 *
 * Corre en CADA despliegue (`vercel-build`), y eso cambia lo que se le puede
 * pedir. Antes hacía un `upsert` por ejercicio, por contribución y por
 * variante: con 45 ejercicios eran ~250 viajes a la base y se ejecutaba a mano
 * de uvas a peras. Con 94 ejercicios y 200+ variantes serían ~560 viajes a
 * Neon en cada build, y todos escribiendo filas idénticas a las que ya estaban.
 *
 * Ahora LEE primero y escribe solo lo que de verdad difiere. Un despliegue que
 * no toca el catálogo son cuatro SELECT y cero escrituras.
 *
 * Sigue sin crear datos personales: el onboarding es el único camino para eso.
 */

export const SEED_VERSION = 2;

export interface SeedCounts {
  muscleGroups: number;
  exercises: number;
  variants: number;
  contributions: number;
  /** Filas realmente escritas. `0` = el catálogo ya estaba al día. */
  written: number;
  /**
   * Ejercicios del catálogo que NO se pudieron sembrar porque alguien tiene un
   * ejercicio propio con ese mismo nombre (`Exercise.name` es único global).
   * Se avisa y se sigue: perder una entrada del catálogo es molesto, tumbar el
   * despliegue entero por ella es peor.
   */
  skipped: string[];
}

export async function runSeed(prisma: PrismaClient): Promise<SeedCounts> {
  let written = 0;

  // ── 1. Grupos musculares ────────────────────────────────────────────────
  const existingGroups = await prisma.muscleGroup.findMany();
  const groupByCode = new Map(existingGroups.map((g) => [g.code, g]));
  for (const group of MUSCLE_GROUPS) {
    const current = groupByCode.get(group.code);
    if (
      current &&
      current.nameEs === group.nameEs &&
      current.region === group.region
    ) {
      continue;
    }
    const saved = await prisma.muscleGroup.upsert({
      where: { code: group.code },
      create: group,
      update: { nameEs: group.nameEs, region: group.region },
    });
    groupByCode.set(saved.code, saved);
    written++;
  }
  const groupIdByCode = new Map(
    [...groupByCode.values()].map((g) => [g.code, g.id]),
  );

  // ── 2. Ejercicios, contribuciones y variantes ───────────────────────────
  //
  // Una sola lectura con todo lo que hace falta comparar. Se leen TODOS los
  // ejercicios (también los propios de cada persona) porque el nombre es único
  // global y hay que detectar los choques.
  const existing = await prisma.exercise.findMany({
    include: { variants: true, contributions: true },
  });
  const byName = new Map(existing.map((e) => [e.name, e]));

  const skipped: string[] = [];

  for (const seed of EXERCISES) {
    const current = byName.get(seed.name);

    // Choque con un ejercicio propio de alguien: no es nuestro, no se toca.
    if (current && current.profileId !== null) {
      skipped.push(seed.name);
      continue;
    }

    let exerciseId: string;
    if (!current) {
      const created = await prisma.exercise.create({
        data: {
          name: seed.name,
          movementPattern: seed.movementPattern,
          systemicFatigue: seed.systemicFatigue,
          instructions: seed.instructions,
        },
      });
      exerciseId = created.id;
      written++;
    } else {
      exerciseId = current.id;
      const cambia =
        current.movementPattern !== seed.movementPattern ||
        current.systemicFatigue !== seed.systemicFatigue ||
        current.instructions !== seed.instructions ||
        // Reactiva un ejercicio del catálogo que quedara desactivado.
        current.isActive !== true ||
        current.deletedAt !== null;
      if (cambia) {
        await prisma.exercise.update({
          where: { id: exerciseId },
          data: {
            movementPattern: seed.movementPattern,
            systemicFatigue: seed.systemicFatigue,
            instructions: seed.instructions,
            isActive: true,
            deletedAt: null,
          },
        });
        written++;
      }
    }

    // ── Contribuciones ────────────────────────────────────────────────────
    const currentContributions = new Map(
      (current?.contributions ?? []).map((c) => [c.muscleGroupId, c]),
    );
    for (const contribution of seed.contributions) {
      const muscleGroupId = groupIdByCode.get(contribution.group);
      if (!muscleGroupId) {
        throw new Error(
          `Grupo desconocido en el catálogo: ${contribution.group}`,
        );
      }
      const now = currentContributions.get(muscleGroupId);
      if (
        now &&
        now.role === contribution.role &&
        now.factor === contribution.factor
      ) {
        continue;
      }
      await prisma.exerciseMuscleContribution.upsert({
        where: {
          exerciseId_muscleGroupId: { exerciseId, muscleGroupId },
        },
        create: {
          exerciseId,
          muscleGroupId,
          role: contribution.role,
          factor: contribution.factor,
        },
        update: { role: contribution.role, factor: contribution.factor },
      });
      written++;
    }

    // ── Variantes ─────────────────────────────────────────────────────────
    const currentVariants = new Map(
      (current?.variants ?? []).map((v) => [v.name, v]),
    );
    for (const variant of seed.variants) {
      const now = currentVariants.get(variant.name);
      const stability = variant.stability ?? null;
      const isDefault = variant.isDefault ?? false;
      if (
        now &&
        now.equipment === variant.equipment &&
        now.stability === stability &&
        now.loadStepKg === variant.loadStepKg &&
        now.repRangeMin === variant.repRangeMin &&
        now.repRangeMax === variant.repRangeMax &&
        now.defaultRestSeconds === variant.defaultRestSeconds &&
        now.isDefault === isDefault &&
        now.deletedAt === null &&
        sameContraindications(now.contraindications, variant.contraindications)
      ) {
        continue;
      }
      await prisma.exerciseVariant.upsert({
        where: { exerciseId_name: { exerciseId, name: variant.name } },
        create: {
          exerciseId,
          name: variant.name,
          equipment: variant.equipment,
          stability,
          loadStepKg: variant.loadStepKg,
          repRangeMin: variant.repRangeMin,
          repRangeMax: variant.repRangeMax,
          defaultRestSeconds: variant.defaultRestSeconds,
          contraindications: variant.contraindications,
          isDefault,
        },
        update: {
          equipment: variant.equipment,
          stability,
          loadStepKg: variant.loadStepKg,
          repRangeMin: variant.repRangeMin,
          repRangeMax: variant.repRangeMax,
          defaultRestSeconds: variant.defaultRestSeconds,
          contraindications: variant.contraindications,
          isDefault,
          // Una variante del catálogo que alguien hubiera dejado en soft-delete
          // vuelve. El seed es la fuente de verdad del catálogo global.
          deletedAt: null,
        },
      });
      written++;
    }
  }

  const version = await prisma.appSetting.findUnique({
    where: { key: "seed_version" },
  });
  if (version?.value !== SEED_VERSION) {
    await prisma.appSetting.upsert({
      where: { key: "seed_version" },
      create: { key: "seed_version", value: SEED_VERSION },
      update: { value: SEED_VERSION },
    });
    written++;
  }

  return {
    muscleGroups: await prisma.muscleGroup.count(),
    exercises: await prisma.exercise.count({ where: { profileId: null } }),
    variants: await prisma.exerciseVariant.count(),
    contributions: await prisma.exerciseMuscleContribution.count(),
    written,
    skipped,
  };
}

/** `contraindications` es una columna Json: se compara por contenido. */
function sameContraindications(stored: unknown, seed: string[]): boolean {
  if (!Array.isArray(stored)) return false;
  if (stored.length !== seed.length) return false;
  const a = [...stored].map(String).sort();
  const b = [...seed].sort();
  return a.every((value, i) => value === b[i]);
}
