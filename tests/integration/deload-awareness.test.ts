import { beforeAll, describe, expect, it } from "vitest";

import { addDays } from "@/core/dates";
import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";

/**
 * Conciencia de descarga, de punta a punta.
 *
 * El problema que cierra: si el motor te recomienda una descarga y la HACES
 * —mitad de series, misma carga—, el propio motor lo leía después como
 * "has acortado 3 de las últimas 4 sesiones" y seguía diciéndote "llevas 10
 * semanas sin una semana suave". Es decir, te penalizaba por obedecerle.
 *
 * Cómo lo sabe ahora (sin migración: `WorkoutSession.weekKind` ya existía con
 * el enum ACCUMULATION | DELOAD y nadie escribía nunca DELOAD):
 * al cerrar la sesión se marca `DELOAD` si se cumplen LAS DOS cosas —
 *   1. el motor recomendaba descarga cuando entraste (se consulta antes de
 *      marcarla completada, así que la sesión no se cuenta a sí misma), y
 *   2. registraste menos del 70 % de las series que prescribe la PLANTILLA.
 * Exigir las dos es lo que impide que un día flojo suelto se disfrace de
 * descarga.
 */

const testDb = createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { startOrResumeSession, finishSession, logSet } =
  await import("@/server/services/workout-session.service");
const { getExecutionSession } =
  await import("@/server/repositories/workout.repo");
const { getTrainingAnalysis } =
  await import("@/server/services/fatigue.service");

const LUNES = "2026-06-01";
let profileId: string;
let templateIds: string[];

const MAL = {
  perceivedPerformance: 2,
  pump: 3,
  jointPain: 1,
  fatigue: 5,
  motivation: 2,
};
const BIEN = {
  perceivedPerformance: 4,
  pump: 3,
  jointPain: 1,
  fatigue: 2,
  motivation: 4,
};

/** Entrena un día registrando `fraccion` de las series previstas. */
async function entrenar(
  localDate: string,
  templateId: string,
  fraccion: number,
  feedback: typeof BIEN,
) {
  const started = await startOrResumeSession(
    profileId,
    templateId,
    new Date(`${localDate}T18:00:00Z`),
  );
  const id = started.sessionId!;
  const session = (await getExecutionSession(profileId, id))!;
  for (const ex of session.exercises) {
    const n = Math.max(1, Math.round(ex.plannedSets * fraccion));
    for (let i = 1; i <= n; i++) {
      await logSet(profileId, {
        workoutExerciseId: ex.id,
        setNumber: i,
        setType: "WORKING",
        weightKg: 60,
        reps: ex.repRangeMin + 1,
        rir: 2,
      });
    }
  }
  const result = await finishSession(
    profileId,
    id,
    feedback,
    new Date(`${localDate}T19:00:00Z`),
  );
  const row = await prisma.workoutSession.findUniqueOrThrow({
    where: { id },
    select: { weekKind: true },
  });
  return { ...result, weekKind: row.weekKind, sessionId: id };
}

/** Entrena una semana completa a partir del lunes indicado. */
async function semana(inicio: string, fraccion: number, feedback: typeof BIEN) {
  const out = [];
  for (const [i, id] of templateIds.entries()) {
    out.push(await entrenar(addDays(inicio, i), id, fraccion, feedback));
  }
  return out;
}

const analisis = (localDate: string) =>
  getTrainingAnalysis(profileId, new Date(`${localDate}T20:00:00Z`));

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
  templateIds = (
    await prisma.workoutTemplate.findMany({
      where: { deletedAt: null },
      orderBy: { ordinal: "asc" },
    })
  ).map((t) => t.id);

  // 10 semanas acumulando; las tres últimas con feedback malo.
  for (let s = 0; s < 10; s++) {
    await semana(addDays(LUNES, s * 7), 1, s >= 7 ? MAL : BIEN);
  }
}, 180_000);

describe("A · el usuario IGNORA la descarga recomendada", () => {
  it("recomienda descarga y la acumulación sigue contando", async () => {
    const hoy = addDays(LUNES, 70);
    const a = await analisis(hoy);
    expect(a.fatigue.decision).toBe("DELOAD_RECOMMENDED");
    expect(a.context.weeksSinceDeload).toBe(10);
  });

  it("entrenar normal NO se marca como descarga, aunque la recomiende", async () => {
    // Segunda condición: sin recorte real no hay descarga. Entrenar al 100 %
    // ignorando la recomendación es exactamente eso.
    const dia = await entrenar(addDays(LUNES, 70), templateIds[0], 1, MAL);
    expect(dia.weekKind).toBe("ACCUMULATION");
    expect(dia.deload).toBe(false);

    const a = await analisis(addDays(LUNES, 70));
    expect(a.context.weeksSinceDeload).toBeGreaterThanOrEqual(10);
  });
});

