import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CoachProvider } from "@/ai/provider";
import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";
import { seedCompletedSessionWithSets } from "./helpers/seed-sessions";

/**
 * `BodyMeasurement` como FUENTE ÚNICA de verdad del seguimiento corporal (B0).
 *
 * Estas pruebas fijan tres invariantes de los que dependerá todo lo que venga
 * después (motor de tendencia, gráficas, check-in):
 *
 *   1. Una fila por persona y día. Registrar dos veces el mismo día actualiza,
 *      no duplica — y lo impone la BASE DE DATOS, no solo el código.
 *   2. El % graso se guarda de forma longitudinal y SIEMPRE con su
 *      procedencia. Un porcentaje sin saber de dónde sale no es comparable con
 *      ninguna otra lectura y por tanto no sirve para una serie temporal.
 *   3. El peso de una persona nunca se mezcla con el de otra, ni siquiera
 *      cuando las dos registran el mismo día.
 *
 * Y una cuarta, negativa: `DailyCheckIn.weightKg` está obsoleta y NADA puede
 * volver a tratarla como fuente de peso.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { askCoach } = await import("@/server/services/coach.service");

const BASE = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  waistCm: 88,
  trainingYears: 3,
  daysPerWeek: 4,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
  strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
  dailySteps: 8500,
  workActivity: "SEDENTARY",
  balancedProgram: true,
  priorityMuscles: [],
  contraindications: [],
  excludedExerciseNames: [],
} as const;

function onboarding(overrides: Record<string, unknown> = {}) {
  return onboardingSchema.parse({ ...BASE, ...overrides });
}

/** Mediciones de un perfil, en orden cronológico. */
async function measurementsOf(profileId: string) {
  return prisma.bodyMeasurement.findMany({
    where: { profileId },
    orderBy: { localDate: "asc" },
  });
}

