import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { addDays } from "@/core/dates";
import { onboardingSchema } from "@/core/schemas/onboarding";
import { cycleStartSchema } from "@/core/schemas/cycle";

import { createTestDatabase } from "./helpers/test-db";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";
import { createTestUser } from "./helpers/users";

/**
 * Flujo completo de ciclos contra PostgreSQL real (docs/CYCLES.md §6):
 *
 *   1. Usuario con 4 meses de definición (pesajes, objetivo, entrenamientos).
 *   2. Consulta el resumen al finalizar.
 *   3. Confirma sus datos y elige volumen limpio.
 *   4. Recibe calorías y macros con el mantenimiento APRENDIDO.
 *   5. Confirma: transición atómica, idempotente, sin perder historial.
 *   6. Sigue registrando; el ajuste adaptativo vigila la fase nueva.
 *   7. Cierra sin empezar otro, y vuelve a empezar más tarde.
 *
 * Más los casos de error: doble envío, petición obsoleta, dos envíos a la vez,
 * ciclo de otra persona, dos ciclos activos y usuarios antiguos.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const body = await import("@/server/services/body.service");
const cycles = await import("@/server/services/cycle.service");
const intake = await import("@/server/services/intake.service");
const adjustment =
  await import("@/server/services/nutrition-adjustment.service");
const { getWeeklyVolume } =
  await import("@/server/repositories/weekly-volume.repo");

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

await runSeed(prisma);

const CUT_START = "2026-06-01";
const CUT_DAYS = 120;
const HOY = addDays(CUT_START, CUT_DAYS);
const at = (localDate: string) => new Date(`${localDate}T10:00:00Z`);

const BASE = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  waistCm: 94,
  trainingYears: 3,
  daysPerWeek: 4,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
  strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
  weeklyRatePct: -0.5,
  targetWeightKg: 78,
  dailySteps: 8500,
  workActivity: "SEDENTARY",
  balancedProgram: true,
  priorityMuscles: [],
  contraindications: [],
  excludedExerciseNames: [],
} as const;

const noise = (i: number) =>
  0.35 * Math.sin(i * 1.7) + 0.15 * Math.cos(i * 0.9);

/** Cuatro meses de definición: −0,42 kg/sem, pesaje diario y entreno 2×/sem. */
async function usuarioConDefinicion(username: string) {
  const userId = await createTestUser(prisma, username);
  const { profileId, programId } = await completeOnboarding(
    userId,
    onboardingSchema.parse(BASE),
    at(CUT_START),
  );
  for (let i = 1; i < CUT_DAYS; i++) {
    const w = 84 - (0.42 / 7) * i + noise(i);
    await body.saveWeight(
      profileId,
      { localDate: addDays(CUT_START, i), weightKg: Math.round(w * 10) / 10 },
      at(HOY),
    );
  }
  // Fuerza que sube un poco a lo largo de la definición.
  const meso = await prisma.mesocycle.findFirstOrThrow({
    where: { programId },
    include: { templates: { include: { exercises: true } } },
  });
  const variantId = meso.templates[0].exercises[0].exerciseVariantId;
  for (let i = 3; i < CUT_DAYS; i += 4) {
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: meso.id,
      variantId,
      localDate: addDays(CUT_START, i),
      sets: [
        {
          setNumber: 1,
          weightKg: 80 + Math.floor(i / 30) * 2.5,
          reps: 8,
          rir: 2,
        },
        {
          setNumber: 2,
          weightKg: 80 + Math.floor(i / 30) * 2.5,
          reps: 8,
          rir: 1,
        },
      ],
    });
  }
  return { profileId, programId };
}

async function counts(profileId: string) {
  const [measurements, sets, goals, targets, estimates, decisions] =
    await Promise.all([
      prisma.bodyMeasurement.count({ where: { profileId } }),
      prisma.setLog.count({
        where: {
          workoutExercise: {
            session: { mesocycle: { program: { profileId } } },
          },
        },
      }),
      prisma.goal.count({ where: { profileId } }),
      prisma.nutritionTarget.count({ where: { profileId } }),
      prisma.energyEstimate.count({ where: { profileId } }),
      prisma.recommendation.count({ where: { profileId } }),
    ]);
  return { measurements, sets, goals, targets, estimates, decisions };
}

