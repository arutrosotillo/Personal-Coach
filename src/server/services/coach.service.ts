import type { CoachBodyContext, CoachProfileInput } from "@/ai/context";
import { runCoach, type CoachRequest } from "@/ai/coach";
import { createProvider, type CoachProvider } from "@/ai/provider";
import { isCoachConfigured } from "@/ai/config";
import type { CoachResult, CoachTask } from "@/ai/types";
import { experienceFromYears } from "@/core/program/generate-initial-program";
import { getProfileOverview } from "@/server/repositories/profile.repo";
import { prisma } from "@/server/db";
import { getTrainingAnalysis } from "@/server/services/fatigue.service";
import { getBodyProgress } from "@/server/services/body.service";

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
async function loadProfile(profileId: string): Promise<{
  profileId: string;
  profile: CoachProfileInput;
} | null> {
  const overview = await getProfileOverview(profileId);
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
 * Métricas de NUTRICIÓN Y HÁBITOS que el usuario sí tiene registradas. Sin
 * esto, el contexto le decía al modelo que la app no guarda esos datos aunque
 * hubiera meses de check-ins: negar un dato real es tan dañino como inventarlo.
 *
 * El peso y las medidas corporales YA NO se listan aquí (B6): viajan de verdad
 * en el bloque `body`, y es `buildCoachContext` quien deduce de su presencia
 * que están disponibles. Tenerlos en los dos sitios habría creado dos fuentes
 * de "¿tenemos peso?" que podían discrepar.
 *
 * Lo que queda sale de `DailyCheckIn`, que sigue vacía hasta F4.
 */
async function recordedMetrics(profileId: string): Promise<string[]> {
  const checkIn = await prisma.dailyCheckIn.findFirst({
    where: { profileId },
    orderBy: { localDate: "desc" },
  });
  const available: string[] = [];
  if (checkIn?.kcal != null) available.push("calorías diarias");
  if (checkIn?.proteinG != null) available.push("proteína diaria");
  if (checkIn?.sleepHours != null) available.push("horas de sueño");
  if (checkIn?.steps != null) available.push("pasos / actividad diaria");
  return available;
}

/**
 * REDONDEO PARA LA IA, por semántica y no con un `toFixed` global.
 *
 * Los motores siguen trabajando con precisión completa: esto solo afecta a la
 * REPRESENTACIÓN que viaja al prompt. Hace falta porque el modelo tiene
 * prohibido calcular, así que transcribe lo que recibe: en la QA en vivo
 * escribió literalmente «-0.4189655172413784 kg por semana» y
 * «83.98681344989609» en 13 de 95 respuestas. Hay precedente exacto en
 * `context.ts`, donde `avgCompletionPct` ya se redondea por lo mismo.
 *
 * La precisión de cada métrica es la que tiene sentido leer, y coincide con la
 * que enseña `/progress`:
 *   · peso corporal y cintura → 1 decimal (una báscula doméstica no da más);
 *   · ritmos en kg/semana → 2 decimales (0,42 y 0,05 son distintos);
 *   · % graso y puntos porcentuales → 1 decimal;
 *   · % de ritmo semanal → 2 decimales, como el ritmo que representa.
 */
function redondear(
  v: number | null | undefined,
  decimales: number,
): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const f = 10 ** decimales;
  return Math.round(v * f) / f;
}
/** Peso y cintura: 1 decimal. */
const kg1 = (v: number | null | undefined) => redondear(v, 1);
/** Ritmos: 2 decimales. */
const rate2 = (v: number | null | undefined) => redondear(v, 2);
/** Porcentajes y puntos porcentuales: 1 decimal. */
const pct1 = (v: number | null | undefined) => redondear(v, 1);

