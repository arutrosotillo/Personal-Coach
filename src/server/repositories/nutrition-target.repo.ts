import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/server/db";

/**
 * Objetivos calóricos y sus ajustes. Las filas de `NutritionTarget` SON el
 * historial: un ajuste nunca edita la fila vigente, crea otra con
 * `effectiveFrom` de hoy. La vigente es la de `effectiveFrom` más reciente.
 */

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
  /** Estimación de mantenimiento con la que se decidió (se congela). */
  estimate?: Prisma.EnergyEstimateUncheckedCreateInput;
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
    if (write.estimate) {
      await tx.energyEstimate.create({ data: write.estimate });
    }
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
