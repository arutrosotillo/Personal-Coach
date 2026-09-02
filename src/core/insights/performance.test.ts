import { describe, expect, it } from "vitest";

import { assessPerformance } from "@/core/insights/performance";
import type {
  ContextSession,
  TrainingAnalysis,
  VariantAnalysis,
} from "@/core/training/analysis";
import type {
  ProgressionAction,
  ProgressionReasonCode,
  ProgressionSuggestion,
} from "@/core/training/progression";

/**
 * Agregación del rendimiento a partir de lo que el motor de progresión ya
 * decidió.
 *
 * Los casos que más importan son los que impiden hablar de más: un curl
 * estancado no puede tumbar el veredicto entero, una descarga no es una caída,
 * y un ejercicio recién cambiado no dice nada todavía.
 */

const HOY = "2026-09-01";

function variante(
  id: string,
  opts: {
    action?: ProgressionAction;
    reasonCode?: ProgressionReasonCode;
    regressed?: boolean;
    plateaued?: boolean;
    exposures?: number;
    daysSinceLast?: number;
  } = {},
): VariantAnalysis {
  const suggestion = {
    action: opts.action ?? "HOLD",
    reasonCode: opts.reasonCode ?? "HOLD_DEFAULT",
    suggestedWeightKg: null,
    suggestedReps: null,
    setTargets: null,
    confidence: "MEDIUM",
    explanation: "",
    signals: [],
    engineVersion: "2.0.0",
    numbers: {
      pesoRef: 60,
      loadStepKg: 2.5,
      repRange: [8, 12],
      targetRir: 2,
      n: 3,
      plannedSets: 3,
      missingRir: 0,
      exposures: opts.exposures ?? 5,
      sameWeightRun: 1,
      daysSinceLast: opts.daysSinceLast ?? 3,
    },
  } as unknown as ProgressionSuggestion;

  return {
    variantId: id,
    exerciseName: `Ejercicio ${id}`,
    variantName: "barra",
    daysSinceLast: opts.daysSinceLast ?? 3,
    exposures: opts.exposures ?? 5,
    suggestion,
    regressed: opts.regressed ?? false,
    plateaued: opts.plateaued ?? false,
  };
}

function sesion(localDate: string, deload = false): ContextSession {
  return {
    id: `s-${localDate}`,
    localDate,
    templateName: "Torso A",
    perceivedPerformance: null,
    pump: null,
    jointPain: null,
    fatigue: null,
    motivation: null,
    notes: null,
    plannedSets: 12,
    loggedSets: deload ? 6 : 12,
    deload,
    completionRate: deload ? 0.5 : 1,
    durationMin: 60,
  };
}

function analisis(
  variants: VariantAnalysis[],
  sessions: ContextSession[] = [sesion("2026-08-30")],
): TrainingAnalysis {
  return {
    context: {
      todayLocalDate: HOY,
      sinceLocalDate: "2026-08-01",
      sessions,
      variants: [],
      weeksSinceDeload: 4,
    },
    variants,
    fatigue: {} as TrainingAnalysis["fatigue"],
  };
}

/** N variantes que el motor pide subir. */
const subiendo = (n: number, prefijo = "up") =>
  Array.from({ length: n }, (_, i) =>
    variante(`${prefijo}${i}`, { action: "INCREASE_LOAD" }),
  );
const manteniendo = (n: number, prefijo = "hold") =>
  Array.from({ length: n }, (_, i) => variante(`${prefijo}${i}`));
const cayendo = (n: number, prefijo = "down") =>
  Array.from({ length: n }, (_, i) =>
    variante(`${prefijo}${i}`, { regressed: true, action: "DECREASE_LOAD" }),
  );

describe("estado de una variante", () => {
  it("el motor pidiendo subir carga o reps es mejorar", () => {
    for (const action of ["INCREASE_LOAD", "ADD_REP"] as const) {
      const r = assessPerformance(
        analisis(manteniendo(2).concat(variante("x", { action }))),
      );
      expect(r.variants.find((v) => v.variantId === "x")!.state).toBe(
        "IMPROVING",
      );
    }
  });

  it("`regressed` manda por encima de la acción: una bajada sin recuperar es caída", () => {
    const r = assessPerformance(
      analisis([
        variante("x", { regressed: true, action: "HOLD" }),
        ...manteniendo(2),
      ]),
    );
    expect(r.variants.find((v) => v.variantId === "x")!.state).toBe(
      "DECLINING",
    );
  });

  it("una meseta es estable, no una caída", () => {
    const r = assessPerformance(
      analisis([variante("x", { plateaued: true }), ...manteniendo(2)]),
    );
    expect(r.variants.find((v) => v.variantId === "x")!.state).toBe("STABLE");
  });
});

