import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";

/**
 * El ciclo completo semana 1 → semana 2, contra la base de datos de verdad.
 *
 * Es la pregunta que motivó la auditoría de la primera semana real de uso:
 * *después de entrenar una semana entera, ¿el sistema entiende cómo he
 * rendido y me prescribe lo siguiente?* Los tests unitarios del motor ya
 * comprueban las reglas una a una; lo que aquí se prueba es la CADENA:
 *
 *   entrenar la semana 1 → historial persistido → el motor recibe la
 *   exposición correcta (la de ESA variante, no la de un primo suyo) →
 *   los objetivos de la semana 2 están disponibles ANTES de empezarla.
 *
 * El último eslabón es el que importa para el gimnasio: los objetivos se
 * calculan sin crear la sesión, así que `/train` los lleva impresos y entrar
 * sin cobertura sigue sabiendo qué toca.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { getTodayOverview, previewTemplateSession } =
  await import("@/server/repositories/workout.repo");
const { buildSuggestions } =
  await import("@/server/services/progression.service");
const ws = await import("@/server/services/workout-session.service");

let profileId: string;
let mesocycleId: string;
let templateId: string;

beforeAll(async () => {
  await runSeed(prisma);
  const result = await completeOnboarding(
    await createTestUser(prisma, "arturo"),
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
    // Lunes.
    new Date("2026-08-31T08:00:00Z"),
  );
  profileId = result.profileId;
  const program = await prisma.trainingProgram.findUniqueOrThrow({
    where: { id: result.programId },
    include: {
      mesocycles: { include: { templates: { orderBy: { ordinal: "asc" } } } },
    },
  });
  mesocycleId = program.mesocycles[0].id;
  templateId = program.mesocycles[0].templates[0].id;
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

/**
 * Entrena un día entero: abre la sesión, registra TODAS las series con el peso
 * y las repeticiones que se le pidan, y la cierra. Es el camino real (mismos
 * servicios que usa la app), no un `INSERT` a mano.
 */
async function entrenar(
  onTemplateId: string,
  instant: Date,
  plan: (ex: {
    repRangeMin: number;
    repRangeMax: number;
    plannedSets: number;
  }) => { weightKg: number; reps: number; rir: number | null },
) {
  const { sessionId } = await ws.startOrResumeSession(
    profileId,
    onTemplateId,
    instant,
  );
  const exercises = await prisma.workoutExercise.findMany({
    where: { sessionId },
    orderBy: { ordinal: "asc" },
  });
  for (const we of exercises) {
    const { weightKg, reps, rir } = plan(we);
    for (let n = 1; n <= we.plannedSets; n++) {
      await ws.logSet(profileId, {
        workoutExerciseId: we.id,
        setNumber: n,
        setType: "WORKING",
        weightKg,
        reps,
        rir,
      });
    }
  }
  await ws.finishSession(profileId, sessionId, { fatigue: 2 }, instant);
  return sessionId;
}