beforeAll(async () => {
  await runSeed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("el onboarding crea la primera medición de la serie", () => {
  it("guarda peso, cintura, % graso y su procedencia cuando está medido de forma fiable", async () => {
    const userId = await createTestUser(prisma, "medido");
    const { profileId } = await completeOnboarding(
      userId,
      onboarding({ bodyFatPct: 15.5, bodyFatMeasured: true }),
      new Date("2026-07-14T10:00:00Z"),
    );

    const medicion = await prisma.bodyMeasurement.findUniqueOrThrow({
      where: { profileId_localDate: { profileId, localDate: "2026-07-14" } },
    });
    expect(medicion.weightKg).toBe(84);
    expect(medicion.waistCm).toBe(88);
    expect(medicion.bodyFatPct).toBe(15.5);
    // DEXA o plicómetro: la lectura es comparable con otras del mismo tipo.
    expect(medicion.bodyFatReliability).toBe("MEASURED");
  });

  it("marca el % graso como ESTIMATED si no se declaró fiable", async () => {
    // Es el caso NORMAL: una báscula de bioimpedancia doméstica. Guardar el
    // número sin esta distinción haría que una lectura de báscula y una de
    // DEXA parecieran el mismo dato, y no lo son.
    const userId = await createTestUser(prisma, "estimado");
    const { profileId } = await completeOnboarding(
      userId,
      onboarding({ bodyFatPct: 22, bodyFatMeasured: false }),
      new Date("2026-07-14T10:00:00Z"),
    );

    const medicion = await prisma.bodyMeasurement.findUniqueOrThrow({
      where: { profileId_localDate: { profileId, localDate: "2026-07-14" } },
    });
    expect(medicion.bodyFatPct).toBe(22);
    expect(medicion.bodyFatReliability).toBe("ESTIMATED");
  });

  it("deja % graso y procedencia a null cuando no se indica (el campo es opcional)", async () => {
    const userId = await createTestUser(prisma, "sin-grasa");
    const { profileId } = await completeOnboarding(
      userId,
      onboarding(),
      new Date("2026-07-14T10:00:00Z"),
    );

    const medicion = await prisma.bodyMeasurement.findUniqueOrThrow({
      where: { profileId_localDate: { profileId, localDate: "2026-07-14" } },
    });
    expect(medicion.bodyFatPct).toBeNull();
    // Sin porcentaje no hay procedencia que guardar: nunca un valor huérfano.
    expect(medicion.bodyFatReliability).toBeNull();
    // El peso sí es obligatorio: la serie corporal siempre arranca con él.
    expect(medicion.weightKg).toBe(84);
  });
});

describe("una fila por persona y día", () => {
  it("re-hacer el onboarding el MISMO día actualiza la medición en vez de duplicarla", async () => {
    const userId = await createTestUser(prisma, "mismo-dia");
    const { profileId } = await completeOnboarding(
      userId,
      onboarding({ bodyFatPct: 18, bodyFatMeasured: true }),
      new Date("2026-07-14T08:00:00Z"),
    );

    await completeOnboarding(
      userId,
      onboarding({ weightKg: 83.2, waistCm: 86.5, bodyFatPct: 17 }),
      new Date("2026-07-14T21:00:00Z"),
    );

    const filas = await measurementsOf(profileId);
    expect(filas).toHaveLength(1);
    // La última medición del día gana: quien se pesa dos veces suele estar
    // corrigiendo la primera, no registrando dos hechos distintos.
    expect(filas[0].weightKg).toBe(83.2);
    expect(filas[0].waistCm).toBe(86.5);
    expect(filas[0].bodyFatPct).toBe(17);
    // `bodyFatMeasured` volvió a su default (false) en la segunda pasada, así
    // que la procedencia tiene que bajar con él. Si se quedara en "MEASURED",
    // una estimación de báscula pasaría por una medición fiable para siempre.
    expect(filas[0].bodyFatReliability).toBe("ESTIMATED");
  });

  it("re-hacer el onboarding sin cintura BORRA la anterior, no deja un valor huérfano", async () => {
    // El onboarding es una declaración COMPLETA del estado corporal de hoy.
    // Conservar la cintura de una pasada anterior sería inventarse un dato que
    // la persona acaba de decidir no dar.
    const userId = await createTestUser(prisma, "sin-cintura");
    const { profileId } = await completeOnboarding(
      userId,
      onboarding({ waistCm: 90, bodyFatPct: 20 }),
      new Date("2026-07-14T08:00:00Z"),
    );

    const conCintura = await measurementsOf(profileId);
    expect(conCintura[0].waistCm).toBe(90);

    await completeOnboarding(
      userId,
      onboarding({ waistCm: undefined, bodyFatPct: undefined }),
      new Date("2026-07-14T21:00:00Z"),
    );

    const filas = await measurementsOf(profileId);
    expect(filas).toHaveLength(1);
    expect(filas[0].waistCm).toBeNull();
    expect(filas[0].bodyFatPct).toBeNull();
    expect(filas[0].bodyFatReliability).toBeNull();
  });

  it("en un día DISTINTO añade una fila nueva y no toca la anterior", async () => {
    const userId = await createTestUser(prisma, "otro-dia");
    const { profileId } = await completeOnboarding(
      userId,
      onboarding({ weightKg: 84 }),
      new Date("2026-07-14T10:00:00Z"),
    );
    await completeOnboarding(
      userId,
      onboarding({ weightKg: 82.4 }),
      new Date("2026-07-28T10:00:00Z"),
    );

    const filas = await measurementsOf(profileId);
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.localDate)).toEqual(["2026-07-14", "2026-07-28"]);
    // La histórica se conserva intacta: sin esto no hay serie temporal.
    expect(filas[0].weightKg).toBe(84);
    expect(filas[1].weightKg).toBe(82.4);
  });

  it("la unicidad la impone la BASE DE DATOS, no solo el código de servicio", async () => {
    // Sin esta prueba, la garantía "una fila por día" dependería de que todo
    // el mundo se acuerde de usar `upsert`. Aquí se ataca por debajo del
    // servicio, que es por donde entraría el fallo real.
    const userId = await createTestUser(prisma, "constraint");
    const { profileId } = await completeOnboarding(
      userId,
      onboarding(),
      new Date("2026-07-14T10:00:00Z"),
    );

    await expect(
      prisma.bodyMeasurement.create({
        data: { profileId, localDate: "2026-07-14", weightKg: 999 },
      }),
    ).rejects.toThrow();

    const filas = await measurementsOf(profileId);
    expect(filas).toHaveLength(1);
    expect(filas[0].weightKg).toBe(84);
  });
});

