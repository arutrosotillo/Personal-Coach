import type { CoachProfileInput } from "@/ai/context";
import { runCoach, type CoachRequest } from "@/ai/coach";
import { createProvider, type CoachProvider } from "@/ai/provider";
import { isCoachConfigured } from "@/ai/config";
import type { CoachResult, CoachTask } from "@/ai/types";
import { experienceFromYears } from "@/core/program/generate-initial-program";
import { getProfileOverview } from "@/server/repositories/profile.repo";
import { getTrainingAnalysis } from "@/server/services/fatigue.service";

/**
 * Servicio de Coach AI: reúne el análisis determinista y el perfil, y delega en
 * la capa `src/ai`. Es el único punto donde se instancia el proveedor real.
 *
 * La IA es estrictamente READ-ONLY: este servicio no escribe absolutamente nada.
 */

export interface CoachInput {
  task: CoachTask;
  variantId?: string;
  question?: string;
}

/** Perfil compacto para el contexto. Solo lo que aporta al consejo. */
async function loadProfile(): Promise<{
  profileId: string;
  profile: CoachProfileInput;
} | null> {
  const overview = await getProfileOverview();
  if (!overview) return null;
  const daysPerWeek = overview.program?.daysPerWeek ?? null;
  const years = overview.profile.trainingYears ?? null;
  return {
    profileId: overview.profile.id,
    profile: {
      goal: overview.goal?.type ?? null,
      strategy: overview.goal?.strategy ?? null,
      experienceLevel: years === null ? null : experienceFromYears(years),
      daysPerWeek,
    },
  };
}

export async function askCoach(
  input: CoachInput,
  provider: CoachProvider | null = createProvider(),
  now: Date = new Date(),
): Promise<CoachResult> {
  if (!provider) {
    return {
      ok: false,
      task: input.task,
      error: "NOT_CONFIGURED",
      message: isCoachConfigured()
        ? "AI Coach no está disponible."
        : "AI Coach no configurado. Añade OPENAI_API_KEY a tu .env para activarlo. El resto de la app funciona igual.",
      fallback: null,
    };
  }

  const loaded = await loadProfile();
  if (!loaded) {
    return {
      ok: false,
      task: input.task,
      error: "NO_DATA",
      message: "Todavía no hay perfil. Completa el onboarding.",
      fallback: null,
    };
  }

  const analysis = await getTrainingAnalysis(loaded.profileId, now);
  const request: CoachRequest = {
    task: input.task,
    analysis,
    profile: loaded.profile,
    variantId: input.variantId,
    question: input.question,
  };
  return runCoach(provider, request);
}
