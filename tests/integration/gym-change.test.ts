import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { addDays } from "@/core/dates";
import { onboardingSchema } from "@/core/schemas/onboarding";
import { analyzeTraining } from "@/core/training/analysis";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * Integración: cambio de gimnasio de punta a punta, contra Postgres.
 *
 * Lo que se protege aquí es lo que el usuario pidió conservar —objetivo,
 * programa, prescripciones, historial— y lo que pidió dejar de hacer: comparar
 * la carga de una máquina con la de otra en la sesión, en `/train`, en el
 * historial y en la fatiga.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { getTrainingContext } =
  await import("@/server/repositories/training-context.repo");
const { previewTemplateSession } =
  await import("@/server/repositories/workout.repo");
const { buildSuggestions, getExerciseHistorySummary } =
  await import("@/server/services/progression.service");
const { registerGymChange, updateGymChange, deleteGymChange, GymChangeError } =
  await import("@/server/services/equipment-change.service");
const { changeTemplateVariant, editTemplateExercise } =
  await import("@/server/services/program-edit.service");
const { createCustomExercise } =
  await import("@/server/services/custom-exercise.service");

const TODAY = "2026-11-20";
const CHANGE = "2026-11-10";
const NOW = new Date(`${TODAY}T12:00:00Z`);

let profileId: string;
let mesocycleId: string;
let templateId: string;
/** Dos ejercicios del programa: uno cambia de máquina y entrena; el otro cambia y aún no. */
let machineA: string;
let machineB: string;
/** Uno que NO cambia (sus cargas siguen siendo comparables). */
let freeVariant: string;

const sets = (weightKg: number, reps: number) =>
  [1, 2, 3].map((setNumber) => ({ setNumber, weightKg, reps, rir: 2 }));

beforeAll(async () => {
  await runSeed(prisma);
  const data = onboardingSchema.parse({
    sex: "MALE",
    birthDate: "1992-03-10",
    heightCm: 178,
    weightKg: 81,
    trainingYears: 3,
    daysPerWeek: 3,
    minutesPerSession: 75,
    equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
    strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
    dailySteps: 8000,
    workActivity: "SEDENTARY",
    balancedProgram: true,
    priorityMuscles: [],
  });
  const result = await completeOnboarding(
    await createTestUser(prisma, "arturo"),
    data,
    new Date("2026-08-31T10:00:00Z"),
  );
  profileId = result.profileId;
  const program = await prisma.trainingProgram.findUniqueOrThrow({
    where: { id: result.programId },
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
  mesocycleId = program.mesocycles[0].id;
  const template = program.mesocycles[0].templates[0];
  templateId = template.id;
  machineA = template.exercises[0].exerciseVariantId;
  machineB = template.exercises[1].exerciseVariantId;
  freeVariant = template.exercises[2].exerciseVariantId;

  // Historial: 3 semanas con la máquina anterior (100 kg) en A y B, y una
  // sesión con la nueva (65 kg) en A. El ejercicio libre, todo el rato a 20 kg.
  for (const d of [-17, -10, -3]) {
    for (const variantId of [machineA, machineB]) {
      await seedCompletedSessionWithSets(prisma, {
        mesocycleId,
        variantId,
        localDate: addDays(CHANGE, d),
        sets: sets(100, 10),
      });
    }
  }
  await seedCompletedSessionWithSets(prisma, {
    mesocycleId,
    variantId: machineA,
    localDate: addDays(CHANGE, 2),
    sets: sets(65, 12),
  });
  for (const d of [-17, -10, -3, 2]) {
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId,
      variantId: freeVariant,
      localDate: addDays(CHANGE, d),
      sets: sets(20, 10),
    });
  }
});

