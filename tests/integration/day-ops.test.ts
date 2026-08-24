import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";
import type { ManualProgramInput } from "@/core/schemas/manual-program";

import { createTestDatabase } from "./helpers/test-db";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/** Integración Fase 3.1: CRUD/reorder de días (WorkoutTemplate) sobre el programa
 * activo, con la danza de ordinales y el soft-delete de días con sesiones. */

const testDb = createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { createManualProgram } =
  await import("@/server/services/manual-program.service");
const edit = await import("@/server/services/program-edit.service");

const GEN_ONBOARDING = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  trainingYears: 3,
  daysPerWeek: 3,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
  strategy: "LEAN_GAIN",
  dailySteps: 8000,
  workActivity: "SEDENTARY",
  balancedProgram: true,
  priorityMuscles: [],
} as const;

let profileId: string;
let variantIds: string[];

beforeAll(async () => {
  await runSeed(prisma);
  const data = onboardingSchema.parse({
    sex: "MALE",
    birthDate: "1992-03-10",
    heightCm: 178,
    weightKg: 84,
    trainingYears: 3,
    daysPerWeek: 3,
    minutesPerSession: 75,
    equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
    strategy: "LEAN_GAIN",
    dailySteps: 8000,
    workActivity: "SEDENTARY",
    balancedProgram: true,
    priorityMuscles: [],
  });
  const r = await completeOnboarding(data, new Date("2026-07-14T10:00:00Z"));
  profileId = r.profileId;
  const variants = await prisma.exerciseVariant.findMany({
    where: { deletedAt: null },
    take: 5,
    orderBy: { name: "asc" },
  });
  variantIds = variants.map((v) => v.id);
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

/** Crea (y activa) un programa manual de 2 días para operar sobre él. */
async function freshManual(): Promise<{
  mesocycleId: string;
  templateIds: string[];
}> {
  const input: ManualProgramInput = {
    name: "Base",
    days: [
      {
        name: "Día 1",
        exercises: [
          {
            exerciseVariantId: variantIds[0],
            baseSets: 3,
            repRangeMin: 8,
            repRangeMax: 12,
            targetRir: 2,
            restSeconds: 120,
          },
        ],
      },
      {
        name: "Día 2",
        exercises: [
          {
            exerciseVariantId: variantIds[1],
            baseSets: 3,
            repRangeMin: 8,
            repRangeMax: 12,
            targetRir: 2,
            restSeconds: 120,
          },
        ],
      },
    ],
  };
  await createManualProgram(profileId, input);
  const meso = await prisma.mesocycle.findFirstOrThrow({
    where: { program: { profileId, isActive: true } },
    include: {
      templates: { where: { deletedAt: null }, orderBy: { ordinal: "asc" } },
    },
  });
  return { mesocycleId: meso.id, templateIds: meso.templates.map((t) => t.id) };
}

const aliveDays = (mesocycleId: string) =>
  prisma.workoutTemplate.findMany({
    where: { mesocycleId, deletedAt: null },
    orderBy: { ordinal: "asc" },
  });

describe("addDay / renameDay", () => {
  it("añade un día al final con un ejercicio y actualiza daysPerWeek", async () => {
    const { mesocycleId } = await freshManual();
    await edit.addDay(profileId, "Día extra", variantIds[2]);
    const days = await aliveDays(mesocycleId);
    expect(days).toHaveLength(3);
    expect(days[2].name).toBe("Día extra");
    expect(days.map((d) => d.ordinal)).toEqual([1, 2, 3]);
    const exs = await prisma.templateExercise.findMany({
      where: { templateId: days[2].id },
    });
    expect(exs).toHaveLength(1);
    const program = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
    });
    expect(program.daysPerWeek).toBe(3);
  });

  it("renombra un día", async () => {
    const { templateIds } = await freshManual();
    await edit.renameDay(profileId, templateIds[0], "Torso");
    const t = await prisma.workoutTemplate.findUniqueOrThrow({
      where: { id: templateIds[0] },
    });
    expect(t.name).toBe("Torso");
  });
});

describe("reorderDay", () => {
  it("intercambia ordinales de dos días adyacentes", async () => {
    const { templateIds } = await freshManual();
    await edit.reorderDay(profileId, templateIds[0], "down");
    const a = await prisma.workoutTemplate.findUniqueOrThrow({
      where: { id: templateIds[0] },
    });
    const b = await prisma.workoutTemplate.findUniqueOrThrow({
      where: { id: templateIds[1] },
    });
    expect(a.ordinal).toBe(2);
    expect(b.ordinal).toBe(1);
  });
});

