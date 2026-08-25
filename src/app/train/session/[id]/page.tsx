import { notFound, redirect } from "next/navigation";

import { isCoachConfigured } from "@/ai/config";

import { SessionRunner } from "@/components/training/session-runner";
import {
  getExecutionSession,
  toClientSession,
} from "@/server/repositories/workout.repo";
import { requireProfileId } from "@/server/repositories/profile.repo";
import { listSubstitutionOptions } from "@/server/repositories/substitution.repo";
import { getRecoveryVeto } from "@/server/services/fatigue.service";
import { buildSuggestions } from "@/server/services/progression.service";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profileId = await requireProfileId();
  const session = await getExecutionSession(profileId, id);
  if (!session) notFound();
  // Una sesión ya cerrada no se puede editar: sin esto se renderizaba el
  // ejecutor entero, con sus botones, para una sesión terminada o descartada
  // (basta con darle a "atrás" después de finalizar). Cada toque devolvía un
  // error honesto, pero ofrecer una pantalla que no hace nada es peor que no
  // ofrecerla.
  if (session.status !== "IN_PROGRESS") redirect("/train/history");

  const substitution = await listSubstitutionOptions();
  // El veto se calcula sobre el día de la sesión: la salud y la fatiga mandan
  // sobre la progresión (COACH_PHILOSOPHY §2).
  const veto = await getRecoveryVeto(profileId, session.localDate);
  const suggestions = buildSuggestions(session, veto);
  return (
    <SessionRunner
      key={session.exercises.map((exercise) => exercise.variantId).join("|")}
      session={toClientSession(session)}
      substitution={substitution}
      suggestions={suggestions}
      coachEnabled={isCoachConfigured()}
    />
  );
}
