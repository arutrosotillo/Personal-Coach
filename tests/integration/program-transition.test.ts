import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { addDays } from "@/core/dates";
import { onboardingSchema } from "@/core/schemas/onboarding";
import { analyzeTraining } from "@/core/training/analysis";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * Integración: cambiar de programa a mitad de una fase, contra Postgres.
 *
 * Un programa nuevo es una transición, no un reinicio fisiológico. Lo que se
 * protege: el bloque anterior queda archivado con sus fechas y sin perder una
 * serie; la fatiga no se reinicia, no se diluye y no recomienda descargar por el
 * simple hecho de cambiar; y nada de esto toca a otra persona.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { createManualProgram } =
  await import("@/server/services/manual-program.service");
const { reactivateProgram, editTemplateExercise, changeTemplateVariant } =
  await import("@/server/services/program-edit.service");
const { registerGymChange } =
  await import("@/server/services/equipment-change.service");
const { startOrResumeSession } =
  await import("@/server/services/workout-session.service");
const { getBlockStatsView } =
  await import("@/server/services/block-stats.service");
const { listArchivedPrograms } =
  await import("@/server/repositories/program.repo");
const { getTrainingContext } =
  await import("@/server/repositories/training-context.repo");
const { previewTemplateSession } =
  await import("@/server/repositories/workout.repo");

const TODAY = "2026-11-06";
const CHANGE = "2026-11-07";
const NOW = new Date(`${TODAY}T20:00:00Z`);

