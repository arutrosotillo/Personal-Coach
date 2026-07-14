import {
  programRationaleOutput,
  type ProgramRationaleOutput,
} from "@/core/schemas/program-rationale";
import { prisma } from "@/server/db";

export interface ProgramRationale {
  version: string;
  ruleId: string;
  explanation: string;
  output: ProgramRationaleOutput;
}

/**
 * Recupera la decisión del generador (versión, ruleId, explicación y datos
 * derivados) que produjo un programa, para el bloque "Por qué este programa".
 * Devuelve null si el output no valida (programa de un generador anterior).
 */
export async function getProgramRationale(
  programId: string,
): Promise<ProgramRationale | null> {
  const recommendation = await prisma.recommendation.findFirst({
    where: { type: "INITIAL_PROGRAM", scopeId: programId },
    include: { decision: true },
  });
  if (!recommendation) return null;

  const parsed = programRationaleOutput.safeParse(
    recommendation.decision.output,
  );
  if (!parsed.success) return null;

  return {
    version: recommendation.decision.algorithmVersion,
    ruleId: recommendation.decision.ruleId,
    explanation: recommendation.decision.explanation,
    output: parsed.data,
  };
}
