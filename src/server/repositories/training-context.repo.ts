import { FATIGUE, PROGRESSION } from "@/core/config/training-config";
import { addDays, diffDays } from "@/core/dates";
import type {
  ContextSession,
  ContextVariant,
  TrainingContext,
} from "@/core/training/analysis";
import { prisma } from "@/server/db";

/**
 * Lectura longitudinal del entrenamiento (Fase 3.3). Una sola fuente para el
 * motor de fatiga y para el context builder de Coach AI: así los dos ven
 * exactamente los mismos hechos y no pueden divergir.
 *
 * Todo lo que devuelve son DATOS CRUDOS AGREGADOS; ninguna interpretación vive
 * aquí (eso es `core/`).
 */

/**
 * Contexto de entrenamiento desde `sinceLocalDate` (inclusive) hasta hoy.
 *
 * Nota sobre `Mesocycle`: `currentWeek` nunca avanza (nadie lo actualiza), así
 * que la "semana" del mesociclo no es un dato fiable. `weekKind` SÍ se escribe
 * desde el micro-hardening posterior a la QA: vale `DELOAD` cuando el usuario
 * ejecuta de verdad la descarga recomendada. Las semanas de acumulación se DERIVAN de las fechas reales de las
 * sesiones — sin migración y sin inventar estructura (docs/TRAINING_ENGINE.md).
 *
 * Dos ventanas distintas, a propósito:
 *   · las SESIONES se acotan a `sinceLocalDate` (es la ventana de fatiga);
 *   · las EXPOSICIONES de cada ejercicio se acotan por NÚMERO (`HISTORY_WINDOW`),
 *     igual que hace `workout.repo` para la pantalla de sesión. Antes se
 *     acotaban por días, así que el mismo motor contaba "6 sesiones seguidas
 *     por debajo del rango" al entrenar y "4" en la tarjeta de recuperación:
 *     los mismos hechos con números distintos en dos pantallas.
 */

/** Margen hacia atrás para completar `HISTORY_WINDOW` exposiciones. */
const EXPOSURE_LOOKBACK_DAYS = 180;

/**
 * Ámbito de TODAS las lecturas de este fichero: el perfil entero, **incluidos
 * los programas archivados**.
 *
 * Es deliberado y contraintuitivo, así que conviene dejarlo escrito. Una
 * revisión propuso acotar al programa activo, porque las sesiones de programas
 * abandonados llenaban la ventana de "las últimas 4 sesiones" con sus chips a
 * NULL. Pero acotar rompe algo peor: cambiar de programa es una operación
 * NORMAL en esta app (F3.1b), y con el filtro el motor de fatiga se quedaría
 * ciego tres semanas después de cada cambio — justo cuando el usuario acaba de
 * terminar un bloque y más probable es que necesite descargar. Una sesión que
 * entrenaste es un hecho sobre tu cuerpo; no deja de serlo porque cambies la
 * fila del programa a la que cuelga.
 *
 * Además `workout.repo` (la pantalla de sesión) lee igual, así que las dos
 * pantallas ven los mismos hechos. Divergir aquí es exactamente el defecto que
 * este fichero intenta no tener.
 *
 * (`TrainingProgram.deletedAt` no lo escribe nadie hoy — el borrado suave solo
 * existe en `WorkoutTemplate`—, pero el filtro se deja puesto para que un
 * borrado real, si algún día se implementa, no cuente como entrenamiento.)
 */