describe("semana 1 → semana 2", () => {
  it("al cerrar la semana, el siguiente entrenamiento y sus objetivos existen ANTES de empezarlo", async () => {
    // Semana 1 completa: los tres días, cerrando el rango con el esfuerzo
    // previsto. Es el escenario que debe producir una subida.
    await entrenar(templateId, new Date("2026-08-31T11:00:00Z"), (ex) => ({
      weightKg: 60,
      reps: ex.repRangeMax,
      rir: 2,
    }));

    const overview = await getTodayOverview(
      profileId,
      new Date("2026-09-04T18:00:00Z"),
    );
    expect(overview?.templates.find((t) => t.id === templateId)?.done).toBe(
      true,
    );
    // Terminar la semana NO deja al usuario sin siguiente paso: el overview
    // dice cuándo empieza la siguiente y con qué día.
    expect(overview?.nextWeekStartDate).toBe("2026-09-07");
    expect(overview?.nextWeekNumber).toBe(2);
    expect(overview?.nextWeekTemplate?.id).toBe(
      overview?.templates[0]?.id ?? null,
    );

    // Y los objetivos del día 1 de la semana 2 se pueden calcular SIN crear la
    // sesión: es lo que hace que estén en el HTML que cachea el service worker.
    const preview = await previewTemplateSession(
      profileId,
      templateId,
      "2026-09-07",
    );
    expect(preview).not.toBeNull();
    const sugerencias = buildSuggestions(preview!);

    for (const ex of preview!.exercises) {
      const s = sugerencias[ex.id];
      // Ningún ejercicio se queda sin prescripción: es el contrato de la
      // pantalla offline.
      expect(s).toBeDefined();
      expect(s.setTargets ?? []).toHaveLength(ex.plannedSets);
      // Y todos vienen CON historial: la semana 1 se ha usado de verdad.
      expect(s.reasonCode).not.toBe("NO_HISTORY");
      expect(s.numbers.pesoRef).toBe(60);
    }

    // Cerrar el rango con el esfuerzo previsto sube la carga.
    const primero = preview!.exercises[0];
    expect(sugerencias[primero.id].action).toBe("INCREASE_LOAD");
    expect(sugerencias[primero.id].suggestedWeightKg).toBeGreaterThan(60);

    // Y el preview NO ha creado nada.
    expect(
      await prisma.workoutSession.count({
        where: { mesocycleId, localDate: "2026-09-07" },
      }),
    ).toBe(0);
  });

  it("el objetivo que se ve antes de empezar es el MISMO que sale al empezar", async () => {
    // Si estos dos números pudieran diferir, la pantalla offline mentiría.
    const preview = await previewTemplateSession(
      profileId,
      templateId,
      "2026-09-07",
    );
    const antes = buildSuggestions(preview!);
    const porOrdinal = new Map(
      preview!.exercises.map((e) => [e.ordinal, antes[e.id]]),
    );

    const { sessionId } = await ws.startOrResumeSession(
      profileId,
      templateId,
      new Date("2026-09-07T11:00:00Z"),
    );
    const { getExecutionSession } =
      await import("@/server/repositories/workout.repo");
    const real = await getExecutionSession(profileId, sessionId);
    const despues = buildSuggestions(real!);

    for (const ex of real!.exercises) {
      const esperado = porOrdinal.get(ex.ordinal);
      expect(despues[ex.id].action).toBe(esperado?.action);
      expect(despues[ex.id].suggestedWeightKg).toBe(esperado?.suggestedWeightKg);
      expect(despues[ex.id].setTargets).toEqual(esperado?.setTargets);
    }

    await ws.discardSession(profileId, sessionId);
  });
});

describe("identidad de ejercicio: el historial no se contagia", () => {
  it("dos VARIANTES del mismo ejercicio progresan por separado", async () => {
    // "Press banca — Barra" y "Press banca — Máquina" son el mismo `Exercise`.
    // Si la progresión colgara del ejercicio (como colgaban las notas), haber
    // entrenado una movería los objetivos de la otra.
    const banca = await prisma.exercise.findFirstOrThrow({
      where: { name: "Press banca" },
      include: { variants: true },
    });
    const barra = banca.variants.find((v) => v.equipment === "BARBELL")!;
    const maquina = banca.variants.find((v) => v.equipment === "MACHINE")!;

    const dia = await prisma.workoutTemplate.create({
      data: {
        mesocycleId,
        name: "Día de prueba de identidad",
        ordinal: 99,
        exercises: {
          create: [
            {
              exerciseVariantId: barra.id,
              ordinal: 1,
              baseSets: 3,
              repRangeMin: 8,
              repRangeMax: 12,
              targetRir: 2,
              restSeconds: 120,
            },
            {
              exerciseVariantId: maquina.id,
              ordinal: 2,
              baseSets: 3,
              repRangeMin: 8,
              repRangeMax: 12,
              targetRir: 1,
              restSeconds: 120,
            },
          ],
        },
      },
    });

    // Solo se entrena la de BARRA, y cerrando el rango.
    const { sessionId } = await ws.startOrResumeSession(
      profileId,
      dia.id,
      new Date("2026-09-09T11:00:00Z"),
    );
    const exercises = await prisma.workoutExercise.findMany({
      where: { sessionId },
      orderBy: { ordinal: "asc" },
    });
    for (let n = 1; n <= 3; n++) {
      await ws.logSet(profileId, {
        workoutExerciseId: exercises[0].id,
        setNumber: n,
        setType: "WORKING",
        weightKg: 100,
        reps: 12,
        rir: 2,
      });
    }
    await ws.finishSession(
      profileId,
      sessionId,
      {},
      new Date("2026-09-09T12:00:00Z"),
    );

    const preview = await previewTemplateSession(profileId, dia.id, "2026-09-16");
    const s = buildSuggestions(preview!);
    const conBarra = preview!.exercises.find((e) => e.variantId === barra.id)!;
    const conMaquina = preview!.exercises.find(
      (e) => e.variantId === maquina.id,
    )!;

    // La entrenada progresa desde SUS 100 kg…
    expect(s[conBarra.id].numbers.pesoRef).toBe(100);
    expect(s[conBarra.id].action).toBe("INCREASE_LOAD");
    // …y la que no se ha tocado sigue sin historial. Ni hereda los 100 kg ni
    // hereda la subida.
    expect(s[conMaquina.id].reasonCode).toBe("NO_HISTORY");
    expect(s[conMaquina.id].suggestedWeightKg).toBeNull();
  });
});
