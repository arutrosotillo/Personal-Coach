import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";
import type { ManualProgramInput } from "@/core/schemas/manual-program";

import { createTestDatabase } from "./helpers/test-db";

/**
 * Integración Fase 3.1: crear un programa MANUAL aterriza en las mismas tablas
 * que el generado, archiva el activo anterior (sin borrar) y NO crea traza
 * INITIAL_PROGRAM (por eso es "manual" derivable).
 */

const testDb = createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { createManualProgram } =
  await import("@/server/services/manual-program.service");
const { isGeneratedProgram, canRestoreProgram } =
  await import("@/server/services/program-source.service");
const { restoreInitialProgram } =
  await import("@/server/services/program-edit.service");
const workout = await import("@/server/services/workout-session.service");

let profileId: string;
let generatedProgramId: string;
let variantIds: string[];

beforeAll(async () => {
  await runSeed(prisma);
  const data = onboardingSchema.parse({
    sex: "MALE",
    birthDate: "1992-03-10",
    heightCm: 178,
    weightKg: 84,
    trainingYears: 3,
    daysPerWeek: 4,
    minutesPerSession: 75,
    equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
    strategy: "LEAN_GAIN",
    dailySteps: 8000,
    workActivity: "SEDENTARY",
    balancedProgram: true,
    priorityMuscles: [],
  });
  const result = await completeOnboarding(
    data,
    new Date("2026-07-14T10:00:00Z"),
  );
  profileId = result.profileId;
  generatedProgramId = result.programId;
  const variants = await prisma.exerciseVariant.findMany({
    where: { deletedAt: null },
    take: 4,
    orderBy: { name: "asc" },
  });
  variantIds = variants.map((v) => v.id);
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

function manualInput(): ManualProgramInput {
  return {
    name: "Mi rutina de fuerza",
    days: [
      {
        name: "Día pesado",
        exercises: [
          {
            exerciseVariantId: variantIds[0],
            baseSets: 5, // el generador no permitiría 5; el manual sí
            repRangeMin: 5,
            repRangeMax: 5,
            targetRir: 1,
            restSeconds: 180,
          },
          {
            exerciseVariantId: variantIds[1],
            baseSets: 4,
            repRangeMin: 8,
            repRangeMax: 10,
            targetRir: 2,
            restSeconds: 120,
          },
        ],
      },
      {
        name: "Día accesorio",
        exercises: [
          {
            exerciseVariantId: variantIds[2],
            baseSets: 3,
            // rango invertido a propósito → debe normalizarse
            repRangeMin: 15,
            repRangeMax: 10,
            targetRir: 0,
            restSeconds: 90,
          },
        ],
      },
    ],
  };
}

describe("createManualProgram", () => {
  it("aterriza en las mismas tablas, con la misma forma que un generado", async () => {
    const { programId } = await createManualProgram(
      profileId,
      manualInput(),
      new Date("2026-07-20T10:00:00Z"),
    );

    const program = await prisma.trainingProgram.findUniqueOrThrow({
      where: { id: programId },
      include: {
        mesocycles: {
          include: {
            templates: {
              orderBy: { ordinal: "asc" },
              include: { exercises: { orderBy: { ordinal: "asc" } } },
            },
          },
        },
      },
    });
    expect(program.isActive).toBe(true);
    expect(program.daysPerWeek).toBe(2);
    expect(program.name).toBe("Mi rutina de fuerza");

    const meso = program.mesocycles[0];
    expect(meso.ordinal).toBe(1);
    expect(meso.templates).toHaveLength(2);
    expect(meso.templates.map((t) => t.ordinal)).toEqual([1, 2]);
    expect(meso.templates[0].name).toBe("Día pesado");

    const firstEx = meso.templates[0].exercises;
    expect(firstEx.map((e) => e.ordinal)).toEqual([1, 2]);
    expect(firstEx[0].baseSets).toBe(5); // 5×5 permitido
    expect(firstEx[0].repRangeMin).toBe(5);
    expect(firstEx[0].targetRir).toBe(1);

    // Rango invertido normalizado (15/10 → 10..15).
    const invEx = meso.templates[1].exercises[0];
    expect(invEx.repRangeMin).toBe(10);
    expect(invEx.repRangeMax).toBe(15);
    expect(invEx.targetRir).toBe(0);
  });

  it("archiva el programa activo anterior (no lo borra) y activa el nuevo", async () => {
    const before = await prisma.trainingProgram.count({ where: { profileId } });
    const { programId } = await createManualProgram(
      profileId,
      { ...manualInput(), name: "Otra rutina" },
      new Date("2026-07-21T10:00:00Z"),
    );

    // Sigue existiendo el generado inicial (archivado), no se borra nada.
    const generated = await prisma.trainingProgram.findUniqueOrThrow({
      where: { id: generatedProgramId },
    });
    expect(generated.isActive).toBe(false);

    // Exactamente un activo, y es el nuevo.
    const active = await prisma.trainingProgram.findMany({
      where: { profileId, isActive: true },
    });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(programId);

    // No se borró ninguno (nº de programas crece).
    expect(await prisma.trainingProgram.count({ where: { profileId } })).toBe(
      before + 1,
    );
  });

  it("NO crea traza INITIAL_PROGRAM (el programa manual es derivable como manual)", async () => {
    const { programId } = await createManualProgram(
      profileId,
      { ...manualInput(), name: "Manual sin traza" },
      new Date("2026-07-22T10:00:00Z"),
    );
    const rec = await prisma.recommendation.findFirst({
      where: { type: "INITIAL_PROGRAM", scopeId: programId },
    });
    expect(rec).toBeNull();
  });

  it("origen derivable: generado → isGenerated/canRestore true; manual → false", async () => {
    expect(await isGeneratedProgram(generatedProgramId)).toBe(true);
    expect(await canRestoreProgram(generatedProgramId)).toBe(true);
    const { programId } = await createManualProgram(
      profileId,
      { ...manualInput(), name: "Manual origen" },
      new Date("2026-08-01T10:00:00Z"),
    );
    expect(await isGeneratedProgram(programId)).toBe(false);
    expect(await canRestoreProgram(programId)).toBe(false);
  });

  it("restore sobre un programa manual falla de forma CONTROLADA y sin corromper", async () => {
    // El activo es manual (creado en el test anterior).
    const activeBefore = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
      include: { mesocycles: { include: { templates: true } } },
    });
    expect(await canRestoreProgram(activeBefore.id)).toBe(false);

    await expect(restoreInitialProgram(profileId)).rejects.toThrow(/manual/);

    // Nada cambió: mismo activo, mismas plantillas.
    const activeAfter = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
      include: { mesocycles: { include: { templates: true } } },
    });
    expect(activeAfter.id).toBe(activeBefore.id);
    expect(activeAfter.mesocycles[0].templates.length).toBe(
      activeBefore.mesocycles[0].templates.length,
    );
  });

  it("rechaza (controlado) una variante inexistente, sin corromper", async () => {
    const bad = manualInput();
    bad.days[0].exercises[0].exerciseVariantId = "no-existe";
    const activeBefore = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
    });

    await expect(
      createManualProgram(profileId, bad, new Date("2026-07-23T10:00:00Z")),
    ).rejects.toThrow(/disponible/);

    // El activo no cambió (la transacción ni siquiera empezó a archivar).
    const activeAfter = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
    });
    expect(activeAfter.id).toBe(activeBefore.id);
  });

  it("no cambia de programa mientras hay una sesión en curso", async () => {
    const activeBefore = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
      include: { mesocycles: { include: { templates: true } } },
    });
    const started = await workout.startOrResumeSession(
      profileId,
      activeBefore.mesocycles[0].templates[0].id,
    );
    const programCount = await prisma.trainingProgram.count({
      where: { profileId },
    });

    await expect(
      createManualProgram(profileId, {
        ...manualInput(),
        name: "No debe crearse",
      }),
    ).rejects.toThrow(/sesión en curso/);
    expect(await prisma.trainingProgram.count({ where: { profileId } })).toBe(
      programCount,
    );
    expect(
      (
        await prisma.trainingProgram.findFirstOrThrow({
          where: { profileId, isActive: true },
        })
      ).id,
    ).toBe(activeBefore.id);
    await workout.discardSession(profileId, started.sessionId);
  });
});