describe("qué se queda fuera del recuento", () => {
  it("un ejercicio recién cambiado no cuenta hasta su tercera exposición", () => {
    const r = assessPerformance(
      analisis([...manteniendo(3), variante("nuevo", { exposures: 2 })]),
    );
    const nuevo = r.variants.find((v) => v.variantId === "nuevo")!;
    expect(nuevo.state).toBe("NOT_JUDGED");
    expect(nuevo.excludedBecause).toBe("TOO_FEW_EXPOSURES");
    expect(r.judged).toBe(3);
  });

  it("un ejercicio que no se toca hace un mes no dice nada del presente", () => {
    const r = assessPerformance(
      analisis([...manteniendo(3), variante("viejo", { daysSinceLast: 30 })]),
    );
    expect(
      r.variants.find((v) => v.variantId === "viejo")!.excludedBecause,
    ).toBe("STALE");
  });

  it("sin RIR el motor no puede confirmar el esfuerzo, y aquí tampoco se inventa", () => {
    const r = assessPerformance(
      analisis([
        ...manteniendo(3),
        variante("sinrir", { reasonCode: "NEEDS_RIR_CONFIRMATION" }),
      ]),
    );
    expect(
      r.variants.find((v) => v.variantId === "sinrir")!.excludedBecause,
    ).toBe("RIR_MISSING");
  });

  it("con veto de recuperación el motor suspendió su juicio, y este también", () => {
    const r = assessPerformance(
      analisis([
        ...manteniendo(3),
        variante("veto", { reasonCode: "RECOVERY_VETO" }),
      ]),
    );
    expect(
      r.variants.find((v) => v.variantId === "veto")!.excludedBecause,
    ).toBe("RECOVERY_VETO");
  });

  it("sin historial tampoco", () => {
    const r = assessPerformance(
      analisis([
        ...manteniendo(3),
        variante("nuevo", { reasonCode: "NO_HISTORY" }),
      ]),
    );
    expect(
      r.variants.find((v) => v.variantId === "nuevo")!.excludedBecause,
    ).toBe("NO_HISTORY");
  });
});

describe("agregación", () => {
  it("con menos de tres variantes juzgables no se resume nada", () => {
    const r = assessPerformance(analisis(manteniendo(2)));
    expect(r.trend).toBe("INSUFFICIENT_DATA");
    expect(r.reasonCode).toBe("TOO_FEW_JUDGED_VARIANTS");
  });

  it("UN curl estancado NO convierte el entrenamiento entero en caída", () => {
    // El caso que motiva la regla de proporción: 1 de 8 es el 12,5 %, y
    // además es una sola variante. Ni por número ni por proporción.
    const r = assessPerformance(analisis([...manteniendo(7), ...cayendo(1)]));
    expect(r.declining).toBe(1);
    expect(r.judged).toBe(8);
    expect(r.trend).not.toBe("DECLINING");
    expect(r.trend).toBe("STABLE");
  });

  it("tres de ocho sí es una caída", () => {
    const r = assessPerformance(analisis([...manteniendo(5), ...cayendo(3)]));
    expect(r.trend).toBe("DECLINING");
    expect(r.reasonCode).toBe("SEVERAL_REGRESSED");
  });

  it("dos de seis también: hacen falta número Y proporción, y aquí se cumplen las dos", () => {
    const r = assessPerformance(analisis([...manteniendo(4), ...cayendo(2)]));
    expect(r.trend).toBe("DECLINING");
  });

  it("dos de doce no: cumple el número pero no la proporción", () => {
    const r = assessPerformance(analisis([...manteniendo(10), ...cayendo(2)]));
    expect(r.judged).toBe(12);
    expect(r.trend).toBe("STABLE");
  });

  it("mayoría progresando y nada cayendo es mejorar", () => {
    const r = assessPerformance(analisis([...subiendo(4), ...manteniendo(2)]));
    expect(r.trend).toBe("IMPROVING");
    expect(r.reasonCode).toBe("MAJORITY_PROGRESSING");
  });

  it("señales contradictorias NO son 'mejorando' por mucho que la mayoría suba", () => {
    // Si algo va hacia atrás, el veredicto global no puede ser optimista.
    const r = assessPerformance(analisis([...subiendo(6), ...cayendo(1)]));
    expect(r.improving).toBe(6);
    expect(r.declining).toBe(1);
    expect(r.trend).toBe("STABLE");
    expect(r.reasonCode).toBe("MIXED_SIGNALS");
  });

  it("mitad subiendo y mitad manteniendo llega justo a mejorar", () => {
    const r = assessPerformance(analisis([...subiendo(3), ...manteniendo(3)]));
    expect(r.trend).toBe("IMPROVING");
  });
});

