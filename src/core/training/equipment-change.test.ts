import { describe, expect, it } from "vitest";

import { summarizePerformance } from "@/core/cycles/performance";
import { addDays } from "@/core/dates";
import { assessPerformance } from "@/core/insights/performance";

import {
  analyzeTraining,
  type ContextExposure,
  type ContextVariant,
  type TrainingContext,
} from "./analysis";
import { loadSegmentOn, splitBySegment } from "./equipment";
import { targetRirOnVariantChange } from "./prescription-defaults";
import { suggestProgression } from "./progression";

/**
 * Cambio de gimnasio: la misma variante en OTRA máquina.
 *
 * Los casos salen del análisis con los datos reales de Arturo (9 de sus 16
 * ejercicios son de máquina, polea o multipower): sin un tramo nuevo, una
 * máquina más ligera producía "carga atípica, sigo con 100 kg", y una más dura
 * producía en dos semanas una DESCARGA recomendada por "caída grave del
 * rendimiento" que era solo el aparato. Y tratar el cambio como ejercicios
 * nuevos diluía la fatiga que ya había. Cada bloque comprueba el número y la
 * explicación (doble aserción).
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

function exp(
  localDate: string,
  weightKg: number,
  reps: number[],
  rir = 1,
): ContextExposure {
  return {
    localDate,
    sets: reps.map((r) => ({ weightKg, reps: r, rir })),
  };
}

/** Semanas antes del cambio: una exposición por semana. */
function weeksBefore(n: number, weightKg: number, reps: number[], rir = 1) {
  return Array.from({ length: n }, (_, i) =>
    exp(addDays(CHANGE, -7 * (n - i) + 4), weightKg, reps, rir),
  );
}

function variant(
  variantId: string,
  exposures: ContextExposure[],
  equipmentChange: ContextVariant["equipmentChange"] = null,
): ContextVariant {
  const last = exposures[exposures.length - 1];
  const reference =
    last ?? equipmentChange?.previousExposures.at(-1) ?? exp(TODAY, 0, []);
  return {
    variantId,
    exerciseName: variantId,
    variantName: "Máquina",
    prescription: RX,
    exposures,
    daysSinceLast: Math.max(
      0,
      Math.round(
        (Date.parse(TODAY) - Date.parse(reference.localDate)) / 86_400_000,
      ),
    ),
    equipmentChange,
  };
}

/** La misma variante, con su historial partido en el cambio. */
function changed(
  variantId: string,
  before: ContextExposure[],
  after: ContextExposure[],
): ContextVariant {
  return variant(variantId, after, {
    sinceLocalDate: CHANGE,
    previousExposures: before,
  });
}

function sessions(
  n: number,
  feedback: Partial<TrainingContext["sessions"][number]> = {},
  today = TODAY,
): TrainingContext["sessions"] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    localDate: addDays(today, -2 * (n - 1 - i)),
    templateName: "Día",
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
    ...feedback,
  }));
}

function context(
  variants: ContextVariant[],
  opts: {
    today?: string;
    sessions?: TrainingContext["sessions"];
    weeksSinceDeload?: number;
  } = {},
): TrainingContext {
  const today = opts.today ?? TODAY;
  return {
    todayLocalDate: today,
    sinceLocalDate: addDays(today, -28),
    sessions: opts.sessions ?? sessions(8, {}, today),
    variants,
    weeksSinceDeload: opts.weeksSinceDeload ?? 4,
  };
}

