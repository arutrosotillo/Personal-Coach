import { describe, expect, it } from "vitest";

import { PROGRESSION, RECENCY } from "@/core/config/training-config";
import { addDays } from "@/core/dates";

import {
  equivalentReps,
  suggestProgression,
  type ProgressionExposure,
  type ProgressionInput,
  type ProgressionPrescription,
  type ProgressionSet,
} from "./progression";

/**
 * Suite del motor de progresión v2 (Fase 3.2b). Doble aserción en todos los
 * casos: valor numérico + reasonCode/explicación. Ver
 * docs/TRAINING_ENGINE_FINAL_AUDIT.md §7 para la escalera de decisión.
 */

/** Prescripción canónica de la auditoría: 3×6–8 @ 2 RIR, incremento 2,5 kg. */
const BENCH: ProgressionPrescription = {
  repRangeMin: 6,
  repRangeMax: 8,
  targetRir: 2,
  loadStepKg: 2.5,
  plannedSets: 3,
};

/** `s(80, [8, 8, 7], [2, 2, 1])` → una exposición de 3 series. */
function s(
  weightKg: number,
  reps: number[],
  rir: Array<number | null> | number | null = null,
): ProgressionExposure {
  const rirs = Array.isArray(rir) ? rir : reps.map(() => rir);
  return {
    sets: reps.map((r, i): ProgressionSet => ({
      weightKg,
      reps: r,
      rir: rirs[i] ?? null,
    })),
  };
}

function run(
  history: ProgressionExposure[],
  rx: Partial<ProgressionPrescription> = {},
  todayLocalDate?: string,
) {
  const input: ProgressionInput = {
    prescription: { ...BENCH, ...rx },
    history,
    todayLocalDate,
  };
  return suggestProgression(input);
}

const TODAY = "2026-08-25";

/** La misma exposición, fechada a `daysAgo` días de `TODAY`. */
function dated(exposure: ProgressionExposure, daysAgo: number) {
  return { ...exposure, localDate: addDays(TODAY, -daysAgo) };
}

