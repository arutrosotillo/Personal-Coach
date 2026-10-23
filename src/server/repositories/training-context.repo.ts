import { FATIGUE, PROGRESSION } from "@/core/config/training-config";
import { addDays, diffDays } from "@/core/dates";
import type {
  ContextExposure,
  ContextSession,
  ContextVariant,
  TrainingContext,
} from "@/core/training/analysis";
import type { TimelineSession } from "@/core/training/deload";
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
  //
  // Las sesiones de DESCARGA van a su propio montón y solo se usan si son lo
  // ÚNICO que hay de esa variante. Hiciste menos series a propósito, así que no
  // dicen nada nuevo sobre tu capacidad a esa carga. Si entraran, obedecer la
  // descarga se penalizaba OTRA VEZ, ahora en el motor de progresión: media
  // sesión dispara `SESSION_INCOMPLETE` ("repite y complétala", de la sesión
  // que la propia app te mandó recortar) y las repeticiones totales partidas
  // por la mitad fabrican `PLATEAU_SIGNAL` → `WIDESPREAD_PLATEAU` → dos puntos
  // OBJETIVOS que sostienen la SIGUIENTE recomendación de descarga. Es decir:
  // hacer la descarga alimentaba el bucle que pide otra. Tampoco su
  // prescripción: si recortaste con "− Quitar serie", el snapshot dice 2 series
  // donde tu programa dice 4.
  //
  // Pero si la variante SOLO existe en descargas —la sustituiste esa semana
  // porque la máquina estaba ocupada—, descartarlas la dejaba sin una sola
  // exposición, y leer "la última" rompía `/train` y `/coach`. Ahí la descarga
  // es mejor referencia que ninguna: la carga fue la de siempre. Es la misma
  // regla que aplica `workout.repo` a la pantalla de sesión.
  //
  // Los datos NO se pierden: las series, cargas, reps y RIR siguen en la base,
  // en el historial y en el e1RM (`getVariantHistory` los lee).
  interface Bucket {
    prescription: ContextVariant["prescription"];
    exposures: ContextExposure[];
  }
  interface Entry {
    exerciseName: string;
    variantName: string;
    normal: Bucket | null;
    deload: Bucket | null;
  }
  const byVariant = new Map<string, Entry>();
  for (const session of sessions) {
    const chosen = new Map<string, (typeof session.exercises)[number]>();
    for (const we of session.exercises) {
      if (we.setLogs.length === 0) continue;
      const current = chosen.get(we.exerciseVariantId);
      if (!current || we.ordinal < current.ordinal) {
        chosen.set(we.exerciseVariantId, we);
      }
    }
    const kind = session.weekKind === "DELOAD" ? "deload" : "normal";
    for (const [variantId, we] of chosen) {
      let entry = byVariant.get(variantId);
      if (!entry) {
        entry = {
          exerciseName: we.exerciseVariant.exercise.name,
          variantName: we.exerciseVariant.name,
          normal: null,
          deload: null,
        };
        byVariant.set(variantId, entry);
      }
      const bucket = (entry[kind] ??= {
        prescription: prescriptionOf(we),
        exposures: [],
      });
      // La prescripción vigente es la del snapshot más reciente.
      bucket.prescription = prescriptionOf(we);
      bucket.exposures.push({
        localDate: session.localDate,
        sets: we.setLogs.map((x) => ({
          weightKg: x.weightKg,
          reps: x.reps,
          rir: x.rir,
        })),
      });
    }
  }

  const variants: ContextVariant[] = [];
  for (const [variantId, entry] of byVariant) {
    // Un montón solo existe si tiene al menos una exposición, así que `last`
    // siempre está definido.
    const source = entry.normal ?? entry.deload;
    const last = source?.exposures.at(-1);
    if (!source || !last) continue;
    // Un ejercicio que no has tocado en la ventana no es parte de "cómo va tu
    // entrenamiento ahora"; sus exposiciones antiguas solo sirven para dar
    // contexto a los que SÍ has entrenado.
    if (last.localDate < sinceLocalDate) continue;
    variants.push({
      variantId,
      exerciseName: entry.exerciseName,
      variantName: entry.variantName,
      prescription: source.prescription,
      exposures: source.exposures.slice(-PROGRESSION.HISTORY_WINDOW),
      daysSinceLast: diffDays(last.localDate, todayLocalDate),
    });
  }

  const [timeline, program] = await Promise.all([
    sessionTimeline(profileId, todayLocalDate),
    prisma.trainingProgram.findFirst({
      where: { profileId, isActive: true, deletedAt: null },
      select: { daysPerWeek: true },
    }),
  ]);

  return {
    todayLocalDate,
    sinceLocalDate,
    sessions: contextSessions,
    variants,
    weeksSinceDeload: accumulationWeeks(timeline, todayLocalDate),
    timeline,
    sessionsPerWeek: program?.daysPerWeek ?? null,
  };
}

