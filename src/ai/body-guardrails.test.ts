import { describe, expect, it } from "vitest";

import { buildCoachContext, type CoachBodyContext } from "@/ai/context";
import { checkResponse } from "@/ai/guardrails";
import type { CoachResponse } from "@/ai/types";
import type { TrainingAnalysis } from "@/core/training/analysis";

/**
 * Guardrails del bloque corporal (B6).
 *
 * El riesgo que vigilan es distinto del de los guardrails de entrenamiento: no
 * es que la IA invente una carga, es que convierta una estimación en un
 * diagnóstico. "Tu 17 % está en rango saludable" suena inofensivo y es
 * exactamente lo que esta app no debe decir.
 */

/** Análisis de entrenamiento mínimo, sin nada que el cuerpo pueda contradecir. */
const ANALISIS = {
  context: {
    todayLocalDate: "2026-09-01",
    sinceLocalDate: "2026-08-01",
    sessions: [
      {
        id: "s1",
        localDate: "2026-08-30",
        templateName: "Torso A",
        perceivedPerformance: 3,
        pump: null,
        jointPain: 1,
        fatigue: 2,
        motivation: 4,
        notes: null,
        plannedSets: 9,
        loggedSets: 9,
        deload: false,
        completionRate: 1,
        durationMin: 60,
      },
    ],
    variants: [],
    weeksSinceDeload: 3,
  },
  variants: [],
  fatigue: {
    level: "LOW",
    decision: "CONTINUE",
    score: 1,
    objectiveScore: 1,
    confidence: "MEDIUM",
    signals: [],
    jointPain: { message: null },
    plan: null,
    explanation: "Todo en orden.",
    engineVersion: "1.0.0",
    numbers: { windowDays: 28 },
  },
} as unknown as TrainingAnalysis;

const CUERPO: CoachBodyContext = {
  goal: {
    strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
    goalType: "FAT_LOSS",
    targetPctPerWeek: -0.5,
    targetKgPerWeek: -0.41,
    targetWeightKg: 78,
    kgToTargetWeight: -4.4,
    phaseStartLocalDate: "2026-07-23",
  },
  weight: {
    status: "LOSING",
    reasonCode: "CONFIDENCE_INTERVAL_BELOW_ZERO",
    slopeKgPerWeek: -0.45,
    ciLowPerWeek: -0.54,
    ciHighPerWeek: -0.37,
    windowDays: 28,
    measurementsInWindow: 28,
    latestKg: 82.4,
    latestEmaKg: 82.6,
    totalChangeKg: -2.3,
  },
  waist: {
    status: "WITHIN_MEASUREMENT_ERROR",
    latestCm: 91.8,
    fittedChangeCm: -2,
    minDetectableChangeCm: 3.1,
    protocol: "MEAN_OF_THREE",
    measurementsUsed: 3,
  },
  bodyFat: {
    status: "NOT_INTERPRETABLE",
    latestPct: 17.5,
    reliability: "ESTIMATED",
    changePp: -1.5,
    minInterpretableChangePp: 2,
    spanDays: 60,
  },
  checkIn: { status: "NOT_DUE", daysSinceLast: 3, intervalDays: 14 },
  insight: {
    observationCode: "WEIGHT_DOWN_PERFORMANCE_HELD",
    goalAssessmentCode: "LOSING_PERFORMANCE_HELD",
  },
};

const contexto = (body: CoachBodyContext | null = CUERPO) =>
  buildCoachContext(
    ANALISIS,
    { goal: "FAT_LOSS", strategy: null, experienceLevel: null, daysPerWeek: 4 },
    body,
  );

/** Respuesta con el texto puesto en el titular. */
function respuesta(texto: string): CoachResponse {
  return {
    headline: texto,
    highlights: [],
    fatigue: null,
    recommendation: "Sigue con tu plan.",
    hypotheses: [],
  };
}

const bloquea = (texto: string, body: CoachBodyContext | null = CUERPO) =>
  checkResponse(respuesta(texto), contexto(body)).block;

describe("valoración clínica del cuerpo", () => {
  it.each([
    "Tu 17,5 % de grasa está en rango saludable.",
    "Con ese peso estás en sobrepeso.",
    "Tu IMC indica obesidad.",
    "Tu cintura implica riesgo cardiovascular.",
    "Tu peso ideal serían 75 kg.",
    "Estás en un porcentaje ideal de grasa.",
  ])("bloquea: %s", (texto) => {
    expect(bloquea(texto)).toBe(true);
  });

  it("bloquea aunque venga en negativo o condicionado", () => {
    // Por presencia, como las sustancias: el coste de un falso positivo aquí
    // es cero, y bastaba abrir la frase con "no" para colar el juicio.
    expect(bloquea("No estás en sobrepeso, tranquilo.")).toBe(true);
    expect(bloquea("Si estuvieras en obesidad haríamos otra cosa.")).toBe(true);
  });
});

