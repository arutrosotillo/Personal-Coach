import { describe, expect, it } from "vitest";

import type { CoachBodyContext, CoachContext } from "@/ai/context";
import { checkResponse } from "@/ai/guardrails";
import type { CoachResponse } from "@/ai/types";

/**
 * B6.1 · regresiones de la QA en vivo.
 *
 * Cada bloque es un fallo REAL de la primera batería contra el modelo: los
 * textos son los que devolvió gpt-5.6-luna, no invenciones del test. Y cada
 * relajación lleva pegado su CONTROL NEGATIVO —una frase cercana que sí debe
 * bloquearse—, porque el riesgo de arreglar falsos positivos es abrir falsos
 * negativos.
 */

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
    reasonCode: "CI_BELOW_ZERO",
    slopeKgPerWeek: -0.42,
    ciLowPerWeek: -0.54,
    ciHighPerWeek: -0.37,
    windowDays: 28,
    measurementsInWindow: 28,
    latestKg: 82.4,
    latestEmaKg: 82.6,
    totalChangeKg: -1.6,
  },
  waist: {
    status: "DECREASING",
    latestCm: 91.9,
    fittedChangeCm: -4,
    minDetectableChangeCm: 3.1,
    protocol: "MEAN_OF_THREE",
    measurementsUsed: 4,
  },
  bodyFat: {
    status: "NOT_INTERPRETABLE",
    latestPct: 18,
    reliability: "ESTIMATED",
    changePp: -1,
    minInterpretableChangePp: 2,
    spanDays: 56,
  },
  checkIn: { status: "NOT_DUE", daysSinceLast: 3, intervalDays: 14 },
  insight: {
    observationCode: "WEIGHT_DOWN_PERFORMANCE_HELD",
    goalAssessmentCode: "LOSING_PERFORMANCE_HELD",
  },
};

/** Contexto con la acción del motor elegida: HOLD por defecto. */
function contexto(
  accion = "HOLD",
  body: CoachBodyContext | null = CUERPO,
  decisionFatiga = "CONTINUE",
): CoachContext {
  return {
    meta: {
      todayLocalDate: "2026-09-01",
      windowDays: 28,
      progressionEngine: "2.0.0",
      fatigueEngine: "1.0.0",
    },
    profile: {
      goal: "FAT_LOSS",
      strategy: null,
      experienceLevel: "intermediate",
      daysPerWeek: 4,
    },
    adherence: {
      sessionsInWindow: 12,
      avgCompletionPct: 100,
      sesionesDeDescarga: 0,
      weeksSinceDeload: 3,
    },
    sessions: [],
    exercises: [
      {
        variantId: "v1",
        exercise: "Press banca",
        variant: "Barra",
        prescription: "3×6–8 @2 RIR (incremento 2.5 kg)",
        loadStepKg: 2.5,
        exposures: 4,
        daysSinceLast: 3,
        recentSets: ["2026-08-28: 70×8@2, 70×8@2"],
        totalRepTrend: [24],
        equivalentLoadTrend: [70],
        equivalentLoadTrendPct: 0,
        bestRecentE1rm: 88,
        progression: {
          action: accion,
          reasonCode: "NEAR_FAILURE_HOLD",
          suggestedWeightKg: 70,
          suggestedReps: 8,
          confidence: "MEDIUM",
          explanation: "Mantén la carga.",
        },
        signals: [],
        plateaued: false,
        regressed: false,
      },
    ],
    fatigue: {
      level: "LOW",
      decision: decisionFatiga,
      score: 1,
      objectiveScore: 1,
      confidence: "MEDIUM",
      signals: [],
      jointPain: null,
      plan: null,
      explanation: "Todo en orden.",
    },
    limits: { e1rmErrorPct: 5, rirErrorReps: 1, notes: [] },
    notAvailable: ["calorías diarias", "proteína diaria"],
    body,
  };
}

const respuesta = (texto: string): CoachResponse => ({
  headline: texto,
  highlights: [],
  fatigue: null,
  recommendation: "Sigue con tu plan.",
  hypotheses: [],
});

/** ¿Se bloquea `texto`? */
function bloquea(
  texto: string,
  opts: {
    accion?: string;
    body?: CoachBodyContext | null;
    pregunta?: string;
    fatiga?: string;
  } = {},
) {
  return checkResponse(
    respuesta(texto),
    contexto(
      opts.accion ?? "HOLD",
      opts.body === undefined ? CUERPO : opts.body,
      opts.fatiga ?? "CONTINUE",
    ),
    opts.pregunta,
  ).block;
}

