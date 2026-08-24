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

export interface ArchivedProgram {
  id: string;
  name: string;
  daysPerWeek: number;
  createdAt: Date;
  isGenerated: boolean;
}

/**
 * Programas archivados del perfil (isActive:false, no borrados), del más reciente
 * al más antiguo, con el origen derivado (¿existe su INITIAL_PROGRAM?) en una sola
 * query en lote — no N+1.
 */
export async function listArchivedPrograms(
  profileId: string,
): Promise<ArchivedProgram[]> {
  const programs = await prisma.trainingProgram.findMany({
    where: { profileId, isActive: false, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, daysPerWeek: true, createdAt: true },
  });
  if (programs.length === 0) return [];

  const generated = await prisma.recommendation.findMany({
    where: {
      type: "INITIAL_PROGRAM",
      scopeId: { in: programs.map((p) => p.id) },
    },
    select: { scopeId: true },
  });
  const generatedIds = new Set(generated.map((r) => r.scopeId));

  return programs.map((p) => ({
    ...p,
    isGenerated: generatedIds.has(p.id),
  }));
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
