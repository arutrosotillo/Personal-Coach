import type { CoachProfileInput } from "@/ai/context";
import { runCoach, type CoachRequest } from "@/ai/coach";
import { createProvider, type CoachProvider } from "@/ai/provider";
import { isCoachConfigured } from "@/ai/config";
import type { CoachResult, CoachTask } from "@/ai/types";
import { experienceFromYears } from "@/core/program/generate-initial-program";
import { getProfileOverview } from "@/server/repositories/profile.repo";
import { prisma } from "@/server/db";
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
      available: await recordedMetrics(overview.profile.id),
    },
  };
}

/**
 * Métricas que el usuario SÍ tiene registradas. Sin esto, el contexto le decía
 * al modelo que la app no guarda peso corporal ni calorías aunque hubiera
 * meses de check-ins: negar un dato real es tan dañino como inventarlo.
 *
 * (Las métricas siguen sin viajar al contexto —eso es F4—; de momento solo se
 * deja de afirmar que no existen.)
 */
async function recordedMetrics(profileId: string): Promise<string[]> {
  const [checkIn, measurement] = await Promise.all([
    prisma.dailyCheckIn.findFirst({
      where: { profileId },
      orderBy: { localDate: "desc" },
    }),
    prisma.bodyMeasurement.findFirst({
      where: { profileId },
      orderBy: { localDate: "desc" },
    }),
  ]);
  const available: string[] = [];
  if (checkIn?.weightKg != null || measurement?.weightKg != null) {
    available.push("peso corporal actual");
  }
  if (checkIn?.kcal != null) available.push("calorías diarias");
  if (checkIn?.proteinG != null) available.push("proteína diaria");
  if (checkIn?.sleepHours != null) available.push("horas de sueño");
  if (checkIn?.steps != null) available.push("pasos / actividad diaria");
  if (measurement?.waistCm != null) available.push("medidas corporales");
  return available;
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