describe("tramos de equipamiento", () => {
  const cambios = [
    { variantId: "prensa", sinceLocalDate: "2026-11-10" },
    { variantId: "prensa", sinceLocalDate: "2027-03-01" },
    { variantId: "curl", sinceLocalDate: "2026-12-01" },
  ];

  it("sin cambios vigentes todo es comparable; uno futuro aún no cuenta", () => {
    expect(loadSegmentOn(cambios, "remo", TODAY).since).toBeNull();
    // Se puede registrar la mudanza por adelantado: hasta ese día, nada.
    expect(loadSegmentOn(cambios, "curl", TODAY).since).toBeNull();
    expect(loadSegmentOn(cambios, "curl", "2026-12-01").since).toBe(
      "2026-12-01",
    );
  });

  it("dos cambios: el tramo vigente es el último y el anterior acaba en él", () => {
    const tramo = loadSegmentOn(cambios, "prensa", "2027-04-01");
    expect(tramo).toEqual({ since: "2027-03-01", previousSince: "2026-11-10" });
    const items = ["2026-10-01", "2026-12-01", "2027-03-15"].map((d) => ({
      localDate: d,
    }));
    const { comparable, previous } = splitBySegment(items, tramo);
    expect(comparable.map((x) => x.localDate)).toEqual(["2027-03-15"]);
    // Lo de antes del PRIMER cambio no se compara con ninguno de los dos.
    expect(previous.map((x) => x.localDate)).toEqual(["2026-12-01"]);
  });
});

describe("misma variante en una máquina MÁS LIGERA", () => {
  const antes = weeksBefore(4, 100, [10, 10, 9]);
  // Primera sesión en el gimnasio nuevo: 65 kg con reserva de sobra.
  const primera = exp(addDays(CHANGE, 1), 65, [12, 12, 12], 3);

  it("control: sin registrar el cambio, el motor lee una carga atípica y propone la vieja", () => {
    const s = suggestProgression({
      prescription: RX,
      history: [...antes, primera],
      todayLocalDate: TODAY,
    });
    expect(s.reasonCode).toBe("ATYPICAL_LOAD_DROP");
    expect(s.suggestedWeightKg).toBe(100);
  });

  it("con el cambio, la referencia es la máquina nueva: ni carga atípica ni regresión", () => {
    const a = analyzeTraining(context([changed("prensa", antes, [primera])]));
    const v = a.variants[0];
    expect(v.suggestion.reasonCode).not.toBe("ATYPICAL_LOAD_DROP");
    expect(v.suggestion.suggestedWeightKg).not.toBe(100);
    expect(v.suggestion.suggestedWeightKg).toBeGreaterThanOrEqual(65);
    expect(v.regressed).toBe(false);
    expect(v.equipmentChange).toMatchObject({
      comparableExposures: 1,
      calibrating: true,
    });
  });

  it("sin sesiones con la máquina nueva: 'máquina nueva', sin citar la carga de antes", () => {
    const s = suggestProgression({
      prescription: RX,
      history: [],
      todayLocalDate: TODAY,
      equipmentChange: { sinceLocalDate: CHANGE },
    });
    expect(s.action).toBe("START");
    expect(s.reasonCode).toBe("EQUIPMENT_CHANGE");
    expect(s.suggestedWeightKg).toBeNull();
    expect(s.explanation).toContain("Equipamiento nuevo desde el");
    expect(s.explanation).toContain("no es perder fuerza");
    expect(s.explanation).not.toContain("100");
    // Sin cambio, sigue siendo "primera vez".
    expect(
      suggestProgression({ prescription: RX, history: [] }).reasonCode,
    ).toBe("NO_HISTORY");
  });
});

