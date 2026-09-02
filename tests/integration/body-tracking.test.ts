import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bodyMeasurementSchema } from "@/core/schemas/body-measurement";
import { onboardingSchema } from "@/core/schemas/onboarding";
import { addDays } from "@/core/dates";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";

/**
 * Ciclo completo de una medición contra base de datos real: crear, leer,
 * actualizar, borrar, y el DTO que consumirá `/progress`.
 *
 * Se prueba contra el SERVICE, que es donde viven las guardas de propiedad, y
 * no contra la server action: esta resuelve el perfil desde la cookie y
 * falsearla probaría el simulacro en vez del código. Los ataques entre
 * usuarios viven en `user-isolation.test.ts`.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const body = await import("@/server/services/body.service");

const HOY = "2026-08-31";
const AHORA = new Date(`${HOY}T10:00:00Z`);

const BASE = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
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

/** Perfil nuevo, con el onboarding hecho hace 90 días. */
async function nuevoPerfil(username: string): Promise<string> {
  const userId = await createTestUser(prisma, username);
  const { profileId } = await completeOnboarding(
    userId,
    onboardingSchema.parse(BASE),
    new Date(`${addDays(HOY, -90)}T10:00:00Z`),
  );
  return profileId;
}

function medicion(fields: Record<string, unknown>) {
  return bodyMeasurementSchema.parse(fields);
}