const lean = (
  extra: Partial<Parameters<typeof cycleStartSchema.parse>[0]> = {},
) => ({
  strategy: "LEAN_GAIN" as const,
  weeklyRatePct: 0.15,
  targetWeightKg: null,
  weightKg: 77.1,
  waistCm: null,
  dailySteps: 9000,
  workActivity: "SEDENTARY" as const,
  bodyFatCeilingPct: 15,
  ...extra,
});

describe("de definición a volumen limpio", () => {
  let profileId: string;
  let programId: string;
  let cutGoalId: string;
  let before: Awaited<ReturnType<typeof counts>>;

  it("1–2. el resumen al finalizar describe la definición con sus números", async () => {
    ({ profileId, programId } = await usuarioConDefinicion("ciclos-ana"));
    const preview = await cycles.getClosePreview(profileId, at(HOY));
    expect(preview).not.toBeNull();
    cutGoalId = preview!.goalId;
    const s = preview!.summary;
    expect(s.startLocalDate).toBe(CUT_START);
    expect(s.endLocalDate).toBe(HOY);
    expect(s.weight.changeKg!).toBeLessThan(-6);
    expect(s.weight.ratePerWeekKg!).toBeCloseTo(-0.42, 1);
    expect(s.nutrition.periods[0].kcal).toBeGreaterThan(1500);
    expect(s.performance!.comparedVariants).toBe(1);
    expect(s.performance!.improved).toBe(1);
    // Mantenimiento OBSERVADO: objetivo + ~460 kcal de déficit medido.
    const m = preview!.maintenance;
    expect(m.observed).not.toBeNull();
    expect(m.observed!.intakeSource).toBe("TARGET_PROXY");
    expect(m.observed!.tdeeKcal).toBeGreaterThan(
      s.nutrition.periods[0].kcal + 350,
    );
    expect(m.explanation).toContain("se asume que lo cumpliste");
    // Mantenimiento provisional, por si cierra sin empezar otro.
    expect(preview!.interim.kcal).toBe(m.tdeeKcal);
  });

  it("3–4. la propuesta de volumen usa el mantenimiento aprendido y lo explica", async () => {
    const preview = await cycles.previewCyclePlan(profileId, lean(), at(HOY));
    expect(preview.closingMaintenance).not.toBeNull();
    expect(preview.maintenance.basis).toBe("PRIOR");
    expect(preview.plan.energyDeltaKcal).toBeGreaterThan(75);
    expect(preview.plan.energyDeltaKcal).toBeLessThan(175);
    expect(preview.plan.kcal).toBeGreaterThan(preview.plan.maintenanceKcal);
    expect(preview.plan.explanation.expectations.join(" ")).toContain(
      "glucógeno",
    );
    expect(preview.volumeNote).toContain("15 %");
    // Previsualizar NO escribe.
    before = await counts(profileId);
    expect(before.goals).toBe(1);
  });

  it("5. confirmar: transición atómica, historial intacto, programa intacto", async () => {
    const preview = await cycles.previewCyclePlan(profileId, lean(), at(HOY));
    const requestId = randomUUID();
    const result = await cycles.startCycle(
      profileId,
      cycleStartSchema.parse({
        ...lean(),
        requestId,
        expectedActiveGoalId: cutGoalId,
        closeOutcome: "COMPLETED",
        expectedKcal: preview.plan.kcal,
      }),
      at(HOY),
    );
    expect(result.duplicate).toBe(false);

    const old = await prisma.goal.findUniqueOrThrow({
      where: { id: cutGoalId },
    });
    expect(old.status).toBe("COMPLETED");
    expect(old.endDate).toBe(addDays(HOY, -1));
    expect(old.closingSummary).not.toBeNull();

    const neu = await prisma.goal.findUniqueOrThrow({
      where: { id: result.goalId },
    });
    expect(neu.status).toBe("ACTIVE");
    expect(neu.strategy).toBe("LEAN_GAIN");
    expect(neu.startDate).toBe(HOY);
    expect(neu.openRequestId).toBe(requestId);

    // Objetivo calórico nuevo, trazable 1:1 hasta su decisión.
    const target = await prisma.nutritionTarget.findUniqueOrThrow({
      where: { profileId_effectiveFrom: { profileId, effectiveFrom: HOY } },
      include: { recommendation: { include: { decision: true } } },
    });
    expect(target.kcal).toBe(preview.plan.kcal);
    expect(target.source).toBe("CYCLE_START");
    expect(target.recommendation!.type).toBe("CYCLE_TARGETS");
    expect(target.recommendation!.decision.ruleId).toBe("CYCLE_TRANSITION");

    // Memoria metabólica: se congela el cierre y el arranque.
    const estimates = await prisma.energyEstimate.findMany({
      where: { profileId },
      orderBy: { kind: "asc" },
    });
    expect(estimates.map((e) => e.kind).sort()).toEqual([
      "CYCLE_CLOSE",
      "CYCLE_START",
    ]);
    const close = estimates.find((e) => e.kind === "CYCLE_CLOSE")!;
    expect(close.goalId).toBe(cutGoalId);
    expect(close.memoryTdeeKcal).not.toBeNull();
    expect(close.fromDeficit).toBe(true);

    // Nada del historial se ha perdido; el programa sigue activo y es el mismo.
    const after = await counts(profileId);
    expect(after.sets).toBe(before.sets);
    expect(after.measurements).toBe(before.measurements + 1); // el peso confirmado hoy
    expect(after.goals).toBe(2);
    const program = await prisma.trainingProgram.findUniqueOrThrow({
      where: { id: programId },
    });
    expect(program.isActive).toBe(true);

    // Preferencia de % graso guardada (solo orienta).
    const pref = await prisma.userPreference.findUnique({
      where: { profileId_key: { profileId, key: "body_fat_ceiling_pct" } },
    });
    expect(pref?.value).toBe(15);
  });

  it("doble envío con el mismo requestId: devuelve el mismo ciclo, no crea otro", async () => {
    const goal = await prisma.goal.findFirstOrThrow({
      where: { profileId, status: "ACTIVE" },
    });
    const before2 = await counts(profileId);
    const again = await cycles.startCycle(
      profileId,
      cycleStartSchema.parse({
        ...lean(),
        requestId: goal.openRequestId!,
        expectedActiveGoalId: cutGoalId,
        closeOutcome: "COMPLETED",
        expectedKcal: 2000,
      }),
      at(HOY),
    );
    expect(again).toMatchObject({ goalId: goal.id, duplicate: true });
    expect(await counts(profileId)).toEqual(before2);
  });

  it("petición obsoleta (el activo ya no es el que vio) o plan cambiado: no escribe nada", async () => {
    const before2 = await counts(profileId);
    await expect(
      cycles.startCycle(
        profileId,
        cycleStartSchema.parse({
          ...lean(),
          requestId: randomUUID(),
          expectedActiveGoalId: cutGoalId, // ya cerrado
          closeOutcome: "COMPLETED",
          expectedKcal: 2800,
        }),
        at(HOY),
      ),
    ).rejects.toBeInstanceOf(cycles.StaleCycleError);

    const active = await prisma.goal.findFirstOrThrow({
      where: { profileId, status: "ACTIVE" },
    });
    await expect(
      cycles.startCycle(
        profileId,
        cycleStartSchema.parse({
          ...lean({ strategy: "MAINTENANCE", weeklyRatePct: 0 }),
          requestId: randomUUID(),
          expectedActiveGoalId: active.id,
          closeOutcome: "ABANDONED",
          expectedKcal: 999,
        }),
        at(HOY),
      ),
    ).rejects.toBeInstanceOf(cycles.StalePlanError);
    expect(await counts(profileId)).toEqual(before2);
  });

  it("6. sigue registrando: el ajuste vigila la fase nueva sin usar el relleno de glucógeno", async () => {
    // Dos meses más: +1,4 kg de glucógeno los primeros 10 días y +0,12 kg/sem.
    let w = 77.1;
    const after60 = addDays(HOY, 60);
    for (let i = 1; i <= 60; i++) {
      w += 0.12 / 7;
      const glyco = 1.4 * Math.min(i / 10, 1);
      await body.saveWeight(
        profileId,
        {
          localDate: addDays(HOY, i),
          weightKg: Math.round((w + glyco + noise(i + 200)) * 10) / 10,
        },
        at(after60),
      );
      // Registra lo que come la mitad de los días (opcional).
      if (i % 2 === 0) {
        await intake.saveIntake(
          profileId,
          { localDate: addDays(HOY, i), kcal: 2700, proteinG: 140 },
          at(after60),
        );
      }
    }
    const r = await adjustment.getCalorieAdjustment(profileId, at(after60));
    expect(r!.policy).toBe("GAIN");
    // Salir de un déficit: estabilización de 21 días.
    expect(r!.trackingStartLocalDate).toBe(addDays(HOY, 21));
    expect(r!.action).toBe("HOLD");
    expect(["ON_TRACK", "UNCONFIRMED_SLOW", "UNCONFIRMED_FAST"]).toContain(
      r!.reasonCode,
    );

    const overview = await cycles.getCycleOverview(profileId, at(after60), {
      adjustment: r,
    });
    expect(overview.active!.strategy).toBe("LEAN_GAIN");
    expect(overview.active!.week).toBe(9);
    expect(overview.composition!.level).toBe("NONE");
    expect(overview.intake.last14.days).toBe(7);
    // Con registro escaso (50 % de los días) el gasto aún se estima con el objetivo.
    expect(overview.maintenance.observed?.intakeSource ?? "TARGET_PROXY").toBe(
      "TARGET_PROXY",
    );
  });

  it("historial: dos ciclos, el cerrado con su resumen congelado", async () => {
    const h = await cycles.getCycleHistory(profileId, at(addDays(HOY, 60)));
    expect(h.items).toHaveLength(2);
    expect(h.items[0].active).toBe(true);
    expect(h.items[1].strategy).toBe("FAT_LOSS_MUSCLE_PRESERVATION");
    expect(h.items[1].computedNow).toBe(false);
    expect(h.items[1].summary!.weight.changeKg!).toBeLessThan(-6);
    expect(h.estimates.length).toBeGreaterThanOrEqual(2);
  });

  it("7. cerrar sin empezar otro deja un estado seguro, y se puede volver a empezar", async () => {
    const day = addDays(HOY, 61);
    const active = await prisma.goal.findFirstOrThrow({
      where: { profileId, status: "ACTIVE" },
    });
    const preview = await cycles.getClosePreview(profileId, at(day));
    const res = await cycles.closeCycle(
      profileId,
      {
        goalId: active.id,
        outcome: "ABANDONED",
        interimNutrition: "MAINTENANCE",
        expectedKcal: preview!.interim.kcal,
      },
      at(day),
    );
    expect(res.alreadyClosed).toBe(false);
    // Cerrar dos veces es idempotente.
    expect(
      (
        await cycles.closeCycle(
          profileId,
          {
            goalId: active.id,
            outcome: "ABANDONED",
            interimNutrition: "KEEP",
            expectedKcal: null,
          },
          at(day),
        )
      ).alreadyClosed,
    ).toBe(true);

    const overview = await cycles.getCycleOverview(profileId, at(day));
    expect(overview.active).toBeNull();
    expect(overview.lastClosed!.status).toBe("ABANDONED");
    expect(overview.target!.kcal).toBe(preview!.interim.kcal);
    const adj = await adjustment.getCalorieAdjustment(profileId, at(day));
    expect(adj!.reasonCode).toBe("NOT_APPLICABLE_GOAL");
    // El contador de volumen usa el listón de mantenimiento sin ciclo activo.
    expect(await getWeeklyVolume(profileId, day)).not.toBeNull();

    // Más tarde, empieza un mantenimiento sin ciclo que cerrar.
    const later = addDays(day, 10);
    const req = lean({
      strategy: "MAINTENANCE",
      weeklyRatePct: 0,
      bodyFatCeilingPct: null,
      weightKg: null,
    });
    const plan = await cycles.previewCyclePlan(profileId, req, at(later));
    const started = await cycles.startCycle(
      profileId,
      cycleStartSchema.parse({
        ...req,
        requestId: randomUUID(),
        expectedActiveGoalId: null,
        closeOutcome: null,
        expectedKcal: plan.plan.kcal,
      }),
      at(later),
    );
    const g = await prisma.goal.findUniqueOrThrow({
      where: { id: started.goalId },
    });
    expect(g.strategy).toBe("MAINTENANCE");
    expect(await prisma.goal.count({ where: { profileId } })).toBe(3);
    expect(
      await prisma.userPreference.findUnique({
        where: { profileId_key: { profileId, key: "body_fat_ceiling_pct" } },
      }),
    ).toBeNull();
  });
});