describe("misma variante en una máquina MÁS DURA (mismo número, menos reps)", () => {
  // 4 ejercicios de máquina: 100 kg en rango antes; en la nueva, 100 kg se
  // quedan en 5 repeticiones dos semanas seguidas. 4 de mancuernas, sanos.
  const maquinas = ["prensa", "femoral", "cuadriceps", "press"];
  const libres = ["curl", "lateral", "bulgara", "fondos"];
  const antes = weeksBefore(3, 100, [10, 10, 10]);
  const despues = [
    exp(addDays(CHANGE, 1), 100, [5, 5, 5]),
    exp(addDays(CHANGE, 8), 100, [5, 5, 5]),
  ];
  const sanos = libres.map((id) =>
    variant(id, [
      exp(addDays(TODAY, -15), 20, [9, 9, 9]),
      exp(addDays(TODAY, -8), 20, [10, 10, 9]),
      exp(addDays(TODAY, -1), 20, [10, 10, 10]),
    ]),
  );

  it("control: sin el cambio, la máquina se lee como caída grave y pide una descarga", () => {
    const a = analyzeTraining(
      context(
        [
          ...maquinas.map((id) => variant(id, [...antes, ...despues])),
          ...sanos,
        ],
        { weeksSinceDeload: 9 },
      ),
    );
    expect(a.fatigue.decision).toBe("DELOAD_RECOMMENDED");
    expect(a.fatigue.signals.map((s) => s.code)).toContain(
      "SEVERE_PERFORMANCE_DECLINE",
    );
  });

  it("con el cambio: el motor sugiere bajar EN ESA MÁQUINA, pero la fatiga no lo lee como caída", () => {
    const a = analyzeTraining(
      context(
        [...maquinas.map((id) => changed(id, antes, despues)), ...sanos],
        { weeksSinceDeload: 9 },
      ),
    );
    // Consejo de carga dentro del mismo aparato: es comparable y útil.
    const prensa = a.variants.find((v) => v.variantId === "prensa")!;
    expect(prensa.suggestion.action).toBe("DECREASE_LOAD");
    // ...sin etiquetarlo como regresión: eso lo leen la fatiga y el Coach.
    expect(prensa.regressed).toBe(false);
    // Pero no hay descarga ni caída del rendimiento por calibrar una máquina.
    expect(a.fatigue.decision).not.toBe("DELOAD_RECOMMENDED");
    const codes = a.fatigue.signals.map((s) => s.code);
    expect(codes).not.toContain("SEVERE_PERFORMANCE_DECLINE");
    expect(codes).not.toContain("PERFORMANCE_DECLINE");
    expect(a.fatigue.adaptation.exercises).toBe(4);
    expect(a.fatigue.adaptation.message).toContain("Equipamiento nuevo en 4");
    // Y el cruce cuerpo × rendimiento tampoco ve "varios ejercicios hacia atrás".
    expect(assessPerformance(a).trend).not.toBe("DECLINING");
  });
});

describe("los ejercicios que siguen siendo comparables", () => {
  const cayendo = (id: string) =>
    variant(id, [
      exp(addDays(TODAY, -15), 20, [10, 10, 10]),
      exp(addDays(TODAY, -8), 20, [6, 6, 6]),
      exp(addDays(TODAY, -1), 20, [6, 6, 6]),
    ]);
  const maquina = (id: string) =>
    changed(id, weeksBefore(3, 100, [10, 10, 10]), [
      exp(addDays(CHANGE, 2), 60, [10, 10, 10]),
    ]);

  it("conservan TODO su historial y sus señales, sin que el cambio las diluya", () => {
    const libres = ["curl", "lateral", "bulgara", "fondos"].map(cayendo);
    const a = analyzeTraining(
      context([
        ...libres,
        ...["prensa", "femoral", "cuadriceps", "press"].map(maquina),
      ]),
    );
    // Las mancuernas no se tocan: 3 exposiciones cada una.
    expect(a.variants.find((v) => v.variantId === "curl")!.exposures).toBe(3);
    const decline = a.fatigue.signals.find((s) =>
      s.code.endsWith("PERFORMANCE_DECLINE"),
    );
    expect(decline).toBeDefined();
    // El denominador son los 8 ejercicios de siempre (las máquinas siguen
    // contando con lo último de la anterior), no 8 + 4 "nuevos".
    expect(decline!.numbers).toEqual({ ejercicios: 4, total: 8 });
    expect(decline!.message).toContain("curl");
  });

  it("una carga atípica real en un ejercicio sin cambio se sigue avisando", () => {
    const a = analyzeTraining(
      context([
        variant("curl", [
          exp(addDays(TODAY, -8), 20, [10, 10, 10]),
          exp(addDays(TODAY, -1), 12, [12, 12, 12], 4),
        ]),
        maquina("prensa"),
      ]),
    );
    expect(a.variants[0].suggestion.reasonCode).toBe("ATYPICAL_LOAD_DROP");
  });
});

