import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bodyCheckInSchema } from "@/core/schemas/body-measurement";
import { goalUpdateSchema } from "@/core/schemas/goal-update";
import { onboardingSchema } from "@/core/schemas/onboarding";
import { addDays } from "@/core/dates";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";

/**
 * B4 contra base de datos real: check-in con protocolo de tres tomas, y
 * objetivo editable con la distinción entre corregir la fase actual y empezar
 * una nueva.
 *
 * La invariante que más se vigila aquí: abrir una fase nueva NO puede borrar
 * nada, y la tendencia de la fase nueva NO puede alimentarse de la anterior.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const body = await import("@/server/services/body.service");

const HOY = "2026-09-01";
const AHORA = new Date(`${HOY}T10:00:00Z`);

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

/** Perfil con el onboarding hecho hace `diasAtras` días. */
async function nuevoPerfil(username: string, diasAtras = 90): Promise<string> {
  const userId = await createTestUser(prisma, username);
  const { profileId } = await completeOnboarding(
    userId,
    onboardingSchema.parse(BASE),
    new Date(`${addDays(HOY, -diasAtras)}T10:00:00Z`),
  );
  return profileId;
}

/** Pesajes diarios bajando ~0,42 kg/semana durante `dias` días. */
async function sembrarPesajes(profileId: string, dias: number, desde = 84) {
  for (let i = dias - 1; i >= 0; i--) {
    await body.saveWeight(
      profileId,
      { localDate: addDays(HOY, -i), weightKg: desde - 0.06 * (dias - 1 - i) },
      AHORA,
    );
  }
}

const checkIn = (fields: Record<string, unknown>) =>
  bodyCheckInSchema.parse({ localDate: HOY, ...fields });

