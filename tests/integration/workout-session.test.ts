import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OnboardingData } from "@/core/schemas/onboarding";
import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";

/**
 * Integración Fase 2A: ciclo de vida de una sesión (crear/reanudar, registro
 * idempotente, sustitución, finalizar/descartar) y edición del programa sin
 * reescribir el historial. DB real temporal; DATABASE_URL fijada antes de los
 * imports dinámicos de servidor.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const session = await import("@/server/services/workout-session.service");
const programEdit = await import("@/server/services/program-edit.service");
const { getExecutionSession, listCompletedSessions } =
  await import("@/server/repositories/workout.repo");

const ONBOARDING: OnboardingData = onboardingSchema.parse({
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

let profileId: string;
let templateIds: string[];

beforeAll(async () => {
  await runSeed(prisma);
  const result = await completeOnboarding(
    ONBOARDING,
    new Date("2026-07-14T10:00:00Z"),
  );
  profileId = result.profileId;
  const program = await prisma.trainingProgram.findUniqueOrThrow({
    where: { id: result.programId },
    include: {
      mesocycles: {
        include: { templates: { orderBy: { ordinal: "asc" } } },
      },
    },
  });
  templateIds = program.mesocycles[0].templates.map((t) => t.id);
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

async function firstTemplate() {
  return prisma.workoutTemplate.findFirstOrThrow({
    where: { id: templateIds[0] },
    include: { exercises: { orderBy: { ordinal: "asc" } } },
  });
}

async function cleanupSessions() {
  await prisma.setLog.deleteMany({});
  await prisma.workoutExercise.deleteMany({});
  await prisma.workoutSession.deleteMany({});
}

describe("startOrResumeSession", () => {
  it("crea una sesión copiando (snapshot) los ejercicios de la plantilla", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const { sessionId, resumed } = await session.startOrResumeSession(
      profileId,
      template.id,
      new Date("2026-07-14T11:00:00Z"),
    );
    expect(resumed).toBe(false);

    const we = await prisma.workoutExercise.findMany({
      where: { sessionId },
      orderBy: { ordinal: "asc" },
    });
    expect(we).toHaveLength(template.exercises.length);
    // El snapshot conserva variante, series y rango de la plantilla.
    for (let i = 0; i < template.exercises.length; i++) {
      expect(we[i].exerciseVariantId).toBe(
        template.exercises[i].exerciseVariantId,
      );
      expect(we[i].plannedSets).toBe(template.exercises[i].baseSets);
      expect(we[i].repRangeMin).toBe(template.exercises[i].repRangeMin);
    }
  });

  it("reanuda la sesión activa en lugar de crear otra (una activa a la vez)", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const a = await session.startOrResumeSession(profileId, template.id);
    const b = await session.startOrResumeSession(profileId, template.id);
    expect(b.resumed).toBe(true);
    expect(b.sessionId).toBe(a.sessionId);
    expect(await prisma.workoutSession.count()).toBe(1);
  });

  it("rechaza una plantilla de un programa archivado", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const mesocycle = await prisma.mesocycle.findUniqueOrThrow({
      where: { id: template.mesocycleId },
    });
    await prisma.trainingProgram.update({
      where: { id: mesocycle.programId },
      data: { isActive: false },
    });

    await expect(
      session.startOrResumeSession(profileId, template.id),
    ).rejects.toThrow();
    expect(await prisma.workoutSession.count()).toBe(0);

    await prisma.trainingProgram.update({
      where: { id: mesocycle.programId },
      data: { isActive: true },
    });
  });
});

describe("logSet (idempotencia)", () => {
  it("un doble registro de la misma serie actualiza la fila, no la duplica", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const { sessionId } = await session.startOrResumeSession(
      profileId,
      template.id,
    );
    const we = await prisma.workoutExercise.findFirstOrThrow({
      where: { sessionId },
      orderBy: { ordinal: "asc" },
    });

    await session.logSet(profileId, {
      workoutExerciseId: we.id,
      setNumber: 1,
      setType: "WORKING",
      weightKg: 40,
      reps: 10,
      rir: 2,
    });
    // Segundo toque con distinto peso: debe SOBRESCRIBIR, no crear serie nueva.
    await session.logSet(profileId, {
      workoutExerciseId: we.id,
      setNumber: 1,
      setType: "WORKING",
      weightKg: 42.5,
      reps: 10,
      rir: 2,
    });

    const logs = await prisma.setLog.findMany({
      where: { workoutExerciseId: we.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].weightKg).toBe(42.5);
    expect(logs[0].estimated1Rm).not.toBeNull();
  });

  it("registra varias series ordenadas por setNumber", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const { sessionId } = await session.startOrResumeSession(
      profileId,
      template.id,
    );
    const we = await prisma.workoutExercise.findFirstOrThrow({
      where: { sessionId },
      orderBy: { ordinal: "asc" },
    });
    for (let n = 1; n <= 3; n++) {
      await session.logSet(profileId, {
        workoutExerciseId: we.id,
        setNumber: n,
        setType: "WORKING",
        weightKg: 40,
        reps: 12 - n,
        rir: 2,
      });
    }
    const logs = await prisma.setLog.findMany({
      where: { workoutExerciseId: we.id },
      orderBy: { setNumber: "asc" },
    });
    expect(logs.map((l) => l.setNumber)).toEqual([1, 2, 3]);
  });
});

describe("substituteExercise", () => {
  it("cambia la variante, borra las series previas y toma el rango de la nueva", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const { sessionId } = await session.startOrResumeSession(
      profileId,
      template.id,
    );
    const we = await prisma.workoutExercise.findFirstOrThrow({
      where: { sessionId },
      orderBy: { ordinal: "asc" },
    });
    await session.logSet(profileId, {
      workoutExerciseId: we.id,
      setNumber: 1,
      setType: "WORKING",
      weightKg: 40,
      reps: 10,
      rir: 2,
    });

    const other = await prisma.exerciseVariant.findFirstOrThrow({
      where: { id: { not: we.exerciseVariantId }, deletedAt: null },
    });
    await session.substituteExercise(profileId, we.id, other.id);

    const updated = await prisma.workoutExercise.findUniqueOrThrow({
      where: { id: we.id },
    });
    expect(updated.exerciseVariantId).toBe(other.id);
    expect(updated.repRangeMin).toBe(other.repRangeMin);
    // Las series de la variante anterior se descartan.
    expect(
      await prisma.setLog.count({ where: { workoutExerciseId: we.id } }),
    ).toBe(0);
  });

  it("elegir la variante actual es un no-op y conserva sus series", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const { sessionId } = await session.startOrResumeSession(
      profileId,
      template.id,
    );
    const we = await prisma.workoutExercise.findFirstOrThrow({
      where: { sessionId },
      orderBy: { ordinal: "asc" },
    });
    await session.logSet(profileId, {
      workoutExerciseId: we.id,
      setNumber: 1,
      setType: "WORKING",
      weightKg: 40,
      reps: 10,
      rir: 2,
    });

    await session.substituteExercise(profileId, we.id, we.exerciseVariantId);

    expect(
      await prisma.setLog.count({ where: { workoutExerciseId: we.id } }),
    ).toBe(1);
  });
});

describe("setPlannedSets (integridad)", () => {
  it("no permite que otro perfil borre series", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const { sessionId } = await session.startOrResumeSession(
      profileId,
      template.id,
    );
    const we = await prisma.workoutExercise.findFirstOrThrow({
      where: { sessionId },
      orderBy: { ordinal: "asc" },
    });
    for (let setNumber = 1; setNumber <= 3; setNumber++) {
      await session.logSet(profileId, {
        workoutExerciseId: we.id,
        setNumber,
        setType: "WORKING",
        weightKg: 40,
        reps: 10,
        rir: 2,
      });
    }

    await expect(
      session.setPlannedSets("otro-perfil", we.id, 1),
    ).rejects.toThrow();
    expect(
      await prisma.setLog.count({ where: { workoutExerciseId: we.id } }),
    ).toBe(3);
  });

  it("no modifica el snapshot ni las series de una sesión completada", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const { sessionId } = await session.startOrResumeSession(
      profileId,
      template.id,
    );
    const we = await prisma.workoutExercise.findFirstOrThrow({
      where: { sessionId },
      orderBy: { ordinal: "asc" },
    });
    for (let setNumber = 1; setNumber <= 3; setNumber++) {
      await session.logSet(profileId, {
        workoutExerciseId: we.id,
        setNumber,
        setType: "WORKING",
        weightKg: 40,
        reps: 10,
        rir: 2,
      });
    }
    await session.finishSession(profileId, sessionId, {});

    await expect(session.setPlannedSets(profileId, we.id, 1)).rejects.toThrow();
    const unchanged = await prisma.workoutExercise.findUniqueOrThrow({
      where: { id: we.id },
    });
    expect(unchanged.plannedSets).toBe(we.plannedSets);
    expect(
      await prisma.setLog.count({ where: { workoutExerciseId: we.id } }),
    ).toBe(3);
  });
});

describe("finishSession / discardSession e historial", () => {
  it("finalizar marca COMPLETED con feedback y aparece en el historial", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const { sessionId } = await session.startOrResumeSession(
      profileId,
      template.id,
    );
    await session.finishSession(
      profileId,
      sessionId,
      {
        perceivedPerformance: 4,
        pump: 3,
        jointPain: 0,
        fatigue: 2,
        motivation: 5,
        notes: "bien",
      },
      new Date("2026-07-14T12:00:00Z"),
    );
    const done = await prisma.workoutSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(done.status).toBe("COMPLETED");
    expect(done.perceivedPerformance).toBe(4);
    expect(done.notes).toBe("bien");

    const history = await listCompletedSessions(profileId);
    expect(history.some((s) => s.id === sessionId)).toBe(true);
  });

  it("descartar marca ABORTED y queda fuera del historial", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const { sessionId } = await session.startOrResumeSession(
      profileId,
      template.id,
    );
    await session.discardSession(profileId, sessionId);
    const aborted = await prisma.workoutSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(aborted.status).toBe("ABORTED");

    const history = await listCompletedSessions(profileId);
    expect(history.some((s) => s.id === sessionId)).toBe(false);
  });

  it("una sesión finalizada alimenta 'última vez' de una sesión posterior", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const a = await session.startOrResumeSession(profileId, template.id);
    const weA = await prisma.workoutExercise.findFirstOrThrow({
      where: { sessionId: a.sessionId },
      orderBy: { ordinal: "asc" },
    });
    await session.logSet(profileId, {
      workoutExerciseId: weA.id,
      setNumber: 1,
      setType: "WORKING",
      weightKg: 45,
      reps: 10,
      rir: 2,
    });
    await session.finishSession(
      profileId,
      a.sessionId,
      {},
      new Date("2026-07-14T12:30:00Z"),
    );

    const b = await session.startOrResumeSession(
      profileId,
      template.id,
      new Date("2026-07-16T11:00:00Z"),
    );
    const exec = await getExecutionSession(profileId, b.sessionId);
    const sameVariant = exec?.exercises.find(
      (e) => e.variantId === weA.exerciseVariantId,
    );
    expect(sameVariant?.lastTime?.sets.length ?? 0).toBeGreaterThan(0);
    expect(sameVariant?.lastTime?.sets[0].weightKg).toBe(45);
  });
});

describe("edición del programa no reescribe el historial", () => {
  it("editar la plantilla NO cambia el snapshot de una sesión ya guardada", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    const te = template.exercises[0];
    const { sessionId } = await session.startOrResumeSession(
      profileId,
      template.id,
    );
    const weBefore = await prisma.workoutExercise.findFirstOrThrow({
      where: { sessionId, exerciseVariantId: te.exerciseVariantId },
    });
    await session.finishSession(
      profileId,
      sessionId,
      {},
      new Date("2026-07-14T13:00:00Z"),
    );

    await programEdit.editTemplateExercise(profileId, te.id, {
      baseSets: te.baseSets + 2,
      repRangeMin: 6,
      repRangeMax: 10,
      targetRir: 1,
      restSeconds: 180,
    });

    // La plantilla cambió…
    const teAfter = await prisma.templateExercise.findUniqueOrThrow({
      where: { id: te.id },
    });
    expect(teAfter.baseSets).toBe(te.baseSets + 2);
    // …pero el snapshot de la sesión finalizada permanece intacto.
    const weAfter = await prisma.workoutExercise.findUniqueOrThrow({
      where: { id: weBefore.id },
    });
    expect(weAfter.plannedSets).toBe(weBefore.plannedSets);
    expect(weAfter.repRangeMin).toBe(weBefore.repRangeMin);
    expect(weAfter.restSeconds).toBe(weBefore.restSeconds);
  });

  it("reordenar intercambia los ordinales de dos ejercicios adyacentes", async () => {
    const template = await firstTemplate();
    if (template.exercises.length < 2) return;
    const [first, second] = template.exercises;
    await programEdit.reorderTemplateExercise(profileId, first.id, "down");
    const a = await prisma.templateExercise.findUniqueOrThrow({
      where: { id: first.id },
    });
    const b = await prisma.templateExercise.findUniqueOrThrow({
      where: { id: second.id },
    });
    expect(a.ordinal).toBe(second.ordinal);
    expect(b.ordinal).toBe(first.ordinal);
    // Restaurar el orden para no afectar a otros tests.
    await programEdit.reorderTemplateExercise(profileId, first.id, "up");
  });

  it("restaurar el plan inicial regenera las plantillas desde el onboarding guardado", async () => {
    await cleanupSessions();
    const template = await firstTemplate();
    // Ensuciamos: quitamos un ejercicio.
    await programEdit.removeTemplateExercise(
      profileId,
      template.exercises[0].id,
    );
    const afterRemove = await prisma.templateExercise.count({
      where: { templateId: template.id },
    });
    expect(afterRemove).toBe(template.exercises.length - 1);

    await programEdit.restoreInitialProgram(
      profileId,
      new Date("2026-07-17T10:00:00Z"),
    );

    const program = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
      include: {
        mesocycles: {
          orderBy: { ordinal: "asc" },
          include: {
            templates: {
              where: { deletedAt: null },
              include: { exercises: true },
            },
          },
        },
      },
    });
    const templates = program.mesocycles[0].templates;
    expect(templates).toHaveLength(ONBOARDING.daysPerWeek);
    expect(templates.every((t) => t.exercises.length > 0)).toBe(true);
  });

  it("restaurar con una sesión ya guardada conserva el historial y no colisiona ordinales", async () => {
    await cleanupSessions();
    // Una plantilla activa cualquiera (los ids iniciales pueden haberse
    // regenerado en el test anterior).
    const template = await prisma.workoutTemplate.findFirstOrThrow({
      where: {
        deletedAt: null,
        mesocycle: { program: { profileId, isActive: true } },
      },
      orderBy: { ordinal: "asc" },
      include: { exercises: { orderBy: { ordinal: "asc" } } },
    });
    // Sesión completada sobre esta plantilla → debe conservarse (soft-delete).
    const { sessionId } = await session.startOrResumeSession(
      profileId,
      template.id,
    );
    await session.finishSession(
      profileId,
      sessionId,
      {},
      new Date("2026-07-18T09:00:00Z"),
    );

    // No debe lanzar por @@unique([mesocycleId, ordinal]) al recrear el plan.
    await programEdit.restoreInitialProgram(
      profileId,
      new Date("2026-07-18T10:00:00Z"),
    );

    // La plantilla con historial sigue existiendo (borrada) y la sesión intacta.
    const archived = await prisma.workoutTemplate.findUniqueOrThrow({
      where: { id: template.id },
    });
    expect(archived.deletedAt).not.toBeNull();
    const kept = await prisma.workoutSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(kept.status).toBe("COMPLETED");

    // El plan activo se regeneró completo con ordinales 1..N sin conflicto.
    const active = await prisma.workoutTemplate.findMany({
      where: {
        mesocycleId: archived.mesocycleId,
        deletedAt: null,
      },
      orderBy: { ordinal: "asc" },
    });
    expect(active).toHaveLength(ONBOARDING.daysPerWeek);
    expect(active.map((t) => t.ordinal)).toEqual(
      Array.from({ length: ONBOARDING.daysPerWeek }, (_, i) => i + 1),
    );
  });
});
