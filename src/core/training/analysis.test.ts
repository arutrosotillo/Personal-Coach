import { describe, expect, it } from "vitest";

import { addDays } from "@/core/dates";

import { analyzeTraining, type TrainingContext } from "./analysis";

/**
 * `analysis.ts` es el traductor entre los dos motores: convierte lo que dice el
 * motor de progresión en las entradas del motor de fatiga. Es un sitio barato
 * para meter la pata caro, porque un error aquí hace que la app se contradiga a
 * sí misma en dos pantallas distintas.
 */

const TODAY = "2026-08-25";

function sets(weightKg: number, reps: number[], rir = 2) {
  return reps.map((r) => ({ weightKg, reps: r, rir }));
}

function variant(
  variantId: string,
  exposures: TrainingContext["variants"][number]["exposures"],
) {
  return {
    variantId,
    exerciseName: variantId,
    variantName: "Barra",
    prescription: {
      repRangeMin: 6,
      repRangeMax: 8,
      targetRir: 2,
      plannedSets: 3,
      loadStepKg: 2.5,
    },
    exposures,
    daysSinceLast: 3,
  };
}

function context(
  variants: TrainingContext["variants"],
  sessions: TrainingContext["sessions"] = [],
): TrainingContext {
  return {
    todayLocalDate: TODAY,
    sinceLocalDate: addDays(TODAY, -28),
    sessions,
    variants,
    weeksSinceDeload: 3,
  };
}

/** Cuatro sesiones con el feedback indicado en las dos últimas. */
function sessions(feedback: Partial<TrainingContext["sessions"][number]> = {}) {
  return [24, 17, 10, 3].map((daysAgo, i) => ({
    id: `s${i}`,
    localDate: addDays(TODAY, -daysAgo),
    templateName: "Full body",
    perceivedPerformance: null,
    pump: null,
    jointPain: null,
    fatigue: null,
    motivation: null,
    notes: null,
    plannedSets: 9,
    loggedSets: 9,
    completionRate: 1,
    durationMin: 60,
    ...(i >= 2 ? feedback : {}),
  }));
}

describe("regresión: qué cuenta como 'el rendimiento ha caído'", () => {
  it("un mal día suelto NO es una regresión", () => {
    // El caso que disparaba una recomendación de descarga: cuatro semanas
    // impecables y una única sesión mala al mismo peso que la anterior. La
    // pantalla de sesión decía "no cambio nada por una sesión" mientras la
    // tarjeta de recuperación decía "el rendimiento ha caído".
    const v = variant("Press banca", [
      { localDate: addDays(TODAY, -24), sets: sets(82.5, [8, 8, 8]) },
      { localDate: addDays(TODAY, -17), sets: sets(82.5, [8, 8, 8]) },
      { localDate: addDays(TODAY, -10), sets: sets(82.5, [8, 8, 8]) },
      { localDate: addDays(TODAY, -3), sets: sets(82.5, [5, 5, 5], 0) },
    ]);
    const r = analyzeTraining(context([v]));
    expect(r.variants[0].suggestion.reasonCode).toBe(
      "ONE_OFF_UNDERPERFORMANCE",
    );
    expect(r.variants[0].regressed).toBe(false);
  });

  it("y no depende de si ese peso ya se había usado antes", () => {
    // La condición antigua miraba `sameWeightRun`, así que el veredicto
    // cambiaba según un detalle que no dice nada del entrenamiento.
    const estrenado = variant("Press banca", [
      { localDate: addDays(TODAY, -24), sets: sets(77.5, [8, 8, 8]) },
      { localDate: addDays(TODAY, -17), sets: sets(80, [8, 8, 8]) },
      { localDate: addDays(TODAY, -10), sets: sets(82.5, [8, 8, 8]) },
      { localDate: addDays(TODAY, -3), sets: sets(85, [5, 5, 5], 0) },
    ]);
    expect(analyzeTraining(context([estrenado])).variants[0].regressed).toBe(
      false,
    );
  });

  it("un peso que el motor ha tenido que bajar SÍ lo es", () => {
    const v = variant("Press banca", [
      { localDate: addDays(TODAY, -24), sets: sets(85, [8, 8, 8]) },
      { localDate: addDays(TODAY, -17), sets: sets(85, [4, 4, 4], 0) },
      { localDate: addDays(TODAY, -10), sets: sets(85, [4, 4, 3], 0) },
      { localDate: addDays(TODAY, -3), sets: sets(80, [5, 5, 4], 0) },
    ]);
    const r = analyzeTraining(context([v]));
    expect(r.variants[0].regressed).toBe(true);
  });

  it("pero deja de serlo cuando el ejercicio vuelve a avanzar", () => {
    // Bajar una vez y reconstruir es doble progresión funcionando, no una
    // caída: mientras el motor pida más, el ejercicio no está en regresión.
    const v = variant("Press banca", [
      { localDate: addDays(TODAY, -24), sets: sets(85, [8, 8, 8]) },
      { localDate: addDays(TODAY, -17), sets: sets(85, [4, 4, 4], 0) },
      { localDate: addDays(TODAY, -10), sets: sets(80, [6, 6, 6]) },
      { localDate: addDays(TODAY, -3), sets: sets(80, [7, 7, 6]) },
    ]);
    const r = analyzeTraining(context([v]));
    expect(r.variants[0].suggestion.action).toBe("ADD_REP");
    expect(r.variants[0].regressed).toBe(false);
  });
});