describe("removeDay", () => {
  it("elimina un día sin sesiones (hard-delete) y compacta ordinales", async () => {
    const { mesocycleId, templateIds } = await freshManual();
    await edit.addDay(profileId, "Día 3", variantIds[2]); // 3 días
    await edit.removeDay(profileId, templateIds[0]);
    const days = await aliveDays(mesocycleId);
    expect(days).toHaveLength(2);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2]);
    expect(days.some((d) => d.id === templateIds[0])).toBe(false);
  });

  it("un día CON sesiones se soft-borra (historial intacto) y libera su ordinal", async () => {
    const { mesocycleId, templateIds } = await freshManual();
    await edit.addDay(profileId, "Día 3", variantIds[2]);
    // Sesión completada ligada al día 1.
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      templateId: templateIds[0],
      variantId: variantIds[0],
      localDate: "2026-07-20",
      sets: [{ setNumber: 1, weightKg: 60, reps: 8, rir: 2 }],
    });
    const sessionsBefore = await prisma.workoutSession.count();

    await edit.removeDay(profileId, templateIds[0]);

    const removed = await prisma.workoutTemplate.findUniqueOrThrow({
      where: { id: templateIds[0] },
    });
    expect(removed.deletedAt).not.toBeNull();
    expect(removed.ordinal).toBeLessThan(0); // aparcado en negativo
    // La sesión histórica sigue existiendo.
    expect(await prisma.workoutSession.count()).toBe(sessionsBefore);
    // Los días vivos quedan 1..N sin choques.
    const days = await aliveDays(mesocycleId);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2]);
  });

  it("rechaza eliminar el último día vivo (invariante ≥1 día)", async () => {
    const { templateIds } = await freshManual();
    await edit.removeDay(profileId, templateIds[0]); // quedan 1
    await expect(edit.removeDay(profileId, templateIds[1])).rejects.toThrow(
      /al menos un día/,
    );
  });

  it("reordenar TRAS soft-borrar un día con sesión no colisiona ordinales (regresión)", async () => {
    const { mesocycleId, templateIds } = await freshManual();
    await edit.addDay(profileId, "Día 3", variantIds[2]); // 3 días vivos
    // El día 1 con una sesión → soft-delete (aparcado en ordinal negativo).
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      templateId: templateIds[0],
      variantId: variantIds[0],
      localDate: "2026-07-28",
      sets: [{ setNumber: 1, weightKg: 50, reps: 8, rir: 2 }],
    });
    await edit.removeDay(profileId, templateIds[0]);

    // Reordenar los vivos NO debe chocar con el día aparcado en -1.
    const alive = await aliveDays(mesocycleId);
    await expect(
      edit.reorderDay(profileId, alive[0].id, "down"),
    ).resolves.toBeUndefined();
    const after = await aliveDays(mesocycleId);
    expect(after.map((d) => d.ordinal)).toEqual([1, 2]);

    // La sesión histórica sigue visible en el historial pese al día soft-borrado.
    const { getExerciseHistorySummary } =
      await import("@/server/services/progression.service");
    // El historial por variante (scoped a perfil) sigue viendo la sesión del día
    // soft-borrado; el conteo acumula sesiones de este perfil.
    const summary = await getExerciseHistorySummary(profileId, variantIds[0]);
    expect(summary.sessionCount).toBeGreaterThanOrEqual(1);
    const { getVariantHistory } =
      await import("@/server/repositories/workout.repo");
    const hist = await getVariantHistory(profileId, variantIds[0]);
    const has50 = hist.some((s) => s.sets.some((x) => x.weightKg === 50));
    expect(has50).toBe(true);
  });
});

describe("restoreInitialProgram tras soft-borrar un día (regresión)", () => {
  it("no colisiona ordinales, sincroniza daysPerWeek y conserva el historial", async () => {
    // Programa GENERADO fresco (re-onboarding archiva el activo).
    const data = onboardingSchema.parse(GEN_ONBOARDING);
    const gen = await completeOnboarding(
      data,
      new Date("2026-08-05T10:00:00Z"),
    );
    const meso = await prisma.mesocycle.findFirstOrThrow({
      where: { program: { id: gen.programId } },
      include: {
        templates: { where: { deletedAt: null }, orderBy: { ordinal: "asc" } },
      },
    });
    const day1 = meso.templates[0];
    const day1Variant = await prisma.templateExercise.findFirstOrThrow({
      where: { templateId: day1.id },
    });
    // Sesión en el día 1 → removeDay lo soft-borra (aparcado en negativo).
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: meso.id,
      templateId: day1.id,
      variantId: day1Variant.exerciseVariantId,
      localDate: "2026-08-06",
      sets: [{ setNumber: 1, weightKg: 70, reps: 8, rir: 2 }],
    });
    await edit.removeDay(profileId, day1.id);

    // Restore NO debe lanzar (antes chocaba el ordinal -1 con el día aparcado).
    await expect(
      edit.restoreInitialProgram(profileId),
    ).resolves.toBeUndefined();

    const program = await prisma.trainingProgram.findFirstOrThrow({
      where: { id: gen.programId },
      include: {
        mesocycles: {
          include: {
            templates: { where: { deletedAt: null } },
          },
        },
      },
    });
    // daysPerWeek sincronizado con los días vivos regenerados.
    expect(program.daysPerWeek).toBe(program.mesocycles[0].templates.length);
    expect(program.daysPerWeek).toBe(3);
    // El historial del día borrado sobrevive.
    const { getExerciseHistorySummary } =
      await import("@/server/services/progression.service");
    const summary = await getExerciseHistorySummary(
      profileId,
      day1Variant.exerciseVariantId,
    );
    expect(summary.sessionCount).toBeGreaterThanOrEqual(1);
  });
});