describe("afirmar un cambio de tejido", () => {
  it.each([
    "Estás perdiendo músculo.",
    "Vas ganando grasa estas semanas.",
    "Has perdido masa muscular.",
    "Llevas ganando grasa desde julio.",
  ])("bloquea: %s", (texto) => {
    expect(bloquea(texto)).toBe(true);
  });

  it("PERMITE hablar de composición corporal como posibilidad", () => {
    // Es justo lo que el motor de insights afirma, y bloquearlo dejaría muda
    // la lectura más útil de la app.
    expect(
      bloquea(
        "El peso quieto con las cargas subiendo es compatible con una mejora de composición corporal.",
      ),
    ).toBe(false);
  });
});

describe("prescripción nutricional", () => {
  it.each([
    "Sube las calorías esta semana.",
    "Reduce el déficit un poco.",
    "Aumenta la proteína.",
    "Come más para sostener el entrenamiento.",
    "Recorta 200 kcal al día.",
  ])("bloquea: %s", (texto) => {
    expect(bloquea(texto)).toBe(true);
  });

  it("PERMITE la cautela en negativo", () => {
    // "No recortes más" es una precaución legítima, no una prescripción.
    expect(bloquea("No recortes más las calorías por ahora.")).toBe(false);
  });

  it("PERMITE una pauta general sin cifras ni imperativos", () => {
    expect(
      bloquea(
        "Si buscas conservar músculo mientras el peso baja, un aporte proteico suficiente ayuda.",
      ),
    ).toBe(false);
  });
});

describe("los kilos corporales no se bloquean como cargas inventadas", () => {
  it("citar el peso actual pasa", () => {
    // Sin ensanchar el conjunto de cargas, "82,4 kg" se bloqueaba como carga
    // inventada, que es justo la frase que el bloque corporal permite.
    expect(bloquea("Tu peso está en 82,4 kg.")).toBe(false);
  });

  it("citar el peso objetivo y lo que falta también", () => {
    expect(bloquea("Te quedan 4,4 kg para llegar a 78 kg.")).toBe(false);
  });

  it("pero un peso corporal INVENTADO sigue bloqueado", () => {
    expect(bloquea("Tu peso está en 91,3 kg.")).toBe(true);
  });
});

describe("sin bloque corporal nada cambia", () => {
  it("el contexto no lleva `body` y las métricas se declaran ausentes", () => {
    const ctx = contexto(null);
    expect(ctx.body).toBeNull();
    expect(ctx.notAvailable).toContain("peso corporal actual");
    expect(ctx.notAvailable).toContain("medidas corporales");
  });

  it("y citar CIFRAS de peso corporal no cuela", () => {
    // El aviso de métrica ausente solo salta con cifras: una mención
    // cualitativa ("has bajado algo") no es una invención, y el guardrail
    // existente lo tiene bien puesto. Con número, no pasa.
    const r = checkResponse(
      respuesta("Tu peso corporal ha bajado 2,3 kg."),
      contexto(null),
    );
    expect(r.block || r.warnings.length > 0).toBe(true);
  });
});

describe("con bloque corporal, las métricas dejan de declararse ausentes", () => {
  it("no se le dice al modelo que falta un dato que sí tenemos", () => {
    const ctx = contexto();
    expect(ctx.notAvailable).not.toContain("peso corporal actual");
    expect(ctx.notAvailable).not.toContain("medidas corporales");
    // Lo que de verdad falta sigue declarándose.
    expect(ctx.notAvailable).toContain("calorías diarias");
  });

  it("los márgenes de error del cuerpo viajan en `limits`", () => {
    const notas = contexto().limits.notes.join(" ");
    expect(notas).toMatch(/1 kg entre días/);
    expect(notas).toMatch(/slopeKgPerWeek.*null/);
    expect(notas).toMatch(/ESTIMACIÓN/);
    expect(notas).toMatch(/NO permiten deducir una causa/);
  });

  it("sin cuerpo, esas notas no ocupan contexto", () => {
    const notas = contexto(null).limits.notes.join(" ");
    expect(notas).not.toMatch(/1 kg entre días/);
  });
});

describe("el bloque corporal no filtra la serie cruda", () => {
  it("no hay ningún array de pesajes en el contexto serializado", () => {
    const ctx = contexto();
    const body = ctx.body!;
    // Solo veredictos y agregados: si algún día alguien mete la serie, el
    // modelo podría fabricar una tendencia distinta de la del motor.
    expect(Object.keys(body).sort()).toEqual([
      "bodyFat",
      "checkIn",
      "goal",
      "insight",
      "waist",
      "weight",
    ]);
    expect(JSON.stringify(body)).not.toMatch(/series|rawKg|emaKg\"?:\s*\[/);
  });

  it("con tendencia no afirmable, la pendiente viaja como null", () => {
    const inconcluso: CoachBodyContext = {
      ...CUERPO,
      weight: {
        ...CUERPO.weight,
        status: "INCONCLUSIVE",
        slopeKgPerWeek: null,
      },
    };
    expect(contexto(inconcluso).body!.weight.slopeKgPerWeek).toBeNull();
  });
});
