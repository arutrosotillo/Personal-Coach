import { beforeAll, describe, expect, it } from "vitest";

import { addDays } from "@/core/dates";
import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * Integración F3.3: qué ve —y qué NO ve— el motor de fatiga.
 *
 * Este repositorio alimenta a la vez la tarjeta de recuperación y el contexto
 * que se le manda a Coach AI, así que un fallo de ÁMBITO aquí no produce un
 * error: produce un consejo seguro de sí mismo calculado sobre datos que no
 * le corresponden. Los casos de abajo son defectos reales encontrados en
 * revisión independiente, más la decisión de ámbito que se tomó a partir de
 * ellos.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { getTrainingContext } =
  await import("@/server/repositories/training-context.repo");
const { analyzeTraining } = await import("@/core/training/analysis");

// Todas estas suites prueban el comportamiento del dominio con UN usuario.
// Se crea una vez y se reutiliza, igual que antes de multi-usuario: reonboardar
// al MISMO usuario sigue reutilizando su perfil.
let ownerUserId: string | null = null;
async function ownerId(): Promise<string> {
  ownerUserId ??= await createTestUser(prisma, "owner");
  return ownerUserId;
}

const TODAY = "2026-08-25";

let profileId: string;
let activeMesocycleId: string;
let archivedMesocycleId: string;
let variantId: string;

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
  const result = await completeOnboarding(
    await ownerId(),
    data,
    new Date("2026-07-14T10:00:00Z"),
  );
  profileId = result.profileId;

  const program = await prisma.trainingProgram.findUniqueOrThrow({
    where: { id: result.programId },
    include: { mesocycles: { include: { templates: true } } },
  });
  activeMesocycleId = program.mesocycles[0].id;

  // Un programa ARCHIVADO del mismo perfil (lo que produce F3.1b al crear uno
  // nuevo o al archivar el anterior).
  const archived = await prisma.trainingProgram.create({
    data: {
      profileId,
      name: "Programa anterior",
      daysPerWeek: 3,
      isActive: false,
      mesocycles: { create: { ordinal: 1, weeksPlanned: 6, currentWeek: 1 } },
    },
    include: { mesocycles: true },
  });
  archivedMesocycleId = archived.mesocycles[0].id;

  variantId = (await prisma.exerciseVariant.findFirstOrThrow()).id;
});

describe("ámbito: el perfil entero, no solo el programa vigente", () => {
  it("cuenta las sesiones de programas archivados", async () => {
    // Dos sesiones del programa activo y tres del archivado, todas recientes.
    for (const daysAgo of [10, 3]) {
      await seedCompletedSessionWithSets(prisma, {
        mesocycleId: activeMesocycleId,
        variantId,
        localDate: addDays(TODAY, -daysAgo),
        sets: [{ setNumber: 1, weightKg: 80, reps: 10, rir: 2 }],
      });
    }
    for (const daysAgo of [9, 5, 1]) {
      await seedCompletedSessionWithSets(prisma, {
        mesocycleId: archivedMesocycleId,
        variantId,
        localDate: addDays(TODAY, -daysAgo),
        plannedSets: 6,
        sets: [{ setNumber: 1, weightKg: 60, reps: 10, rir: 2 }],
      });
    }

    // Cambiar de programa es una operación normal (F3.1b). Si el filtro fuese
    // "solo el programa activo", el motor se quedaría ciego tres semanas
    // después de cada cambio — justo al terminar un bloque, que es cuando más
    // probable es necesitar una descarga. Entrenaste esas sesiones: cuentan.
    const ctx = await getTrainingContext(profileId, addDays(TODAY, -28), TODAY);
    expect(ctx.sessions).toHaveLength(5);

    // Y la continuidad de carga no se pierde al cambiar de programa: el motor
    // de progresión sigue viendo lo que levantaste antes.
    const pesos = ctx.variants[0].exposures.flatMap((e) =>
      e.sets.map((x) => x.weightKg),
    );
    expect(pesos.sort()).toEqual([60, 60, 60, 80, 80]);
  });
});

describe("semanas de acumulación", () => {
  it("un parón largo reinicia el contador", async () => {
    // Sin esto el contador crecería para siempre: nada en la app escribe
    // `weekKind: "DELOAD"`, así que un parón real es el único reinicio posible.
    const antes = await getTrainingContext(
      profileId,
      addDays(TODAY, -28),
      TODAY,
    );
    expect(antes.weeksSinceDeload).toBe(1);

    // Una sesión de hace un año, con un hueco enorme por delante: no debe
    // convertirse en "llevas 52 semanas acumulando".
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: activeMesocycleId,
      variantId,
      localDate: addDays(TODAY, -365),
      sets: [{ setNumber: 1, weightKg: 70, reps: 10, rir: 2 }],
    });
    const despues = await getTrainingContext(
      profileId,
      addDays(TODAY, -28),
      TODAY,
    );
    expect(despues.weeksSinceDeload).toBe(1);
  });
});