describe("aislamiento: el cuerpo de cada persona es suyo", () => {
  it("dos personas que registran el MISMO día tienen cada una su fila", async () => {
    // La clave única es (perfil, día), no (día): que A registre no puede
    // impedir ni pisar el registro de B.
    const [userA, userB] = await Promise.all([
      createTestUser(prisma, "ana-cuerpo"),
      createTestUser(prisma, "bruno-cuerpo"),
    ]);
    const { profileId: perfilA } = await completeOnboarding(
      userA,
      onboarding({ weightKg: 84, waistCm: 88, bodyFatPct: 15 }),
      new Date("2026-07-14T10:00:00Z"),
    );
    const { profileId: perfilB } = await completeOnboarding(
      userB,
      onboarding({
        sex: "FEMALE",
        heightCm: 165,
        weightKg: 62,
        waistCm: 71,
        bodyFatPct: 26,
        bodyFatMeasured: true,
      }),
      new Date("2026-07-14T11:00:00Z"),
    );

    const [deA, deB] = await Promise.all([
      measurementsOf(perfilA),
      measurementsOf(perfilB),
    ]);

    expect(deA).toHaveLength(1);
    expect(deB).toHaveLength(1);
    expect(deA[0].localDate).toBe(deB[0].localDate);
    expect(deA[0].id).not.toBe(deB[0].id);

    // Ni un número cruzado.
    expect(deA[0].weightKg).toBe(84);
    expect(deA[0].waistCm).toBe(88);
    expect(deA[0].bodyFatPct).toBe(15);
    expect(deA[0].bodyFatReliability).toBe("ESTIMATED");
    expect(deB[0].weightKg).toBe(62);
    expect(deB[0].waistCm).toBe(71);
    expect(deB[0].bodyFatPct).toBe(26);
    expect(deB[0].bodyFatReliability).toBe("MEASURED");
  });

  it("re-hacer el onboarding de B no toca ni una fila de A", async () => {
    const [userA, userB] = await Promise.all([
      createTestUser(prisma, "ana-intacta"),
      createTestUser(prisma, "bruno-reonboarda"),
    ]);
    const { profileId: perfilA } = await completeOnboarding(
      userA,
      onboarding({ weightKg: 84 }),
      new Date("2026-07-14T10:00:00Z"),
    );
    await completeOnboarding(
      userB,
      onboarding({ weightKg: 62 }),
      new Date("2026-07-14T10:30:00Z"),
    );

    const antesDeA = await measurementsOf(perfilA);

    await completeOnboarding(
      userB,
      onboarding({ weightKg: 61.1, waistCm: 70 }),
      new Date("2026-07-14T22:00:00Z"),
    );

    const despuesDeA = await measurementsOf(perfilA);
    expect(despuesDeA).toEqual(antesDeA);
  });

  it("una consulta por perfil nunca devuelve mediciones de otro", async () => {
    const [userA, userB] = await Promise.all([
      createTestUser(prisma, "ana-consulta"),
      createTestUser(prisma, "bruno-consulta"),
    ]);
    const { profileId: perfilA } = await completeOnboarding(
      userA,
      onboarding({ weightKg: 84 }),
      new Date("2026-07-14T10:00:00Z"),
    );
    const { profileId: perfilB } = await completeOnboarding(
      userB,
      onboarding({ weightKg: 62 }),
      new Date("2026-07-15T10:00:00Z"),
    );

    const { getLatestMeasurement } =
      await import("@/server/repositories/profile.repo");

    // El repositorio recibe el perfil ya resuelto desde la sesión: la última
    // medición de A es la de A aunque la de B sea posterior en el calendario.
    expect((await getLatestMeasurement(perfilA))?.weightKg).toBe(84);
    expect((await getLatestMeasurement(perfilB))?.weightKg).toBe(62);

    const deA = await measurementsOf(perfilA);
    for (const fila of deA) expect(fila.profileId).toBe(perfilA);
  });
});

