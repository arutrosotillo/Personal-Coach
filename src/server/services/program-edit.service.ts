import { DEFAULT_TIMEZONE, toLocalDate } from "@/core/dates";
import {
  experienceFromYears,
  generateInitialProgram,
} from "@/core/program/generate-initial-program";
import { onboardingSchema } from "@/core/schemas/onboarding";
import type { TemplateExerciseEdit } from "@/core/schemas/template-edit";
import { STRATEGY_TO_GOAL_TYPE } from "@/core/enums";
import { prisma } from "@/server/db";
import { loadCatalog } from "@/server/repositories/catalog.repo";

/**
 * Edición básica del programa (Fase 2A). Modifica las plantillas del programa
 * activo. La edición NO reescribe el historial: las sesiones ya guardadas
 * conservan su snapshot en WorkoutExercise.
 */

async function assertTemplateExerciseOwned(profileId: string, id: string) {
  return prisma.templateExercise.findFirstOrThrow({
    where: {
      id,
      template: {
        deletedAt: null,
        mesocycle: { program: { profileId, isActive: true } },
      },
    },
    include: { template: true },
  });
}

/** Edita series/rango de reps/RIR/descanso de un ejercicio de plantilla. */
export async function editTemplateExercise(
  profileId: string,
  templateExerciseId: string,
  edit: TemplateExerciseEdit,
) {
  await assertTemplateExerciseOwned(profileId, templateExerciseId);
  // Normaliza el rango si viene invertido, sin descartar ninguno de los dos.
  const repRangeMin = Math.min(edit.repRangeMin, edit.repRangeMax);
  const repRangeMax = Math.max(edit.repRangeMin, edit.repRangeMax);
  await prisma.templateExercise.update({
    where: { id: templateExerciseId },
    data: {
      baseSets: edit.baseSets,
      repRangeMin,
      repRangeMax,
      targetRir: edit.targetRir,
      restSeconds: edit.restSeconds,
    },
  });
}

/** Cambia la variante (o sustituye por otro ejercicio) tomando su rango/descanso. */
export async function changeTemplateVariant(
  profileId: string,
  templateExerciseId: string,
  newVariantId: string,
) {
  await assertTemplateExerciseOwned(profileId, templateExerciseId);
  const variant = await prisma.exerciseVariant.findFirstOrThrow({
    where: { id: newVariantId, deletedAt: null },
  });
  await prisma.templateExercise.update({
    where: { id: templateExerciseId },
    data: {
      exerciseVariantId: variant.id,
      repRangeMin: variant.repRangeMin,
      repRangeMax: variant.repRangeMax,
      restSeconds: variant.defaultRestSeconds,
    },
  });
}

/** Sube o baja un ejercicio en el orden de la plantilla (intercambia ordinales). */
export async function reorderTemplateExercise(
  profileId: string,
  templateExerciseId: string,
  direction: "up" | "down",
) {
  const te = await assertTemplateExerciseOwned(profileId, templateExerciseId);
  const siblings = await prisma.templateExercise.findMany({
    where: { templateId: te.templateId },
    orderBy: { ordinal: "asc" },
  });
  const idx = siblings.findIndex((s) => s.id === te.id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  const other = siblings[swapIdx];
  // Intercambio en dos pasos con un ordinal temporal (evita chocar con @@unique).
  await prisma.$transaction([
    prisma.templateExercise.update({
      where: { id: te.id },
      data: { ordinal: -1 },
    }),
    prisma.templateExercise.update({
      where: { id: other.id },
      data: { ordinal: te.ordinal },
    }),
    prisma.templateExercise.update({
      where: { id: te.id },
      data: { ordinal: other.ordinal },
    }),
  ]);
}

/** Elimina un ejercicio de la plantilla y compacta los ordinales. */
export async function removeTemplateExercise(
  profileId: string,
  templateExerciseId: string,
) {
  const te = await assertTemplateExerciseOwned(profileId, templateExerciseId);
  await prisma.$transaction(async (tx) => {
    // Un día no puede quedarse sin ejercicios. Si se vacía, sigue apareciendo
    // como entrenable: se puede empezar una sesión de 0 ejercicios, terminarla
    // sin registrar nada, y esa sesión fantasma marca el día como hecho y
    // puede convertirse en el ancla desde la que se cuentan las semanas del
    // mesociclo. El plan de F3.1 ya lo daba por bloqueado; no lo estaba.
    const quedan = await tx.templateExercise.count({
      where: { templateId: te.templateId },
    });
    if (quedan <= 1) {
      throw new Error(
        "Un día necesita al menos un ejercicio. Quita el día entero si no lo quieres.",
      );
    }
    await tx.templateExercise.delete({ where: { id: te.id } });
    const rest = await tx.templateExercise.findMany({
      where: { templateId: te.templateId },
      orderBy: { ordinal: "asc" },
    });
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].ordinal !== i + 1) {
        await tx.templateExercise.update({
          where: { id: rest[i].id },
          data: { ordinal: i + 1 },
        });
      }
    }
  });
}

