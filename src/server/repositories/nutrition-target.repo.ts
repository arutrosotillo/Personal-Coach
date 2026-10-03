import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/server/db";

/**
 * Objetivos calóricos y sus ajustes. Las filas de `NutritionTarget` SON el
 * historial: un ajuste nunca edita la fila vigente, crea otra con
 * `effectiveFrom` de hoy. La vigente es la de `effectiveFrom` más reciente.
 */

export interface NutritionTargetRecord {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  effectiveFrom: string;
  source: string;
}

const TARGET_SELECT = {
  kcal: true,
  proteinG: true,
  fatG: true,
  carbsG: true,
  effectiveFrom: true,
  source: true,
} as const;

/** Los dos últimos objetivos, el vigente primero: con ellos se sabe el último cambio. */
export async function listLatestTargets(
  profileId: string,
): Promise<NutritionTargetRecord[]> {
  return prisma.nutritionTarget.findMany({
    where: { profileId },
    orderBy: { effectiveFrom: "desc" },
    take: 2,
    select: TARGET_SELECT,
  });
}

/** Día del último "ahora no" a un ajuste calórico, o `null`. */
export async function findLastRejectedCalorieAdjustment(
  profileId: string,
): Promise<string | null> {
  const row = await prisma.recommendation.findFirst({
    where: { profileId, type: "ADJUST_CALORIES", status: "REJECTED" },
    orderBy: { createdAt: "desc" },
    select: { appliesToLocalDate: true },
  });
  return row?.appliesToLocalDate ?? null;
}

export interface CalorieAdjustmentWrite {
  profileId: string;
  localDate: string;
  now: Date;
  accepted: boolean;
  decision: {
    algorithmVersion: string;
    ruleId: string;
    inputSnapshot: Prisma.InputJsonValue;
    output: Prisma.InputJsonValue;
    explanation: string;
  };
  recommendation: {
    title: string;
    body: string;
    payload: Prisma.InputJsonValue;
  };
  /** Solo si se acepta. */
  target: {
    kcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
  } | null;
}

/**
 * Persiste la respuesta del usuario a un ajuste: decisión del motor +
 * recomendación (1:1, misma transacción) + nuevo objetivo si se aceptó.
 */
export async function persistCalorieAdjustment(
  write: CalorieAdjustmentWrite,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const decision = await tx.algorithmDecision.create({
      data: {
        engine: "nutrition",
        ...write.decision,
        evaluationDate: write.localDate,
      },
    });
    const recommendation = await tx.recommendation.create({
      data: {
        profileId: write.profileId,
        decisionId: decision.id,
        type: "ADJUST_CALORIES",
        scope: "NUTRITION",
        priority: "MEDIUM",
        status: write.accepted ? "ACCEPTED" : "REJECTED",
        title: write.recommendation.title,
        body: write.recommendation.body,
        payload: write.recommendation.payload,
        appliesToLocalDate: write.localDate,
        resolvedAt: write.now,
      },
    });
    if (write.target) {
      // Un objetivo por perfil y día (clave única). Si hoy ya había uno, el
      // ajuste lo sustituye: el enfriamiento impide que esto pase dos veces.
      await tx.nutritionTarget.upsert({
        where: {
          profileId_effectiveFrom: {
            profileId: write.profileId,
            effectiveFrom: write.localDate,
          },
        },
        create: {
          profileId: write.profileId,
          effectiveFrom: write.localDate,
          ...write.target,
          source: "ALGORITHM",
          recommendationId: recommendation.id,
          notes: write.recommendation.body,
        },
        update: {
          ...write.target,
          source: "ALGORITHM",
          recommendationId: recommendation.id,
          notes: write.recommendation.body,
        },
      });
    }
  });
}