describe("garantías", () => {
  it("la base de datos impide dos ciclos activos por perfil", async () => {
    const { profileId } = await usuarioConDefinicion("ciclos-dos-activos");
    await expect(
      prisma.goal.create({
        data: {
          profileId,
          strategy: "MAINTENANCE",
          type: "MAINTENANCE",
          status: "ACTIVE",
          startDate: HOY,
          startWeightKg: 77,
          weeklyRatePct: 0,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("dos envíos a la vez con requestId distinto: uno gana y el otro no deja nada a medias", async () => {
    const { profileId } = await usuarioConDefinicion("ciclos-carrera");
    const active = await prisma.goal.findFirstOrThrow({
      where: { profileId, status: "ACTIVE" },
    });
    const plan = await cycles.previewCyclePlan(profileId, lean(), at(HOY));
    const send = () =>
      cycles.startCycle(
        profileId,
        cycleStartSchema.parse({
          ...lean(),
          requestId: randomUUID(),
          expectedActiveGoalId: active.id,
          closeOutcome: "COMPLETED",
          expectedKcal: plan.plan.kcal,
        }),
        at(HOY),
      );
    const results = await Promise.allSettled([send(), send()]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const ko = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect((ko[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      cycles.StaleCycleError,
    );
    expect(
      await prisma.goal.count({ where: { profileId, status: "ACTIVE" } }),
    ).toBe(1);
    expect(await prisma.goal.count({ where: { profileId } })).toBe(2);
    expect(
      await prisma.energyEstimate.count({
        where: { profileId, kind: "CYCLE_START" },
      }),
    ).toBe(1);
    expect(
      await prisma.recommendation.count({
        where: { profileId, type: "CYCLE_TARGETS" },
      }),
    ).toBe(1);
  });

  it("no se puede cerrar el ciclo de otra persona (mismo error que si no existiera)", async () => {
    const a = await usuarioConDefinicion("ciclos-dueno");
    const b = await usuarioConDefinicion("ciclos-intruso");
    const goalA = await prisma.goal.findFirstOrThrow({
      where: { profileId: a.profileId, status: "ACTIVE" },
    });
    await expect(
      cycles.closeCycle(
        b.profileId,
        {
          goalId: goalA.id,
          outcome: "COMPLETED",
          interimNutrition: "KEEP",
          expectedKcal: null,
        },
        at(HOY),
      ),
    ).rejects.toBeInstanceOf(cycles.CycleNotFoundError);
    expect(
      (await prisma.goal.findUniqueOrThrow({ where: { id: goalA.id } })).status,
    ).toBe("ACTIVE");
  });

  it("usuarios antiguos: ciclos cerrados sin fecha de fin se leen con la del siguiente", async () => {
    const { profileId } = await usuarioConDefinicion("ciclos-antiguo");
    const current = await prisma.goal.findFirstOrThrow({
      where: { profileId, status: "ACTIVE" },
    });
    // Como lo dejaba la versión anterior: SUPERSEDED, sin endDate ni resumen.
    await prisma.goal.update({
      where: { id: current.id },
      data: { status: "SUPERSEDED" },
    });
    await prisma.goal.create({
      data: {
        profileId,
        strategy: "MAINTENANCE",
        type: "MAINTENANCE",
        status: "ACTIVE",
        startDate: addDays(CUT_START, 90),
        startWeightKg: 79,
        weeklyRatePct: 0,
      },
    });
    const h = await cycles.getCycleHistory(profileId, at(HOY));
    expect(h.items).toHaveLength(2);
    expect(h.items[1].endDate).toBe(addDays(CUT_START, 89));
    expect(h.items[1].computedNow).toBe(true);
    expect(h.items[1].summary!.days).toBe(90);
    const overview = await cycles.getCycleOverview(profileId, at(HOY));
    expect(overview.active!.strategy).toBe("MAINTENANCE");
  });

  it("registro de ingesta: no admite días futuros y se corrige sin duplicar", async () => {
    const { profileId } = await usuarioConDefinicion("ciclos-ingesta");
    await expect(
      intake.saveIntake(
        profileId,
        { localDate: addDays(HOY, 1), kcal: 2000, proteinG: null },
        at(HOY),
      ),
    ).rejects.toBeInstanceOf(intake.FutureIntakeError);
    await intake.saveIntake(
      profileId,
      { localDate: HOY, kcal: 2000, proteinG: 150 },
      at(HOY),
    );
    await intake.saveIntake(
      profileId,
      { localDate: HOY, kcal: 2100, proteinG: 160 },
      at(HOY),
    );
    const rows = await prisma.dailyCheckIn.findMany({ where: { profileId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kcal: 2100,
      proteinG: 160,
      weightKg: null,
    });
    await intake.clearIntake(profileId, HOY, at(HOY));
    expect(
      (await prisma.dailyCheckIn.findFirstOrThrow({ where: { profileId } }))
        .kcal,
    ).toBeNull();
  });
});