describe("registrar un cambio de gimnasio", () => {
  let eventId: string;

  it("no toca el objetivo, el programa, las prescripciones ni las series", async () => {
    const goalBefore = await prisma.goal.findFirstOrThrow({
      where: { profileId, status: "ACTIVE" },
    });
    const rxBefore = await prisma.templateExercise.findMany({
      where: { templateId },
      orderBy: { ordinal: "asc" },
    });
    const setsBefore = await prisma.setLog.count();

    const requestId = randomUUID();
    const r = await registerGymChange(
      profileId,
      {
        localDate: CHANGE,
        label: "Gimnasio Valencia",
        variantIds: [machineA, machineB],
        requestId,
      },
      NOW,
    );
    eventId = r.eventId;

    const event = await prisma.personalEvent.findUniqueOrThrow({
      where: { id: eventId },
      include: { equipmentChanges: true },
    });
    expect(event.type).toBe("GYM_CHANGE");
    expect(event.localDate).toBe(CHANGE);
    expect(event.note).toBe("Gimnasio Valencia");
    expect(
      event.equipmentChanges.map((c) => c.exerciseVariantId).sort(),
    ).toEqual([machineA, machineB].sort());

    // Lo que se conserva, tal cual.
    expect(
      await prisma.goal.findFirstOrThrow({
        where: { profileId, status: "ACTIVE" },
      }),
    ).toEqual(goalBefore);
    expect(
      await prisma.templateExercise.findMany({
        where: { templateId },
        orderBy: { ordinal: "asc" },
      }),
    ).toEqual(rxBefore);
    expect(await prisma.setLog.count()).toBe(setsBefore);

    // Idempotente: el reintento con la misma clave no crea otro evento.
    const again = await registerGymChange(
      profileId,
      { localDate: CHANGE, label: null, variantIds: [machineA], requestId },
      NOW,
    );
    expect(again).toEqual({ eventId, replayed: true });
    expect(
      await prisma.personalEvent.count({
        where: { profileId, type: "GYM_CHANGE" },
      }),
    ).toBe(1);
  });

  it("rechaza el ejercicio personalizado de otra persona y las fechas absurdas", async () => {
    const other = await completeOnboarding(
      await createTestUser(prisma, "otra"),
      onboardingSchema.parse({
        sex: "FEMALE",
        birthDate: "1995-01-01",
        heightCm: 165,
        weightKg: 60,
        trainingYears: 1,
        daysPerWeek: 3,
        minutesPerSession: 60,
        equipment: ["DUMBBELL", "MACHINE"],
        strategy: "RECOMP_MAINTAIN_WEIGHT",
        balancedProgram: true,
        priorityMuscles: [],
      }),
      NOW,
    );
    const ajeno = await createCustomExercise(other.profileId, {
      name: "Prensa secreta de otra",
      movementPattern: "SQUAT",
      systemicFatigue: 2,
      primaryMuscle: "CUADRICEPS",
      secondaryMuscles: [],
      variantName: "Máquina",
      equipment: "MACHINE",
      loadStepKg: 5,
      repRangeMin: 8,
      repRangeMax: 12,
      restSeconds: 120,
      contraindications: [],
      instructions: "",
    });
    await expect(
      registerGymChange(
        profileId,
        {
          localDate: CHANGE,
          label: null,
          variantIds: [ajeno.variantId],
          requestId: randomUUID(),
        },
        NOW,
      ),
    ).rejects.toThrow(GymChangeError);
    await expect(
      registerGymChange(
        profileId,
        {
          localDate: "2030-01-01",
          label: null,
          variantIds: [],
          requestId: randomUUID(),
        },
        NOW,
      ),
    ).rejects.toThrow(/La fecha tiene que estar entre/);
  });

  it("la fatiga y el Coach solo comparan dentro de cada máquina", async () => {
    const ctx = await getTrainingContext(profileId, addDays(TODAY, -28), TODAY);
    const a = ctx.variants.find((v) => v.variantId === machineA)!;
    expect(a.exposures.flatMap((e) => e.sets.map((s) => s.weightKg))).toEqual([
      65, 65, 65,
    ]);
    expect(a.equipmentChange?.sinceLocalDate).toBe(CHANGE);
    expect(a.equipmentChange?.previousExposures).toHaveLength(3);
    // El ejercicio que no cambia conserva su historial entero.
    const libre = ctx.variants.find((v) => v.variantId === freeVariant)!;
    expect(libre.exposures).toHaveLength(4);
    expect(libre.equipmentChange).toBeNull();

    const analysis = analyzeTraining(ctx);
    const va = analysis.variants.find((v) => v.variantId === machineA)!;
    expect(va.suggestion.reasonCode).not.toBe("ATYPICAL_LOAD_DROP");
    expect(va.regressed).toBe(false);
    expect(analysis.fatigue.adaptation.exercises).toBe(2);
  });

  it("en /train: la última vez es de la máquina nueva y la anterior se enseña aparte", async () => {
    const preview = (await previewTemplateSession(
      profileId,
      templateId,
      TODAY,
    ))!;
    const a = preview.exercises.find((e) => e.variantId === machineA)!;
    expect(a.lastTime?.sets.map((s) => s.weightKg)).toEqual([65, 65, 65]);
    expect(a.equipmentChange).toMatchObject({
      sinceLocalDate: CHANGE,
      comparableExposures: 1,
      calibrating: true,
    });
    expect(a.equipmentChange?.previous?.sets[0].weightKg).toBe(100);

    // B cambió de máquina y aún no se ha entrenado en la nueva: ni "primera
    // vez", ni la carga de la otra máquina como referencia.
    const b = preview.exercises.find((e) => e.variantId === machineB)!;
    expect(b.lastTime).toBeNull();
    const suggestions = buildSuggestions(preview);
    expect(suggestions[b.id].reasonCode).toBe("EQUIPMENT_CHANGE");
    expect(suggestions[b.id].suggestedWeightKg).toBeNull();
    expect(suggestions[a.id].suggestedWeightKg).not.toBe(100);

    // Un día ANTES del cambio, todo sigue como estaba.
    const antes = (await previewTemplateSession(
      profileId,
      templateId,
      addDays(CHANGE, -1),
    ))!;
    expect(
      antes.exercises.find((e) => e.variantId === machineB)!.equipmentChange,
    ).toBeNull();
  });

  it("el historial del ejercicio: tendencia con la máquina nueva y lo de antes aparte", async () => {
    const h = await getExerciseHistorySummary(
      profileId,
      machineA,
      addDays(TODAY, -56),
      NOW,
    );
    expect(h.sessionCount).toBe(1);
    expect(h.trend.direction).toBe("INSUFFICIENT");
    expect(h.equipmentChange?.sinceLocalDate).toBe(CHANGE);
    expect(h.equipmentChange?.previous.sessionCount).toBe(3);
    expect(h.equipmentChange?.previous.bestSet?.weightKg).toBe(100);
  });

  it("corregir y deshacer: el historial nunca se toca", async () => {
    await updateGymChange(
      profileId,
      eventId,
      { localDate: CHANGE, label: "Valencia", variantIds: [machineA] },
      NOW,
    );
    expect(
      (
        await prisma.equipmentChange.findMany({
          where: { personalEventId: eventId },
        })
      ).map((c) => c.exerciseVariantId),
    ).toEqual([machineA]);

    const setsBefore = await prisma.setLog.count();
    await deleteGymChange(profileId, eventId);
    expect(await prisma.equipmentChange.count({ where: { profileId } })).toBe(
      0,
    );
    expect(await prisma.setLog.count()).toBe(setsBefore);
    const ctx = await getTrainingContext(profileId, addDays(TODAY, -28), TODAY);
    expect(
      ctx.variants.find((v) => v.variantId === machineA)!.exposures,
    ).toHaveLength(4);

    // Borrar uno que ya no existe (o que no es tuyo) es un error legible.
    await expect(deleteGymChange(profileId, eventId)).rejects.toThrow(
      GymChangeError,
    );
  });
});

describe("adaptar la rutina conserva la prescripción", () => {
  it("cambiar de variante mantiene series, rango, descanso y RIR (salvo el mínimo de seguridad)", async () => {
    const te = await prisma.templateExercise.findFirstOrThrow({
      where: { templateId, exerciseVariantId: machineA },
      include: { exerciseVariant: true },
    });
    await editTemplateExercise(profileId, te.id, {
      baseSets: 4,
      repRangeMin: 5,
      repRangeMax: 10,
      targetRir: 2,
      restSeconds: 150,
    });
    const otra = await prisma.exerciseVariant.findFirstOrThrow({
      where: {
        exerciseId: te.exerciseVariant.exerciseId,
        id: { not: machineA },
        deletedAt: null,
      },
    });
    await changeTemplateVariant(profileId, te.id, otra.id);
    const after = await prisma.templateExercise.findUniqueOrThrow({
      where: { id: te.id },
    });
    expect(after.exerciseVariantId).toBe(otra.id);
    expect(after).toMatchObject({
      baseSets: 4,
      repRangeMin: 5,
      repRangeMax: 10,
      restSeconds: 150,
    });
    // 2 es el máximo que prescribe el motor: nunca hay que subirlo.
    expect(after.targetRir).toBe(2);
  });
});