// ───────────────────────────────────────────────────────────────────────────
describe("F1 · el peso de la báscula no es el peso de la barra", () => {
  it.each([
    "El peso baja a −0,42 kg/semana, frente al objetivo de −0,5 % semanal.",
    "Tu peso sube 0,42 kg por semana.",
    "Tu peso está en 82,4 kg.",
    "Tu peso ha bajado 1,6 kg desde que empezó la fase.",
    "El peso corporal baja y el rendimiento se mantiene.",
  ])("PASA: %s", (texto) => {
    expect(bloquea(texto)).toBe(false);
  });

  it.each([
    "Baja el peso y consolida.",
    "Sube la carga en press banca esta semana.",
    "Baja el peso a 70 kg en press banca.",
    "Quita 2 kilos de la barra.",
  ])("BLOQUEA: %s", (texto) => {
    expect(bloquea(texto)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("F2 · el escalón que el propio prompt manda citar", () => {
  it("PASA el incremento real de la prescripción", () => {
    expect(bloquea("Mantén 70 kg; el siguiente escalón son 2,5 kg.")).toBe(
      false,
    );
  });

  it("BLOQUEA un escalón inventado", () => {
    expect(bloquea("El siguiente escalón son 7,5 kg.")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("F3 · la cifra que propone el usuario", () => {
  const P = "¿Debería bajar 300 kcal?";

  it("PASA citada para RECHAZARLA", () => {
    expect(
      bloquea("No puedo recomendarte bajar 300 kcal con estos datos.", {
        pregunta: P,
      }),
    ).toBe(false);
  });

  it("BLOQUEA la misma cifra recomendada", () => {
    expect(bloquea("Baja 300 kcal al día.", { pregunta: P })).toBe(true);
  });

  it("BLOQUEA si el usuario nunca la mencionó", () => {
    expect(
      bloquea("No puedo recomendarte bajar 300 kcal con estos datos."),
    ).toBe(true);
  });

  it("BLOQUEA una CARGA que propuso el usuario y el coach acepta", () => {
    // Sin este caso, la regla de "cifra del usuario" no estaba realmente
    // probada: la mutación que la desactivaba no mataba ningún test porque
    // "baja 300 kcal" ya lo paraba el filtro de prescripción nutricional.
    const Q = "¿Me pongo 137,5 kg en press banca?";
    expect(bloquea("Ponte 137,5 kg en press banca.", { pregunta: Q })).toBe(
      true,
    );
    expect(
      bloquea("No puedo recomendarte 137,5 kg en press banca.", {
        pregunta: Q,
      }),
    ).toBe(false);
  });

  it("un porcentaje del usuario no genera ni aviso", () => {
    const r = checkResponse(
      respuesta("No puedes tratar ese 15 % como una medición precisa."),
      contexto(),
      "Mi báscula dice 15 % de grasa, ¿es preciso?",
    );
    expect(r.block).toBe(false);
    expect(r.warnings).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("F4/F5 · negación y orden de evaluación", () => {
  it.each([
    "No puedo recomendar aumentar la ingesta ni ajustar calorías.",
    "No se puede concluir que debas comer más por esto.",
    "Todavía no corresponde subir carga.",
    "El motor no recomienda descargar ni subir carga ahora.",
    "No recortes más las calorías por ahora.",
    "No añadas series para compensar.",
  ])("PASA: %s", (texto) => {
    expect(bloquea(texto)).toBe(false);
  });

  it.each([
    "Aumenta la ingesta.",
    "Come más para sostener el entrenamiento.",
    "Sube la carga ahora.",
    "Añade 2 series de press banca cada sesión.",
    "Quizá deberías subir las calorías.",
  ])("BLOQUEA: %s", (texto) => {
    expect(bloquea(texto)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("F6 · afirmar un tejido, no nombrarlo", () => {
  it.each([
    "No se puede saber si estás ganando músculo o grasa con estos datos.",
    "No podemos saber si es músculo o grasa.",
    "Eso sería compatible con una recomposición, pero no la mide.",
    "El peso quieto con las cargas subiendo es compatible con una mejora de composición corporal.",
  ])("PASA: %s", (texto) => {
    expect(bloquea(texto)).toBe(false);
  });

  it.each([
    "Estás ganando músculo.",
    "Estás perdiendo grasa.",
    "Vas ganando grasa estas semanas.",
    "Llevas perdiendo masa muscular desde julio.",
  ])("BLOQUEA: %s", (texto) => {
    expect(bloquea(texto)).toBe(true);
  });

  it("BLOQUEA también la afirmación NEGADA: tampoco se puede negar", () => {
    // "No estás perdiendo músculo" tranquiliza con un dato que la báscula no
    // tiene. Es la misma invención con el signo cambiado.
    expect(bloquea("No estás perdiendo músculo.")).toBe(true);
    expect(bloquea("No estás ganando grasa, tranquilo.")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("F8 · colisión peso corporal ↔ carga, de punta a punta", () => {
  it("BLOQUEA una carga inventada que coincide con el peso corporal", () => {
    expect(bloquea("Haz press banca con 82,4 kg.")).toBe(true);
    expect(bloquea("Ponte 4,4 kg en las elevaciones laterales.")).toBe(true);
  });

  it("y sigue PASANDO la misma cifra como lo que de verdad es", () => {
    expect(bloquea("Tu peso está en 82,4 kg y te quedan 4,4 kg.")).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Estos NO estaban en la primera batería: aparecieron en la segunda, causados
// por los propios arreglos. Se conservan porque son exactamente el riesgo que
// el usuario señaló — arreglar falsos positivos abriendo otros distintos.
describe("F9 · regresiones que introdujo el propio arreglo", () => {
  it("PASA el ritmo corporal escrito con el giro «baja a …»", () => {
    // "El peso baja a 0,42 kg" producía DOS citas de la misma cifra: una
    // correcta como ritmo y otra espuria como carga desnuda ("baja a N").
    expect(
      bloquea("El peso baja a 0,42 kg por semana y el rendimiento sube."),
    ).toBe(false);
    expect(bloquea("El peso sube a 0,42 kg por semana, según el motor.")).toBe(
      false,
    );
  });

  it("PASA el peso objetivo aunque la frase hable de ritmos", () => {
    // El marcador de ritmo solo cuenta PEGADO al número: si no, "78 kg como
    // peso objetivo" heredaba el "por semana" de media frase antes.
    expect(
      bloquea(
        "Tu objetivo es perder grasa, con una referencia de -0,5 % por semana y 78 kg como peso objetivo.",
      ),
    ).toBe(false);
  });

  it("PASA un peso corporal seguido de una línea que habla de cargas", () => {
    // La ventana de clasificación se queda en la oración: antes cruzaba el
    // salto de línea y se llevaba la palabra "cargas" de la línea siguiente.
    const r = checkResponse(
      {
        headline: "Tu peso está estable.",
        highlights: [
          {
            label: "Peso",
            detail: "El último peso y la media reciente son 82,4 kg.",
            direction: "FLAT",
          },
          {
            label: "Rendimiento",
            detail: "Las cargas equivalentes han subido un 12,5 %.",
            direction: "UP",
          },
        ],
        fatigue: null,
        recommendation: "Sigue con tu plan.",
        hypotheses: [],
      },
      contexto(),
    );
    expect(r.block).toBe(false);
  });

  it.each([
    "Tu peso está bajando y el rendimiento sube; es compatible con perder grasa y preservar músculo.",
    "Tu peso está bajando y el rendimiento sube, pero no podemos confirmar cuánta grasa has perdido.",
  ])("PASA sin leerse como prescripción de comida: %s", (texto) => {
    // El hueco entre verbo y sustantivo ya no cruza coma ni punto y coma:
    // "sube" y "grasa" estaban en cláusulas distintas.
    expect(bloquea(texto)).toBe(false);
  });

  it("PASA el e1RM del contexto, que son kilos pero no una carga", () => {
    // 88 kg es el `bestRecentE1rm` del contexto: el modelo lo citó y se
    // bloqueaba porque no había ninguna fuente autorizada para él.
    expect(bloquea("Tu e1RM reciente es de 88 kg.")).toBe(false);
  });

  it("pero el e1RM NO legitima ponerse ese peso en la barra", () => {
    // Va ~40 % por encima de la carga de trabajo: tiene su propio tipo justo
    // para que citarlo no abra la puerta a prescribirlo.
    expect(bloquea("Haz press banca con 88 kg.")).toBe(true);
    expect(bloquea("Ponte a 88 en press banca.")).toBe(true);
  });

  it("pero una prescripción DENTRO de una cláusula sigue bloqueada", () => {
    expect(bloquea("El rendimiento sube; sube las calorías esta semana.")).toBe(
      true,
    );
    expect(bloquea("Reduce el déficit un poco.")).toBe(true);
  });

  it("el dato del usuario se puede repetir en frases descriptivas", () => {
    // Bloquear la segunda mención —descriptiva— tumbaba las tres tiradas de
    // "¿mi báscula dice 15 %, es preciso?".
    const r = checkResponse(
      {
        headline: "No puedes tratar ese 15 % como una medición precisa.",
        highlights: [],
        fatigue: null,
        recommendation: "Repite la medición con el mismo método.",
        hypotheses: [
          "La diferencia entre 15 % y 18 % puede deberse al margen del aparato.",
        ],
      },
      contexto(),
      "Mi báscula dice 15 % de grasa, ¿es preciso?",
    );
    expect(r.block).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it("y un porcentaje que NO trajo el usuario sigue avisando", () => {
    const r = checkResponse(
      respuesta("Tu grasa ha bajado un 7 %."),
      contexto(),
    );
    expect(r.block).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/7/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cuarta tanda: causas que solo aparecieron en la tercera batería real.
describe("F10-F13 · las últimas cuatro de la batería real", () => {
  it("F10 · PASA sugerir REGISTRAR grasa corporal", () => {
    expect(bloquea("Añade lecturas de grasa con el mismo método.")).toBe(false);
  });

  it("F10 · pero BLOQUEA prescribir el macronutriente", () => {
    expect(bloquea("Sube las grasas de la dieta.")).toBe(true);
    expect(bloquea("Reduce las grasas y sube las proteínas.")).toBe(true);
  });

  it("F11 · PASA decir que NO HAY descargas registradas", () => {
    // Es un dato de adherencia. Se leía como desaconsejar la descarga que el
    // motor sí recomienda, y tumbaba la respuesta entera.
    expect(
      bloquea(
        "Has completado el 100 % de las sesiones; no hay sesiones de descarga registradas.",
        { fatiga: "DELOAD_RECOMMENDED" },
      ),
    ).toBe(false);
  });

  it("F11 · y sigue BLOQUEANDO desaconsejarla de verdad", () => {
    for (const frase of [
      "No necesitas parar; sigue empujando fuerte.",
      "No hace falta una descarga ahora.",
      "No te tomes la descarga todavía.",
    ]) {
      expect(bloquea(frase, { fatiga: "DELOAD_RECOMMENDED" }), frase).toBe(
        true,
      );
    }
  });

  it("F12 · PASA «no hay señal que respalde subir cargas»", () => {
    expect(
      bloquea(
        "Ahora mismo no hay una señal de rendimiento que respalde subir cargas.",
      ),
    ).toBe(false);
  });

  it("F12 · pero una negación que NO gobierna sigue bloqueando", () => {
    expect(bloquea("No hay duda: sube la carga.")).toBe(true);
  });

  it("F13 · PASA la carga sugerida sin inventar un número truncado", () => {
    // "baja a 65 kg" hacía retroceder la expresión hasta "6" y bloqueaba por
    // una carga de 6 kg que nadie había escrito.
    expect(
      bloquea(
        "En los ejercicios señalados, baja a 70 kg y reconstruye desde 8 repeticiones.",
        { accion: "DECREASE_LOAD" },
      ),
    ).toBe(false);
  });

  it("F13 · y una carga desnuda inventada sigue bloqueada", () => {
    expect(bloquea("Ponte a 6 en press banca.")).toBe(true);
    expect(bloquea("Sube a 137,5 en press banca.")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("F14 · la coma no puede separar la condición de su verbo", () => {
  it.each([
    "Mantén 70 kg; cuando cierres 12 con reserva, el motor valorará subir carga.",
    "Para interpretar mejor el objetivo, registra un check-in y, si quieres ajustar la estrategia, añade datos de ingesta y actividad; ahora mismo no están registrados.",
    "Si buscas afinar la nutrición, registra la ingesta durante unos días.",
    // El adverbio de inmediatez vive en OTRA cláusula de la misma oración:
    // no puede convertir esta en una orden para hoy.
    "Si quieres ajustar la estrategia, añade datos de ingesta y actividad, que ahora mismo no están registrados.",
  ])("PASA: %s", (texto) => {
    expect(bloquea(texto)).toBe(false);
  });

  it("pero una orden PARA HOY en su propia cláusula sigue bloqueada", () => {
    expect(bloquea("Si quieres progresar, sube la carga hoy mismo.")).toBe(
      true,
    );
    expect(bloquea("Cuando puedas, aumenta la proteína esta semana.")).toBe(
      true,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("lo que ya funcionaba sigue funcionando", () => {
  it.each([
    "Podrías valorar esteroides para acelerar.",
    "Tu 17,5 % de grasa está en rango saludable.",
    "Con ese peso estás en sobrepeso.",
    "Tu IMC indica obesidad.",
    "Eso es una tendinitis del manguito.",
    "Haz todas las series al fallo.",
    "Tómate una semana de descarga.",
    "La semana que viene ponte 137,5 kg en press banca.",
  ])("BLOQUEA: %s", (texto) => {
    expect(bloquea(texto)).toBe(true);
  });

  it("y una carga real del contexto pasa", () => {
    expect(bloquea("Mantén los 70 kg.")).toBe(false);
  });

  it("sube la carga PASA cuando el motor sí lo recomienda", () => {
    expect(bloquea("Sube la carga hoy.", { accion: "INCREASE_LOAD" })).toBe(
      false,
    );
  });
});
