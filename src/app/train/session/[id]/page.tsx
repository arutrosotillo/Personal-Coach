import { notFound } from "next/navigation";

import { SessionRunner } from "@/components/training/session-runner";
import {
  getExecutionSession,
  toClientSession,
} from "@/server/repositories/workout.repo";
import { requireProfileId } from "@/server/repositories/profile.repo";
import { listSubstitutionOptions } from "@/server/repositories/substitution.repo";
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

  const substitution = await listSubstitutionOptions();
  const suggestions = buildSuggestions(session);
  return (
    <SessionRunner
      key={session.exercises.map((exercise) => exercise.variantId).join("|")}
      session={toClientSession(session)}
      substitution={substitution}
      suggestions={suggestions}
    />
  );
}