function prescriptionOf(we: {
  repRangeMin: number;
  repRangeMax: number;
  targetRir: number;
  plannedSets: number;
  exerciseVariant: { loadStepKg: number };
}): ContextVariant["prescription"] {
  return {
    repRangeMin: we.repRangeMin,
    repRangeMax: we.repRangeMax,
    targetRir: we.targetRir,
    plannedSets: we.plannedSets,
    loadStepKg: we.exerciseVariant.loadStepKg,
  };
}

/**
 * TODAS las sesiones completadas hasta hoy —no solo la ventana—, con su fecha
 * y si fueron descarga, de la más antigua a la más reciente. Es lo que permite
 * situar cada descarga (cuándo empezó, si ha terminado, si has vuelto) y
 * contar las semanas de acumulación, sin migración.
 *
 * Cota superior en `todayLocalDate`, igual que la consulta de sesiones: sin
 * ella, una sesión con fecha por delante del "hoy" evaluado dejaba el ancla de
 * acumulación en el futuro y el contador salía NEGATIVO — y un número negativo
 * nunca alcanza el umbral, así que la señal de calendario se apagaba para
 * siempre.
 */
async function sessionTimeline(
  profileId: string,
  todayLocalDate: string,
): Promise<TimelineSession[]> {
  const rows = await prisma.workoutSession.findMany({
    where: {
      status: "COMPLETED",
      localDate: { lte: todayLocalDate },
      mesocycle: { program: PROGRAM_SCOPE(profileId) },
    },
    orderBy: [{ localDate: "asc" }, { finishedAt: "asc" }],
    select: { localDate: true, weekKind: true },
  });
  return rows.map((r) => ({
    localDate: r.localDate,
    deload: r.weekKind === "DELOAD",
  }));
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
function accumulationWeeks(
  timeline: TimelineSession[],
  todayLocalDate: string,
): number | null {
  const deloadDates = timeline
    .filter((s) => s.deload)
    .map((s) => ({ localDate: s.localDate }))
    .reverse();
  const dates = timeline
    .filter((s, i) => i === 0 || s.localDate !== timeline[i - 1].localDate)
    .map((s) => ({ localDate: s.localDate }));
  if (dates.length === 0) return null;

  let anchor = dates[0].localDate;
  for (let i = 1; i < dates.length; i++) {
    const gap = diffDays(dates[i - 1].localDate, dates[i].localDate);
    if (gap >= FATIGUE.ACCUMULATION_RESET_GAP_DAYS) anchor = dates[i].localDate;
  }
  // Hace falta una TANDA de sesiones marcadas, no una suelta: una sola sesión
  // etiquetada no puede borrar diez semanas de acumulación.
  if (deloadDates.length > 0) {
    const ultima = deloadDates[0].localDate;
    const tanda = deloadDates.filter(
      (d) =>
        diffDays(d.localDate, ultima) < FATIGUE.DELOAD_DETECTION.WINDOW_DAYS,
    );
    if (
      tanda.length >= FATIGUE.DELOAD_DETECTION.MIN_SESSIONS_TO_RESET &&
      ultima > anchor
    ) {
      anchor = ultima;
    }
  }

  // Un parón que sigue abierto hoy también cuenta.
  const sinceLast = diffDays(dates[dates.length - 1].localDate, todayLocalDate);
  if (sinceLast >= FATIGUE.ACCUMULATION_RESET_GAP_DAYS) return 0;

  return Math.max(0, Math.floor(diffDays(anchor, todayLocalDate) / 7));
}