/**
 * Traduce el seguimiento corporal al bloque que viaja al modelo (B6).
 *
 * Todo lo que sale de aquí está YA CALCULADO por los motores. Lo que NO sale:
 * la serie cruda de pesajes —con ella el modelo podría fabricar una tendencia
 * distinta de la del motor— y la pendiente cuando el motor la ha declarado no
 * afirmable, que es exactamente la misma regla que aplica la pantalla.
 *
 * Devuelve `null` cuando no hay ninguna medición: mandar un bloque vacío solo
 * gastaría contexto y le daría al modelo un objeto lleno de `null` que
 * interpretar.
 */
function toBodyContext(
  progress: Awaited<ReturnType<typeof getBodyProgress>>,
): CoachBodyContext | null {
  const { analysis, checkIn, insight, phaseStartLocalDate } = progress;
  const { weight, waist, bodyFat, goal } = analysis;

  if (progress.history.length === 0) return null;

  return {
    goal: goal
      ? {
          strategy: goal.strategy,
          goalType: goal.goalType,
          targetPctPerWeek: rate2(goal.targetPctPerWeek)!,
          targetKgPerWeek: rate2(goal.targetKgPerWeek),
          targetWeightKg: kg1(goal.targetWeightKg),
          kgToTargetWeight: kg1(goal.kgToTargetWeight),
          phaseStartLocalDate,
        }
      : null,
    weight: {
      status: weight.status,
      reasonCode: weight.reasonCode,
      // La MISMA regla que en pantalla: la pendiente solo se afirma cuando el
      // motor la respalda. `goal.observedKgPerWeek` ya es null si no.
      slopeKgPerWeek: rate2(goal?.observedKgPerWeek),
      // El intervalo va con la MISMA precisión que la pendiente: enseñarlos
      // con distinta resolución invita a leer una diferencia que no existe.
      ciLowPerWeek: rate2(weight.trend?.ciLowPerWeek),
      ciHighPerWeek: rate2(weight.trend?.ciHighPerWeek),
      windowDays: weight.windowDays,
      measurementsInWindow: weight.measurementsInWindow,
      latestKg: kg1(weight.latestKg),
      latestEmaKg: kg1(weight.latestEmaKg),
      totalChangeKg: kg1(weight.totalChangeKg),
    },
    waist:
      waist.latestCm === null
        ? null
        : {
            status: waist.status,
            latestCm: kg1(waist.latestCm),
            fittedChangeCm: kg1(waist.fittedChangeCm),
            minDetectableChangeCm: kg1(waist.minDetectableChangeCm)!,
            protocol: waist.protocol,
            measurementsUsed: waist.measurementsUsed,
          },
    bodyFat:
      bodyFat.latestPct === null
        ? null
        : {
            status: bodyFat.status,
            latestPct: pct1(bodyFat.latestPct),
            reliability: bodyFat.latestReliability,
            changePp: pct1(bodyFat.changePp),
            minInterpretableChangePp: pct1(bodyFat.minInterpretableChangePp)!,
            spanDays: bodyFat.spanDays,
          },
    checkIn: {
      status: checkIn.status,
      daysSinceLast: checkIn.daysSinceLast,
      intervalDays: checkIn.intervalDays,
    },
    insight: insight
      ? {
          observationCode: insight.observation.code,
          goalAssessmentCode: insight.goalAssessment?.code ?? null,
        }
      : null,
  };
}

/**
 * El contexto del coach se construye SIEMPRE a partir del `profileId` que
 * recibe. Antes lo resolvía por su cuenta con un `findFirst` sin filtro, así
 * que con varias cuentas habría mandado a OpenAI el historial del usuario más
 * antiguo, preguntara quien preguntara.
 */
export async function askCoach(
  profileId: string,
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

  const loaded = await loadProfile(profileId);
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
  // Se le pasa el análisis ya leído para que no vuelva a consultarlo: la
  // pregunta al coach hace bastantes cosas como para duplicar una query.
  const progress = await getBodyProgress(loaded.profileId, now, analysis);

  const request: CoachRequest = {
    task: input.task,
    analysis,
    profile: loaded.profile,
    body: toBodyContext(progress),
    variantId: input.variantId,
    question: input.question,
  };
  return runCoach(provider, request);
}
