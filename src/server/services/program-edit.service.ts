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
  const recommendation = await prisma.recommendation.findFirstOrThrow({
    where: { type: "INITIAL_PROGRAM", scopeId: program.id },
    include: { decision: true },
  });
  const snapshot = recommendation.decision.inputSnapshot as {
    onboarding?: unknown;
  };
  const data = onboardingSchema.parse(snapshot.onboarding);

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
    // 1..N antes de recrear el plan.
    let archivedOrdinal = -1;
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
  });

  function toLocalDateNow(d: Date) {
    // deletedAt es DateTime; usamos el instante actual.
    void toLocalDate(d, DEFAULT_TIMEZONE);
    return d;
  }
}