/** Añade un ejercicio (variante) al final de una plantilla. */
export async function addTemplateExercise(
  profileId: string,
  templateId: string,
  variantId: string,
) {
  const template = await prisma.workoutTemplate.findFirstOrThrow({
    where: {
      id: templateId,
      deletedAt: null,
      mesocycle: { program: { profileId, isActive: true } },
    },
  });
  const variant = await prisma.exerciseVariant.findFirstOrThrow({
    where: { id: variantId, deletedAt: null },
  });
  const max = await prisma.templateExercise.aggregate({
    where: { templateId },
    _max: { ordinal: true },
  });
  await prisma.templateExercise.create({
    data: {
      templateId: template.id,
      exerciseVariantId: variant.id,
      ordinal: (max._max.ordinal ?? 0) + 1,
      baseSets: 3,
      repRangeMin: variant.repRangeMin,
      repRangeMax: variant.repRangeMax,
      targetRir: 2,
      restSeconds: variant.defaultRestSeconds,
    },
  });
}

/**
 * Restaura el programa inicial regenerándolo desde el onboarding guardado en
 * la AlgorithmDecision. Reemplaza las plantillas del mesociclo (las sesiones ya
 * completadas conservan su snapshot y no se tocan).
 */
export async function restoreInitialProgram(
  profileId: string,
  now: Date = new Date(),
) {
  const program = await prisma.trainingProgram.findFirstOrThrow({
    where: { profileId, isActive: true, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { mesocycles: { orderBy: { ordinal: "asc" }, take: 1 } },
  });
  const mesocycle = program.mesocycles[0];
  if (!mesocycle) throw new Error("El programa activo no tiene mesociclos.");
  // Solo los programas GENERADOS tienen un plan inicial que restaurar. Para un
  // programa manual se falla de forma controlada (nunca findFirstOrThrow crudo).
  const recommendation = await prisma.recommendation.findFirst({
    where: { type: "INITIAL_PROGRAM", scopeId: program.id },
    include: { decision: true },
  });
  if (!recommendation) {
    throw new Error(
      "Este programa es manual: no tiene un plan inicial que restaurar.",
    );
  }
  const snapshot = recommendation.decision.inputSnapshot as {
    onboarding?: unknown;
  };
  // Snapshot de una versión antigua puede no validar contra el schema actual:
  // fallo CONTROLADO en vez de un error Zod crudo.
  const parsedOnboarding = onboardingSchema.safeParse(snapshot.onboarding);
  if (!parsedOnboarding.success) {
    throw new Error(
      "No se puede restaurar: el plan inicial es de una versión anterior.",
    );
  }
  const data = parsedOnboarding.data;

  const catalog = await loadCatalog();
  const regenerated = generateInitialProgram({
    daysPerWeek: data.daysPerWeek,
    minutesPerSession: data.minutesPerSession,
    equipment: data.equipment,
    contraindications: data.contraindications,
    excludedExerciseNames: data.excludedExerciseNames,
    priorityMuscles: data.balancedProgram ? [] : data.priorityMuscles,
    goalType: STRATEGY_TO_GOAL_TYPE[data.strategy],
    experienceLevel: experienceFromYears(data.trainingYears),
    catalog,
  });

  await prisma.$transaction(async (tx) => {
    // Borra plantillas SIN sesiones asociadas; las que tengan sesiones se
    // marcan borradas (soft) para no romper el historial.
    const templates = await tx.workoutTemplate.findMany({
      where: { mesocycleId: mesocycle.id, deletedAt: null },
      include: { _count: { select: { sessions: true } } },
    });
    // Las plantillas con historial se conservan (soft-delete). Su `ordinal` se
    // mueve a un valor negativo distinto: @@unique([mesocycleId, ordinal]) NO
    // excluye filas borradas en SQLite, así que hay que liberar los ordinales
    // 1..N antes de recrear el plan. El contador arranca POR DEBAJO de todos los
    // ordinales existentes (incluidos días ya soft-borrados por removeDay).
    const minOrd = await tx.workoutTemplate.aggregate({
      where: { mesocycleId: mesocycle.id },
      _min: { ordinal: true },
    });
    let archivedOrdinal = Math.min(-1, (minOrd._min.ordinal ?? 0) - 1);
    for (const t of templates) {
      if (t._count.sessions > 0) {
        await tx.workoutTemplate.update({
          where: { id: t.id },
          data: { deletedAt: toLocalDateNow(now), ordinal: archivedOrdinal-- },
        });
      } else {
        await tx.templateExercise.deleteMany({ where: { templateId: t.id } });
        await tx.workoutTemplate.delete({ where: { id: t.id } });
      }
    }
    for (const day of regenerated.days) {
      await tx.workoutTemplate.create({
        data: {
          mesocycleId: mesocycle.id,
          name: day.name,
          ordinal: day.ordinal,
          exercises: {
            create: day.exercises.map((e, i) => ({
              exerciseVariantId: e.variantId,
              ordinal: i + 1,
              baseSets: e.sets,
              repRangeMin: e.repRangeMin,
              repRangeMax: e.repRangeMax,
              targetRir: e.targetRir,
              restSeconds: e.restSeconds,
            })),
          },
        },
      });
    }
    // Mantiene daysPerWeek en sync (restore puede cambiar el nº de días vivos).
    await syncDaysPerWeek(tx, mesocycle.id);
  });

  function toLocalDateNow(d: Date) {
    // deletedAt es DateTime; usamos el instante actual.
    void toLocalDate(d, DEFAULT_TIMEZONE);
    return d;
  }
}

/**
 * Reactiva un programa ARCHIVADO del perfil: archiva el activo actual y activa
 * el elegido, en una transacción. NO crea un programa nuevo, NO regenera
 * plantillas, NO toca sesiones/snapshots/SetLogs. La transacción realiza el
 * cambio y un índice parcial de DB impide dos programas activos vivos. El
 * historial por variante sigue funcionando (scoped a perfil).
 */
export async function reactivateProgram(profileId: string, programId: string) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.trainingProgram.findFirst({
      where: { id: programId, profileId, deletedAt: null },
    });
    if (!target) {
      throw new Error("El programa no existe o no es tuyo.");
    }
    if (target.isActive) return; // ya activo: no-op

    const inProgress = await tx.workoutSession.findFirst({
      where: { status: "IN_PROGRESS", mesocycle: { program: { profileId } } },
      select: { id: true },
    });
    if (inProgress) {
      throw new Error(
        "Finaliza o descarta la sesión en curso antes de cambiar de programa.",
      );
    }

    await tx.trainingProgram.updateMany({
      where: { profileId, isActive: true },
      data: { isActive: false },
    });
    await tx.trainingProgram.update({
      where: { id: target.id },
      data: { isActive: true },
    });
  });
}