describe("DailyCheckIn.weightKg está obsoleta", () => {
  it("no cuenta como fuente de peso para el contexto del coach", async () => {
    // La regresión que este test bloquea: que alguien vuelva a aceptar
    // `DailyCheckIn.weightKg` como peso corporal. Con dos columnas capaces de
    // guardar el peso del mismo día, el motor de tendencia y el de nutrición
    // acabarían leyendo números distintos sin que nadie lo notara.
    const userId = await createTestUser(prisma, "checkin-obsoleto");
    const { profileId } = await completeOnboarding(
      userId,
      onboarding(),
      new Date("2026-07-14T10:00:00Z"),
    );

    // El coach responde NO_DATA sin sesiones y no llegaría a construir el
    // contexto, que es justo lo que hay que inspeccionar.
    const programa = await prisma.trainingProgram.findFirstOrThrow({
      where: { profileId, isActive: true },
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
    const meso = programa.mesocycles[0];
    const plantilla = meso.templates[0];
    await seedCompletedSessionWithSets(prisma, {
      mesocycleId: meso.id,
      templateId: plantilla.id,
      variantId: plantilla.exercises[0].exerciseVariantId,
      localDate: "2026-07-16",
      sets: [
        { setNumber: 1, weightKg: 60, reps: 10, rir: 2 },
        { setNumber: 2, weightKg: 60, reps: 10, rir: 2 },
      ],
    });

    // Se deja la fuente REAL sin peso...
    await prisma.bodyMeasurement.update({
      where: { profileId_localDate: { profileId, localDate: "2026-07-14" } },
      data: { weightKg: null, waistCm: null },
    });
    // ...y se pone un peso en la columna obsoleta.
    await prisma.dailyCheckIn.create({
      data: { profileId, localDate: "2026-07-14", weightKg: 84 },
    });

    // Proveedor falso que captura el contexto EXACTO que habría viajado a
    // OpenAI. Implementa `generate`, que es el único método de `CoachProvider`:
    // con cualquier otro nombre la llamada lanza, `runCoach` lo captura y
    // devuelve ERROR, y el test pasaría sin haber inspeccionado nada.
    let contexto: string | null = null;
    const proveedor: CoachProvider = {
      generate: async (peticion) => {
        contexto = peticion.contextJson;
        return {
          kind: "OK",
          text: JSON.stringify({
            headline: "ok",
            highlights: [],
            fatigue: null,
            recommendation: "ok",
            hypotheses: [],
          }),
          model: "fake",
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: null,
        };
      },
    };
    await askCoach(
      profileId,
      { task: "WEEKLY" },
      proveedor,
      new Date("2026-07-20T10:00:00Z"),
    );

    // Que el proveedor se llamara de verdad: sin esto el resto del test se
    // cumpliría de forma vacía sobre una cadena vacía.
    expect(contexto).not.toBeNull();

    // El coach tiene que seguir creyendo que NO hay peso registrado: es lo
    // único cierto, porque la fuente única está vacía.
    const enviado = JSON.parse(contexto!) as { notAvailable: string[] };
    expect(enviado.notAvailable).toContain("peso corporal actual");
  });
});
