import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { onboardingSchema } from "@/core/schemas/onboarding";
import type { ManualProgramInput } from "@/core/schemas/manual-program";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * Integración Fase 3.1: un programa MANUAL usa el mismo motor de sesiones,
 * snapshots, historial y progresión que el generado; y cambiar de programa
 * conserva las sesiones y el historial por variante (Caso B).
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { createManualProgram } =
  await import("@/server/services/manual-program.service");
const { getExecutionSession } =
  await import("@/server/repositories/workout.repo");
const { buildSuggestions, getExerciseHistorySummary } =
  await import("@/server/services/progression.service");
const ws = await import("@/server/services/workout-session.service");

// Todas estas suites prueban el comportamiento del dominio con UN usuario.
// Se crea una vez y se reutiliza, igual que antes de multi-usuario: reonboardar
// al MISMO usuario sigue reutilizando su perfil.
let ownerUserId: string | null = null;
async function ownerId(): Promise<string> {
  ownerUserId ??= await createTestUser(prisma, "owner");
  return ownerUserId;
}

let profileId: string;
let variantIds: string[];
let bandVariantId: string;

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
  const r = await completeOnboarding(
    await ownerId(),
    data,
    new Date("2026-07-14T10:00:00Z"),
  );
  profileId = r.profileId;
  // Variantes CON incremento de carga: las que no lo tienen (bandas) progresan
  // solo por repeticiones y se cubren aparte, más abajo.
  const variants = await prisma.exerciseVariant.findMany({
    where: { deletedAt: null, loadStepKg: { gt: 0 } },
    take: 4,
    orderBy: { name: "asc" },
  });
  variantIds = variants.map((v) => v.id);
  bandVariantId = (
    await prisma.exerciseVariant.findFirstOrThrow({
      where: { deletedAt: null, loadStepKg: 0 },
      orderBy: { name: "asc" },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

function manual(name: string, variantId: string): ManualProgramInput {
  return {
    name,
    days: [
      {
        name: "Día 1",
        exercises: [
          {
            exerciseVariantId: variantId,
            baseSets: 3,
            repRangeMin: 6,
            repRangeMax: 8,
            targetRir: 2,
            restSeconds: 150,
          },
        ],
      },
    ],
  };
}

describe("programa manual usa el mismo motor (Caso A backend)", () => {
  it("crear → sesión → snapshot → logSet → finishSession → progresión sugiere", async () => {
    const variantId = variantIds[0];
    await createManualProgram(profileId, manual("Fuerza manual", variantId));
    const template = await prisma.workoutTemplate.findFirstOrThrow({
      where: {
        mesocycle: { program: { profileId, isActive: true } },
        deletedAt: null,
      },
      orderBy: { ordinal: "asc" },
    });

    // Sesión desde la plantilla manual → snapshot correcto.
    const started = await ws.startOrResumeSession(
      profileId,
      template.id,
      new Date("2026-07-20T10:00:00Z"),
    );
    const we = await prisma.workoutExercise.findFirstOrThrow({
      where: { sessionId: started.sessionId },
    });
    expect(we.exerciseVariantId).toBe(variantId);
    expect(we.repRangeMin).toBe(6);
    expect(we.repRangeMax).toBe(8);
    expect(we.targetRir).toBe(2);

    // Registra el tope del rango con RIR objetivo y finaliza.
    for (let n = 1; n <= we.plannedSets; n++) {
      await ws.logSet(profileId, {
        workoutExerciseId: we.id,
        setNumber: n,
        setType: "WORKING",
        weightKg: 100,
        reps: 8,
        rir: 2,
      });
    }
    await ws.finishSession(
      profileId,
      started.sessionId,
      {},
      new Date("2026-07-20T11:00:00Z"),
    );

    // Segunda sesión: la progresión sugiere subir (mismo motor que un generado).
    const next = await ws.startOrResumeSession(
      profileId,
      template.id,
      new Date("2026-07-23T10:00:00Z"),
    );
    const exec = await getExecutionSession(profileId, next.sessionId);
    const target = exec!.exercises.find((e) => e.variantId === variantId)!;
    const suggestion = buildSuggestions(exec!)[target.id];
    expect(suggestion.action).toBe("INCREASE_LOAD");
    expect(target.lastTime?.sets[0].weightKg).toBe(100);
    await ws.discardSession(profileId, next.sessionId);
  });

  it("variante sin carga cuantificable (loadStepKg 0) nunca sugiere kilos", async () => {
    await createManualProgram(profileId, manual("Banda manual", bandVariantId));
    const template = await prisma.workoutTemplate.findFirstOrThrow({
      where: {
        mesocycle: { program: { profileId, isActive: true } },
        deletedAt: null,
      },
      orderBy: { ordinal: "asc" },
    });
    const started = await ws.startOrResumeSession(
      profileId,
      template.id,
      new Date("2026-07-27T10:00:00Z"),
    );
    const we = await prisma.workoutExercise.findFirstOrThrow({
      where: { sessionId: started.sessionId },
    });
    for (let n = 1; n <= we.plannedSets; n++) {
      await ws.logSet(profileId, {
        workoutExerciseId: we.id,
        setNumber: n,
        setType: "WORKING",
        weightKg: 0,
        reps: 8,
        rir: 2,
      });
    }
    await ws.finishSession(
      profileId,
      started.sessionId,
      {},
      new Date("2026-07-27T11:00:00Z"),
    );

    const next = await ws.startOrResumeSession(
      profileId,
      template.id,
      new Date("2026-07-30T10:00:00Z"),
    );
    const exec = await getExecutionSession(profileId, next.sessionId);
    const target = exec!.exercises.find((e) => e.variantId === bandVariantId)!;
    const suggestion = buildSuggestions(exec!)[target.id];
    expect(suggestion.action).toBe("ADD_REP");
    expect(suggestion.reasonCode).toBe("NO_LOAD_STEP");
    expect(suggestion.suggestedWeightKg).toBe(0);
    expect(suggestion.explanation).not.toMatch(/sube a 0 kg/i);
    await ws.discardSession(profileId, next.sessionId);
  });
});

describe("cambiar de programa conserva historial (Caso B backend)", () => {
  it("una sesión de un programa sobrevive al crear otro, y el historial por variante se recupera", async () => {
    const sharedVariant = variantIds[1];
    // Programa A (manual) con una sesión completada de la variante compartida.
    await createManualProgram(profileId, manual("Programa A", sharedVariant));
    const mesoA = await prisma.mesocycle.findFirstOrThrow({
      where: { program: { profileId, isActive: true } },
    });
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: mesoA.id,
      variantId: sharedVariant,
      localDate: "2026-07-25",
      sets: [
        { setNumber: 1, weightKg: 90, reps: 6, rir: 2 },
        { setNumber: 2, weightKg: 90, reps: 6, rir: 1 },
      ],
    });
    const sessionsBefore = await prisma.workoutSession.count();

    // Crea el programa B con la MISMA variante.
    await createManualProgram(profileId, manual("Programa B", sharedVariant));

    // La sesión histórica de A NO desapareció.
    expect(await prisma.workoutSession.count()).toBe(sessionsBefore);
    // Y el historial por variante se recupera bajo el programa B.
    const summary = await getExerciseHistorySummary(profileId, sharedVariant);
    expect(summary.sessionCount).toBeGreaterThanOrEqual(1);
    expect(summary.bestSet?.weightKg).toBe(90);
  });
});
