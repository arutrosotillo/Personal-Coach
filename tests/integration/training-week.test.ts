import { beforeAll, describe, expect, it } from "vitest";

import { addDays } from "@/core/dates";
import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";

/**
 * La semana del programa, de punta a punta.
 *
 * Esto existe por un defecto que solo aparecía a partir del OCTAVO día de uso
 * real, así que ningún test de una sola sesión lo veía: `Mesocycle.currentWeek`
 * vale 0 y nadie lo incrementa nunca, así que todas las sesiones se guardaban
 * con `weekNumber: 1` y "las sesiones hechas esta semana" las encontraba TODAS.
 * A partir de la semana 2 la pantalla decía "¡Semana completada!" para siempre
 * y "Hoy toca" no volvía a proponer un entrenamiento jamás.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { startOrResumeSession, finishSession, logSet } =
  await import("@/server/services/workout-session.service");
const { getTodayOverview, getExecutionSession } =
  await import("@/server/repositories/workout.repo");

const LUNES = "2026-06-01";
let profileId: string;
let templateIds: string[];

async function entrenar(localDate: string, templateId: string) {
  const started = await startOrResumeSession(
    profileId,
    templateId,
    new Date(`${localDate}T18:00:00Z`),
  );
  const id = started.sessionId!;
  const session = (await getExecutionSession(profileId, id))!;
  await logSet(profileId, {
    workoutExerciseId: session.exercises[0].id,
    setNumber: 1,
    setType: "WORKING",
    weightKg: 40,
    reps: 10,
    rir: 2,
  });
  await finishSession(profileId, id, {
    perceivedPerformance: 4,
    pump: 3,
    jointPain: 1,
    fatigue: 2,
    motivation: 4,
  });
}

const overview = (localDate: string) =>
  getTodayOverview(profileId, new Date(`${localDate}T20:00:00Z`));

beforeAll(async () => {
  await runSeed(prisma);
  const result = await completeOnboarding(
    onboardingSchema.parse({
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
    }),
    new Date(`${LUNES}T10:00:00Z`),
  );
  profileId = result.profileId;
  const templates = await prisma.workoutTemplate.findMany({
    where: { deletedAt: null },
    orderBy: { ordinal: "asc" },
  });
  templateIds = templates.map((t) => t.id);
}, 30_000);

describe("la semana avanza con el calendario", () => {
  it("la primera semana se completa y lo dice", async () => {
    for (const [i, id] of templateIds.entries()) {
      await entrenar(addDays(LUNES, i), id);
    }
    const ov = (await overview(addDays(LUNES, 2)))!;
    expect(ov.weekNumber).toBe(1);
    expect(ov.templates.every((t) => t.done)).toBe(true);
  });

  it("el LUNES siguiente vuelve a proponer entrenamiento", async () => {
    // El defecto original: aquí seguía diciendo "¡Semana completada!".
    const domingo = (await overview(addDays(LUNES, 6)))!;
    expect(domingo.weekNumber).toBe(1);
    expect(domingo.templates.every((t) => t.done)).toBe(true);

    const lunes = (await overview(addDays(LUNES, 7)))!;
    expect(lunes.weekNumber).toBe(2);
    expect(lunes.templates.filter((t) => t.done)).toHaveLength(0);
    expect(lunes.templates.find((t) => !t.done)?.name).toBeTruthy();
  });

  it("y las sesiones nuevas se guardan con SU semana, no todas con la 1", async () => {
    for (const [i, id] of templateIds.entries()) {
      await entrenar(addDays(LUNES, 7 + i), id);
    }
    const porSemana = await prisma.workoutSession.groupBy({
      by: ["weekNumber"],
      _count: true,
      orderBy: { weekNumber: "asc" },
    });
    expect(porSemana.map((w) => [w.weekNumber, w._count])).toEqual([
      [1, 3],
      [2, 3],
    ]);
  });

  it("una semana saltada no arrastra días marcados como hechos", async () => {
    const tresSemanasDespues = (await overview(addDays(LUNES, 21)))!;
    expect(tresSemanasDespues.weekNumber).toBe(4);
    expect(tresSemanasDespues.templates.filter((t) => t.done)).toHaveLength(0);
  });
});

describe("un día sin ejercicios no es entrenable", () => {
  it("no se puede vaciar un día quitando su último ejercicio", async () => {
    // Vaciarlo dejaba el día como entrenable: podías empezar una sesión de
    // cero ejercicios, "completarla" sin registrar nada, y esa sesión fantasma
    // marcaba el día como hecho y podía volverse el ancla desde la que se
    // cuentan las semanas del mesociclo.
    const { removeTemplateExercise } =
      await import("@/server/services/program-edit.service");
    const template = await prisma.workoutTemplate.findFirstOrThrow({
      where: { deletedAt: null },
      orderBy: { ordinal: "asc" },
      include: { exercises: { orderBy: { ordinal: "asc" } } },
    });
    // Se quitan todos menos el último; el último debe fallar.
    for (const te of template.exercises.slice(0, -1)) {
      await removeTemplateExercise(profileId, te.id);
    }
    await expect(
      removeTemplateExercise(profileId, template.exercises.at(-1)!.id),
    ).rejects.toThrow(/al menos un ejercicio/i);

    const quedan = await prisma.templateExercise.count({
      where: { templateId: template.id },
    });
    expect(quedan).toBe(1);
  });
});
