import { prisma } from "@/server/db";

/**
 * ÚNICA fuente de verdad del origen de un programa (Fase 3.1).
 *
 * Convención (documentada, sin campo `source` en DB, sin migración): un programa
 * es GENERADO sii existe su recomendación `INITIAL_PROGRAM` (`scopeId = program.id`),
 * creada por `completeOnboarding`. Un programa MANUAL (createManualProgram) no crea
 * esa traza. Solo los generados pueden "Restaurar plan inicial" (regenerar desde el
 * snapshot del onboarding); un manual no tiene plan inicial que restaurar.
 *
 * NO dispersar `if (recommendation exists...)` por componentes: usar SIEMPRE estos
 * helpers.
 */

/** ¿El programa fue generado por el motor (y por tanto es restaurable)? */
export async function isGeneratedProgram(programId: string): Promise<boolean> {
  const rec = await prisma.recommendation.findFirst({
    where: { type: "INITIAL_PROGRAM", scopeId: programId },
    select: { id: true },
  });
  return rec !== null;
}

/** Alias semántico: solo los programas generados pueden restaurarse. */
export const canRestoreProgram = isGeneratedProgram;
