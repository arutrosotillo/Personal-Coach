import { diffDays } from "@/core/dates";
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
 * Nota sobre `Mesocycle`: hoy `currentWeek` nunca avanza y `weekKind` es
 * siempre `ACCUMULATION`, así que la "semana" del mesociclo no es un dato
 * fiable. Las semanas de acumulación se DERIVAN de las fechas reales de las
 * sesiones — sin migración y sin inventar estructura (docs/TRAINING_ENGINE.md).
 */
export async function getTrainingContext(
  profileId: string,
  sinceLocalDate: string,
  todayLocalDate: string,
): Promise<TrainingContext> {
  const sessions = await prisma.workoutSession.findMany({
    where: {
      status: "COMPLETED",
      localDate: { gte: sinceLocalDate, lte: todayLocalDate },
      mesocycle: { program: { profileId } },
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

  const contextSessions: ContextSession[] = sessions.map((s) => {
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
      completionRate:
        plannedSets > 0 ? Math.min(1, loggedSets / plannedSets) : 0,
      durationMin:
        s.startedAt && s.finishedAt
          ? Math.round((s.finishedAt.getTime() - s.startedAt.getTime()) / 60000)
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

  const variants = [...byVariant.values()].map((v) => ({
    ...v,
    daysSinceLast: diffDays(
      v.exposures[v.exposures.length - 1].localDate,
      todayLocalDate,
    ),
  }));

  // ── Semanas de acumulación continua ────────────────────────────────────
  const lastDeload = await prisma.workoutSession.findFirst({
    where: {
      status: "COMPLETED",
      weekKind: "DELOAD",
      mesocycle: { program: { profileId } },
    },
    orderBy: { localDate: "desc" },
    select: { localDate: true },
  });
  const firstEver = await prisma.workoutSession.findFirst({
    where: {
      status: "COMPLETED",
      mesocycle: { program: { profileId, isActive: true, deletedAt: null } },
    },
    orderBy: { localDate: "asc" },
    select: { localDate: true },
  });
  const anchor = lastDeload?.localDate ?? firstEver?.localDate ?? null;
  const weeksSinceDeload =
    anchor === null ? null : Math.floor(diffDays(anchor, todayLocalDate) / 7);

  return {
    todayLocalDate,
    sinceLocalDate,
    sessions: contextSessions,
    variants,
    weeksSinceDeload,
  };
}