describe("B/C · el usuario CUMPLE la descarga", () => {
  it("las tres sesiones quedan marcadas como descarga", async () => {
    const dias = await semana(addDays(LUNES, 77), 0.5, BIEN);
    expect(dias.map((d) => d.weekKind)).toEqual(["DELOAD", "DELOAD", "DELOAD"]);
  });

  it("no se le penaliza por haber acortado las sesiones", async () => {
    const a = await analisis(addDays(LUNES, 79));
    const codigos = a.fatigue.signals.map((s) => s.code);
    expect(codigos).not.toContain("SESSION_COMPLETION_DROP");
  });

  it("y LONG_ACCUMULATION se reinicia", async () => {
    const a = await analisis(addDays(LUNES, 79));
    expect(a.context.weeksSinceDeload).toBe(0);
    expect(a.fatigue.signals.map((s) => s.code)).not.toContain(
      "LONG_ACCUMULATION",
    );
    expect(a.fatigue.decision).not.toBe("DELOAD_RECOMMENDED");
  });

  it("sin borrar una sola serie del historial fisiológico", async () => {
    // La descarga no amnistía datos: las series, cargas, reps y RIR siguen
    // ahí, y el motor de progresión sigue viendo su historial completo.
    const sets = await prisma.setLog.count();
    expect(sets).toBeGreaterThan(300);
    const a = await analisis(addDays(LUNES, 79));
    expect(a.variants.length).toBeGreaterThan(0);
    expect(a.variants.every((v) => v.suggestion.numbers.exposures > 1)).toBe(
      true,
    );
  });
});

describe("D/E · lo que NO debe contar como descarga", () => {
  it("una sesión corta suelta, sin descarga recomendada, cuenta como corta", async () => {
    // Tras la descarga el motor ya no la recomienda, así que un día flojo aquí
    // es un día flojo: no puede disfrazarse de descarga.
    const dia = await entrenar(addDays(LUNES, 84), templateIds[0], 0.34, BIEN);
    expect(dia.weekKind).toBe("ACCUMULATION");
    expect(dia.deload).toBe(false);
  });

  it("y el contador de acumulación cuenta DESDE la descarga", async () => {
    // La última sesión de descarga fue el día 79; el día 84 solo han pasado
    // cinco días, así que aún no se ha cumplido una semana entera.
    expect((await analisis(addDays(LUNES, 84))).context.weeksSinceDeload).toBe(
      0,
    );
    expect((await analisis(addDays(LUNES, 86))).context.weeksSinceDeload).toBe(
      1,
    );
  });
});

describe("F · vuelta a la normalidad, sin estado atrapado", () => {
  it("entrenar completo vuelve a marcarse como acumulación", async () => {
    const dias = await semana(addDays(LUNES, 91), 1, BIEN);
    expect(dias.every((d) => d.weekKind === "ACCUMULATION")).toBe(true);
  });

  it("y la acumulación sigue contando desde la descarga, no desde cero", async () => {
    const a = await analisis(addDays(LUNES, 93));
    expect(a.context.weeksSinceDeload).toBe(2);
    expect(a.fatigue.decision).not.toBe("DELOAD_RECOMMENDED");
  });
});

describe("contrato de guardado: nada se pierde en silencio", () => {
  it("cerrar dos veces avisa en vez de perder el feedback", async () => {
    const { SessionNotInProgressError } =
      await import("@/server/services/workout-session.service");
    const dia = addDays(LUNES, 98);
    await entrenar(dia, templateIds[0], 1, BIEN);
    const cerrada = await prisma.workoutSession.findFirstOrThrow({
      where: { localDate: dia },
      select: { id: true, fatigue: true, jointPain: true },
    });

    // Segundo intento desde una "pestaña vieja", con feedback distinto.
    await expect(
      finishSession(profileId, cerrada.id, MAL, new Date(`${dia}T20:00:00Z`)),
    ).rejects.toBeInstanceOf(SessionNotInProgressError);

    // Y el feedback original sigue intacto: no se ha machacado a medias.
    const despues = await prisma.workoutSession.findFirstOrThrow({
      where: { id: cerrada.id },
      select: { fatigue: true, jointPain: true, status: true },
    });
    expect(despues.status).toBe("COMPLETED");
    expect(despues.fatigue).toBe(BIEN.fatigue);
    expect(despues.jointPain).toBe(BIEN.jointPain);
  });

  it("y un reintento no duplica ni la sesión ni las series", async () => {
    const dia = addDays(LUNES, 98);
    const sesiones = await prisma.workoutSession.count({
      where: { localDate: dia },
    });
    expect(sesiones).toBe(1);

    // `logSet` es idempotente por (ejercicio, nº de serie): repetir el mismo
    // registro actualiza la fila, nunca crea una segunda "serie 1".
    const we = await prisma.workoutExercise.findFirstOrThrow({
      where: { session: { localDate: dia } },
      select: { id: true },
    });
    const antes = await prisma.setLog.count({
      where: { workoutExerciseId: we.id },
    });
    await expect(
      logSet(profileId, {
        workoutExerciseId: we.id,
        setNumber: 1,
        setType: "WORKING",
        weightKg: 60,
        reps: 10,
        rir: 2,
      }),
    ).rejects.toThrow();
    expect(
      await prisma.setLog.count({ where: { workoutExerciseId: we.id } }),
    ).toBe(antes);
  });
});