const onboarding = () =>
  onboardingSchema.parse({
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

async function variantId(exercise: string, variant: string): Promise<string> {
  const row = await prisma.exerciseVariant.findFirstOrThrow({
    where: { name: variant, exercise: { name: exercise } },
    select: { id: true },
  });
  return row.id;
}

let profileId: string;
let otherProfileId: string;
let oldProgramId: string;
let oldMesocycleId: string;
let calfId: string;
let newProgramId: string;

const fatigueNow = async (today = TODAY) =>
  analyzeTraining(
    await getTrainingContext(profileId, addDays(today, -28), today),
  ).fatigue;

/** Instantánea de todo lo entrenado, para comprobar que nada se reescribe. */
const historySnapshot = (id: string) =>
  prisma.setLog.findMany({
    where: {
      workoutExercise: {
        session: { mesocycle: { program: { profileId: id } } },
      },
    },
    orderBy: { id: "asc" },
  });

beforeAll(async () => {
  await runSeed(prisma);

  const a = await completeOnboarding(
    await createTestUser(prisma, "arturo"),
    onboarding(),
    new Date("2026-08-31T10:00:00Z"),
  );
  profileId = a.profileId;
  oldProgramId = a.programId;
  const other = await completeOnboarding(
    await createTestUser(prisma, "ana"),
    onboarding(),
    new Date("2026-08-31T10:00:00Z"),
  );
  otherProfileId = other.profileId;

  const program = await prisma.trainingProgram.findUniqueOrThrow({
    where: { id: oldProgramId },
    include: {
      mesocycles: {
        include: { templates: { include: { exercises: true } } },
      },
    },
  });
  oldMesocycleId = program.mesocycles[0].id;
  calfId = await variantId("Elevación de talones de pie", "Multipower");

  // 10 semanas seguidas de entrenamiento, con los mismos ejercicios.
  const oldVariants = [
    calfId,
    await variantId("Press inclinado", "Máquina"),
    await variantId("Prensa de piernas", "Prensa 45°"),
    await variantId("Dominadas", "Peso corporal / lastre"),
  ];
  for (let week = 0; week < 10; week++) {
    for (const [i, variant] of oldVariants.entries()) {
      await seedCompletedSessionWithSets(prisma, {
        mesocycleId: oldMesocycleId,
        variantId: variant,
        localDate: addDays("2026-08-31", week * 7 + Math.min(i, 4)),
        weekNumber: week + 1,
        sets: [1, 2, 3].map((setNumber) => ({
          setNumber,
          weightKg: 50 + week,
          reps: 9,
          rir: 1,
        })),
      });
    }
  }
});

describe("el catálogo tiene lo que el programa nuevo necesita", () => {
  it.each([
    ["Dominadas", "Agarre prono / lastre", "BODYWEIGHT"],
    ["Curl bayesian en polea", "Dos poleas, brazos retrasados", "CABLE"],
    ["Extensión de tríceps en polea", "Dos poleas cruzadas (en X)", "CABLE"],
    ["Curl femoral tumbado", "Polea con tobillera, unilateral", "CABLE"],
    ["Aperturas", "Dos poleas, sentado en banco", "CABLE"],
  ])("%s · %s", async (exercise, variant, equipment) => {
    const row = await prisma.exerciseVariant.findFirstOrThrow({
      where: { name: variant, exercise: { name: exercise } },
      include: { exercise: { include: { contributions: true } } },
    });
    expect(row.equipment).toBe(equipment);
    expect(row.isDefault).toBe(false);
    expect(row.exercise.contributions.length).toBeGreaterThan(0);
  });

  it("volver a sembrar no escribe nada: el seed es diferencial", async () => {
    const before = await prisma.exerciseVariant.count();
    await runSeed(prisma);
    expect(await prisma.exerciseVariant.count()).toBe(before);
  });
});

describe("la transición", () => {
  let historyBefore: Awaited<ReturnType<typeof historySnapshot>>;
  let otherHistoryBefore: Awaited<ReturnType<typeof historySnapshot>>;
  let otherProgramBefore: unknown;
  let fatigueBefore: Awaited<ReturnType<typeof fatigueNow>>;

  beforeAll(async () => {
    historyBefore = await historySnapshot(profileId);
    otherHistoryBefore = await historySnapshot(otherProfileId);
    otherProgramBefore = await prisma.trainingProgram.findMany({
      where: { profileId: otherProfileId },
      include: { mesocycles: true },
    });
    fatigueBefore = await fatigueNow();

    await registerGymChange(
      profileId,
      {
        requestId: randomUUID(),
        localDate: CHANGE,
        label: "Gimnasio nuevo",
        variantIds: [calfId],
      },
      NOW,
    );
    const created = await createManualProgram(
      profileId,
      {
        name: "UP/LW/UP nuevo",
        description: "Continuación del bloque anterior con otro material.",
        days: [
          {
            name: "Torso A",
            exercises: [
              {
                exerciseVariantId: await variantId(
                  "Press inclinado",
                  "Multipower",
                ),
                baseSets: 3,
                repRangeMin: 5,
                repRangeMax: 10,
                targetRir: 1,
                restSeconds: 120,
              },
              {
                exerciseVariantId: await variantId(
                  "Remo en T",
                  "Barra en landmine",
                ),
                baseSets: 3,
                repRangeMin: 5,
                repRangeMax: 10,
                targetRir: 2,
                targetRirMin: 1,
                restSeconds: 180,
              },
            ],
          },
          {
            name: "Pierna",
            exercises: [
              {
                exerciseVariantId: await variantId(
                  "Peso muerto rumano",
                  "Barra",
                ),
                baseSets: 2,
                repRangeMin: 6,
                repRangeMax: 10,
                targetRir: 3,
                targetRirMin: 2,
                restSeconds: 180,
              },
              {
                exerciseVariantId: calfId,
                baseSets: 3,
                repRangeMin: 8,
                repRangeMax: 15,
                targetRir: 1,
                targetRirMin: 0,
                restSeconds: 90,
              },
            ],
          },
          {
            name: "Torso B",
            exercises: [
              {
                exerciseVariantId: await variantId(
                  "Dominadas",
                  "Agarre prono / lastre",
                ),
                baseSets: 3,
                repRangeMin: 5,
                repRangeMax: 10,
                targetRir: 2,
                targetRirMin: 1,
                restSeconds: 180,
              },
            ],
          },
        ],
      },
      NOW,
    );
    newProgramId = created.programId;
  });

  describe("archiva el bloque anterior sin perder nada", () => {
    it("el programa queda inactivo y su bloque, cerrado con sus fechas reales", async () => {
      const old = await prisma.trainingProgram.findUniqueOrThrow({
        where: { id: oldProgramId },
        include: { mesocycles: true },
      });
      expect(old.isActive).toBe(false);
      expect(old.deletedAt).toBeNull();
      expect(old.mesocycles[0].status).toBe("COMPLETED");
      expect(old.mesocycles[0].startDate).toBe("2026-08-31");
      // Última sesión sembrada: semana 10 (lunes 2 nov) + 3 días.
      expect(old.mesocycles[0].endDate).toBe("2026-11-05");
    });

    it("no reescribe ni una serie", async () => {
      expect(await historySnapshot(profileId)).toEqual(historyBefore);
      expect(historyBefore.length).toBe(120);
    });

    it("la estructura del programa archivado sigue entera", async () => {
      const view = await getBlockStatsView(profileId, oldProgramId);
      expect(view!.program.isActive).toBe(false);
      expect(view!.program.days.length).toBeGreaterThan(0);
      expect(view!.program.days[0].exercises.length).toBeGreaterThan(0);
    });

    it("aparece en el archivo con su periodo y sus sesiones", async () => {
      const archived = await listArchivedPrograms(profileId);
      const old = archived.find((p) => p.id === oldProgramId)!;
      expect(old.sessions).toBe(40);
      expect(old.startLocalDate).toBe("2026-08-31");
      expect(old.endLocalDate).toBe("2026-11-05");
    });

    it("solo hay un programa activo", async () => {
      const active = await prisma.trainingProgram.findMany({
        where: { profileId, isActive: true },
      });
      expect(active.map((p) => p.id)).toEqual([newProgramId]);
    });
  });

  describe("la fatiga es una transición, no un reinicio", () => {
    it("el veredicto es EXACTAMENTE el de antes de cambiar", async () => {
      const after = await fatigueNow();
      expect(after.decision).toBe(fatigueBefore.decision);
      expect(after.score).toBe(fatigueBefore.score);
      expect(after.objectiveScore).toBe(fatigueBefore.objectiveScore);
      expect(after.signals).toEqual(fatigueBefore.signals);
      expect(after.numbers.sessionsInWindow).toBe(
        fatigueBefore.numbers.sessionsInWindow,
      );
      expect(after.numbers.weeksSinceDeload).toBe(
        fatigueBefore.numbers.weeksSinceDeload,
      );
    });

    it("no reinicia la acumulación: siguen contando las semanas entrenadas", async () => {
      const after = await fatigueNow();
      expect(after.numbers.weeksSinceDeload).toBe(9);
      expect(after.signals.map((s) => s.code)).toContain("LONG_ACCUMULATION");
    });

    it("no recomienda descargar por el hecho de cambiar de programa", async () => {
      expect((await fatigueNow()).decision).not.toBe("DELOAD_RECOMMENDED");
    });

    it("los ejercicios que se dejan siguen en el recuento mientras sean recientes", async () => {
      const after = await fatigueNow(addDays(TODAY, 7));
      expect(after.numbers.exercisesTracked).toBe(
        fatigueBefore.numbers.exercisesTracked,
      );
      // Y salen cuando dejan de serlo: un ejercicio abandonado no dice nada.
      const later = await fatigueNow(addDays(TODAY, 30));
      expect(later.numbers.exercisesTracked).toBe(0);
    });

    it("una primera semana floja con lo nuevo no se lee como caída", async () => {
      const remo = await variantId("Remo en T", "Barra en landmine");
      const mesocycle = await prisma.mesocycle.findFirstOrThrow({
        where: { programId: newProgramId },
      });
      // Se pasa de carga y baja: buscar el peso de partida, no rendir menos.
      for (const [d, weightKg, reps] of [
        [3, 60, 3],
        [10, 45, 8],
      ] as const) {
        await seedCompletedSessionWithSets(prisma, {
          mesocycleId: mesocycle.id,
          variantId: remo,
          localDate: addDays(TODAY, d),
          sets: [1, 2, 3].map((setNumber) => ({
            setNumber,
            weightKg,
            reps,
            rir: 0,
          })),
        });
      }
      const today = addDays(TODAY, 11);
      const a = analyzeTraining(
        await getTrainingContext(profileId, addDays(today, -28), today),
      );
      const row = a.variants.find((v) => v.variantId === remo)!;
      expect(row.introducing).toBe(true);
      expect(row.regressed).toBe(false);
      expect(a.fatigue.signals.map((s) => s.code)).not.toContain(
        "SINGLE_LIFT_DECLINE",
      );
      expect(a.fatigue.adaptation.message).toContain("ejercicio nuevo");
    });
  });

  describe("las cargas de referencia", () => {
    it("lo nuevo empieza sin carga: no se inventa, y dice que es la primera vez", async () => {
      const template = await prisma.workoutTemplate.findFirstOrThrow({
        where: {
          name: "Torso B",
          mesocycle: { programId: newProgramId },
        },
      });
      const preview = await previewTemplateSession(
        profileId,
        template.id,
        addDays(TODAY, 3),
      );
      const dominada = preview!.exercises[0];
      expect(dominada.variantName).toBe("Agarre prono / lastre");
      // El historial con otro agarre no se le atribuye a esta variante.
      expect(dominada.lastTime).toBeNull();
      expect(dominada.equipmentChange).toBeNull();
    });

    it("el mismo ejercicio en otra máquina abre un tramo y no compara cargas", async () => {
      const template = await prisma.workoutTemplate.findFirstOrThrow({
        where: { name: "Pierna", mesocycle: { programId: newProgramId } },
      });
      const preview = await previewTemplateSession(
        profileId,
        template.id,
        addDays(TODAY, 3),
      );
      const calf = preview!.exercises.find((e) => e.variantId === calfId)!;
      expect(calf.equipmentChange?.sinceLocalDate).toBe(CHANGE);
      expect(calf.lastTime).toBeNull();
    });

    it("el historial de la variante sigue intacto bajo su tramo anterior", async () => {
      const count = await prisma.setLog.count({
        where: { exerciseVariantId: calfId, localDate: { lt: CHANGE } },
      });
      expect(count).toBe(30);
    });
  });

  describe("el rango de RIR viaja hasta la sesión", () => {
    it("se conserva en la plantilla, en la vista previa y en la sesión", async () => {
      const template = await prisma.workoutTemplate.findFirstOrThrow({
        where: { name: "Pierna", mesocycle: { programId: newProgramId } },
        include: { exercises: { orderBy: { ordinal: "asc" } } },
      });
      expect(template.exercises[0].targetRir).toBe(3);
      expect(template.exercises[0].targetRirMin).toBe(2);

      const preview = await previewTemplateSession(
        profileId,
        template.id,
        addDays(TODAY, 3),
      );
      expect(preview!.exercises[0].targetRirMin).toBe(2);

      const { sessionId } = await startOrResumeSession(
        profileId,
        template.id,
        new Date(`${addDays(TODAY, 12)}T10:00:00Z`),
      );
      const session = await prisma.workoutSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: { exercises: { orderBy: { ordinal: "asc" } } },
      });
      expect(session.exercises[0].targetRir).toBe(3);
      expect(session.exercises[0].targetRirMin).toBe(2);
      await prisma.workoutSession.delete({ where: { id: sessionId } });
    });

    it("editar quita o conserva el rango según lo que se envía", async () => {
      const te = await prisma.templateExercise.findFirstOrThrow({
        where: {
          template: { name: "Pierna", mesocycle: { programId: newProgramId } },
          ordinal: 1,
        },
      });
      const base = {
        baseSets: te.baseSets,
        repRangeMin: te.repRangeMin,
        repRangeMax: te.repRangeMax,
        restSeconds: te.restSeconds,
      };
      await editTemplateExercise(profileId, te.id, {
        ...base,
        targetRir: 2,
        targetRirMin: null,
      });
      let row = await prisma.templateExercise.findUniqueOrThrow({
        where: { id: te.id },
      });
      expect(row.targetRir).toBe(2);
      expect(row.targetRirMin).toBeNull();

      await editTemplateExercise(profileId, te.id, {
        ...base,
        targetRir: 3,
        targetRirMin: 2,
      });
      row = await prisma.templateExercise.findUniqueOrThrow({
        where: { id: te.id },
      });
      expect(row.targetRirMin).toBe(2);
    });

    it("si la seguridad sube el RIR al cambiar de variante, el rango desaparece", async () => {
      const te = await prisma.templateExercise.findFirstOrThrow({
        where: {
          template: { name: "Torso A", mesocycle: { programId: newProgramId } },
          ordinal: 1,
        },
      });
      await prisma.templateExercise.update({
        where: { id: te.id },
        data: { targetRir: 1, targetRirMin: 0 },
      });
      const barra = await variantId("Press inclinado", "Barra");
      const result = await changeTemplateVariant(profileId, te.id, barra);
      const row = await prisma.templateExercise.findUniqueOrThrow({
        where: { id: te.id },
      });
      expect(result.targetRir).toBeGreaterThan(result.previousTargetRir);
      expect(row.targetRirMin).toBeNull();
    });
  });

  describe("las estadísticas del bloque archivado", () => {
    it("describen lo registrado, sin depender del programa activo", async () => {
      const view = await getBlockStatsView(profileId, oldProgramId);
      const stats = view!.stats!;
      expect(stats.startLocalDate).toBe("2026-08-31");
      expect(stats.endLocalDate).toBe("2026-11-05");
      expect(stats.weeks).toBe(10);
      expect(stats.adherence.completed).toBe(40);
      expect(stats.adherence.setsLogged).toBe(120);
      expect(stats.exercises).toHaveLength(4);
      expect(stats.comparison.compared).toBe(4);
      expect(stats.comparison.up).toBe(4);
    });

    it("el tramo nuevo no recorta el bloque archivado", async () => {
      const view = await getBlockStatsView(profileId, oldProgramId);
      const calf = view!.stats!.exercises.find((e) => e.variantId === calfId)!;
      expect(calf.comparableSince).toBeNull();
      expect(calf.comparison!.verdict).toBe("UP");
    });

    it("reconstruye la fatiga semana a semana con el motor, y lo dice", async () => {
      const view = await getBlockStatsView(profileId, oldProgramId);
      const fatigue = view!.fatigue!;
      expect(fatigue.points).toHaveLength(10);
      expect(fatigue.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(fatigue.points[9].localDate).toBe("2026-11-05");
      expect(fatigue.points[9].score).toBeGreaterThanOrEqual(1);
    });

    it("un programa ajeno no existe para quien no es su dueño", async () => {
      expect(await getBlockStatsView(otherProfileId, oldProgramId)).toBeNull();
      expect(await getBlockStatsView(profileId, "no-existe")).toBeNull();
    });

    it("un bloque sin sesiones no se inventa estadísticas", async () => {
      const otherProgram = await prisma.trainingProgram.findFirstOrThrow({
        where: { profileId: otherProfileId, isActive: true },
      });
      const view = await getBlockStatsView(otherProfileId, otherProgram.id);
      expect(view!.stats).toBeNull();
      expect(view!.fatigue).toBeNull();
    });
  });

  describe("no toca a nadie más", () => {
    it("el historial y los programas de otra persona quedan idénticos", async () => {
      expect(await historySnapshot(otherProfileId)).toEqual(otherHistoryBefore);
      expect(
        await prisma.trainingProgram.findMany({
          where: { profileId: otherProfileId },
          include: { mesocycles: true },
        }),
      ).toEqual(otherProgramBefore);
    });
  });

  describe("el bloque archivado se puede reutilizar", () => {
    it("reactivarlo lo reabre sin tocar su historial, y cierra el otro", async () => {
      const before = await historySnapshot(profileId);
      await reactivateProgram(profileId, oldProgramId);

      const old = await prisma.trainingProgram.findUniqueOrThrow({
        where: { id: oldProgramId },
        include: { mesocycles: true },
      });
      expect(old.isActive).toBe(true);
      expect(old.mesocycles[0].status).toBe("ACTIVE");
      expect(old.mesocycles[0].startDate).toBe("2026-08-31");
      expect(old.mesocycles[0].endDate).toBeNull();

      const newer = await prisma.trainingProgram.findUniqueOrThrow({
        where: { id: newProgramId },
      });
      expect(newer.isActive).toBe(false);
      expect(await historySnapshot(profileId)).toEqual(before);

      await reactivateProgram(profileId, newProgramId);
      const closed = await prisma.mesocycle.findUniqueOrThrow({
        where: { id: oldMesocycleId },
      });
      expect(closed.status).toBe("COMPLETED");
      expect(closed.endDate).toBe("2026-11-05");
    });
  });
});
