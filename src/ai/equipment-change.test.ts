import { describe, expect, it } from "vitest";

import { buildCoachContext, serializeContext } from "@/ai/context";
import { checkResponse } from "@/ai/guardrails";
import { SYSTEM_PROMPT } from "@/ai/prompts";
import type { CoachResponse } from "@/ai/types";
import { addDays } from "@/core/dates";
import {
  analyzeTraining,
  type TrainingContext,
} from "@/core/training/analysis";

/**
 * Coach AI y el cambio de gimnasio: el modelo NO recibe las cargas de la
 * máquina anterior, así que no puede compararlas con las nuevas, y si lo
 * intenta, el guardrail de cifras bloquea la carga que no está en los datos.
 */

const TODAY = "2026-11-20";
const CHANGE = "2026-11-10";

const RX = {
  repRangeMin: 8,
  repRangeMax: 12,
  targetRir: 1,
  plannedSets: 3,
  loadStepKg: 5,
};

const set3 = (weightKg: number, reps: number) =>
  [reps, reps, reps].map((r) => ({ weightKg, reps: r, rir: 1 }));

const context: TrainingContext = {
  todayLocalDate: TODAY,
  sinceLocalDate: addDays(TODAY, -28),
  sessions: [6, 4, 2, 0].map((d, i) => ({
    id: `s${i}`,
    localDate: addDays(TODAY, -d),
    templateName: "Día 2",
    perceivedPerformance: 3,
    pump: 3,
    jointPain: 1,
    fatigue: 3,
    motivation: 3,
    notes: null,
    plannedSets: 9,
    loggedSets: 9,
    completionRate: 1,
    durationMin: 60,
    deload: false,
  })),
  variants: [
    {
      variantId: "prensa",
      exerciseName: "Prensa de piernas",
      variantName: "Prensa 45°",
      prescription: RX,
      exposures: [{ localDate: addDays(CHANGE, 2), sets: set3(70, 10) }],
      daysSinceLast: 8,
      equipmentChange: {
        sinceLocalDate: CHANGE,
        previousExposures: [-17, -10, -3].map((d) => ({
          localDate: addDays(CHANGE, d),
          sets: set3(100, 10),
        })),
      },
    },
  ],
  weeksSinceDeload: 4,
};

const coach = buildCoachContext(analyzeTraining(context), {
  goal: "FAT_LOSS",
  strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
  experienceLevel: "INTERMEDIATE",
  daysPerWeek: 3,
});

const respuesta = (texto: string): CoachResponse => ({
  headline: texto,
  highlights: [],
  fatigue: null,
  recommendation: "Sigue con tu plan.",
  hypotheses: [],
});

describe("Coach AI con un cambio de equipamiento", () => {
  it("el contexto marca el cambio y solo lleva las series de la máquina nueva", () => {
    const prensa = coach.exercises[0];
    expect(prensa.equipmentChange).toEqual({
      since: CHANGE,
      comparableExposures: 1,
      calibrating: true,
    });
    expect(prensa.recentSets).toEqual([
      `${addDays(CHANGE, 2)}: 70×10@1, 70×10@1, 70×10@1`,
    ]);
    // Ni una carga de la máquina anterior viaja al modelo (el 100 % de
    // adherencia sí, y no es una carga).
    expect(serializeContext(coach, 50_000)).not.toMatch(/100\s*(×|kg)/);
  });

  it("el guardrail bloquea comparar con la carga de la máquina anterior", () => {
    const r = checkResponse(
      respuesta(
        "En la prensa has bajado de 100 kg a 70 kg: has perdido fuerza.",
      ),
      coach,
    );
    expect(r.block).toBe(true);
  });

  it("hablar de la máquina nueva con sus cifras sí pasa", () => {
    const r = checkResponse(
      respuesta(
        "En la prensa nueva hiciste 70 kg × 10: todavía faltan sesiones para valorarla.",
      ),
      coach,
    );
    expect(r.block).toBe(false);
  });

  it("el prompt le explica la regla", () => {
    expect(SYSTEM_PROMPT).toContain("OTRA MÁQUINA NO ES OTRA PERSONA");
    expect(SYSTEM_PROMPT).toContain("CAMBIO DE EQUIPAMIENTO");
  });
});