describe("exposiciones: se acotan por número, no por días", () => {
  it("el motor ve el mismo historial que en la pantalla de sesión", async () => {
    // Ocho exposiciones repartidas en cuatro meses. La ventana de fatiga son
    // 28 días, pero el motor razona en EXPOSICIONES: si se acotaran por días,
    // la tarjeta de recuperación contaría "4 sesiones seguidas por debajo del
    // rango" donde la pantalla de sesión cuenta 6.
    const otra = await prisma.exerciseVariant.findFirstOrThrow({
      where: { id: { not: variantId } },
    });
    for (const daysAgo of [110, 96, 82, 68, 54, 40, 20, 6]) {
      await seedCompletedSessionWithSets(prisma, {
        mesocycleId: activeMesocycleId,
        variantId: otra.id,
        localDate: addDays(TODAY, -daysAgo),
        sets: [{ setNumber: 1, weightKg: 50, reps: 10, rir: 2 }],
      });
    }
    const ctx = await getTrainingContext(profileId, addDays(TODAY, -28), TODAY);
    const v = ctx.variants.find((x) => x.variantId === otra.id);
    expect(v).toBeDefined();
    expect(v!.exposures.length).toBe(6);

    // Pero las SESIONES siguen acotadas a la ventana: son cosas distintas.
    expect(ctx.sessions.every((s) => s.localDate >= addDays(TODAY, -28))).toBe(
      true,
    );
  });

  it("un ejercicio que no se ha tocado en la ventana no cuenta como actual", async () => {
    const vieja = await prisma.exerciseVariant.findFirstOrThrow({
      where: { id: { notIn: [variantId] }, name: { not: "" } },
      orderBy: { id: "desc" },
    });
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: activeMesocycleId,
      variantId: vieja.id,
      localDate: addDays(TODAY, -100),
      sets: [{ setNumber: 1, weightKg: 40, reps: 10, rir: 2 }],
    });
    const ctx = await getTrainingContext(profileId, addDays(TODAY, -28), TODAY);
    expect(ctx.variants.map((v) => v.variantId)).not.toContain(vieja.id);
  });
});

describe("descarga: un ejercicio que solo has hecho descargando", () => {
  let sustitutoId: string;

  it("sustituirlo durante la descarga no rompe la lectura", async () => {
    // El caso real: en la semana de descarga la máquina está ocupada y cambias
    // el ejercicio por otro que no habías hecho nunca. Esa variante solo
    // existe en sesiones DELOAD, se quedaba sin exposiciones y leer la última
    // lanzaba un TypeError: `/train` y `/coach` daban error, y la pantalla de
    // sesión perdía en silencio el bloqueo de subidas (su `catch` devuelve
    // `null`).
    const sustituto = await prisma.exerciseVariant.findFirstOrThrow({
      where: { setLogs: { none: {} } },
      orderBy: { name: "asc" },
    });
    sustitutoId = sustituto.id;
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: activeMesocycleId,
      variantId: sustituto.id,
      localDate: addDays(TODAY, -2),
      weekKind: "DELOAD",
      plannedSets: 4,
      sets: [
        { setNumber: 1, weightKg: 30, reps: 10, rir: 2 },
        { setNumber: 2, weightKg: 30, reps: 10, rir: 2 },
      ],
    });

    const ctx = await getTrainingContext(profileId, addDays(TODAY, -28), TODAY);
    const v = ctx.variants.find((x) => x.variantId === sustituto.id);

    // Sin otra referencia, la descarga es mejor que nada: la carga fue la de
    // siempre. Se usa como exposición en vez de dejar el ejercicio "sin
    // historial" (y a la pantalla de sesión diciendo "primera vez").
    expect(v).toBeDefined();
    expect(v!.exposures).toHaveLength(1);
    expect(v!.exposures[0].sets.map((s) => s.weightKg)).toEqual([30, 30]);
    expect(v!.daysSinceLast).toBe(2);

    // Y lo que de verdad se rompía: el análisis de `/train` y `/coach`.
    expect(() => analyzeTraining(ctx)).not.toThrow();
  });

  it("y la pantalla de sesión usa esa misma descarga como referencia", async () => {
    // Misma regla en las dos pantallas. Sin ella, la de sesión decía "primera
    // vez con este ejercicio" justo al lado de una "última vez".
    const { getExecutionSession } =
      await import("@/server/repositories/workout.repo");
    const { buildSuggestions } =
      await import("@/server/services/progression.service");
    const enCurso = await seedCompletedSessionWithSets(prisma, {
      mesocycleId: activeMesocycleId,
      variantId: sustitutoId,
      localDate: TODAY,
      status: "IN_PROGRESS",
      plannedSets: 4,
      sets: [],
    });
    const session = (await getExecutionSession(profileId, enCurso))!;
    const ex = session.exercises[0];
    expect(ex.lastTime?.localDate).toBe(addDays(TODAY, -2));
    expect(ex.lastTime?.deload).toBe(true);
    expect(ex.lastTime?.exposures).toHaveLength(1);

    const s = buildSuggestions(session)[ex.id];
    expect(s.action).not.toBe("START");
    expect(s.numbers.pesoRef).toBe(30);
    await prisma.workoutSession.delete({ where: { id: enCurso } });
  });

  it("el historial de sesiones llega entero, más allá de la ventana", async () => {
    // Sirve para situar la descarga: una terminada hace dos meses sigue
    // marcando desde cuándo los datos de cada ejercicio son nuevos.
    const ctx = await getTrainingContext(profileId, addDays(TODAY, -28), TODAY);
    const fechas = ctx.timeline!.map((s) => s.localDate);
    expect(fechas[0]).toBe(addDays(TODAY, -365));
    expect(fechas).toEqual([...fechas].sort());
    expect(fechas.length).toBeGreaterThan(ctx.sessions.length);
    expect(ctx.timeline!.filter((s) => s.deload)).toHaveLength(1);
    expect(ctx.sessionsPerWeek).toBe(3);
  });
});