// ───────────────────────────────────────────────────────────────────────────
describe("0 · sin historial", () => {
  it("sin exposiciones → START, no inventa peso", () => {
    const r = run([]);
    expect(r.action).toBe("START");
    expect(r.reasonCode).toBe("NO_HISTORY");
    expect(r.suggestedWeightKg).toBeNull();
    expect(r.suggestedReps).toBe(6);
    expect(r.setTargets).toBeNull();
    expect(r.confidence).toBe("LOW");
    expect(r.explanation).toMatch(/Primera vez/i);
  });

  it("exposiciones vacías (variante recién sustituida) → START", () => {
    const r = run([{ sets: [] }]);
    expect(r.action).toBe("START");
    expect(r.reasonCode).toBe("NO_HISTORY");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("1 · sesión incompleta", () => {
  it("1 de 3 series → HOLD, no ajusta con media sesión", () => {
    const r = run([s(80, [8], [2])]);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("SESSION_INCOMPLETE");
    expect(r.suggestedWeightKg).toBe(80);
    expect(r.confidence).toBe("LOW");
    expect(r.explanation).toContain("1 de 3");
  });

  it("2 de 3 series es utilizable para decidir, pero NO para subir la carga", () => {
    const r = run([s(80, [8, 8], [2, 2])]);
    expect(r.action).toBe("ADD_REP");
    expect(r.reasonCode).toBe("INCOMPLETE_FOR_INCREASE");
    expect(r.numbers.n).toBe(2);
    expect(r.explanation).toContain("2 de 3 series");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("2 · banda de RIR (targetRir ± 1)", () => {
  it("8/8/7 @1 con objetivo 2 → INCREASE_LOAD (dentro de la banda, ya no HOLD genérico)", () => {
    const r = run([s(80, [8, 8, 7], [2, 2, 1])]);
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.reasonCode).toBe("RANGE_CLOSED");
    expect(r.suggestedWeightKg).toBe(82.5);
    expect(r.explanation).toContain("82.5");
  });

  it("8/8/8 @1 con objetivo 2 → INCREASE_LOAD", () => {
    const r = run([s(80, [8, 8, 8], 1)]);
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.reasonCode).toBe("RANGE_CLOSED");
  });

  it("8/8/8 @2 → INCREASE_LOAD (referencia)", () => {
    const r = run([s(80, [8, 8, 8], 2)]);
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.suggestedWeightKg).toBe(82.5);
  });

  it("8/8/8 @0 NO recibe el mismo trato que @2 → HOLD la primera vez", () => {
    const r = run([s(80, [8, 8, 8], 0)]);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("CLOSED_RANGE_AT_FAILURE");
    expect(r.suggestedWeightKg).toBe(80);
    expect(r.explanation).toMatch(/llegaste al fallo/i);
    expect(r.explanation).toMatch(/subimos igualmente/i);
  });

  it("cerrar el rango a fallo dos veces seguidas → sube igualmente (sin estado absorbente)", () => {
    const r = run([s(80, [8, 8, 8], 0), s(80, [8, 8, 8], 0)]);
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.reasonCode).toBe("RANGE_CLOSED_AFTER_FAILURE");
    expect(r.suggestedWeightKg).toBe(82.5);
    expect(r.explanation).toMatch(/dos veces seguidas/i);
  });

  it("aislamiento con objetivo 1: llegar al fallo NO se penaliza (0 permitido, nunca exigido)", () => {
    // Con `targetRir 1` la cláusula de fallo cancelaría exactamente la banda y
    // dejaría la zona muerta intacta para la mitad del catálogo. El fallo
    // voluntario en un aislamiento tiene coste de fatiga bajo y el RIR se
    // estima MEJOR cerca del fallo (Halperin 2022): no hay motivo para frenar.
    const r = run([s(30, [15, 15, 15], 0)], {
      repRangeMin: 10,
      repRangeMax: 15,
      targetRir: 1,
      loadStepKg: 2.5,
    });
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.reasonCode).toBe("RANGE_CLOSED");
  });

  it("compuesto con objetivo 2: llegar al fallo SÍ frena la primera vez", () => {
    const r = run([s(100, [8, 8, 8], 0)], { targetRir: 2 });
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("CLOSED_RANGE_AT_FAILURE");
  });

  it("prescripción a fallo (targetRir 0): RIR 0 es exactamente lo pedido → sube", () => {
    const r = run([s(80, [8, 8, 8], 0)], { targetRir: 0 });
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.reasonCode).toBe("RANGE_CLOSED");
  });

  it("fallo sin cerrar el rango → HOLD NEAR_FAILURE_HOLD", () => {
    const r = run([s(80, [7, 7, 6], [0, 0, 0])]);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("NEAR_FAILURE_HOLD");
    expect(r.suggestedWeightKg).toBe(80);
    expect(r.explanation).toMatch(/reserva/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("3 · double progression: ADD_REP sobre la serie más floja", () => {
  it("8/8/6 → objetivo 8/8/7, no resetea a repMin", () => {
    const r = run([s(80, [8, 8, 6], 2)]);
    expect(r.action).toBe("ADD_REP");
    expect(r.reasonCode).toBe("ADD_REP");
    expect(r.suggestedWeightKg).toBe(80);
    expect(r.suggestedReps).toBe(7);
    expect(r.setTargets).toEqual([8, 8, 7]);
    expect(r.explanation).toContain("8/8/7");
  });

  it("6/6/6 → objetivo 7/7/7", () => {
    const r = run([s(80, [6, 6, 6], 2)]);
    expect(r.action).toBe("ADD_REP");
    expect(r.setTargets).toEqual([7, 7, 7]);
  });

  it("7/6/6 → mantiene el 7 y sube las flojas a 7", () => {
    const r = run([s(80, [7, 6, 6], 2)]);
    expect(r.action).toBe("ADD_REP");
    expect(r.suggestedReps).toBe(7);
    expect(r.setTargets).toEqual([7, 7, 7]);
  });

  it("trinquete: un día flojo NO rebaja el objetivo ya consolidado a ese peso", () => {
    const r = run([s(80, [8, 7, 7], 2), s(80, [7, 6, 6], 2)]);
    expect(r.action).toBe("ADD_REP");
    // Ya habías hecho 8/7/7 en 80 kg: el objetivo no retrocede a 7/7/7.
    expect(r.setTargets).toEqual([8, 7, 7]);
  });

  it("trinquete: solo cuenta la racha al MISMO peso (subir de carga lo reinicia)", () => {
    const r = run([s(80, [8, 8, 8], 2), s(82.5, [6, 6, 6], 2)]);
    expect(r.action).toBe("ADD_REP");
    expect(r.setTargets).toEqual([7, 7, 7]);
  });

  it("8/7/7 aún NO cierra el rango (hacen falta n−1 series al techo)", () => {
    const r = run([s(80, [8, 7, 7], 2)]);
    expect(r.action).toBe("ADD_REP");
    expect(r.setTargets).toEqual([8, 8, 8]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("4 · INCREASE_LOAD y tamaño del salto", () => {
  it("objetivo de reps calculado por equivalencia, no repMin (máquina 12–20, paso 5)", () => {
    const r = run([s(40, [20, 20, 20], 1)], {
      repRangeMin: 12,
      repRangeMax: 20,
      targetRir: 1,
      loadStepKg: 5,
    });
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.suggestedWeightKg).toBe(45);
    expect(r.suggestedReps).toBe(14); // equivalencia, no 12
    expect(r.setTargets).toEqual([14, 14, 14]);
  });

  it("carga claramente corta (12/12/12 en rango 6–8) → salto DOBLE, nunca igualar e1RM", () => {
    const r = run([s(80, [12, 12, 12], 2)]);
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.reasonCode).toBe("LOAD_CLEARLY_TOO_LIGHT");
    // 2 incrementos, no el salto de ~12,5 kg que pediría la equivalencia pura.
    expect(r.suggestedWeightKg).toBe(85);
    expect(r.suggestedReps).toBe(8);
    expect(r.explanation).toMatch(/subimos otra vez/i);
  });

  it("overshoot moderado (10/10/10 en rango 6–8) → un solo incremento", () => {
    const r = run([s(80, [10, 10, 10], 2)]);
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.reasonCode).toBe("RANGE_CLOSED");
    expect(r.suggestedWeightKg).toBe(82.5);
  });

  it("el salto doble respeta el tope relativo del 10 %", () => {
    // Máquina de 5 kg sobre 40: 2 pasos = 25 % → se recorta a 1 paso.
    const r = run([s(40, [24, 24, 24], 1)], {
      repRangeMin: 12,
      repRangeMax: 20,
      targetRir: 1,
      loadStepKg: 5,
    });
    expect(r.action).toBe("INCREASE_LOAD");
    // Un solo incremento (5 kg), no dos: el tope relativo recorta el salto
    // DOBLE. Un único incremento del material siempre está permitido.
    expect(r.suggestedWeightKg).toBe(45);
    expect((r.suggestedWeightKg! - 40) / 5).toBe(1);
  });

  it("series ascendentes: referencia = mediana, y NUNCA propone menos de lo ya movido", () => {
    const r = run([
      {
        sets: [
          { weightKg: 75, reps: 8, rir: 2 },
          { weightKg: 80, reps: 8, rir: 2 },
          { weightKg: 85, reps: 8, rir: 2 },
        ],
      },
    ]);
    expect(r.numbers.pesoRef).toBe(80); // mediana, no el mínimo (75)
    // Subir un incremento sobre 80 daría 82,5 kg: menos de los 85 que ya
    // movió. El motor no finge entender el esquema y no descarga a nadie.
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("MIXED_LOADS");
    expect(r.suggestedWeightKg).toBe(85);
    expect(r.signals.map((x) => x.code)).toContain("MIXED_LOADS");
  });

  it("drop-sets: un 'INCREASE' nunca puede acabar descargando al usuario", () => {
    // 75/67,5/60 cada sesión: la mediana es 67,5 y subir daría 70 < 75.
    const r = run([
      {
        sets: [
          { weightKg: 75, reps: 10, rir: 2 },
          { weightKg: 67.5, reps: 10, rir: 3 },
          { weightKg: 60, reps: 10, rir: 4 },
        ],
      },
    ]);
    expect(r.action).not.toBe("INCREASE_LOAD");
    expect(r.suggestedWeightKg!).toBeGreaterThanOrEqual(75);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("5 · saltos incompatibles con el rango → EXTEND_RANGE", () => {
  it("elevación lateral 10 kg, paso 2 kg (+20 %) → extiende el rango antes de subir", () => {
    const r = run([s(10, [15, 15, 15], 1)], {
      repRangeMin: 10,
      repRangeMax: 15,
      targetRir: 1,
      loadStepKg: 2,
    });
    expect(r.action).toBe("ADD_REP");
    expect(r.reasonCode).toBe("EXTEND_RANGE");
    expect(r.suggestedWeightKg).toBe(10);
    expect(r.suggestedReps).toBe(16);
    expect(r.explanation).toMatch(/20 %/);
    expect(r.explanation).toContain("18 reps");
  });

  it("mancuernas 10 kg rango 8–12, siguiente mancuerna 12 kg → 13 reps antes del salto", () => {
    const r = run([s(10, [12, 12, 12], 1)], {
      repRangeMin: 8,
      repRangeMax: 12,
      targetRir: 1,
      loadStepKg: 2,
    });
    expect(r.action).toBe("ADD_REP");
    expect(r.reasonCode).toBe("EXTEND_RANGE");
    expect(r.suggestedReps).toBe(13);
  });

  it("una vez alcanzado el techo extendido, sí sube", () => {
    const r = run([s(10, [18, 18, 18], 1)], {
      repRangeMin: 10,
      repRangeMax: 15,
      targetRir: 1,
      loadStepKg: 2,
    });
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.suggestedWeightKg).toBe(12);
    expect(r.suggestedReps).toBe(10);
  });

  it("si ni extendiendo el rango cabe el salto, lo dice en vez de proponer un objetivo absurdo", () => {
    // Paso de 5 kg sobre 10 kg (+50 %) con rango estrecho: la extensión no basta.
    const r = run([s(10, [8, 8, 8], 1)], {
      repRangeMin: 6,
      repRangeMax: 8,
      targetRir: 1,
      loadStepKg: 5,
    });
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("STEP_TOO_BIG_FOR_RANGE");
    expect(r.suggestedWeightKg).toBe(10);
    // Nunca propone "15 kg × 1 rep".
    expect(r.suggestedReps!).toBeGreaterThanOrEqual(6);
    expect(r.explanation).toMatch(/fraccionales/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("6 · loadStepKg = 0 · sin carga externa cuantificable", () => {
  it("nunca dice 'sube a 0 kg': progresa por repeticiones", () => {
    const r = run([s(0, [25, 25, 25], 1)], {
      repRangeMin: 15,
      repRangeMax: 25,
      targetRir: 1,
      loadStepKg: 0,
    });
    expect(r.action).toBe("ADD_REP");
    expect(r.reasonCode).toBe("NO_LOAD_STEP");
    expect(r.suggestedWeightKg).toBe(0);
    expect(r.suggestedReps).toBe(26);
    expect(r.explanation).not.toMatch(/sube a 0 kg/i);
    expect(r.explanation).toMatch(/no tiene carga externa/i);
  });

  it("al agotar la extensión propone una variante más difícil, no más reps", () => {
    const r = run([s(0, [30, 30, 30], 1)], {
      repRangeMin: 15,
      repRangeMax: 25,
      targetRir: 1,
      loadStepKg: 0,
    });
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("NO_LOAD_STEP_CAPPED");
    expect(r.explanation).toMatch(/variante más difícil/i);
  });

  it("sin carga tampoco baja peso ante bajo rendimiento repetido", () => {
    const under = s(0, [10, 10, 10], 1);
    const r = run([under, under], {
      repRangeMin: 15,
      repRangeMax: 25,
      targetRir: 1,
      loadStepKg: 0,
    });
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("REPEATED_UNDERPERFORMANCE");
    expect(r.explanation).toMatch(/variante más fácil/i);
  });

  it("peso corporal a 0 kg con lastre disponible → añade el primer incremento", () => {
    const r = run([s(0, [10, 10, 10], 2)], {
      repRangeMin: 5,
      repRangeMax: 10,
      targetRir: 2,
      loadStepKg: 2.5,
    });
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.suggestedWeightKg).toBe(2.5);
    expect(r.suggestedReps).toBe(9);
    expect(r.explanation).toMatch(/lastre/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("7 · bajo rendimiento: una sesión no baja la carga, dos sí", () => {
  it("una sola exposición por debajo del mínimo → HOLD con aviso explícito", () => {
    const r = run([s(80, [6, 5, 5], 2)]);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("ONE_OFF_UNDERPERFORMANCE");
    expect(r.suggestedWeightKg).toBe(80);
    expect(r.explanation).toMatch(/No cambio nada por una sesión/i);
    expect(r.explanation).toMatch(/Si se repite/i);
  });

  it("una buena y luego una mala → sigue siendo HOLD (no reacciona a un mal día)", () => {
    const r = run([s(80, [8, 8, 7], 2), s(80, [6, 5, 5], 2)]);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("ONE_OFF_UNDERPERFORMANCE");
  });

  it("dos exposiciones comparables por debajo → DECREASE_LOAD de un incremento", () => {
    const r = run([s(80, [5, 4, 4], 2), s(80, [5, 4, 3], 2)]);
    expect(r.action).toBe("DECREASE_LOAD");
    expect(r.reasonCode).toBe("REPEATED_UNDERPERFORMANCE");
    expect(r.suggestedWeightKg).toBe(77.5);
    expect(r.suggestedReps).toBe(6);
    expect(r.explanation).toMatch(/la carga que sí te deja el rango/i);
  });

  it("bajar exige la MEDIANA por debajo del mínimo: 6/6/5 dos veces NO baja", () => {
    const r = run([s(80, [6, 6, 5], 2), s(80, [6, 6, 5], 2)]);
    expect(r.action).not.toBe("DECREASE_LOAD");
    expect(r.reasonCode).toBe("ADD_REP");
  });

  it("fallar, subir igualmente y volver a fallar → baja anclando al peso más bajo que falló", () => {
    const r = run([s(80, [5, 4, 4], 2), s(82.5, [5, 4, 4], 2)]);
    expect(r.action).toBe("DECREASE_LOAD");
    expect(r.reasonCode).toBe("REPEATED_UNDERPERFORMANCE");
    // Ancla en 80 (el más bajo de la racha), no en 82,5: no persigue hacia arriba.
    expect(r.suggestedWeightKg).toBe(77.5);
  });

  it("si el usuario YA bajó por su cuenta, la racha se corta (se le da otra sesión)", () => {
    const r = run([s(82.5, [5, 4, 4], 2), s(80, [5, 4, 4], 2)]);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("ONE_OFF_UNDERPERFORMANCE");
    expect(r.suggestedWeightKg).toBe(80);
  });

  it("quedarse corto habiendo parado lejos del fallo (RIR 4) no baja la carga", () => {
    const r = run([s(80, [5, 4, 4], 4), s(80, [5, 4, 4], 4)]);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("ONE_OFF_UNDERPERFORMANCE");
  });

  it("RIR alto NO puede atrapar al usuario: 4 exposiciones cortas bajan igual", () => {
    // Quien teclea siempre un RIR alto (o corta las series por dolor) quedaba
    // bloqueado para siempre: el guardia anti-sandbagging nunca dejaba bajar.
    const bad = s(85, [3, 3, 2], 4);
    const r = run([bad, bad, bad, bad]);
    expect(r.action).toBe("DECREASE_LOAD");
    expect(r.reasonCode).toBe("STUCK_BELOW_RANGE");
    expect(r.suggestedWeightKg!).toBeLessThan(85);
    expect(r.explanation).toMatch(/Da igual cómo se sienta el esfuerzo/i);
  });

  it("con RIR alto sigue habiendo paciencia: 3 exposiciones aún no bajan", () => {
    const bad = s(85, [3, 3, 2], 4);
    const r = run([bad, bad, bad]);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("ONE_OFF_UNDERPERFORMANCE");
  });

  it("un error de tecleo no reancla el ejercicio: carga atípica → HOLD", () => {
    // 75 kg → 7,5 kg con esfuerzo de sobra: es un dedo gordo, no una sesión.
    const r = run([s(75, [8, 8, 8], 2), s(7.5, [8, 8, 8], 4)]);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("ATYPICAL_LOAD_DROP");
    expect(r.suggestedWeightKg).toBe(75);
    expect(r.explanation).toMatch(/error de registro/i);
  });

  it("una descarga propia confirmada SÍ pasa a ser la referencia", () => {
    const r = run([
      s(75, [8, 8, 8], 2),
      s(57.5, [8, 8, 8], 4),
      s(57.5, [8, 8, 8], 4),
    ]);
    expect(r.reasonCode).not.toBe("ATYPICAL_LOAD_DROP");
    expect(r.numbers.pesoRef).toBe(57.5);
  });

  it("la bajada nunca deja un peso ≤ 0", () => {
    const r = run([s(2.5, [3, 3, 3], 1), s(2.5, [3, 3, 3], 1)], {
      repRangeMin: 6,
      repRangeMax: 8,
      targetRir: 1,
      loadStepKg: 2.5,
    });
    expect(r.action).toBe("HOLD");
    expect(r.suggestedWeightKg).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("8 · señal de meseta (informativa, nunca interviene)", () => {
  it("3 exposiciones al mismo peso sin batir el mejor total → PLATEAU_SIGNAL con números", () => {
    const r = run([
      s(80, [7, 7, 7], 2),
      s(80, [7, 7, 6], 2),
      s(80, [7, 7, 6], 2),
    ]);
    const plateau = r.signals.find((x) => x.code === "PLATEAU_SIGNAL");
    expect(plateau).toBeDefined();
    expect(plateau!.message).toContain("21 → 20 → 20");
    expect(plateau!.numbers.mejorTotal).toBe(21);
    // La acción NO cambia: sigue siendo double progression normal.
    expect(r.action).toBe("ADD_REP");
    expect(r.setTargets).toEqual([7, 7, 7]);
  });

  it("si la última exposición bate el récord, no hay meseta", () => {
    const r = run([
      s(80, [7, 7, 6], 2),
      s(80, [7, 7, 6], 2),
      s(80, [7, 7, 7], 2),
    ]);
    expect(r.signals).toHaveLength(0);
  });

  it("la meseta nunca añade series, ni baja peso, ni pide deload", () => {
    const r = run([
      s(80, [7, 7, 7], 2),
      s(80, [7, 7, 6], 2),
      s(80, [7, 7, 6], 2),
    ]);
    expect(["ADD_REP", "HOLD"]).toContain(r.action);
    expect(r.setTargets).toHaveLength(3);
    expect(r.numbers.plannedSets).toBe(3);
    expect(JSON.stringify(r)).not.toMatch(/deload/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("9 · RIR ausente: nunca es evidencia positiva", () => {
  it("sin ningún RIR registrado la confianza es BAJA aunque progrese por repeticiones", () => {
    const r = run([s(80, [8, 8, 8], null), s(80, [8, 8, 8], null)]);
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.confidence).toBe("LOW");
    expect(r.numbers.missingRir).toBe(3);
  });

  it("el RIR ausente NO se imputa al objetivo: una serie a fallo registrada manda", () => {
    const r = run([s(80, [8, 8, 8], [null, null, 0])]);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("CLOSED_RANGE_AT_FAILURE");
  });

  it("sin ningún RIR, la primera vez pide confirmación en vez de subir", () => {
    const r = run([s(80, [12, 12, 12], null)]);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("NEEDS_RIR_CONFIRMATION");
    expect(r.suggestedWeightKg).toBe(80);
    expect(r.explanation).toMatch(/sin RIR registrado/i);
  });

  it("sin RIR pero confirmado dos veces: sube, y nunca con salto doble", () => {
    const r = run([s(80, [12, 12, 12], null), s(80, [12, 12, 12], null)]);
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.reasonCode).toBe("RANGE_CLOSED");
    expect(r.suggestedWeightKg).toBe(82.5); // un solo incremento, no 85
    expect(r.explanation).not.toMatch(/esfuerzo previsto/i);
  });

  it("RIR parcial → confianza MEDIA como mucho", () => {
    const r = run([
      s(80, [8, 8, 8], [2, null, 2]),
      s(80, [8, 8, 8], [2, null, 2]),
      s(80, [8, 8, 8], [2, null, 2]),
    ]);
    expect(r.numbers.missingRir).toBe(1);
    expect(r.confidence).toBe("MEDIUM");
  });

  it("confianza ALTA solo con ≥3 exposiciones, RIR completo y sesión completa", () => {
    const done = s(80, [8, 8, 7], 2);
    expect(run([done]).confidence).toBe("LOW");
    expect(run([done, done]).confidence).toBe("MEDIUM");
    expect(run([done, done, done]).confidence).toBe("HIGH");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("10 · e1RM y equivalencia", () => {
  it("la equivalencia es relativa y coherente con Epley", () => {
    expect(equivalentReps(80, 8, 80)).toBeCloseTo(8, 6);
    expect(equivalentReps(80, 8, 82.5)).toBeGreaterThan(6);
    expect(equivalentReps(80, 8, 82.5)).toBeLessThan(8);
    expect(equivalentReps(0, 8, 2.5)).toBe(8); // guardia: sin carga base
  });

  it("el motor no usa e1RM como disparador: mismos reps/RIR → misma decisión", () => {
    const a = run([s(80, [7, 7, 7], 2)]);
    const b = run([s(100, [7, 7, 7], 2)]);
    expect(a.action).toBe(b.action);
    expect(a.reasonCode).toBe(b.reasonCode);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("11 · invariantes (rejilla determinista)", () => {
  const weights = [0, 10, 20, 40, 77.5, 80, 100];
  const steps = [0, 0.5, 2, 2.5, 5];
  const prescriptions: Array<Partial<ProgressionPrescription>> = [
    { repRangeMin: 6, repRangeMax: 8, targetRir: 2 },
    { repRangeMin: 8, repRangeMax: 12, targetRir: 2 },
    { repRangeMin: 10, repRangeMax: 15, targetRir: 1 },
    { repRangeMin: 12, repRangeMax: 20, targetRir: 1 },
    { repRangeMin: 8, repRangeMax: 8, targetRir: 2 }, // rango degenerado
    { repRangeMin: 5, repRangeMax: 6, targetRir: 0 }, // prescrito a fallo
  ];
  const repsGrid = [
    [20, 20, 20],
    [12, 12, 11],
    [8, 8, 7],
    [8, 8, 6],
    [6, 5, 5],
    [3, 2, 2],
  ];
  const rirGrid: Array<Array<number | null>> = [
    [2, 2, 2],
    [1, 1, 1],
    [0, 0, 0],
    [null, null, null],
    [2, null, 4],
    [4, 4, 4],
  ];

  function* cases() {
    for (const w of weights)
      for (const step of steps)
        for (const rx of prescriptions)
          for (const reps of repsGrid)
            for (const rir of rirGrid) {
              const exposure: ProgressionExposure = {
                sets: reps.map((rp, i) => ({
                  weightKg: w,
                  reps: rp,
                  rir: rir[i] ?? null,
                })),
              };
              yield { history: [exposure, exposure], step, w, rx };
            }
  }

  it("P1 · el peso sugerido siempre es peso de referencia ± un nº entero de incrementos", () => {
    for (const c of cases()) {
      const r = run(c.history, { ...c.rx, loadStepKg: c.step });
      if (r.suggestedWeightKg === null || r.numbers.pesoRef === null) continue;
      const delta = r.suggestedWeightKg - r.numbers.pesoRef;
      if (c.step === 0) {
        // Sin incremento cuantificable el peso nunca cambia…
        expect(delta).toBe(0);
      } else if (r.numbers.pesoRef === 0) {
        // …salvo el caso de peso corporal, que añade el primer incremento.
        expect([0, c.step]).toContain(delta);
      } else {
        const k = delta / c.step;
        expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
        if (k > 0) {
          // Subir: como mucho el nº de incrementos permitido.
          expect(k).toBeLessThanOrEqual(PROGRESSION.MAX_STEPS_PER_INCREASE);
        } else {
          // Bajar: se dimensiona con la equivalencia, acotada por fracción.
          // Un ÚNICO incremento del material siempre está permitido aunque
          // supere esa fracción (en cargas ligeras es inevitable).
          const drop = -delta / r.numbers.pesoRef!;
          const oneStep = c.step / r.numbers.pesoRef!;
          expect(drop).toBeLessThanOrEqual(
            Math.max(PROGRESSION.MAX_DECREASE_FRACTION, oneStep) + 1e-9,
          );
        }
      }
    }
  });

  it("P2 · nunca INCREASE_LOAD sin el rango cerrado", () => {
    for (const c of cases()) {
      const r = run(c.history, { ...c.rx, loadStepKg: c.step });
      if (r.action !== "INCREASE_LOAD") continue;
      const reps = c.history[1].sets.map((x) => x.reps);
      const n = reps.length;
      const atTop = reps.filter((x) => x >= c.rx.repRangeMax!).length;
      expect(atTop).toBeGreaterThanOrEqual(Math.max(n - 1, 1));
      expect(Math.min(...reps)).toBeGreaterThanOrEqual(c.rx.repRangeMax! - 1);
    }
  });

  it("P3 · nunca DECREASE_LOAD con una sola exposición", () => {
    for (const c of cases()) {
      const one = run([c.history[0]], { ...c.rx, loadStepKg: c.step });
      expect(one.action).not.toBe("DECREASE_LOAD");
    }
  });

  it("P4 · con loadStepKg = 0 jamás cambia el peso ni sugiere subir carga", () => {
    for (const c of cases()) {
      if (c.step !== 0) continue;
      const r = run(c.history, { ...c.rx, loadStepKg: 0 });
      expect(r.action).not.toBe("INCREASE_LOAD");
      expect(r.action).not.toBe("DECREASE_LOAD");
      expect(r.explanation).not.toMatch(/sube a 0 kg/i);
    }
  });

  it("P5 · setTargets siempre tiene el tamaño de plannedSets y está dentro de límites sanos", () => {
    for (const c of cases()) {
      const r = run(c.history, { ...c.rx, loadStepKg: c.step });
      if (r.setTargets === null) continue;
      expect(r.setTargets).toHaveLength(3);
      for (const t of r.setTargets) {
        expect(Number.isInteger(t)).toBe(true);
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThanOrEqual(
          c.rx.repRangeMax! + PROGRESSION.RANGE_EXTENSION_CAP,
        );
      }
    }
  });

  it("P6 · el motor nunca toca el volumen ni pide deload", () => {
    for (const c of cases()) {
      const r = run(c.history, { ...c.rx, loadStepKg: c.step });
      expect(r.numbers.plannedSets).toBe(3);
      expect([
        "START",
        "INCREASE_LOAD",
        "ADD_REP",
        "HOLD",
        "DECREASE_LOAD",
      ]).toContain(r.action);
      expect(JSON.stringify(r)).not.toMatch(/deload|descarga|añade una serie/i);
    }
  });

  it("P8 · HOLD_DEFAULT es una red de seguridad inalcanzable: ninguna rejilla lo produce", () => {
    for (const c of cases()) {
      const r = run(c.history, { ...c.rx, loadStepKg: c.step });
      expect(r.reasonCode).not.toBe("HOLD_DEFAULT");
    }
  });

  it("P9 · el titular `suggestedReps` nunca contradice al plan `setTargets`", () => {
    for (const c of cases()) {
      const r = run(c.history, { ...c.rx, loadStepKg: c.step });
      if (r.setTargets === null || r.suggestedReps === null) continue;
      expect(r.suggestedReps).toBeGreaterThanOrEqual(Math.min(...r.setTargets));
      expect(r.suggestedReps).toBeLessThanOrEqual(Math.max(...r.setTargets));
    }
  });

  it("P7 · determinista, explicación no vacía y confianza en el enum de 3 niveles", () => {
    for (const c of cases()) {
      const a = run(c.history, { ...c.rx, loadStepKg: c.step });
      const b = run(c.history, { ...c.rx, loadStepKg: c.step });
      expect(a).toEqual(b);
      expect(a.explanation.length).toBeGreaterThan(20);
      expect(["LOW", "MEDIUM", "HIGH"]).toContain(a.confidence);
      expect(a.engineVersion).toBe("2.0.0");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("11 · recencia: el tiempo suspende el avance, nunca baja la carga", () => {
  const cerrado = [
    dated(s(80, [8, 8, 8], 2), 30),
    dated(s(80, [8, 8, 8], 2), 7),
  ];

  it("con historial fresco sube como siempre", () => {
    const r = run(
      [dated(s(80, [8, 8, 8], 2), 14), dated(s(80, [8, 8, 8], 2), 7)],
      {},
      TODAY,
    );
    expect(r.action).toBe("INCREASE_LOAD");
    expect(r.numbers.daysSinceLast).toBe(7);
  });

  it("a partir de STALE_MIN_DAYS suspende la subida sin bajar nada", () => {
    const r = run(
      [dated(s(80, [8, 8, 8], 2), 60), dated(s(80, [8, 8, 8], 2), 25)],
      {},
      TODAY,
    );
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("STALE_HISTORY");
    expect(r.suggestedWeightKg).toBe(80);
    expect(r.explanation).toMatch(/No te bajo la carga por el parón/i);
  });

  it("la frontera es exactamente STALE_MIN_DAYS", () => {
    const dia = (n: number) =>
      run(
        [dated(s(80, [8, 8, 8], 2), n + 30), dated(s(80, [8, 8, 8], 2), n)],
        {},
        TODAY,
      );
    expect(dia(RECENCY.STALE_MIN_DAYS - 1).action).toBe("INCREASE_LOAD");
    expect(dia(RECENCY.STALE_MIN_DAYS).reasonCode).toBe("STALE_HISTORY");
  });

  it("también protege al peso corporal, donde el desentrenamiento pega antes", () => {
    // La puerta de recencia iba DESPUÉS de las ramas sin carga externa, así que
    // tras seis semanas parado el coach pedía superar la última marca justo en
    // los ejercicios donde menos sentido tiene.
    const fondos = [
      dated(s(0, [12, 12, 12], 2), 70),
      dated(s(0, [12, 12, 12], 2), 45),
    ];
    const r = run(
      fondos,
      { loadStepKg: 0, repRangeMin: 8, repRangeMax: 12 },
      TODAY,
    );
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("STALE_HISTORY");
    expect(r.explanation).not.toMatch(/kg/);
    expect(r.explanation).toMatch(/reconfirmar/i);
  });

  it("y a las dominadas sin lastre registrado", () => {
    const dominadas = [
      dated(s(0, [12, 12, 12], 2), 70),
      dated(s(0, [12, 12, 12], 2), 45),
    ];
    const r = run(dominadas, { repRangeMin: 8, repRangeMax: 12 }, TODAY);
    expect(r.action).toBe("HOLD");
    expect(r.reasonCode).toBe("STALE_HISTORY");
  });

  it("sin `todayLocalDate` se comporta como antes (compatibilidad)", () => {
    expect(run(cerrado).action).toBe("INCREASE_LOAD");
  });

  it("una exposición con fecha futura no se confunde con 'no lo sé'", () => {
    const r = run(
      [dated(s(80, [8, 8, 8], 2), 7), dated(s(80, [8, 8, 8], 2), -1)],
      {},
      TODAY,
    );
    expect(r.numbers.daysSinceLast).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("12 · un parón hace incomparables dos exposiciones", () => {
  it("volver con la mitad de peso tras meses NO es una caída atípica", () => {
    // El motor decía, con confianza ALTA: "de momento sigo con 80 kg" a alguien
    // que llevaba cinco meses sin entrenar. Es el peor consejo que puede dar.
    const r = run(
      [dated(s(80, [12, 12, 12], 2), 150), dated(s(40, [12, 12, 12], 5), 0)],
      { repRangeMin: 8, repRangeMax: 12 },
      TODAY,
    );
    expect(r.reasonCode).not.toBe("ATYPICAL_LOAD_DROP");
    expect(r.suggestedWeightKg).not.toBe(80);
  });

  it("pero sin parón sigue pidiendo confirmación", () => {
    const r = run(
      [dated(s(80, [12, 12, 12], 2), 7), dated(s(40, [12, 12, 12], 5), 0)],
      { repRangeMin: 8, repRangeMax: 12 },
      TODAY,
    );
    expect(r.reasonCode).toBe("ATYPICAL_LOAD_DROP");
    expect(r.suggestedWeightKg).toBe(80);
  });

  it("la frontera del hueco es la MISMA que la de historial viejo", () => {
    // Sería incoherente que 21 días fuesen "comparables" para bajarte la carga
    // y "demasiado viejos" para subírtela.
    const bajo = s(80, [4, 4, 4], 0);
    const conHueco = (gap: number) =>
      run([dated(bajo, gap + 1), dated(bajo, 1)], {}, TODAY);
    expect(conHueco(RECENCY.RUN_GAP_DAYS - 1).action).toBe("DECREASE_LOAD");
    expect(conHueco(RECENCY.RUN_GAP_DAYS).reasonCode).toBe(
      "ONE_OFF_UNDERPERFORMANCE",
    );
  });
});
