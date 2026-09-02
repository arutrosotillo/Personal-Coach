import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CoachBodyContext } from "@/ai/context";
import type { CoachProvider } from "@/ai/provider";

import { createTestDatabase } from "../integration/helpers/test-db";
import { AHORA, construirEscenarios, type Deps } from "./scenarios";

/**
 * Verificación de los fixtures ANTES de gastar una llamada.
 *
 * Un escenario etiquetado "peso bajando con el rendimiento cayendo" que en
 * realidad produzca otra cosa daría un informe impecable y falso. Esto imprime
 * el veredicto real de los motores para cada perfil y falla si no coincide con
 * lo declarado.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const body = await import("@/server/services/body.service");
const { askCoach } = await import("@/server/services/coach.service");

const deps: Deps = { prisma, body, completeOnboarding };

/** Captura el contexto exacto que habría viajado, sin llamar a nadie. */
function espia() {
  let capturado: string | null = null;
  const provider: CoachProvider = {
    generate: async (peticion) => {
      capturado = peticion.contextJson;
      return {
        kind: "OK",
        text: JSON.stringify({
          headline: "ok",
          highlights: [],
          fatigue: null,
          recommendation: "ok",
          hypotheses: [],
        }),
        model: "fake",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: null,
      };
    },
  };
  return { provider, leer: () => capturado };
}

beforeAll(async () => {
  await runSeed(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("los fixtures de la QA producen los estados que dicen producir", () => {
  it("cada escenario coincide con su etiqueta", async () => {
    const escenarios = await construirEscenarios(deps);
    const filas: string[] = [];

    for (const e of escenarios) {
      const p = await body.getBodyProgress(e.profileId, AHORA);
      const sp = espia();
      await askCoach(e.profileId, { task: "WEEKLY" }, sp.provider, AHORA);
      const ctx = JSON.parse(sp.leer()!) as {
        body: CoachBodyContext | null;
        notAvailable: string[];
      };
      const b = ctx.body!;

      const ejs = (
        JSON.parse(sp.leer()!) as {
          exercises: Array<{
            exercise: string;
            prescription: string;
            progression: { action: string; reasonCode: string };
            regressed: boolean;
          }>;
        }
      ).exercises.slice(0, 3);
      filas.push(
        `   ${e.id} ejercicios: ` +
          ejs
            .map(
              (x) =>
                `${x.exercise}[${x.prescription}] ${x.progression.action}/${x.progression.reasonCode}${x.regressed ? " REGRESSED" : ""}`,
            )
            .join(" | "),
      );
      filas.push(
        [
          e.id.padEnd(3),
          `weight=${b.weight.status}`,
          `slope=${b.weight.slopeKgPerWeek}`,
          `ci=[${b.weight.ciLowPerWeek},${b.weight.ciHighPerWeek}]`,
          `perf=${p.insight?.observation.performance}`,

          `obs=${b.insight?.observationCode}`,
          `goal=${b.insight?.goalAssessmentCode}`,
          `waist=${b.waist?.protocol ?? "—"}/${b.waist?.status ?? "—"}/mdc${b.waist?.minDetectableChangeCm ?? "—"}/fit${b.waist?.fittedChangeCm ?? "—"}`,
          `bf=${b.bodyFat?.latestPct ?? "—"}/${b.bodyFat?.status ?? "—"}`,
          `latest=${b.weight.latestKg}`,
          `ctxChars=${sp.leer()!.length}`,
        ].join("  "),
      );

      console.log(filas[filas.length - 2] + "\n" + filas[filas.length - 1]);
      expect(b.weight.status, `escenario ${e.id}`).toBe(e.esperado.weight);
      if (e.esperado.performance) {
        expect(p.insight?.observation.performance, `escenario ${e.id}`).toBe(
          e.esperado.performance,
        );
      }
      if (e.esperado.goalAssessment) {
        expect(b.insight?.goalAssessmentCode, `escenario ${e.id}`).toBe(
          e.esperado.goalAssessment,
        );
      }
      if (e.esperado.waistStatus) {
        expect(b.waist?.status, `escenario ${e.id}`).toBe(
          e.esperado.waistStatus,
        );
      }
      if (e.esperado.waistProtocol) {
        expect(b.waist?.protocol, `escenario ${e.id}`).toBe(
          e.esperado.waistProtocol,
        );
      }
      if (e.esperado.bodyFat) {
        expect(b.bodyFat?.latestPct, `escenario ${e.id}`).not.toBeNull();
      }
    }

    console.log("\n" + filas.join("\n") + "\n");
  });
});
