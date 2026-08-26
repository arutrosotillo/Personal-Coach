import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";

/**
 * Invariante estructural: como máximo UN programa activo y no borrado por
 * perfil, garantizado por la base de datos y no por la capa de servicio.
 *
 * Este fichero existe por un riesgo concreto de CLOUD.1: el índice parcial
 * que impone la invariante no puede declararse en schema.prisma (Prisma no
 * soporta índices con `WHERE` en PostgreSQL), así que vive en SQL a mano en
 * `prisma/migrations/*_active_program_invariant`. Una migración generada
 * automáticamente podría eliminarlo sin que nadie lo note.
 *
 * Si estos tests fallan, la protección ha desaparecido: dos programas activos
 * dejarían al motor de entrenamiento sin saber cuál es el vigente.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");

const ONBOARDING = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  waistCm: 88,
  trainingYears: 3,
  daysPerWeek: 4,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
  strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
  dailySteps: 8500,
  workActivity: "SEDENTARY",
  balancedProgram: true,
  priorityMuscles: [],
  contraindications: [],
  excludedExerciseNames: [],
} as const;

let profileId: string;

beforeAll(async () => {
  await runSeed(prisma);
  const result = await completeOnboarding(
    onboardingSchema.parse(ONBOARDING),
    new Date("2026-01-05T10:00:00Z"),
  );
  profileId = result.profileId;
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

async function currentActiveId(pid: string): Promise<string> {
  const row = await prisma.trainingProgram.findFirstOrThrow({
    where: { profileId: pid, isActive: true, deletedAt: null },
  });
  return row.id;
}

/** Clona el programa activo saltándose la capa de servicio a propósito. */
async function cloneProgram(overrides: {
  isActive: boolean;
  deletedAt?: Date | null;
  profileId?: string;
}) {
  const source = await prisma.trainingProgram.findFirstOrThrow({
    where: { id: await currentActiveId(profileId) },
  });
  return prisma.trainingProgram.create({
    data: {
      profileId: overrides.profileId ?? source.profileId,
      name: source.name,
      description: source.description,
      daysPerWeek: source.daysPerWeek,
      isActive: overrides.isActive,
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

async function countActive(pid: string): Promise<number> {
  return prisma.trainingProgram.count({
    where: { profileId: pid, isActive: true, deletedAt: null },
  });
}

describe("invariante: un solo programa activo por perfil", () => {
  it("el índice único parcial existe en la base de datos", async () => {
    // Introspección directa: comprueba que el índice sigue ahí y que su
    // predicado es el correcto. Es la defensa contra una migración generada
    // que lo elimine silenciosamente.
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'TrainingProgram_one_live_active_per_profile'
    `;
    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef;
    expect(def).toContain("UNIQUE");
    expect(def).toContain('"profileId"');
    expect(def).toContain('"isActive" = true');
    expect(def).toContain('"deletedAt" IS NULL');
  });

  it("la base de datos rechaza CREAR un segundo programa activo", async () => {
    await expect(cloneProgram({ isActive: true })).rejects.toThrow();
    expect(await countActive(profileId)).toBe(1);
  });

  it("la base de datos rechaza ACTIVAR un programa archivado", async () => {
    const archived = await cloneProgram({ isActive: false });
    await expect(
      prisma.trainingProgram.update({
        where: { id: archived.id },
        data: { isActive: true },
      }),
    ).rejects.toThrow();
    expect(await countActive(profileId)).toBe(1);
    await prisma.trainingProgram.delete({ where: { id: archived.id } });
  });

  it("un programa activo pero BORRADO no consume el hueco", async () => {
    // El predicado incluye `deletedAt IS NULL`: los borrados no cuentan, que
    // es justo lo que permite archivar y reactivar sin colisiones.
    const soft = await cloneProgram({
      isActive: true,
      deletedAt: new Date("2026-01-04T00:00:00Z"),
    });
    expect(await countActive(profileId)).toBe(1);
    await prisma.trainingProgram.delete({ where: { id: soft.id } });
  });

  it("la invariante es POR PERFIL, no global", async () => {
    // El segundo perfil se crea con Prisma directamente, no con
    // completeOnboarding: la app es de un solo usuario y ese servicio reutiliza
    // siempre el perfil existente (findFirst sin filtro). Aquí lo que se prueba
    // es el alcance del índice, no el flujo de onboarding.
    const other = await prisma.userProfile.create({
      data: { sex: "FEMALE", birthDate: "1994-05-02", heightCm: 165 },
    });
    const source = await prisma.trainingProgram.findFirstOrThrow({
      where: { id: await currentActiveId(profileId) },
    });
    await prisma.trainingProgram.create({
      data: {
        profileId: other.id,
        name: source.name,
        daysPerWeek: source.daysPerWeek,
        isActive: true,
      },
    });
    expect(await countActive(other.id)).toBe(1);
    expect(await countActive(profileId)).toBe(1);

    await prisma.trainingProgram.deleteMany({ where: { profileId: other.id } });
    await prisma.userProfile.delete({ where: { id: other.id } });
  });

  it("liberar el hueco permite activar otro: la invariante no es un bloqueo permanente", async () => {
    const activeId = await currentActiveId(profileId);
    const archived = await cloneProgram({ isActive: false });
    // Transacción INTERACTIVA, igual que reactivateProgram. La forma de array
    // `$transaction([...])` NO sirve aquí: Prisma la envía como un lote y el
    // índice rechaza el estado intermedio con los dos programas activos. El
    // swap tiene que liberar el hueco antes de ocuparlo, en ese orden.
    await prisma.$transaction(async (tx) => {
      await tx.trainingProgram.update({
        where: { id: activeId },
        data: { isActive: false },
      });
      await tx.trainingProgram.update({
        where: { id: archived.id },
        data: { isActive: true },
      });
    });
    expect(await countActive(profileId)).toBe(1);
    const nowActive = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true, deletedAt: null },
    });
    expect(nowActive.id).toBe(archived.id);

    // Restaurar el estado inicial para no contaminar otros tests.
    await prisma.$transaction(async (tx) => {
      await tx.trainingProgram.update({
        where: { id: archived.id },
        data: { isActive: false },
      });
      await tx.trainingProgram.update({
        where: { id: activeId },
        data: { isActive: true },
      });
    });
    await prisma.trainingProgram.delete({ where: { id: archived.id } });
  });
});