describe("la fatiga previa al cambio no se borra ni se diluye", () => {
  // 4 máquinas estancadas (3 semanas al mismo peso sin mejorar) y 2 libres
  // sanas, con fatiga 4/5 sostenida: antes del cambio, descarga recomendada.
  const maquinas = ["prensa", "femoral", "cuadriceps", "press"];
  const estancadas = weeksBefore(3, 100, [10, 10, 10]);
  const libres = ["curl", "lateral"].map((id) =>
    variant(id, [
      exp(addDays(TODAY, -15), 20, [9, 9, 9]),
      exp(addDays(TODAY, -8), 20, [10, 10, 9]),
      exp(addDays(TODAY, -1), 20, [10, 10, 10]),
    ]),
  );
  const ctx = (vs: ContextVariant[], today = TODAY) =>
    context(vs, {
      today,
      sessions: sessions(8, { fatigue: 4 }, today),
      weeksSinceDeload: 9,
    });

  // Los mismos hechos sin registrar ningún cambio.
  const antes = analyzeTraining(
    ctx([...maquinas.map((id) => variant(id, estancadas)), ...libres]),
  );

  it("punto de partida: descarga recomendada por meseta generalizada", () => {
    expect(antes.fatigue.decision).toBe("DELOAD_RECOMMENDED");
    expect(antes.fatigue.signals.map((s) => s.code)).toContain(
      "WIDESPREAD_PLATEAU",
    );
  });

  it("con una sesión en la máquina nueva, la recomendación SIGUE en pie (mismo denominador)", () => {
    const a = analyzeTraining(
      ctx([
        ...maquinas.map((id) =>
          changed(id, estancadas, [exp(addDays(CHANGE, 1), 70, [10, 10, 10])]),
        ),
        ...libres,
      ]),
    );
    expect(a.fatigue.decision).toBe("DELOAD_RECOMMENDED");
    const meseta = a.fatigue.signals.find(
      (s) => s.code === "WIDESPREAD_PLATEAU",
    )!;
    expect(meseta.numbers).toEqual({ enMeseta: 4, total: 6 });
    expect(meseta.message).toContain("con la máquina anterior");
  });

  it("control: tratar las máquinas como ejercicios NUEVOS diluía la señal", () => {
    // El fallo que se evita: las nuevas, sanas por no tener historial, entran
    // en el denominador y 4 de 10 ya no llegan a la mitad.
    const a = analyzeTraining(
      ctx([
        ...maquinas.map((id) => variant(id, estancadas)),
        ...maquinas.map((id) =>
          variant(`${id}-nueva`, [exp(addDays(CHANGE, 1), 70, [10, 10, 10])]),
        ),
        ...libres,
      ]),
    );
    expect(a.fatigue.decision).not.toBe("DELOAD_RECOMMENDED");
  });

  it("sin nada comparable vigente: fuera del recuento, nunca 'estable', y confianza no alta", () => {
    // Un mes sin entrenar esas máquinas (mudanza) y una sola sesión en las
    // nuevas: lo de antes ya no es reciente y lo nuevo aún no se juzga.
    const hoy = addDays(CHANGE, 30);
    const a = analyzeTraining(
      ctx(
        [
          ...maquinas.map((id) =>
            changed(id, estancadas, [exp(addDays(hoy, -1), 70, [10, 10, 10])]),
          ),
          ...["curl", "lateral"].map((id) =>
            variant(id, [
              exp(addDays(hoy, -15), 20, [9, 9, 9]),
              exp(addDays(hoy, -8), 20, [10, 10, 9]),
              exp(addDays(hoy, -1), 20, [10, 10, 10]),
            ]),
          ),
        ],
        hoy,
      ),
    );
    expect(a.fatigue.adaptation.withoutComparableData).toBe(4);
    expect(a.fatigue.numbers.exercisesTracked).toBe(2);
    expect(a.fatigue.confidence).not.toBe("HIGH");
    expect(a.fatigue.adaptation.message).toContain(
      "sin datos comparables no es lo mismo que estable",
    );
    expect(
      assessPerformance(a).variants.find((v) => v.variantId === "prensa"),
    ).toMatchObject({ state: "NOT_JUDGED", excludedBecause: "NEW_EQUIPMENT" });
  });

  it("con 3 sesiones en la máquina nueva, el tramo nuevo se juzga solo", () => {
    const hoy = addDays(CHANGE, 22);
    const nuevas = [1, 8, 15].map((d) =>
      exp(addDays(CHANGE, d), 70, [10, 10, 10]),
    );
    const a = analyzeTraining(
      ctx([changed("prensa", estancadas, nuevas), ...libres], hoy),
    );
    const prensa = a.variants.find((v) => v.variantId === "prensa")!;
    expect(prensa.equipmentChange).toMatchObject({
      comparableExposures: 3,
      calibrating: false,
    });
    // Tres exposiciones iguales en la máquina NUEVA sí son una meseta.
    expect(prensa.plateaued).toBe(true);
  });

  it("el rendimiento global arrastra lo último de la máquina anterior mientras es reciente", () => {
    const a = analyzeTraining(
      ctx([
        changed("prensa", weeksBefore(3, 100, [10, 10, 10]), [
          exp(addDays(CHANGE, 1), 70, [10, 10, 10]),
        ]),
      ]),
    );
    expect(
      assessPerformance(a).variants.find((v) => v.variantId === "prensa"),
    ).toMatchObject({ fromPreviousEquipment: true, excludedBecause: null });
  });
});