beforeAll(async () => {
  await runSeed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("cadencia sobre datos reales", () => {
  it("un perfil antiguo cuya única cintura es la del onboarding está vencido", async () => {
    const profileId = await nuevoPerfil("antiguo");
    const { checkIn: estado } = await body.getBodyProgress(profileId, AHORA);
    expect(estado.status).toBe("DUE");
    expect(estado.lastLocalDate).toBe(addDays(HOY, -90));
    // Y esa medición es de UNA toma: el onboarding no pide tres.
    expect(estado.lastProtocol).toBeNull();
  });

  it("tras el primer check-in ya no toca, y el protocolo queda registrado", async () => {
    const profileId = await nuevoPerfil("primero");
    await body.submitCheckIn(
      profileId,
      checkIn({ waist1: 92, waist2: 92.5, waist3: 92.2 }),
      AHORA,
    );
    const { checkIn: estado } = await body.getBodyProgress(profileId, AHORA);
    expect(estado.status).toBe("NOT_DUE");
    expect(estado.lastLocalDate).toBe(HOY);
    expect(estado.lastProtocol).toBe("MEAN_OF_THREE");
    expect(estado.daysUntilDue).toBe(14);
  });
});

describe("protocolo de tres tomas", () => {
  it("guarda la MEDIA de las tres, con un decimal", async () => {
    const profileId = await nuevoPerfil("media");
    const guardada = await body.submitCheckIn(
      profileId,
      checkIn({ waist1: 92, waist2: 92.5, waist3: 92.2 }),
      AHORA,
    );
    // (92 + 92,5 + 92,2) / 3 = 92,2333… → 92,2. Guardar 92,23333 sería falsa
    // precisión: la cinta no da eso.
    expect(guardada.waistCm).toBe(92.2);
    expect(guardada.waistProtocol).toBe("MEAN_OF_THREE");
  });

  it("rechaza tres tomas absurdamente discrepantes en vez de promediarlas", async () => {
    // 88, 92 y 99 no son tres medidas del mismo sitio. Promediarlas daría un
    // número que no representa nada.
    const parsed = bodyCheckInSchema.safeParse({
      localDate: HOY,
      waist1: 88,
      waist2: 92,
      waist3: 99,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(
        /mismo sitio|se diferencian/,
      );
    }
  });

  it("rechaza una sola toma: con una no se puede fingir el protocolo", async () => {
    const parsed = bodyCheckInSchema.safeParse({
      localDate: HOY,
      waist1: 92,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/tres veces/);
    }
  });

  it("editar la cintura a mano desde el historial NO la marca como tres tomas", async () => {
    // La marca autoriza al motor a usar el umbral fino. Solo puede ponerla el
    // formulario que de verdad pidió las tres medidas.
    const profileId = await nuevoPerfil("mano");
    const { saveMeasurement } = body;
    const { bodyMeasurementSchema } =
      await import("@/core/schemas/body-measurement");
    const guardada = await saveMeasurement(
      profileId,
      bodyMeasurementSchema.parse({ localDate: HOY, waistCm: 91 }),
      AHORA,
    );
    expect(guardada.waistCm).toBe(91);
    expect(guardada.waistProtocol).toBeNull();
  });

  it("el check-in escribe solo lo que enseña: no borra el peso del día", async () => {
    const profileId = await nuevoPerfil("no-borra");
    await body.saveWeight(profileId, { localDate: HOY, weightKg: 82.4 }, AHORA);

    const tras = await body.submitCheckIn(
      profileId,
      checkIn({ waist1: 90, waist2: 90.5, waist3: 90.1 }),
      AHORA,
    );
    expect(tras.weightKg).toBe(82.4);
    expect(tras.waistCm).toBe(90.2);
  });

  it("el % graso es opcional y no se inventa procedencia", async () => {
    const profileId = await nuevoPerfil("sin-grasa");
    const tras = await body.submitCheckIn(
      profileId,
      checkIn({ waist1: 90, waist2: 90.5, waist3: 90.1 }),
      AHORA,
    );
    expect(tras.bodyFatPct).toBeNull();
    expect(tras.bodyFatReliability).toBeNull();
  });
});

describe("objetivo: corregir la fase actual", () => {
  it("cambiar solo el peso objetivo NO abre una fase nueva ni mueve startDate", async () => {
    const profileId = await nuevoPerfil("solo-target");
    const antes = await body.getGoalForEdit(profileId);

    const r = await body.updateGoal(
      profileId,
      goalUpdateSchema.parse({
        strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
        weeklyRatePct: -0.5,
        targetWeightKg: 77,
      }),
      AHORA,
    );

    expect(r.kind).toBe("EDIT_IN_PLACE");
    expect(r.startDate).toBe(antes!.startDate);
    // Una sola fila de objetivo: no se ha abierto ninguna fase.
    expect(await prisma.goal.count({ where: { profileId } })).toBe(1);
    const despues = await body.getGoalForEdit(profileId);
    expect(despues!.targetWeightKg).toBe(77);
  });

  it("cambiar solo el ritmo tampoco abre fase nueva", async () => {
    const profileId = await nuevoPerfil("solo-ritmo");
    const antes = await body.getGoalForEdit(profileId);

    const r = await body.updateGoal(
      profileId,
      goalUpdateSchema.parse({
        strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
        weeklyRatePct: -0.75,
        targetWeightKg: 78,
      }),
      AHORA,
    );

    expect(r.kind).toBe("EDIT_IN_PLACE");
    expect(r.startDate).toBe(antes!.startDate);
    expect(await prisma.goal.count({ where: { profileId } })).toBe(1);
    expect((await body.getGoalForEdit(profileId))!.weeklyRatePct).toBe(-0.75);
  });

  it("no cambiar nada no toca la base de datos", async () => {
    const profileId = await nuevoPerfil("sin-cambio");
    const antes = await prisma.goal.findFirstOrThrow({ where: { profileId } });
    const r = await body.updateGoal(
      profileId,
      goalUpdateSchema.parse({
        strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
        weeklyRatePct: -0.5,
        targetWeightKg: 78,
      }),
      AHORA,
    );
    expect(r.kind).toBe("NO_CHANGE");
    const despues = await prisma.goal.findFirstOrThrow({
      where: { profileId },
    });
    expect(despues.updatedAt).toEqual(antes.updatedAt);
  });
});

describe("objetivo: empezar una fase nueva", () => {
  it("FAT_LOSS → MAINTENANCE cierra la fase y abre otra hoy, sin borrar nada", async () => {
    const profileId = await nuevoPerfil("a-mantener", 40);
    await sembrarPesajes(profileId, 40);
    const medicionesAntes = await prisma.bodyMeasurement.count({
      where: { profileId },
    });

    const r = await body.updateGoal(
      profileId,
      goalUpdateSchema.parse({
        strategy: "MAINTENANCE",
        weeklyRatePct: 0,
        targetWeightKg: null,
      }),
      AHORA,
    );

    expect(r.kind).toBe("NEW_PHASE");
    expect(r.startDate).toBe(HOY);

    // Dos filas de objetivo: la anterior cerrada, la nueva activa.
    const objetivos = await prisma.goal.findMany({
      where: { profileId },
      orderBy: { createdAt: "asc" },
    });
    expect(objetivos).toHaveLength(2);
    expect(objetivos[0].status).toBe("SUPERSEDED");
    expect(objetivos[1].status).toBe("ACTIVE");
    expect(objetivos[1].startDate).toBe(HOY);
    // El peso con el que arranca la fase es el actual, no el del onboarding.
    expect(objetivos[1].startWeightKg).toBeLessThan(objetivos[0].startWeightKg);

    // NADA se ha borrado.
    expect(await prisma.bodyMeasurement.count({ where: { profileId } })).toBe(
      medicionesAntes,
    );
  });

  it("FAT_LOSS → LEAN_GAIN también abre fase nueva", async () => {
    const profileId = await nuevoPerfil("a-volumen", 40);
    const r = await body.updateGoal(
      profileId,
      goalUpdateSchema.parse({
        strategy: "LEAN_GAIN",
        weeklyRatePct: 0.15,
        targetWeightKg: null,
      }),
      AHORA,
    );
    expect(r.kind).toBe("NEW_PHASE");
    const activo = await prisma.goal.findFirstOrThrow({
      where: { profileId, status: "ACTIVE" },
    });
    expect(activo.type).toBe("LEAN_GAIN");
    expect(activo.strategy).toBe("LEAN_GAIN");
  });

  it("LA INVARIANTE: la fase nueva NO evalúa su tendencia con datos anteriores", async () => {
    const profileId = await nuevoPerfil("fase-limpia", 40);
    await sembrarPesajes(profileId, 40);

    // Antes del cambio: 40 días bajando, tendencia clarísima.
    const antes = await body.getBodyProgress(profileId, AHORA);
    expect(antes.analysis.weight.status).toBe("LOSING");
    expect(antes.analysis.weight.measurementsInWindow).toBeGreaterThan(20);

    await body.updateGoal(
      profileId,
      goalUpdateSchema.parse({
        strategy: "LEAN_GAIN",
        weeklyRatePct: 0.15,
        targetWeightKg: null,
      }),
      AHORA,
    );

    const despues = await body.getBodyProgress(profileId, AHORA);
    // La fase empezó hoy: solo el pesaje de hoy entra en el análisis, así que
    // no hay tendencia. Decir "estás bajando" del volumen que acaba de
    // empezar sería exactamente la contaminación que esto evita.
    expect(despues.analysis.weight.status).toBe("INSUFFICIENT_DATA");
    expect(despues.analysis.weight.trend).toBeNull();
    expect(despues.phaseStartLocalDate).toBe(HOY);

    // Pero el HISTORIAL y el GRÁFICO siguen enteros: acotar lo que se afirma
    // no es borrar lo que se ve.
    expect(despues.history).toHaveLength(antes.history.length);
    expect(despues.chartSeries.length).toBe(antes.chartSeries.length);
    expect(despues.chartSeries.length).toBeGreaterThan(20);
  });

  it("corregir el objetivo, en cambio, deja la tendencia intacta", async () => {
    const profileId = await nuevoPerfil("edicion-limpia", 40);
    await sembrarPesajes(profileId, 40);
    const antes = await body.getBodyProgress(profileId, AHORA);

    await body.updateGoal(
      profileId,
      goalUpdateSchema.parse({
        strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
        weeklyRatePct: -0.5,
        targetWeightKg: 76,
      }),
      AHORA,
    );

    const despues = await body.getBodyProgress(profileId, AHORA);
    expect(despues.analysis.weight.status).toBe("LOSING");
    expect(despues.analysis.weight.trend!.slopePerWeek).toBeCloseTo(
      antes.analysis.weight.trend!.slopePerWeek,
      10,
    );
    // Y el objetivo nuevo ya se compara.
    expect(despues.analysis.goal!.targetWeightKg).toBe(76);
  });

  it("un perfil sin objetivo activo no puede revisar lo que no tiene", async () => {
    const profileId = await nuevoPerfil("sin-objetivo");
    await prisma.goal.updateMany({
      where: { profileId },
      data: { status: "ABANDONED" },
    });
    await expect(
      body.updateGoal(
        profileId,
        goalUpdateSchema.parse({
          strategy: "MAINTENANCE",
          weeklyRatePct: 0,
          targetWeightKg: null,
        }),
        AHORA,
      ),
    ).rejects.toBeInstanceOf(body.NoActiveGoalError);
  });

  it("cambiar de fase NO toca la nutrición ni el programa", async () => {
    // Cambiar de objetivo es una declaración de intención, no una orden para
    // que los motores se reconfiguren solos. F4 tiene sus propias reglas.
    const profileId = await nuevoPerfil("sin-efectos", 40);
    const [targetsAntes, programasAntes] = await Promise.all([
      prisma.nutritionTarget.findMany({ where: { profileId } }),
      prisma.trainingProgram.findMany({ where: { profileId } }),
    ]);

    await body.updateGoal(
      profileId,
      goalUpdateSchema.parse({
        strategy: "MAINTENANCE",
        weeklyRatePct: 0,
        targetWeightKg: null,
      }),
      AHORA,
    );

    expect(
      await prisma.nutritionTarget.findMany({ where: { profileId } }),
    ).toEqual(targetsAntes);
    expect(
      await prisma.trainingProgram.findMany({ where: { profileId } }),
    ).toEqual(programasAntes);
  });
});

describe("validación del objetivo en la frontera", () => {
  it("rechaza un ritmo fuera del rango de su estrategia", () => {
    // −2 %/semana no lo permite el motor de nutrición para nadie.
    expect(
      goalUpdateSchema.safeParse({
        strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
        weeklyRatePct: -2,
        targetWeightKg: null,
      }).success,
    ).toBe(false);
  });

  it("rechaza un ritmo positivo en una estrategia de pérdida", () => {
    expect(
      goalUpdateSchema.safeParse({
        strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
        weeklyRatePct: 0.2,
        targetWeightKg: null,
      }).success,
    ).toBe(false);
  });

  it("exige ritmo 0 en mantenimiento y recomposición", () => {
    for (const strategy of ["MAINTENANCE", "RECOMP_MAINTAIN_WEIGHT"]) {
      expect(
        goalUpdateSchema.safeParse({
          strategy,
          weeklyRatePct: -0.3,
          targetWeightKg: null,
        }).success,
      ).toBe(false);
      expect(
        goalUpdateSchema.safeParse({
          strategy,
          weeklyRatePct: 0,
          targetWeightKg: null,
        }).success,
      ).toBe(true);
    }
  });
});
