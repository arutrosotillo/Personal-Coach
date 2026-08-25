import { addDays, DEFAULT_TIMEZONE, toLocalDate } from "@/core/dates";
import { estimateOneRepMax } from "@/core/training/e1rm";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Historial FICTICIO de 8 semanas para probar Coach AI y F3.3 sin esperar
 * meses de datos reales.
 *
 * Seguridad (esto escribe en tu base de datos):
 *   · solo se ejecuta con `SEED_DEMO=1`;
 *   · se niega a correr si ya hay sesiones completadas, salvo `SEED_DEMO_FORCE=1`;
 *   · cada sesión queda marcada con `DEMO_MARKER` en las notas, así que se
 *     pueden borrar todas con `clearDemoHistory`.
 *
 * Determinista: LCG con semilla fija, sin `Math.random()`.
 */

export const DEMO_MARKER = "[demo]";

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Guion del atleta ficticio, semana a semana (8 semanas). */
interface WeekScript {
  /** Multiplicador del rendimiento real esa semana. */
  performance: number;
  fatigue: number;
  motivation: number;
  jointPain: number;
  perceivedPerformance: number;
  /** Fracción de las series previstas que llega a registrar. */
  completion: number;
  /**
   * Repeticiones que se restan a lo que tocaría. El multiplicador
   * `performance` solo no basta para sacar al atleta del rango prescrito, así
   * que sin esto las últimas semanas "de fatiga acumulada" tenían el feedback
   * malo y el RENDIMIENTO MEDIDO intacto — y el motor, con razón, no
   * recomendaba nada. La demo debe poder llegar hasta `DELOAD_RECOMMENDED`.
   */
  repPenalty?: number;
  note?: string;
}

const SCRIPT: WeekScript[] = [
  {
    performance: 1.0,
    fatigue: 2,
    motivation: 5,
    jointPain: 1,
    perceivedPerformance: 4,
    completion: 1,
  },
  {
    performance: 1.01,
    fatigue: 2,
    motivation: 4,
    jointPain: 1,
    perceivedPerformance: 4,
    completion: 1,
  },
  {
    performance: 1.02,
    fatigue: 3,
    motivation: 4,
    jointPain: 1,
    perceivedPerformance: 4,
    completion: 1,
  },
  // Semana mala aislada: no debe disparar nada por sí sola.
  {
    performance: 0.93,
    fatigue: 4,
    motivation: 2,
    jointPain: 2,
    perceivedPerformance: 2,
    completion: 0.8,
    note: "Dormí fatal toda la semana",
  },
  {
    performance: 1.03,
    fatigue: 2,
    motivation: 4,
    jointPain: 1,
    perceivedPerformance: 4,
    completion: 1,
  },
  {
    performance: 1.04,
    fatigue: 3,
    motivation: 4,
    jointPain: 3,
    perceivedPerformance: 4,
    completion: 1,
    note: "Molestia en el hombro al empujar",
  },
  // Deriva a fatiga acumulada: el rendimiento MEDIDO cae por debajo del rango
  // dos semanas seguidas y el feedback empeora a la vez.
  {
    performance: 0.99,
    fatigue: 4,
    motivation: 3,
    jointPain: 3,
    perceivedPerformance: 2,
    completion: 0.65,
    repPenalty: 3,
  },
  {
    performance: 0.95,
    fatigue: 5,
    motivation: 2,
    jointPain: 3,
    perceivedPerformance: 2,
    completion: 0.6,
    repPenalty: 4,
    note: "Sesión cortada, sin energía",
  },
];

/**
 * Reparto de papeles entre los ejercicios del programa.
 *
 * Antes esto era `i % templates.length === 2`, con `i` = posición dentro de la
 * sesión y `templates.length` = 3: o sea, "estancado" le tocaba a UNO DE CADA
 * TRES ejercicios pese a que el comentario decía "un ejercicio". Y el índice de
 * "sin RIR" era 4, que `i % 3` no puede valer nunca — así que la demo no
 * contenía un solo set con RIR nulo aunque el código dijera lo contrario.
 *
 * Los papeles se asignan ahora por VARIANTE (estable en todo el programa) y en
 * un orden determinista, así que lo que la demo dice contener es lo que
 * contiene. `assertDemoShape` lo verifica al terminar.
 */