describe("prescripción al cambiar de variante", () => {
  it("conserva el RIR de la persona y solo lo sube por seguridad", () => {
    expect(targetRirOnVariantChange(1, 1)).toBe(1);
    // Un RIR más conservador que el default es una decisión suya.
    expect(targetRirOnVariantChange(2, 1)).toBe(2);
    // De máquina guiada (0) a barra libre (mínimo 2): sube.
    expect(targetRirOnVariantChange(0, 2)).toBe(2);
  });
});

describe("resumen del ciclo", () => {
  const START = "2026-08-31";
  const END = addDays(START, 119);
  const p = (variantId: string, day: number, e1rmKg: number) => ({
    variantId,
    exerciseName: variantId,
    variantName: "Máquina",
    localDate: addDays(START, day),
    e1rmKg,
  });

  it("no compara cargas de dos máquinas: lo excluye y lo cuenta aparte", () => {
    const r = summarizePerformance(
      [
        p("prensa", 3, 130),
        p("prensa", 112, 90), // máquina nueva desde el día 70
        p("curl", 3, 30),
        p("curl", 112, 32),
      ],
      START,
      END,
      undefined,
      [{ variantId: "prensa", sinceLocalDate: addDays(START, 70) }],
    );
    expect(r!.comparedVariants).toBe(1);
    expect(r!.declined).toBe(0);
    expect(r!.excludedByEquipmentChange).toBe(1);
    expect(r!.highlights.map((h) => h.exerciseName)).toEqual(["curl"]);
  });

  it("un cambio ANTERIOR al ciclo no excluye nada: todo el ciclo es el mismo tramo", () => {
    const r = summarizePerformance(
      [p("prensa", 3, 90), p("prensa", 112, 95)],
      START,
      END,
      undefined,
      [{ variantId: "prensa", sinceLocalDate: addDays(START, -10) }],
    );
    expect(r!.comparedVariants).toBe(1);
    expect(r!.excludedByEquipmentChange).toBe(0);
  });

  it("si todo cambió de máquina, el resumen lo dice en vez de desaparecer", () => {
    const r = summarizePerformance(
      [p("prensa", 3, 130), p("prensa", 112, 90)],
      START,
      END,
      undefined,
      [{ variantId: "prensa", sinceLocalDate: addDays(START, 70) }],
    );
    expect(r).toMatchObject({
      comparedVariants: 0,
      excludedByEquipmentChange: 1,
    });
  });
});