const PROGRAM_SCOPE = (profileId: string) => ({ profileId, deletedAt: null });
export async function getTrainingContext(
  profileId: string,
  sinceLocalDate: string,
  todayLocalDate: string,
): Promise<TrainingContext> {
  const exposuresSince = addDays(todayLocalDate, -EXPOSURE_LOOKBACK_DAYS);
  const sessions = await prisma.workoutSession.findMany({
    where: {
      status: "COMPLETED",
      localDate: {
        gte: exposuresSince < sinceLocalDate ? exposuresSince : sinceLocalDate,
        lte: todayLocalDate,
      },
      mesocycle: { program: PROGRAM_SCOPE(profileId) },
    },
    orderBy: { localDate: "asc" },
    include: {
      template: { select: { name: true } },
      exercises: {
        include: {
          exerciseVariant: {
            select: {
              id: true,
              name: true,
              loadStepKg: true,
              exercise: { select: { name: true } },
            },
          },
          setLogs: {
            where: { setType: "WORKING", completed: true, reps: { gt: 0 } },
            orderBy: { setNumber: "asc" },
          },
        },
      },
    },
  });

  const contextSessions: ContextSession[] = sessions
    .filter((s) => s.localDate >= sinceLocalDate)
    .map((s) => {
      const plannedSets = s.exercises.reduce((a, e) => a + e.plannedSets, 0);
      const loggedSets = s.exercises.reduce((a, e) => a + e.setLogs.length, 0);
      return {
        id: s.id,
        localDate: s.localDate,
        templateName: s.template?.name ?? "Sesión",
        perceivedPerformance: s.perceivedPerformance,
        pump: s.pump,
        jointPain: s.jointPain,
        fatigue: s.fatigue,
        motivation: s.motivation,
        notes: s.notes,
        plannedSets,
        loggedSets,
        deload: s.weekKind === "DELOAD",
        // `null`, no 0: una sesión sin series previstas no es una sesión
        // "acortada". Con 0 el motor la contaba como abandono.
        completionRate:
          plannedSets > 0 ? Math.min(1, loggedSets / plannedSets) : null,
        durationMin:
          s.startedAt && s.finishedAt
            ? Math.round(
                (s.finishedAt.getTime() - s.startedAt.getTime()) / 60000,
              )
            : null,
      };
    });

  // ── Agrupación por variante ────────────────────────────────────────────
  // Una sesión aporta como mucho UNA exposición por variante: si la misma
  // variante aparece dos veces el mismo día (principal + back-off), se toma la
  // de menor `ordinal`, igual que hace `workout.repo` para el motor.
  const byVariant = new Map<string, ContextVariant>();
  for (const session of sessions) {
    const chosen = new Map<string, (typeof session.exercises)[number]>();
    for (const we of session.exercises) {
      if (we.setLogs.length === 0) continue;
      const current = chosen.get(we.exerciseVariantId);
      if (!current || we.ordinal < current.ordinal) {
        chosen.set(we.exerciseVariantId, we);
      }
    }
    for (const [variantId, we] of chosen) {
      let entry = byVariant.get(variantId);
      if (!entry) {
        entry = {
          variantId,
          exerciseName: we.exerciseVariant.exercise.name,
          variantName: we.exerciseVariant.name,
          prescription: {
            repRangeMin: we.repRangeMin,
            repRangeMax: we.repRangeMax,
            targetRir: we.targetRir,
            plannedSets: we.plannedSets,
            loadStepKg: we.exerciseVariant.loadStepKg,
          },
          exposures: [],
          daysSinceLast: 0,
        };
        byVariant.set(variantId, entry);
      }
      // La prescripción vigente es la del snapshot más reciente.
      entry.prescription = {
        repRangeMin: we.repRangeMin,
        repRangeMax: we.repRangeMax,
        targetRir: we.targetRir,
        plannedSets: we.plannedSets,
        loadStepKg: we.exerciseVariant.loadStepKg,
      };
      entry.exposures.push({
        localDate: session.localDate,
        sets: we.setLogs.map((x) => ({
          weightKg: x.weightKg,
          reps: x.reps,
          rir: x.rir,
        })),
      });
    }
  }

  const variants = [...byVariant.values()]
    // Un ejercicio que no has tocado en la ventana no es parte de "cómo va tu
    // entrenamiento ahora"; sus exposiciones antiguas solo sirven para dar
    // contexto a los que SÍ has entrenado.
    .filter(
      (v) => v.exposures[v.exposures.length - 1].localDate >= sinceLocalDate,
    )
    .map((v) => ({
      ...v,
      exposures: v.exposures.slice(-PROGRESSION.HISTORY_WINDOW),
      daysSinceLast: diffDays(
        v.exposures[v.exposures.length - 1].localDate,
        todayLocalDate,
      ),
    }));

  const weeksSinceDeload = await accumulationWeeks(profileId, todayLocalDate);

  return {
    todayLocalDate,
    sinceLocalDate,
    sessions: contextSessions,
    variants,
    weeksSinceDeload,
  };
}

/**
 * Semanas entrenando SEGUIDO, sin una semana suave ni un parón.
 *
 * El ancla es la más reciente de tres fechas: la última sesión marcada como
 * DELOAD, la primera sesión registrada, y la primera sesión posterior a un
 * hueco de `ACCUMULATION_RESET_GAP_DAYS` días sin entrenar. NO se ancla en el
 * programa activo: generar un programa nuevo es un acto administrativo y no
 * debería reiniciar tus semanas de acumulación real.
 *
 * Las dos últimas anclas cubren cada una un caso distinto, y hacen falta las
 * dos. La sesión `DELOAD` es la descarga que el usuario HIZO: sin ella, quien
 * obedece la recomendación seguiría leyendo "llevas 10 semanas sin una semana
 * suave" la semana siguiente de haberla hecho. El hueco de días cubre a quien
 * simplemente para: sin él, quien se toma tres meses libres leería "llevas 85
 * semanas seguidas acumulando". Un parón real ES, funcionalmente, la semana
 * suave que la señal busca.
 */
async function accumulationWeeks(
  profileId: string,
  todayLocalDate: string,
): Promise<number | null> {
  const scope = PROGRAM_SCOPE(profileId);
  const [lastDeload, dates] = await Promise.all([
    prisma.workoutSession.findFirst({
      where: {
        status: "COMPLETED",
        weekKind: "DELOAD",
        mesocycle: { program: scope },
      },
      orderBy: { localDate: "desc" },
      select: { localDate: true },
    }),
    prisma.workoutSession.findMany({
      where: { status: "COMPLETED", mesocycle: { program: scope } },
      orderBy: { localDate: "asc" },
      select: { localDate: true },
      distinct: ["localDate"],
    }),
  ]);
  if (dates.length === 0) return null;

  let anchor = dates[0].localDate;
  for (let i = 1; i < dates.length; i++) {
    const gap = diffDays(dates[i - 1].localDate, dates[i].localDate);
    if (gap >= FATIGUE.ACCUMULATION_RESET_GAP_DAYS) anchor = dates[i].localDate;
  }
  if (lastDeload && lastDeload.localDate > anchor)
    anchor = lastDeload.localDate;

  // Un parón que sigue abierto hoy también cuenta.
  const sinceLast = diffDays(dates[dates.length - 1].localDate, todayLocalDate);
  if (sinceLast >= FATIGUE.ACCUMULATION_RESET_GAP_DAYS) return 0;

  return Math.floor(diffDays(anchor, todayLocalDate) / 7);
}
