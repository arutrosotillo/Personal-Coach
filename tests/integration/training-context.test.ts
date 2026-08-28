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
