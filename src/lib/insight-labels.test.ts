import { describe, expect, it } from "vitest";

import type { GoalAssessmentCode } from "@/core/insights";
import { GOAL_ASSESSMENT_COPY } from "@/lib/insight-labels";

/**
 * El copy es la última frontera donde se puede colar una causa que el motor
 * se negó a afirmar. Estos tests la vigilan.
 */

const TODOS: GoalAssessmentCode[] = [
  "LOSING_PERFORMANCE_UP",
  "LOSING_PERFORMANCE_HELD",
  "LOSING_PERFORMANCE_DOWN",
  "GAINING_PERFORMANCE_UP",
  "GAINING_PERFORMANCE_HELD",
  "GAINING_PERFORMANCE_DOWN",
  "RECOMP_SIGNAL",
  "WEIGHT_NOT_MOVING",
  "MOVING_AGAINST_GOAL",
  "HOLDING_AS_INTENDED",
  "WEIGHT_DRIFTING",
];

const textos = () =>
  TODOS.flatMap((c) => [
    GOAL_ASSESSMENT_COPY[c].headline,
    GOAL_ASSESSMENT_COPY[c].body,
  ]);

describe("copy de los insights", () => {
  it("ningún código se queda sin texto", () => {
    for (const c of TODOS) {
      expect(GOAL_ASSESSMENT_COPY[c].headline).toBeTruthy();
      expect(GOAL_ASSESSMENT_COPY[c].body).toBeTruthy();
    }
  });

  it("NUNCA afirma una causa", () => {
    // "porque", "debido a", "se debe a", "por culpa de", "provoca", "causa".
    const causal =
      /\bporque\b|\bdebido a\b|\bse debe a\b|por culpa de|\bprovoca\b|\bcausa(?:do|ndo)?\b|\bpor eso\b/i;
    for (const t of textos()) {
      expect(t, `causal: "${t}"`).not.toMatch(causal);
    }
  });

  it("NUNCA receta qué hacer con la comida o el entrenamiento", () => {
    const receta =
      /\bcome\b|\bcomer\b|\bcalorías\b|\bkcal\b|déficit|superávit|proteína|\bdescansa\b|\bentrena menos\b|\bbaja el volumen\b|\breduce\b|\baumenta\b/i;
    for (const t of textos()) {
      expect(t, `receta: "${t}"`).not.toMatch(receta);
    }
  });

  it("NUNCA dictamina sobre el tejido corporal", () => {
    // Ni "pierdes músculo" ni "ganas grasa": eso no sale de una báscula.
    const tejido =
      /perdiendo músculo|pierdes músculo|ganando grasa|ganas grasa|masa muscular|masa grasa/i;
    for (const t of textos()) {
      expect(t, `tejido: "${t}"`).not.toMatch(tejido);
    }
  });

  it("NUNCA usa lenguaje absoluto ni juzga a la persona", () => {
    const absoluto =
      /\bsiempre\b|\bnunca vas\b|\bfracas|\bmal hecho\b|\bestás fallando\b|\bdeberías\b|\btienes que\b/i;
    for (const t of textos()) {
      expect(t, `absoluto: "${t}"`).not.toMatch(absoluto);
    }
  });

  it("los dos casos de atención dicen explícitamente que no se conoce la relación", () => {
    // Son los únicos donde la tentación de explicar es fuerte.
    for (const c of [
      "LOSING_PERFORMANCE_DOWN",
      "GAINING_PERFORMANCE_DOWN",
    ] as const) {
      expect(GOAL_ASSESSMENT_COPY[c].body).toMatch(
        /no se puede saber|no puede decir/i,
      );
    }
  });
});