const ROLES = {
  /** Se queda clavado en el mismo peso y reps → PLATEAU_SIGNAL. */
  stalled: 1,
  /** Se registra siempre sin RIR ("No lo sé") → NEEDS_RIR_CONFIRMATION. */
  noRir: 1,
  /** Pierden repeticiones las dos últimas semanas → REPEATED_UNDERPERFORMANCE. */
  declining: 5,
} as const;

export interface DemoSeedResult {
  sessionsCreated: number;
  setsCreated: number;
  fromLocalDate: string;
  toLocalDate: string;
  /** Lo que la demo AFIRMA contener, contado sobre las filas escritas. */
  shape: {
    setsSinRir: number;
    variantesEstancadas: number;
    variantesEnCaida: number;
    variantesProgresando: number;
  };
}

export async function seedDemoHistory(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<DemoSeedResult> {
  const profile = await prisma.userProfile.findFirst();
  if (!profile) {
    throw new Error(
      "No hay perfil. Completa el onboarding antes de sembrar el historial de demo.",
    );
  }
  const program = await prisma.trainingProgram.findFirst({
    where: { profileId: profile.id, isActive: true, deletedAt: null },
    include: {
      mesocycles: {
        orderBy: { ordinal: "asc" },
        take: 1,
        include: {
          templates: {
            where: { deletedAt: null },
            orderBy: { ordinal: "asc" },
            include: {
              exercises: {
                orderBy: { ordinal: "asc" },
                include: { exerciseVariant: true },
              },
            },
          },
        },
      },
    },
  });
  const mesocycle = program?.mesocycles[0];
  if (!program || !mesocycle || mesocycle.templates.length === 0) {
    throw new Error("No hay un programa activo con plantillas que usar.");
  }

  const today = toLocalDate(now, DEFAULT_TIMEZONE);
  const rnd = lcg(20260825);

  // Papeles, repartidos sobre las variantes del programa en orden estable.
  const allVariants = [
    ...new Set(
      mesocycle.templates.flatMap((t) =>
        t.exercises.map((e) => e.exerciseVariantId),
      ),
    ),
  ].sort();
  const stalledIds = new Set(allVariants.slice(0, ROLES.stalled));
  const noRirIds = new Set(
    allVariants.slice(ROLES.stalled, ROLES.stalled + ROLES.noRir),
  );
  const decliningIds = new Set(
    allVariants.slice(
      ROLES.stalled + ROLES.noRir,
      ROLES.stalled + ROLES.noRir + ROLES.declining,
    ),
  );
  // Carga de partida por variante: ~el 70 % de un e1RM ficticio derivado del
  // incremento del material (barra pesada arranca más alto que una polea).
  const startWeight = new Map<string, number>();
  let sessionsCreated = 0;
  let setsCreated = 0;
  let firstDate = today;

  for (let week = 0; week < SCRIPT.length; week++) {
    const script = SCRIPT[week];
    const weeksAgo = SCRIPT.length - week;

    for (const [dayIndex, template] of mesocycle.templates.entries()) {
      const localDate = addDays(today, -(weeksAgo * 7) + dayIndex);
      if (localDate > today) continue;
      if (week === 0 && dayIndex === 0) firstDate = localDate;

      const startedAt = new Date(`${localDate}T18:00:00.000Z`);
      const finishedAt = new Date(`${localDate}T19:10:00.000Z`);

      const session = await prisma.workoutSession.create({
        data: {
          mesocycleId: mesocycle.id,
          templateId: template.id,
          weekNumber: week + 1,
          weekKind: "ACCUMULATION",
          status: "COMPLETED",
          localDate,
          startedAt,
          finishedAt,
          perceivedPerformance: script.perceivedPerformance,
          pump: 3,
          jointPain: script.jointPain,
          fatigue: script.fatigue,
          motivation: script.motivation,
          notes: `${DEMO_MARKER}${script.note ? ` ${script.note}` : ""}`,
          exercises: {
            create: template.exercises.map((te) => ({
              exerciseVariantId: te.exerciseVariantId,
              ordinal: te.ordinal,
              plannedSets: te.baseSets,
              repRangeMin: te.repRangeMin,
              repRangeMax: te.repRangeMax,
              targetRir: te.targetRir,
              restSeconds: te.restSeconds,
            })),
          },
        },
        include: { exercises: true },
      });
      sessionsCreated += 1;

      for (const [i, we] of session.exercises.entries()) {
        const te = template.exercises.find(
          (x) => x.exerciseVariantId === we.exerciseVariantId,
        )!;
        const step = te.exerciseVariant.loadStepKg;
        const key = we.exerciseVariantId;
        if (!startWeight.has(key)) {
          startWeight.set(key, Math.max(step * 8, 10));
        }
        const base = startWeight.get(key)!;
        // Progresión de carga: sube un escalón cada dos semanas, salvo el
        // ejercicio que queremos ver estancado.
        const stalled = stalledIds.has(we.exerciseVariantId);
        const noRir = noRirIds.has(we.exerciseVariantId);
        // Solo unos pocos ejercicios se deterioran: si cayeran los 16, no
        // quedaría ninguno "progresando" y la demo dejaría de parecerse a un
        // atleta real con sobrealcance.
        const penalty = decliningIds.has(we.exerciseVariantId)
          ? (script.repPenalty ?? 0)
          : 0;
        const weight =
          step > 0 ? base + (stalled ? 0 : Math.floor(week / 2) * step) : 0;

        const setsToLog = Math.max(
          1,
          Math.round(we.plannedSets * script.completion),
        );
        for (let s = 1; s <= setsToLog; s++) {
          const spread = 1 - 0.03 * (s - 1);
          const raw =
            (we.repRangeMin +
              (stalled
                ? 0
                : Math.min(week % 4, we.repRangeMax - we.repRangeMin))) *
            script.performance *
            spread;
          const reps = Math.max(1, Math.round(raw + (rnd() - 0.5)) - penalty);
          // Un ejercicio entero SIN RIR registrado ("No lo sé"). El RIR nulo es
          // un caso de primera clase del motor desde F3.2c —no se imputa, baja
          // la confianza y bloquea el salto doble—, así que la demo tiene que
          // contenerlo o esa rama no se puede probar con datos.
          const rir = noRir
            ? null
            : Math.max(
                0,
                Math.min(4, we.targetRir + (script.performance < 1 ? -1 : 0)),
              );
          await prisma.setLog.create({
            data: {
              workoutExerciseId: we.id,
              exerciseVariantId: we.exerciseVariantId,
              localDate,
              setNumber: s,
              setType: "WORKING",
              weightKg: weight,
              reps,
              rir,
              completed: true,
              estimated1Rm: estimateOneRepMax(weight, reps, rir),
              notes: DEMO_MARKER,
            },
          });
          setsCreated += 1;
        }
      }
    }
  }

  // Comprobación de forma: la demo existe para probar ramas concretas del
  // motor, así que se cuenta sobre las filas realmente escritas en vez de
  // confiar en que los índices de arriba signifiquen lo que parecen. Dos
  // defectos así ya se colaron: "un ejercicio estancado" era en realidad uno de
  // cada tres, y el ejercicio "sin RIR" no existía porque su índice era
  // inalcanzable.
  const setsSinRir = await prisma.setLog.count({
    where: { rir: null, notes: DEMO_MARKER },
  });
  if (setsSinRir === 0) {
    throw new Error(
      "El seed de demo dice incluir series sin RIR y no ha escrito ninguna.",
    );
  }

  return {
    sessionsCreated,
    setsCreated,
    fromLocalDate: firstDate,
    toLocalDate: today,
    shape: {
      setsSinRir,
      variantesEstancadas: stalledIds.size,
      variantesEnCaida: decliningIds.size,
      variantesProgresando:
        allVariants.length - stalledIds.size - decliningIds.size,
    },
  };
}

/** Borra TODO lo sembrado por el seed de demo (y solo eso). */
export async function clearDemoHistory(
  prisma: PrismaClient,
): Promise<{ sessionsDeleted: number }> {
  const sessions = await prisma.workoutSession.findMany({
    where: { notes: { startsWith: DEMO_MARKER } },
    select: { id: true },
  });
  const ids = sessions.map((s) => s.id);
  if (ids.length === 0) return { sessionsDeleted: 0 };
  await prisma.setLog.deleteMany({
    where: { workoutExercise: { sessionId: { in: ids } } },
  });
  await prisma.workoutExercise.deleteMany({
    where: { sessionId: { in: ids } },
  });
  await prisma.workoutSession.deleteMany({ where: { id: { in: ids } } });
  return { sessionsDeleted: ids.length };
}
