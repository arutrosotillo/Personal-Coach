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
    deload: false,
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

describe("la vuelta de una descarga (fatiga v1.1.0)", () => {
  /**
   * El bucle que esto cierra: las sesiones de descarga no cuentan como
   * exposición, así que al volver el motor de fatiga veía las MISMAS caídas
   * que habían motivado la descarga, la volvía a recomendar y vetaba las
   * subidas el primer día de vuelta. Hacer la descarga no servía de nada.
   */
  const d = (daysAgo: number) => addDays(TODAY, -daysAgo);
  const conDias = (v: ReturnType<typeof variant>) => ({
    ...v,
    daysSinceLast: Math.round(
      (Date.parse(TODAY) - Date.parse(v.exposures.at(-1)!.localDate)) /
        86_400_000,
    ),
  });

  /** El motor le ha tenido que bajar la carga y no se ha recuperado. */
  const cayendo = (
    name: string,
    despues: TrainingContext["variants"][number]["exposures"] = [],
  ) =>
    conDias(
      variant(name, [
        { localDate: d(34), sets: sets(85, [8, 8, 8]) },
        { localDate: d(27), sets: sets(85, [4, 4, 4], 0) },
        { localDate: d(20), sets: sets(85, [4, 4, 3], 0) },
        { localDate: d(13), sets: sets(80, [5, 5, 4], 0) },
        ...despues,
      ]),
    );
  /** Rango cerrado: sin veto, el motor sube la carga. */
  const listo = conDias(
    variant("Curl", [
      { localDate: d(20), sets: sets(80, [8, 8, 8]) },
      { localDate: d(13), sets: sets(80, [8, 8, 8]) },
    ]),
  );
  const CAYENDO = ["Press banca", "Sentadilla", "Remo"];

  function sesion(daysAgo: number, deload = false) {
    return {
      id: `s${daysAgo}`,
      localDate: d(daysAgo),
      templateName: "Full body",
      perceivedPerformance: null,
      pump: null,
      jointPain: null,
      fatigue: null,
      motivation: null,
      notes: null,
      plannedSets: 12,
      loggedSets: deload ? 6 : 12,
      completionRate: deload ? 0.5 : 1,
      durationMin: 60,
      deload,
    };
  }
  const ANTES = [27, 20, 13].map((x) => sesion(x));
  const byName = (r: ReturnType<typeof analyzeTraining>, name: string) =>
    r.variants.find((v) => v.exerciseName === name)!;

  it("antes de terminarla, las caídas siguen contando y no se sube carga", () => {
    const r = analyzeTraining(
      context(
        [...CAYENDO.map((n) => cayendo(n)), listo],
        [...ANTES, sesion(2, true)],
      ),
    );
    expect(r.fatigue.deload.phase).toBe("IN_PROGRESS");
    expect(r.fatigue.decision).toBe("DELOAD_RECOMMENDED");
    expect(r.fatigue.signals.map((s) => s.code)).toContain(
      "SEVERE_PERFORMANCE_DECLINE",
    );
    expect(CAYENDO.every((n) => byName(r, n).regressed)).toBe(true);
    expect(byName(r, "Curl").suggestion.reasonCode).toBe("RECOVERY_VETO");
    expect(byName(r, "Curl").suggestion.suggestedWeightKg).toBe(80);
    expect(r.fatigue.headline).toMatch(/^Estás haciendo la descarga/);
  });

  it("terminada: las caídas de antes ya no cuentan y el primer día ya puedes subir", () => {
    const r = analyzeTraining(
      context(
        [...CAYENDO.map((n) => cayendo(n)), listo],
        [...ANTES, sesion(6, true), sesion(4, true), sesion(2, true)],
      ),
    );
    expect(r.fatigue.deload.phase).toBe("FINISHED");
    expect(r.fatigue.deload.lastCompleted?.endLocalDate).toBe(d(2));
    expect(r.variants.every((v) => !v.regressed && !v.plateaued)).toBe(true);
    expect(r.fatigue.objectiveScore).toBe(0);
    expect(r.fatigue.decision).toBe("NO_DELOAD");
    expect(r.fatigue.headline).toMatch(
      /^Descarga terminada \(3 sesiones\): en la próxima sesión vuelve a tu volumen normal/,
    );
    // Sin veto: la subida que estaba suspendida vuelve a salir.
    expect(byName(r, "Curl").suggestion.action).toBe("INCREASE_LOAD");
    expect(byName(r, "Curl").suggestion.suggestedWeightKg).toBe(82.5);
  });

  it("la carga de cada ejercicio la sigue decidiendo TODO su historial", () => {
    // Lo que cambia es qué cuenta como evidencia de fatiga, no la progresión:
    // `suggestion` es lo mismo que ve la pantalla de sesión.
    const r = analyzeTraining(
      context(
        [cayendo("Press banca")],
        [...ANTES, sesion(6, true), sesion(4, true), sesion(2, true)],
      ),
    );
    expect(byName(r, "Press banca").exposures).toBe(4);
    expect(byName(r, "Press banca").suggestion.numbers.exposures).toBe(4);
    expect(byName(r, "Press banca").regressed).toBe(false);
  });

  it("al volver, una sola sesión mala tampoco basta", () => {
    // Nunca ajustar por un dato aislado: con UNA exposición nueva no hay
    // tendencia que juzgar, venga o no de una descarga.
    const r = analyzeTraining(
      context(
        [
          ...CAYENDO.map((n) =>
            cayendo(n, [{ localDate: d(0), sets: sets(80, [4, 4, 4], 0) }]),
          ),
          listo,
        ],
        [
          ...ANTES,
          sesion(6, true),
          sesion(4, true),
          sesion(2, true),
          sesion(0),
        ],
      ),
    );
    expect(r.fatigue.deload.phase).toBe("NONE");
    expect(CAYENDO.some((n) => byName(r, n).regressed)).toBe(false);
    expect(r.fatigue.decision).toBe("NO_DELOAD");
    expect(r.fatigue.headline).not.toMatch(/Descarga terminada/);
  });

  it("pero si sigue cayendo DESPUÉS de descargar, lo ve con los datos nuevos", () => {
    const r = analyzeTraining(
      context(
        [
          ...CAYENDO.map((n) =>
            conDias(
              variant(n, [
                { localDate: d(34), sets: sets(85, [8, 8, 8]) },
                { localDate: d(27), sets: sets(85, [4, 4, 4], 0) },
                { localDate: d(20), sets: sets(85, [4, 4, 3], 0) },
                { localDate: d(6), sets: sets(80, [4, 4, 4], 0) },
                { localDate: d(2), sets: sets(80, [4, 4, 4], 0) },
              ]),
            ),
          ),
          conDias(
            variant("Curl", [
              { localDate: d(27), sets: sets(80, [8, 8, 8]) },
              { localDate: d(20), sets: sets(80, [8, 8, 8]) },
            ]),
          ),
        ],
        [
          sesion(27),
          sesion(20),
          sesion(16, true),
          sesion(14, true),
          sesion(12, true),
          sesion(6),
          sesion(2),
        ],
      ),
    );
    expect(r.fatigue.deload.lastCompleted?.endLocalDate).toBe(d(12));
    // Juzgado SOLO con las dos sesiones de después: 80 kg × 4, dos veces.
    expect(CAYENDO.every((n) => byName(r, n).regressed)).toBe(true);
    expect(r.fatigue.decision).toBe("DELOAD_RECOMMENDED");
    expect(r.fatigue.headline).toMatch(/^Te recomiendo una semana de descarga/);
    expect(byName(r, "Curl").suggestion.reasonCode).toBe("RECOVERY_VETO");
  });

  it("durante la descarga no se sube carga aunque el veredicto ya no la pida", () => {
    // El plan es la misma carga con la mitad de las series. Que el score baje
    // a mitad de semana no termina la descarga.
    const r = analyzeTraining(
      context(
        [listo, conDias(variant("Remo", listo.exposures))],
        [...ANTES, sesion(2, true)],
      ),
    );
    expect(r.fatigue.decision).toBe("NO_DELOAD");
    expect(r.fatigue.deload.phase).toBe("IN_PROGRESS");
    const s = byName(r, "Curl").suggestion;
    expect(s.action).toBe("HOLD");
    expect(s.reasonCode).toBe("RECOVERY_VETO");
    expect(s.explanation).toMatch(/^Estás haciendo la descarga/);
  });

  it("una sola sesión recortada no es una descarga: no borra nada", () => {
    const r = analyzeTraining(
      context(
        [...CAYENDO.map((n) => cayendo(n)), listo],
        [...ANTES, sesion(9, true), sesion(2)],
      ),
    );
    expect(r.fatigue.deload.lastCompleted).toBeNull();
    expect(CAYENDO.every((n) => byName(r, n).regressed)).toBe(true);
    expect(r.fatigue.decision).toBe("DELOAD_RECOMMENDED");
  });

  it("una descarga fuera de la ventana sigue marcando desde cuándo los datos son nuevos", () => {
    // La ventana de sesiones son 28 días; el historial que llega en
    // `timeline` es entero. Sin él, el corte desaparecería al salir la
    // descarga de la ventana y las caídas viejas volverían a contar.
    const viejo = (name: string) =>
      conDias(
        variant(name, [
          { localDate: d(50), sets: sets(85, [8, 8, 8]) },
          { localDate: d(45), sets: sets(85, [4, 4, 4], 0) },
          { localDate: d(40), sets: sets(80, [5, 5, 4], 0) },
          { localDate: d(20), sets: sets(80, [6, 6, 5], 0) },
          { localDate: d(13), sets: sets(80, [6, 6, 5], 0) },
        ]),
      );
    const ctx = context(CAYENDO.map(viejo), ANTES);
    const conHistorial = analyzeTraining({
      ...ctx,
      timeline: [
        ...[50, 45, 40].map((x) => ({ localDate: d(x), deload: false })),
        ...[36, 34, 32].map((x) => ({ localDate: d(x), deload: true })),
        ...ANTES,
      ],
    });
    expect(conHistorial.fatigue.deload.lastCompleted?.endLocalDate).toBe(d(32));
    expect(conHistorial.variants.every((v) => !v.regressed)).toBe(true);

    // Sin el historial no hay corte: el peso bajado de hace 40 días cuenta.
    const sinHistorial = analyzeTraining(ctx);
    expect(sinHistorial.fatigue.deload.lastCompleted).toBeNull();
    expect(sinHistorial.variants.every((v) => v.regressed)).toBe(true);
  });
});