describe("descargas", () => {
  it("una descarga reciente BLOQUEA el veredicto de caída", () => {
    // Menos series y menos carga a propósito. Leerlo como caída de rendimiento
    // sería confundir el tratamiento con la enfermedad.
    const conDescarga = assessPerformance(
      analisis(
        [...manteniendo(5), ...cayendo(3)],
        [sesion("2026-08-28", true), sesion("2026-08-30")],
      ),
    );
    expect(conDescarga.recentDeload).toBe(true);
    expect(conDescarga.trend).toBe("STABLE");
    expect(conDescarga.reasonCode).toBe("DELOAD_IN_WINDOW");
    // El recuento crudo sigue disponible: se bloquea el veredicto, no el dato.
    expect(conDescarga.declining).toBe(3);
  });

  it("una descarga antigua ya no bloquea nada", () => {
    const r = assessPerformance(
      analisis(
        [...manteniendo(5), ...cayendo(3)],
        [sesion("2026-07-01", true), sesion("2026-08-30")],
      ),
    );
    expect(r.recentDeload).toBe(false);
    expect(r.trend).toBe("DECLINING");
  });

  it("una descarga no impide reconocer que se está mejorando", () => {
    // Solo bloquea el veredicto negativo, no todos.
    const r = assessPerformance(
      analisis(
        [...subiendo(4), ...manteniendo(2)],
        [sesion("2026-08-28", true)],
      ),
    );
    expect(r.recentDeload).toBe(true);
    expect(r.trend).toBe("IMPROVING");
  });
});

describe("invariantes", () => {
  it("los recuentos siempre cuadran", () => {
    const casos = [
      manteniendo(3),
      [...subiendo(2), ...cayendo(2), ...manteniendo(1)],
      [...manteniendo(3), variante("x", { exposures: 1 })],
      [],
    ];
    for (const variants of casos) {
      const r = assessPerformance(analisis(variants));
      expect(r.improving + r.stable + r.declining).toBe(r.judged);
      expect(r.judged + r.notJudged).toBe(variants.length);
    }
  });

  it("sin variantes no revienta: dice que faltan datos", () => {
    const r = assessPerformance(analisis([]));
    expect(r.trend).toBe("INSUFFICIENT_DATA");
    expect(r.judged).toBe(0);
  });

  it("el orden de las variantes no cambia el veredicto", () => {
    const variants = [...subiendo(2), ...cayendo(2), ...manteniendo(3)];
    const a = assessPerformance(analisis(variants));
    const b = assessPerformance(analisis([...variants].reverse()));
    expect(b.trend).toBe(a.trend);
    expect(b.judged).toBe(a.judged);
    expect(b.declining).toBe(a.declining);
  });

  it("una variante excluida NUNCA cuenta como mejora ni como caída", () => {
    const r = assessPerformance(
      analisis([
        ...manteniendo(3),
        variante("a", { exposures: 1, regressed: true }),
        variante("b", { daysSinceLast: 40, action: "INCREASE_LOAD" }),
        variante("c", { reasonCode: "RECOVERY_VETO", regressed: true }),
      ]),
    );
    expect(r.judged).toBe(3);
    expect(r.declining).toBe(0);
    expect(r.improving).toBe(0);
    expect(r.notJudged).toBe(3);
  });
});