describe("veto de recuperación (COACH_PHILOSOPHY §2)", () => {
  /** Ejercicio con el rango cerrado: sin veto, el motor sube la carga. */
  const listoParaSubir = variant("Press banca", [
    { localDate: addDays(TODAY, -10), sets: sets(80, [8, 8, 8]) },
    { localDate: addDays(TODAY, -3), sets: sets(80, [8, 8, 8]) },
  ]);

  it("sin señales, la subida sale como siempre", () => {
    const r = analyzeTraining(context([listoParaSubir], sessions()));
    expect(r.variants[0].suggestion.action).toBe("INCREASE_LOAD");
  });

  it("el dolor articular suspende la subida y lo dice", () => {
    const r = analyzeTraining(
      context([listoParaSubir], sessions({ jointPain: 5 })),
    );
    const s = r.variants[0].suggestion;
    expect(r.fatigue.jointPain.level).toBe("ACTION");
    expect(s.action).toBe("HOLD");
    expect(s.reasonCode).toBe("RECOVERY_VETO");
    expect(s.suggestedWeightKg).toBe(80);
    expect(s.explanation).toMatch(/dolor manda/i);
    // La subida no se pierde: queda registrada en una señal.
    expect(s.signals.map((x) => x.code)).toContain("VETO_SUSPENDED_INCREASE");
    expect(s.signals.at(-1)!.numbers.pesoSuspendido).toBe(82.5);
  });

  it("el veto nunca BAJA la carga: solo suspende la subida", () => {
    const r = analyzeTraining(
      context([listoParaSubir], sessions({ jointPain: 5 })),
    );
    expect(r.variants[0].suggestion.suggestedWeightKg).toBe(80);
    expect(r.variants[0].suggestion.action).not.toBe("DECREASE_LOAD");
  });

  it("progresar en repeticiones sigue permitido durante una descarga", () => {
    const aMedioRango = variant("Remo", [
      { localDate: addDays(TODAY, -10), sets: sets(70, [6, 6, 6]) },
      { localDate: addDays(TODAY, -3), sets: sets(70, [7, 7, 6]) },
    ]);
    const r = analyzeTraining(
      context([aMedioRango], sessions({ jointPain: 5 })),
    );
    expect(r.variants[0].suggestion.action).toBe("ADD_REP");
  });

  it("el veto no realimenta al motor de fatiga", () => {
    // Si el HOLD que pone el veto contase como regresión, el propio veto
    // sería evidencia de fatiga y el sistema se retroalimentaría.
    const r = analyzeTraining(
      context([listoParaSubir], sessions({ jointPain: 5 })),
    );
    expect(r.variants[0].regressed).toBe(false);
    expect(r.fatigue.signals.map((s) => s.code)).not.toContain(
      "PERFORMANCE_DECLINE",
    );
  });
});

describe("un mal día tras haberse recuperado no es una caída", () => {
  /** 85 falla → el motor baja a 82,5 → reconstruye hasta 8/8/8 → un mal día. */
  const recuperado = variant("Press banca", [
    { localDate: addDays(TODAY, -28), sets: sets(85, [5, 5, 5], 0) },
    { localDate: addDays(TODAY, -21), sets: sets(82.5, [7, 7, 7]) },
    { localDate: addDays(TODAY, -14), sets: sets(82.5, [8, 8, 8]) },
    { localDate: addDays(TODAY, -7), sets: sets(82.5, [8, 8, 8]) },
    { localDate: addDays(TODAY, -2), sets: sets(82.5, [5, 5, 5], 0) },
  ]);

  it("no cuenta como regresión, aunque el peso siga por debajo del máximo", () => {
    // `walkedBack` mira si el peso actual está por debajo del máximo de la
    // ventana, y aquí lo está (82,5 < 85). Pero el usuario ya había
    // reconstruido: lo de hoy es un mal día, no una caída.
    const r = analyzeTraining(context([recuperado]));
    expect(r.variants[0].suggestion.reasonCode).toBe(
      "ONE_OFF_UNDERPERFORMANCE",
    );
    expect(r.variants[0].regressed).toBe(false);
  });

  it("y con dos ejercicios así NO se recomienda una descarga", () => {
    // El caso completo: era `DELOAD_RECOMMENDED` con un mensaje que decía "el
    // motor ha tenido que bajar la carga" cuando el motor acababa de decir
    // exactamente lo contrario en la pantalla de al lado.
    const otro = {
      ...recuperado,
      variantId: "Sentadilla",
      exerciseName: "Sentadilla",
    };
    const r = analyzeTraining(context([recuperado, otro], sessions()));
    expect(r.fatigue.decision).not.toBe("DELOAD_RECOMMENDED");
  });

  it("pero si nunca llegó a reconstruir, sí lo es", () => {
    const nuncaRecuperado = variant("Press banca", [
      { localDate: addDays(TODAY, -21), sets: sets(85, [8, 8, 8]) },
      { localDate: addDays(TODAY, -14), sets: sets(85, [4, 4, 4], 0) },
      { localDate: addDays(TODAY, -7), sets: sets(85, [4, 4, 3], 0) },
      { localDate: addDays(TODAY, -2), sets: sets(80, [5, 5, 4], 0) },
    ]);
    expect(
      analyzeTraining(context([nuncaRecuperado])).variants[0].regressed,
    ).toBe(true);
  });
});
