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
  /** Sesiones completadas: 0 = el programa no se llegó a entrenar. */
  sessions: number;
  /** Primera y última sesión completada; `null` si no hay ninguna. */
  startLocalDate: string | null;
  endLocalDate: string | null;
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

  const mesocycles = await prisma.mesocycle.findMany({
    where: { programId: { in: programs.map((p) => p.id) } },
    select: { id: true, programId: true },
  });
  const programOf = new Map(mesocycles.map((m) => [m.id, m.programId]));
  const blocks = await prisma.workoutSession.groupBy({
    by: ["mesocycleId"],
    where: {
      status: "COMPLETED",
      mesocycleId: { in: mesocycles.map((m) => m.id) },
    },
    _count: { _all: true },
    _min: { localDate: true },
    _max: { localDate: true },
  });

  return programs.map((p) => {
    const own = blocks.filter((b) => programOf.get(b.mesocycleId) === p.id);
    const starts = own.flatMap((b) => b._min.localDate ?? []).sort();
    const ends = own.flatMap((b) => b._max.localDate ?? []).sort();
    return {
      ...p,
      isGenerated: generatedIds.has(p.id),
      sessions: own.reduce((a, b) => a + b._count._all, 0),
      startLocalDate: starts[0] ?? null,
      endLocalDate: ends[ends.length - 1] ?? null,
    };
  });
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