// ============ OPERACIONES DE DÍA (Fase 3.1) ============
// Un "día" = un WorkoutTemplate. Funcionan sobre el programa ACTIVO del perfil
// (manual o generado). @@unique([mesocycleId, ordinal]) obliga a la misma danza
// de ordinales que la edición de ejercicios.

/** Plantilla propiedad del perfil en su programa activo (no borrada). */
async function assertTemplateOwned(profileId: string, templateId: string) {
  return prisma.workoutTemplate.findFirstOrThrow({
    where: {
      id: templateId,
      deletedAt: null,
      mesocycle: { program: { profileId, isActive: true } },
    },
  });
}

/** Mesociclo activo del perfil (el primero del programa activo). */
async function activeMesocycle(profileId: string) {
  return prisma.mesocycle.findFirstOrThrow({
    where: { program: { profileId, isActive: true, deletedAt: null } },
    orderBy: { ordinal: "asc" },
  });
}

/** Añade un día (plantilla) al final del programa activo, con un ejercicio inicial. */
export async function addDay(
  profileId: string,
  name: string,
  firstVariantId: string,
) {
  const mesocycle = await activeMesocycle(profileId);
  const variant = await prisma.exerciseVariant.findFirstOrThrow({
    where: { id: firstVariantId, deletedAt: null },
  });
  const max = await prisma.workoutTemplate.aggregate({
    where: { mesocycleId: mesocycle.id, deletedAt: null },
    _max: { ordinal: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.workoutTemplate.create({
      data: {
        mesocycleId: mesocycle.id,
        name: name.trim() || "Día nuevo",
        ordinal: (max._max.ordinal ?? 0) + 1,
        exercises: {
          create: {
            exerciseVariantId: variant.id,
            ordinal: 1,
            baseSets: 3,
            repRangeMin: variant.repRangeMin,
            repRangeMax: variant.repRangeMax,
            targetRir: 2,
            restSeconds: variant.defaultRestSeconds,
          },
        },
      },
    });
    await syncDaysPerWeek(tx, mesocycle.id);
  });
}

/** Renombra un día. */
export async function renameDay(
  profileId: string,
  templateId: string,
  name: string,
) {
  await assertTemplateOwned(profileId, templateId);
  await prisma.workoutTemplate.update({
    where: { id: templateId },
    data: { name: name.trim() || "Día nuevo" },
  });
}

/**
 * Elimina un día. Si tiene sesiones, se soft-borra y se mueve a un ordinal
 * negativo (el @@unique NO filtra deletedAt); si no, se borra en firme y se
 * compactan ordinales. Rechaza borrar el ÚLTIMO día vivo (invariante ≥1 día).
 */
export async function removeDay(profileId: string, templateId: string) {
  const template = await assertTemplateOwned(profileId, templateId);
  const alive = await prisma.workoutTemplate.findMany({
    where: { mesocycleId: template.mesocycleId, deletedAt: null },
    orderBy: { ordinal: "asc" },
  });
  if (alive.length <= 1) {
    throw new Error("Un programa necesita al menos un día.");
  }
  const sessionCount = await prisma.workoutSession.count({
    where: { templateId },
  });

  await prisma.$transaction(async (tx) => {
    if (sessionCount > 0) {
      // Libera su ordinal moviéndolo a negativo (único) y soft-borra.
      const min = await tx.workoutTemplate.aggregate({
        where: { mesocycleId: template.mesocycleId },
        _min: { ordinal: true },
      });
      const parked = Math.min(-1, (min._min.ordinal ?? 0) - 1);
      await tx.workoutTemplate.update({
        where: { id: templateId },
        data: { deletedAt: new Date(), ordinal: parked },
      });
    } else {
      await tx.templateExercise.deleteMany({ where: { templateId } });
      await tx.workoutTemplate.delete({ where: { id: templateId } });
    }
    // Compacta los vivos a 1..N.
    const rest = await tx.workoutTemplate.findMany({
      where: { mesocycleId: template.mesocycleId, deletedAt: null },
      orderBy: { ordinal: "asc" },
    });
    // Mueve todos a un rango temporal negativo para evitar choques de @@unique.
    for (let i = 0; i < rest.length; i++) {
      await tx.workoutTemplate.update({
        where: { id: rest[i].id },
        data: { ordinal: -(1000 + i) },
      });
    }
    for (let i = 0; i < rest.length; i++) {
      await tx.workoutTemplate.update({
        where: { id: rest[i].id },
        data: { ordinal: i + 1 },
      });
    }
    await syncDaysPerWeek(tx, template.mesocycleId);
  });
}

/** Sube o baja un día en el orden (intercambia ordinales con temporal). */
export async function reorderDay(
  profileId: string,
  templateId: string,
  direction: "up" | "down",
) {
  const template = await assertTemplateOwned(profileId, templateId);
  const siblings = await prisma.workoutTemplate.findMany({
    where: { mesocycleId: template.mesocycleId, deletedAt: null },
    orderBy: { ordinal: "asc" },
  });
  const idx = siblings.findIndex((s) => s.id === template.id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  const other = siblings[swapIdx];
  // Ordinal temporal por debajo de TODOS los existentes (incluidos los días
  // soft-borrados aparcados en negativo): un `-1` fijo colisionaría con un día
  // borrado que removeDay dejó en -1 (@@unique no filtra deletedAt en SQLite).
  const { _min } = await prisma.workoutTemplate.aggregate({
    where: { mesocycleId: template.mesocycleId },
    _min: { ordinal: true },
  });
  const temp = Math.min(-1, (_min.ordinal ?? 0) - 1);
  await prisma.$transaction([
    prisma.workoutTemplate.update({
      where: { id: template.id },
      data: { ordinal: temp },
    }),
    prisma.workoutTemplate.update({
      where: { id: other.id },
      data: { ordinal: template.ordinal },
    }),
    prisma.workoutTemplate.update({
      where: { id: template.id },
      data: { ordinal: other.ordinal },
    }),
  ]);
}

/** Mantiene TrainingProgram.daysPerWeek = nº de plantillas vivas. */
async function syncDaysPerWeek(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  mesocycleId: string,
) {
  const meso = await tx.mesocycle.findUniqueOrThrow({
    where: { id: mesocycleId },
    select: { programId: true },
  });
  const count = await tx.workoutTemplate.count({
    where: { mesocycleId, deletedAt: null },
  });
  await tx.trainingProgram.update({
    where: { id: meso.programId },
    data: { daysPerWeek: count },
  });
}