beforeAll(async () => {
  await runSeed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("crear y leer", () => {
  it("guarda una medición y la devuelve tal cual quedó", async () => {
    const profileId = await nuevoPerfil("crea");
    const guardada = await body.saveMeasurement(
      profileId,
      medicion({
        localDate: HOY,
        weightKg: 82.4,
        waistCm: 88,
        bodyFatPct: 17.5,
        bodyFatReliability: "MEASURED",
      }),
      AHORA,
    );

    expect(guardada.localDate).toBe(HOY);
    expect(guardada.weightKg).toBe(82.4);
    expect(guardada.waistCm).toBe(88);
    expect(guardada.bodyFatPct).toBe(17.5);
    expect(guardada.bodyFatReliability).toBe("MEASURED");
    expect(guardada.id).toBeTruthy();

    const leida = await body.getMeasurementForDate(profileId, HOY);
    expect(leida).toEqual(guardada);
  });

  it("una medición de un día sin registro devuelve null, no un error", async () => {
    const profileId = await nuevoPerfil("sin-registro");
    expect(await body.getMeasurementForDate(profileId, HOY)).toBeNull();
  });

  it("acepta rellenar días pasados (backfill)", async () => {
    const profileId = await nuevoPerfil("backfill");
    for (const dias of [30, 20, 10]) {
      await body.saveMeasurement(
        profileId,
        medicion({
          localDate: addDays(HOY, -dias),
          weightKg: 84 - dias * 0.02,
        }),
        AHORA,
      );
    }
    const { history } = await body.getBodyProgress(profileId, AHORA);
    // Historial + la medición del onboarding.
    expect(history).toHaveLength(4);
  });

  it("rechaza una medición con fecha futura", async () => {
    const profileId = await nuevoPerfil("futuro");
    await expect(
      body.saveMeasurement(
        profileId,
        medicion({ localDate: addDays(HOY, 1), weightKg: 82 }),
        AHORA,
      ),
    ).rejects.toBeInstanceOf(body.FutureMeasurementError);

    expect(
      await prisma.bodyMeasurement.count({
        where: { profileId, localDate: addDays(HOY, 1) },
      }),
    ).toBe(0);
  });

  it("hoy sí se acepta: el límite es el futuro, no el presente", async () => {
    const profileId = await nuevoPerfil("hoy");
    await expect(
      body.saveMeasurement(
        profileId,
        medicion({ localDate: HOY, weightKg: 82 }),
        AHORA,
      ),
    ).resolves.toBeTruthy();
  });
});

describe("actualizar: una fila por perfil y día", () => {
  it("guardar dos veces el mismo día actualiza en vez de duplicar", async () => {
    const profileId = await nuevoPerfil("actualiza");
    const primera = await body.saveMeasurement(
      profileId,
      medicion({ localDate: HOY, weightKg: 82.4, waistCm: 88 }),
      AHORA,
    );
    const segunda = await body.saveMeasurement(
      profileId,
      medicion({ localDate: HOY, weightKg: 82.1, waistCm: 87.5 }),
      AHORA,
    );

    // MISMA fila: el id no cambia.
    expect(segunda.id).toBe(primera.id);
    expect(segunda.weightKg).toBe(82.1);
    expect(
      await prisma.bodyMeasurement.count({
        where: { profileId, localDate: HOY },
      }),
    ).toBe(1);
  });

  it("guardar es declarar el día ENTERO: omitir la cintura la borra", async () => {
    const profileId = await nuevoPerfil("declara");
    await body.saveMeasurement(
      profileId,
      medicion({ localDate: HOY, weightKg: 82, waistCm: 88 }),
      AHORA,
    );
    const sinCintura = await body.saveMeasurement(
      profileId,
      medicion({ localDate: HOY, weightKg: 82 }),
      AHORA,
    );
    // Si el upsert omitiera los campos ausentes en vez de mandarlos a null,
    // quedaría una cintura huérfana de una edición anterior.
    expect(sinCintura.waistCm).toBeNull();
  });

  it("días distintos son filas distintas", async () => {
    const profileId = await nuevoPerfil("dias-distintos");
    const a = await body.saveMeasurement(
      profileId,
      medicion({ localDate: addDays(HOY, -1), weightKg: 82.6 }),
      AHORA,
    );
    const b = await body.saveMeasurement(
      profileId,
      medicion({ localDate: HOY, weightKg: 82.4 }),
      AHORA,
    );
    expect(a.id).not.toBe(b.id);
  });
});

describe("borrar", () => {
  it("borra una medición propia", async () => {
    const profileId = await nuevoPerfil("borra");
    const guardada = await body.saveMeasurement(
      profileId,
      medicion({ localDate: HOY, weightKg: 82 }),
      AHORA,
    );

    await body.deleteMeasurement(profileId, guardada.id);
    expect(await body.getMeasurementForDate(profileId, HOY)).toBeNull();
    expect(
      await prisma.bodyMeasurement.count({ where: { id: guardada.id } }),
    ).toBe(0);
  });

  it("borrar una medición inexistente falla en vez de fingir éxito", async () => {
    const profileId = await nuevoPerfil("borra-fantasma");
    await expect(
      body.deleteMeasurement(profileId, "id-que-no-existe"),
    ).rejects.toBeInstanceOf(body.MeasurementNotFoundError);
  });

  it("borrar no toca las demás mediciones del mismo perfil", async () => {
    const profileId = await nuevoPerfil("borra-una");
    const a = await body.saveMeasurement(
      profileId,
      medicion({ localDate: addDays(HOY, -2), weightKg: 83 }),
      AHORA,
    );
    await body.saveMeasurement(
      profileId,
      medicion({ localDate: addDays(HOY, -1), weightKg: 82.7 }),
      AHORA,
    );

    await body.deleteMeasurement(profileId, a.id);
    const { history } = await body.getBodyProgress(profileId, AHORA);
    expect(history.map((m) => m.localDate)).toContain(addDays(HOY, -1));
    expect(history.map((m) => m.localDate)).not.toContain(addDays(HOY, -2));
  });
});

describe("entrada rápida de peso", () => {
  it("guarda solo el peso y NO borra la cintura ni el % graso de ese día", async () => {
    // El defecto que esta función existe para evitar: la tarjeta de "Hoy"
    // tiene un solo campo, y con el guardado normal —que declara el día
    // entero— habría borrado en silencio lo anotado esa misma mañana.
    const profileId = await nuevoPerfil("rapido");
    await body.saveMeasurement(
      profileId,
      medicion({
        localDate: HOY,
        weightKg: 82.4,
        waistCm: 88,
        bodyFatPct: 17,
        bodyFatReliability: "MEASURED",
      }),
      AHORA,
    );

    const tras = await body.saveWeight(
      profileId,
      { localDate: HOY, weightKg: 82.1 },
      AHORA,
    );

    expect(tras.weightKg).toBe(82.1);
    expect(tras.waistCm).toBe(88);
    expect(tras.bodyFatPct).toBe(17);
    expect(tras.bodyFatReliability).toBe("MEASURED");
  });

  it("crea la fila del día si no existía", async () => {
    const profileId = await nuevoPerfil("rapido-crea");
    const creada = await body.saveWeight(
      profileId,
      { localDate: HOY, weightKg: 82.4 },
      AHORA,
    );
    expect(creada.weightKg).toBe(82.4);
    expect(creada.waistCm).toBeNull();
    expect(
      await prisma.bodyMeasurement.count({
        where: { profileId, localDate: HOY },
      }),
    ).toBe(1);
  });

  it("tampoco acepta fecha futura", async () => {
    const profileId = await nuevoPerfil("rapido-futuro");
    await expect(
      body.saveWeight(
        profileId,
        { localDate: addDays(HOY, 1), weightKg: 82 },
        AHORA,
      ),
    ).rejects.toBeInstanceOf(body.FutureMeasurementError);
  });
});

describe("el DTO de progreso", () => {
  /** 28 pesajes diarios bajando ~0,42 kg/semana. */
  async function conHistorial(username: string): Promise<string> {
    const profileId = await nuevoPerfil(username);
    for (let i = 27; i >= 0; i--) {
      await body.saveMeasurement(
        profileId,
        medicion({
          localDate: addDays(HOY, -i),
          weightKg: 84 - 0.06 * (27 - i),
        }),
        AHORA,
      );
    }
    return profileId;
  }

  it("devuelve análisis, historial y versión del motor", async () => {
    const profileId = await conHistorial("dto");
    const vista = await body.getBodyProgress(profileId, AHORA);

    expect(vista.analysis.todayLocalDate).toBe(HOY);
    expect(vista.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(vista.analysis.weight.status).toBe("LOSING");
    expect(vista.analysis.weight.windowDays).toBe(28);
    expect(vista.analysis.weight.trend!.slopePerWeek).toBeCloseTo(-0.42, 1);
  });

  it("el historial va del más reciente al más antiguo y lleva id", async () => {
    const profileId = await conHistorial("dto-orden");
    const { history } = await body.getBodyProgress(profileId, AHORA);

    expect(history[0].localDate).toBe(HOY);
    expect(history[0].id).toBeTruthy();
    for (let i = 1; i < history.length; i++) {
      expect(history[i].localDate < history[i - 1].localDate).toBe(true);
    }
  });

  it("no filtra campos de Prisma: el DTO es exactamente el acordado", async () => {
    const profileId = await conHistorial("dto-forma");
    const { history } = await body.getBodyProgress(profileId, AHORA);
    // Si algún día alguien devuelve la fila de Prisma entera, aquí aparecerían
    // `profileId`, `createdAt`, `notes` y los ocho perímetros sin usar.
    expect(Object.keys(history[0]).sort()).toEqual([
      "bodyFatPct",
      "bodyFatReliability",
      "id",
      "localDate",
      "waistCm",
      // B4: el protocolo de cintura entra en el DTO porque la interfaz tiene
      // que poder decir con cuántas tomas se midió.
      "waistProtocol",
      "weightKg",
    ]);
  });

  it("incluye la comparación con el objetivo activo", async () => {
    const profileId = await conHistorial("dto-objetivo");
    const { analysis } = await body.getBodyProgress(profileId, AHORA);

    expect(analysis.goal).not.toBeNull();
    expect(analysis.goal!.goalType).toBe("FAT_LOSS");
    expect(analysis.goal!.expectedDirection).toBe("DOWN");
    expect(analysis.goal!.targetWeightKg).toBe(78);
    // Perdiendo a un ritmo comparable al objetivo: razón en torno a 1.
    expect(analysis.goal!.ratio).toBeGreaterThan(0.7);
    expect(analysis.goal!.ratio).toBeLessThan(1.4);
  });

  it("un perfil recién creado no revienta: dice que faltan datos", async () => {
    const profileId = await nuevoPerfil("dto-vacio");
    const { analysis, history } = await body.getBodyProgress(profileId, AHORA);
    // Solo la medición del onboarding, de hace 90 días.
    expect(history).toHaveLength(1);
    expect(analysis.weight.status).toBe("INSUFFICIENT_DATA");
    expect(analysis.weight.trend).toBeNull();
  });

  it("NO usa DailyCheckIn.weightKg como fuente de peso", async () => {
    // La columna está obsoleta. Si alguien la reconectara, este perfil
    // tendría 28 pesajes fantasma y el análisis dejaría de decir que faltan
    // datos.
    const profileId = await nuevoPerfil("dto-checkin");
    for (let i = 27; i >= 0; i--) {
      await prisma.dailyCheckIn.create({
        data: {
          profileId,
          localDate: addDays(HOY, -i),
          weightKg: 84 - 0.06 * (27 - i),
        },
      });
    }
    const { analysis, history } = await body.getBodyProgress(profileId, AHORA);
    expect(history).toHaveLength(1);
    expect(analysis.weight.status).toBe("INSUFFICIENT_DATA");
  });
});
