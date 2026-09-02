import { describe, expect, it } from "vitest";

import { analyzeBody } from "@/core/body/analyze";
import {
  cm,
  kg,
  pctPoints,
  type BodyGoalInput,
  type BodyMeasurementPoint,
} from "@/core/body/types";
import { addDays } from "@/core/dates";

/**
 * Casos del motor corporal. Doble aserción en todos: el valor numérico Y el
 * estado/`reasonCode` que lo explica, según la convención del proyecto.
 *
 * Todas las series se construyen hacia atrás desde HOY, que es una constante:
 * el motor no lee el reloj y estos tests tampoco.
 */

const HOY = "2026-08-31";

/** Una medición, con solo lo que importe en cada caso. */
function medicion(
  localDate: string,
  fields: Partial<{
    weightKg: number;
    waistCm: number;
    waistProtocol: "SINGLE" | "MEAN_OF_THREE";
    bodyFatPct: number;
    bodyFatReliability: "MEASURED" | "ESTIMATED";
  }> = {},
): BodyMeasurementPoint {
  return {
    localDate,
    weightKg: fields.weightKg === undefined ? null : kg(fields.weightKg),
    waistCm: fields.waistCm === undefined ? null : cm(fields.waistCm),
    waistProtocol: fields.waistProtocol ?? null,
    bodyFatPct:
      fields.bodyFatPct === undefined ? null : pctPoints(fields.bodyFatPct),
    bodyFatReliability: fields.bodyFatReliability ?? null,
  };
}

/**
 * Serie de pesos diarios terminando HOY.
 * `noise(i)` es determinista: los tests no usan `Math.random()`.
 */
function serieDiaria(
  days: number,
  startKg: number,
  kgPerDay: number,
  noise: (i: number) => number = () => 0,
): BodyMeasurementPoint[] {
  return Array.from({ length: days }, (_, i) =>
    medicion(addDays(HOY, -(days - 1 - i)), {
      weightKg: startKg + kgPerDay * i + noise(i),
    }),
  );
}

/** Ruido reproducible de ±0,5 kg, sin media sistemática. */
const ruido = (i: number) => [0.4, -0.3, 0.1, -0.5, 0.5, -0.1, -0.1][i % 7];

function analiza(
  measurements: BodyMeasurementPoint[],
  goal: BodyGoalInput | null = null,
  todayLocalDate = HOY,
) {
  return analyzeBody({ measurements, todayLocalDate, goal });
}

describe("peso — datos insuficientes", () => {
  it("sin ninguna medición", () => {
    const r = analiza([]);
    expect(r.weight.status).toBe("INSUFFICIENT_DATA");
    expect(r.weight.reasonCode).toBe("NO_MEASUREMENTS");
    expect(r.weight.trend).toBeNull();
    expect(r.weight.series).toHaveLength(0);
    expect(r.weight.latestKg).toBeNull();
  });

  it("con un solo pesaje: hay valor actual, pero ninguna tendencia", () => {
    const r = analiza([medicion(HOY, { weightKg: 82 })]);
    expect(r.weight.status).toBe("INSUFFICIENT_DATA");
    expect(r.weight.reasonCode).toBe("TOO_FEW_MEASUREMENTS");
    expect(r.weight.trend).toBeNull();
    // Lo que SÍ se puede afirmar con un dato, se afirma.
    expect(r.weight.latestKg).toBe(82);
    expect(r.weight.latestEmaKg).toBe(82);
    expect(r.weight.totalChangeKg).toBe(0);
    expect(r.weight.series).toHaveLength(1);
  });

  it("con dos pesajes tampoco extrapola, aunque la 'pendiente' sea obvia", () => {
    const r = analiza([
      medicion(addDays(HOY, -7), { weightKg: 84 }),
      medicion(HOY, { weightKg: 82 }),
    ]);
    expect(r.weight.status).toBe("INSUFFICIENT_DATA");
    expect(r.weight.reasonCode).toBe("TOO_FEW_MEASUREMENTS");
    expect(r.weight.trend).toBeNull();
    // Dos puntos definen una recta perfecta y cero incertidumbre; extrapolar
    // −2 kg/semana de ahí sería exactamente la falsa precisión que este motor
    // existe para evitar.
    expect(r.weight.totalChangeKg).toBe(-2);
  });

  it("7 días completos siguen sin bastar: la ventana mínima es de 14", () => {
    const r = analiza(serieDiaria(7, 82, -0.06, ruido));
    expect(r.weight.status).toBe("INSUFFICIENT_DATA");
    expect(r.weight.reasonCode).toBe("TOO_FEW_MEASUREMENTS");
    expect(r.weight.windowDays).toBeNull();
    expect(r.weight.measurementsInWindow).toBe(7);
  });

  it("muchos pesajes apretados en pocos días: sobran puntos, falta horizonte", () => {
    const r = analiza(serieDiaria(9, 82, -0.06, ruido));
    expect(r.weight.status).toBe("INSUFFICIENT_DATA");
    expect(r.weight.reasonCode).toBe("SPAN_TOO_SHORT");
  });
});

describe("peso — elección de ventana", () => {
  it("14 días diarios eligen la ventana de 14", () => {
    const r = analiza(serieDiaria(14, 82, -0.06, ruido));
    expect(r.weight.windowDays).toBe(14);
    expect(r.weight.measurementsInWindow).toBe(14);
  });

  it("un historial largo NO amplía la ventana: 28 días es la primaria", () => {
    // 40 y 120 días de pesajes diarios cumplirían también la ventana de 56,
    // pero 28 es la primaria y gana. Si se ampliara con el historial, el motor
    // acabaría describiendo el pasado en vez del estado actual — ver
    // regime-change.test.ts.
    for (const dias of [40, 120]) {
      const r = analiza(serieDiaria(dias, 84, -0.06, ruido));
      expect(r.weight.windowDays).toBe(28);
      expect(r.weight.measurementsInWindow).toBe(28);
    }
  });

  it("una ganancia lenta y limpia SÍ es afirmable en la ventana primaria", () => {
    // +0,03 kg/día = +0,21 kg/semana: un volumen controlado. Con una ventana
    // de 14 días el margen de error (~±0,46) se lo tragaría y saldría
    // INCONCLUSIVE por construcción, hiciera lo que hiciera la persona. Por
    // eso la primaria son 28 y no 14.
    const r = analiza(serieDiaria(28, 72, 0.03, (i) => ruido(i) / 2));
    expect(r.weight.windowDays).toBe(28);
    expect(r.weight.status).toBe("GAINING");
    expect(r.weight.trend!.ciHalfWidthPerWeek).toBeLessThan(0.21);
  });

  it("con historial corto baja al siguiente escalón", () => {
    // Uno de cada dos días durante 21 días → 11 puntos. La ventana primaria de
    // 28 pide 12, así que no cumple y se baja a la de 21, que pide 10.
    const puntos = Array.from({ length: 11 }, (_, i) =>
      medicion(addDays(HOY, -(20 - i * 2)), { weightKg: 82 - 0.06 * i * 2 }),
    );
    const r = analiza(puntos);
    expect(r.weight.windowDays).toBe(21);
  });

  it("cadencia semanal: 56 días como ÚLTIMO RECURSO, no como default", () => {
    // Con 4 pesajes en los últimos 28 días ninguna ventana corta cumple, así
    // que entra el fallback. Sin él esta persona no tendría tendencia nunca:
    // la precisión de una pendiente depende del span al cuadrado, así que 8
    // pesajes repartidos en 56 días son mejores que 8 apretados en 14.
    const puntos = Array.from({ length: 9 }, (_, i) =>
      medicion(addDays(HOY, -(56 - i * 7)), { weightKg: 84 - 0.35 * i }),
    );
    const r = analiza(puntos);
    expect(r.weight.windowDays).toBe(56);
    expect(r.weight.status).toBe("LOSING");
    expect(r.weight.trend!.slopePerWeek).toBeCloseTo(-0.35, 2);
  });
});

describe("peso — veredictos", () => {
  it("una serie constante es MAINTAINING con pendiente ~0, no INCONCLUSIVE", () => {
    const r = analiza(serieDiaria(28, 80, 0));
    expect(r.weight.status).toBe("MAINTAINING");
    expect(r.weight.reasonCode).toBe("CONFIDENCE_INTERVAL_WITHIN_FLAT_BAND");
    expect(r.weight.trend!.slopePerWeek).toBeCloseTo(0, 6);
    expect(r.weight.trend!.ciLowPerWeek).toBeCloseTo(0, 6);
  });

  it("una bajada clara es LOSING, con el intervalo entero por debajo de cero", () => {
    // −0,06 kg/día ≈ −0,42 kg/semana: el objetivo típico de −0,5 %/sem a 84 kg.
    const r = analiza(serieDiaria(28, 84, -0.06, ruido));
    expect(r.weight.status).toBe("LOSING");
    expect(r.weight.reasonCode).toBe("CONFIDENCE_INTERVAL_BELOW_ZERO");
    expect(r.weight.trend!.slopePerWeek).toBeCloseTo(-0.42, 1);
    expect(r.weight.trend!.ciHighPerWeek).toBeLessThan(0);
  });

  it("una subida clara es GAINING", () => {
    const r = analiza(serieDiaria(28, 72, 0.03, (i) => ruido(i) / 2));
    expect(r.weight.status).toBe("GAINING");
    expect(r.weight.reasonCode).toBe("CONFIDENCE_INTERVAL_ABOVE_ZERO");
    expect(r.weight.trend!.ciLowPerWeek).toBeGreaterThan(0);
  });

  it("una tendencia real pero enterrada en ruido es INCONCLUSIVE, no 'perdiendo'", () => {
    // Bajada de solo −0,01 kg/día (−0,07 kg/sem) con ruido de ±0,5 kg: el
    // intervalo cruza el cero. Este es EL caso que el motor existe para no
    // fallar.
    const r = analiza(serieDiaria(14, 82, -0.01, (i) => ruido(i) * 2));
    expect(r.weight.status).toBe("INCONCLUSIVE");
    expect(r.weight.reasonCode).toBe("CONFIDENCE_INTERVAL_INCLUDES_ZERO");
    expect(r.weight.trend!.ciLowPerWeek).toBeLessThan(0);
    expect(r.weight.trend!.ciHighPerWeek).toBeGreaterThan(0);
  });

  it("un cambio estadísticamente seguro pero trivial es MAINTAINING, no LOSING", () => {
    // −0,005 kg/día = −0,035 kg/semana, sin ruido: el intervalo está entero
    // por debajo de cero, pero dentro de la banda plana (±0,08 kg/sem a 80 kg).
    // Decir "estás perdiendo 35 gramos por semana" es cierto e inútil.
    const r = analiza(serieDiaria(28, 80, -0.005));
    expect(r.weight.trend!.ciHighPerWeek).toBeLessThan(0);
    expect(r.weight.status).toBe("MAINTAINING");
    expect(r.weight.reasonCode).toBe("CONFIDENCE_INTERVAL_WITHIN_FLAT_BAND");
  });

  it("la confianza baja cuando el intervalo se ensancha", () => {
    const limpia = analiza(serieDiaria(28, 84, -0.06));
    const ruidosa = analiza(serieDiaria(14, 84, -0.06, (i) => ruido(i) * 3));
    expect(limpia.weight.confidence).toBe("HIGH");
    expect(ruidosa.weight.confidence).toBe("LOW");
  });
});

describe("peso — datos sucios", () => {
  it("un atípico enorme no secuestra la tendencia ni desaparece del historial", () => {
    const limpia = serieDiaria(28, 84, -0.06, ruido);
    const conError = limpia.map((m, i) =>
      i === 14 ? medicion(m.localDate, { weightKg: 8.4 }) : m,
    );

    const a = analiza(limpia);
    const b = analiza(conError);

    expect(b.weight.status).toBe("LOSING");
    // La pendiente apenas se mueve pese a un error de un orden de magnitud.
    expect(b.weight.trend!.slopePerWeek).toBeCloseTo(
      a.weight.trend!.slopePerWeek,
      1,
    );
    // Y la medición original sigue ahí, marcada, sin haber sido modificada.
    const punto = b.weight.series[14];
    expect(punto.rawKg).toBe(8.4);
    expect(punto.winsorized).toBe(true);
    expect(punto.usedKg).not.toBe(8.4);
  });

  it("reordenar la entrada no cambia el resultado", () => {
    const serie = serieDiaria(28, 84, -0.06, ruido);
    const alReves = [...serie].reverse();
    const barajada = [
      ...serie.filter((_, i) => i % 3 === 0),
      ...serie.filter((_, i) => i % 3 === 1),
      ...serie.filter((_, i) => i % 3 === 2),
    ];
    expect(analiza(alReves)).toEqual(analiza(serie));
    expect(analiza(barajada)).toEqual(analiza(serie));
  });

  it("dos mediciones el mismo día se colapsan a su media, en cualquier orden", () => {
    const serie = serieDiaria(28, 84, -0.06, ruido);
    const dup = [...serie, medicion(serie[10].localDate, { weightKg: 90 })];
    const dupAlReves = [
      medicion(serie[10].localDate, { weightKg: 90 }),
      ...serie,
    ];

    const a = analiza(dup);
    const b = analiza(dupAlReves);
    expect(a).toEqual(b);
    // Media de los dos valores del día, no "el último que llegó".
    const original = serie[10].weightKg as number;
    expect(a.weight.series[10].rawKg).toBeCloseTo((original + 90) / 2, 10);
    // Y sigue habiendo 28 días, no 29.
    expect(a.weight.series).toHaveLength(28);
  });

  it("no entra nada posterior a la fecha de corte", () => {
    const serie = serieDiaria(28, 84, -0.06, ruido);
    const conFuturo = [
      ...serie,
      medicion(addDays(HOY, 1), { weightKg: 60 }),
      medicion(addDays(HOY, 30), { weightKg: 50 }),
    ];
    expect(analiza(conFuturo)).toEqual(analiza(serie));
  });

  it("descarta fechas con formato inválido en vez de reventar", () => {
    const serie = serieDiaria(28, 84, -0.06, ruido);
    const sucia = [
      ...serie,
      medicion("no-es-una-fecha", { weightKg: 999 }),
      medicion("2026-13-45", { weightKg: 999 }),
    ];
    expect(analiza(sucia)).toEqual(analiza(serie));
  });

  it("mediciones sin peso no rompen la serie de peso", () => {
    const serie = serieDiaria(28, 84, -0.06, ruido);
    const conSoloCintura = [
      ...serie,
      medicion(addDays(HOY, -3), { waistCm: 88 }),
    ];
    const r = analiza(conSoloCintura);
    // El día -3 ya tenía peso; añadir cintura ese día no cambia la tendencia.
    expect(r.weight.trend!.slopePerWeek).toBeCloseTo(
      analiza(serie).weight.trend!.slopePerWeek,
      10,
    );
  });
});

describe("cintura", () => {
  const pesos = serieDiaria(60, 84, -0.06, ruido);

  function conCintura(
    lecturas: Array<{ daysAgo: number; waistCm: number }>,
  ): BodyMeasurementPoint[] {
    return [
      ...pesos,
      ...lecturas.map((l) =>
        medicion(addDays(HOY, -l.daysAgo), { waistCm: l.waistCm }),
      ),
    ];
  }

  it("sin cintura registrada no dice nada", () => {
    const r = analiza(pesos);
    expect(r.waist.status).toBe("INSUFFICIENT_DATA");
    expect(r.waist.reasonCode).toBe("NO_MEASUREMENTS");
    expect(r.waist.latestCm).toBeNull();
  });

  it("dos lecturas no bastan por espectacular que sea el cambio", () => {
    const r = analiza(
      conCintura([
        { daysAgo: 56, waistCm: 95 },
        { daysAgo: 0, waistCm: 85 },
      ]),
    );
    expect(r.waist.status).toBe("INSUFFICIENT_DATA");
    expect(r.waist.reasonCode).toBe("TOO_FEW_MEASUREMENTS");
    expect(r.waist.latestCm).toBe(85);
  });

  it("tres lecturas en pocos días tampoco: el horizonte mínimo es de 4 semanas", () => {
    const r = analiza(
      conCintura([
        { daysAgo: 14, waistCm: 90 },
        { daysAgo: 7, waistCm: 88 },
        { daysAgo: 0, waistCm: 86 },
      ]),
    );
    expect(r.waist.status).toBe("INSUFFICIENT_DATA");
    expect(r.waist.reasonCode).toBe("SPAN_TOO_SHORT");
  });

  it("un cambio por debajo del error de medida NO se presenta como progreso", () => {
    // −2 cm en 8 semanas es real como intención pero está por debajo de los
    // 5,4 cm que puede resolver una automedición de una sola toma.
    const r = analiza(
      conCintura([
        { daysAgo: 56, waistCm: 90 },
        { daysAgo: 42, waistCm: 89.5 },
        { daysAgo: 28, waistCm: 89 },
        { daysAgo: 14, waistCm: 88.5 },
        { daysAgo: 0, waistCm: 88 },
      ]),
    );
    expect(r.waist.status).toBe("WITHIN_MEASUREMENT_ERROR");
    expect(r.waist.reasonCode).toBe("CHANGE_BELOW_MEASUREMENT_ERROR");
    expect(r.waist.fittedChangeCm).toBeCloseTo(-2, 1);
    expect(r.waist.minDetectableChangeCm).toBe(5.4);
  });

  it("un cambio grande y sostenido sí es DECREASING", () => {
    const r = analiza(
      conCintura([
        { daysAgo: 84, waistCm: 98 },
        { daysAgo: 63, waistCm: 96 },
        { daysAgo: 42, waistCm: 93.5 },
        { daysAgo: 21, waistCm: 91 },
        { daysAgo: 0, waistCm: 89 },
      ]),
    );
    expect(r.waist.status).toBe("DECREASING");
    expect(r.waist.reasonCode).toBe("CHANGE_ABOVE_MEASUREMENT_ERROR");
    expect(r.waist.fittedChangeCm).toBeLessThan(-5.4);
    expect(r.waist.confidence).toBe("MEDIUM");
  });

  it("con las tres tomas, el umbral baja de 5,4 a 3,1 cm", () => {
    // El protocolo cambia lo que se puede afirmar: los mismos −4 cm son ruido
    // con una toma y son progreso con tres.
    const lecturas = [
      { daysAgo: 84, waistCm: 94, protocol: "MEAN_OF_THREE" as const },
      { daysAgo: 56, waistCm: 93, protocol: "MEAN_OF_THREE" as const },
      { daysAgo: 28, waistCm: 91.5, protocol: "MEAN_OF_THREE" as const },
      { daysAgo: 0, waistCm: 90, protocol: "MEAN_OF_THREE" as const },
    ];
    const conTres = analiza([
      ...pesos,
      ...lecturas.map((l) =>
        medicion(addDays(HOY, -l.daysAgo), {
          waistCm: l.waistCm,
          waistProtocol: l.protocol,
        }),
      ),
    ]);
    expect(conTres.waist.minDetectableChangeCm).toBe(3.1);
    expect(conTres.waist.protocol).toBe("MEAN_OF_THREE");
    expect(conTres.waist.status).toBe("DECREASING");

    // Las MISMAS cifras, medidas de una sola vez, no bastan.
    const conUna = analiza([
      ...pesos,
      ...lecturas.map((l) =>
        medicion(addDays(HOY, -l.daysAgo), { waistCm: l.waistCm }),
      ),
    ]);
    expect(conUna.waist.minDetectableChangeCm).toBe(5.4);
    expect(conUna.waist.protocol).toBe("SINGLE");
    expect(conUna.waist.status).toBe("WITHIN_MEASUREMENT_ERROR");
  });

  it("mezclar una toma histórica con tres nuevas aplica el umbral CONSERVADOR", () => {
    // Es el caso real de todo perfil que ya existía: la cintura del
    // onboarding es de una sola toma. Comparar contra ella arrastra SU error,
    // así que la serie no puede presumir de la precisión de las nuevas.
    const r = analiza([
      ...pesos,
      // La del onboarding, sin protocolo conocido.
      medicion(addDays(HOY, -84), { waistCm: 94 }),
      medicion(addDays(HOY, -56), {
        waistCm: 93,
        waistProtocol: "MEAN_OF_THREE",
      }),
      medicion(addDays(HOY, -28), {
        waistCm: 91.5,
        waistProtocol: "MEAN_OF_THREE",
      }),
      medicion(HOY, { waistCm: 90, waistProtocol: "MEAN_OF_THREE" }),
    ]);
    expect(r.waist.protocol).toBe("MIXED");
    expect(r.waist.minDetectableChangeCm).toBe(5.4);
    expect(r.waist.status).toBe("WITHIN_MEASUREMENT_ERROR");
  });

  it("una cintura de hace dos años no arrastra la tendencia de hoy", () => {
    // Sin tope de horizonte, una bajada antigua seguida de un año estable
    // saldría como "bajando". La pregunta es cómo voy AHORA.
    const r = analiza(
      conCintura([
        { daysAgo: 730, waistCm: 104 },
        { daysAgo: 700, waistCm: 98 },
        { daysAgo: 56, waistCm: 92 },
        { daysAgo: 28, waistCm: 92 },
        { daysAgo: 0, waistCm: 92 },
      ]),
    );
    expect(r.waist.status).toBe("WITHIN_MEASUREMENT_ERROR");
    expect(r.waist.fittedChangeCm).toBeCloseTo(0, 6);
    // Las dos lecturas antiguas quedan fuera del horizonte de 16 semanas.
    expect(r.waist.measurementsUsed).toBe(3);
  });

  it("usa el ajuste, no la resta de extremos: un extremo raro no decide solo", () => {
    // Serie plana de 8 semanas con una última lectura absurdamente baja. La
    // resta de extremos daría −8 cm; la recta ajustada, mucho menos.
    const r = analiza(
      conCintura([
        { daysAgo: 56, waistCm: 92 },
        { daysAgo: 42, waistCm: 92 },
        { daysAgo: 28, waistCm: 92 },
        { daysAgo: 14, waistCm: 92 },
        { daysAgo: 0, waistCm: 84 },
      ]),
    );
    expect(Math.abs(r.waist.fittedChangeCm!)).toBeLessThan(8);
  });
});

describe("% graso", () => {
  const pesos = serieDiaria(90, 84, -0.05, ruido);

  function conGrasa(
    lecturas: Array<{
      daysAgo: number;
      pct: number;
      reliability?: "MEASURED" | "ESTIMATED";
    }>,
  ): BodyMeasurementPoint[] {
    return [
      ...pesos,
      ...lecturas.map((l) =>
        medicion(addDays(HOY, -l.daysAgo), {
          bodyFatPct: l.pct,
          bodyFatReliability: l.reliability ?? "ESTIMATED",
        }),
      ),
    ];
  }

  it("sin lecturas de grasa el estado es NOT_RECORDED, no un error", () => {
    const r = analiza(pesos);
    expect(r.bodyFat.status).toBe("NOT_RECORDED");
    expect(r.bodyFat.changePp).toBeNull();
    expect(r.bodyFat.latestPct).toBeNull();
  });

  it("una sola lectura da el valor actual pero ninguna tendencia", () => {
    const r = analiza(conGrasa([{ daysAgo: 0, pct: 18 }]));
    expect(r.bodyFat.status).toBe("INSUFFICIENT_DATA");
    expect(r.bodyFat.reasonCode).toBe("TOO_FEW_MEASUREMENTS");
    expect(r.bodyFat.latestPct).toBe(18);
    expect(r.bodyFat.latestReliability).toBe("ESTIMATED");
    expect(r.bodyFat.changePp).toBeNull();
  });

  it("un cambio menor de 2 puntos NO es interpretable", () => {
    const r = analiza(
      conGrasa([
        { daysAgo: 60, pct: 20 },
        { daysAgo: 0, pct: 18.5 },
      ]),
    );
    expect(r.bodyFat.status).toBe("NOT_INTERPRETABLE");
    expect(r.bodyFat.reasonCode).toBe("BODY_FAT_CHANGE_BELOW_ERROR");
    // El número se calcula y se expone; lo que no se hace es interpretarlo.
    expect(r.bodyFat.changePp).toBeCloseTo(-1.5, 10);
    expect(r.bodyFat.minInterpretableChangePp).toBe(2);
  });

  it("un cambio de 3 puntos con el mismo método sí es DECREASING", () => {
    const r = analiza(
      conGrasa([
        { daysAgo: 60, pct: 21 },
        { daysAgo: 30, pct: 19.5 },
        { daysAgo: 0, pct: 18 },
      ]),
    );
    expect(r.bodyFat.status).toBe("DECREASING");
    expect(r.bodyFat.changePp).toBeCloseTo(-3, 10);
    expect(r.bodyFat.comparedReliability).toBe("ESTIMATED");
    expect(r.bodyFat.excludedByReliability).toBe(0);
    // Nunca confianza alta: sigue siendo una estimación.
    expect(r.bodyFat.confidence).toBe("LOW");
  });

  it("cambiar de método invalida la comparación en vez de restar peras y manzanas", () => {
    // Dos lecturas de báscula y una de DEXA al final. Restar 24 (báscula) de
    // 18 (DEXA) mediría el cambio de aparato, no el de la persona.
    const r = analiza(
      conGrasa([
        { daysAgo: 60, pct: 24, reliability: "ESTIMATED" },
        { daysAgo: 30, pct: 23, reliability: "ESTIMATED" },
        { daysAgo: 0, pct: 18, reliability: "MEASURED" },
      ]),
    );
    expect(r.bodyFat.status).toBe("MIXED_RELIABILITY");
    expect(r.bodyFat.reasonCode).toBe("BODY_FAT_RELIABILITY_CHANGED");
    expect(r.bodyFat.changePp).toBeNull();
    expect(r.bodyFat.excludedByReliability).toBe(2);
    expect(r.bodyFat.comparedReliability).toBe("MEASURED");
  });

  it("con dos lecturas fiables ignora las estimadas antiguas y compara solo lo comparable", () => {
    const r = analiza(
      conGrasa([
        { daysAgo: 90, pct: 26, reliability: "ESTIMATED" },
        { daysAgo: 60, pct: 22, reliability: "MEASURED" },
        { daysAgo: 0, pct: 19, reliability: "MEASURED" },
      ]),
    );
    expect(r.bodyFat.status).toBe("DECREASING");
    expect(r.bodyFat.changePp).toBeCloseTo(-3, 10);
    expect(r.bodyFat.excludedByReliability).toBe(1);
    // Método fiable: se sube un escalón de confianza, pero nunca a HIGH.
    expect(r.bodyFat.confidence).toBe("MEDIUM");
  });

  it("una lectura de hace un año no cuenta como punto de partida", () => {
    // El horizonte del % graso son 24 semanas. Con una lectura antigua fuera
    // y solo una dentro, no hay con qué comparar.
    const r = analiza(
      conGrasa([
        { daysAgo: 365, pct: 28 },
        { daysAgo: 0, pct: 18 },
      ]),
    );
    expect(r.bodyFat.status).toBe("INSUFFICIENT_DATA");
    expect(r.bodyFat.reasonCode).toBe("TOO_FEW_MEASUREMENTS");
    expect(r.bodyFat.measurementsUsed).toBe(1);
    expect(r.bodyFat.changePp).toBeNull();
  });

  it("dos lecturas separadas por menos de un mes no bastan", () => {
    const r = analiza(
      conGrasa([
        { daysAgo: 14, pct: 22 },
        { daysAgo: 0, pct: 18 },
      ]),
    );
    expect(r.bodyFat.status).toBe("INSUFFICIENT_DATA");
    expect(r.bodyFat.reasonCode).toBe("SPAN_TOO_SHORT");
    expect(r.bodyFat.spanDays).toBe(14);
  });
});

describe("comparación con el objetivo", () => {
  const perdida: BodyGoalInput = {
    type: "FAT_LOSS",
    strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
    weeklyRatePct: -0.5,
    startWeightKg: kg(84),
    targetWeightKg: kg(78),
  };

  it("sin objetivo activo no hay comparación", () => {
    expect(analiza(serieDiaria(28, 84, -0.06, ruido)).goal).toBeNull();
  });

  it("traduce el ritmo objetivo a kg/semana sobre el peso suavizado actual", () => {
    const r = analiza(serieDiaria(28, 84, -0.06, ruido), perdida);
    const g = r.goal!;
    expect(g.expectedDirection).toBe("DOWN");
    expect(g.referenceWeightKg).toBe(r.weight.latestEmaKg);
    expect(g.targetKgPerWeek).toBeCloseTo(
      (-0.5 / 100) * (r.weight.latestEmaKg as number),
      10,
    );
    expect(g.targetWeightKg).toBe(78);
    // Negativo: todavía hay que bajar para llegar al objetivo.
    expect(g.kgToTargetWeight).toBeLessThan(0);
  });

  it("con tendencia afirmable calcula la razón observado/objetivo", () => {
    const r = analiza(serieDiaria(28, 84, -0.06, ruido), perdida);
    expect(r.weight.status).toBe("LOSING");
    expect(r.goal!.observedKgPerWeek).toBeCloseTo(
      r.weight.trend!.slopePerWeek,
      10,
    );
    // Bajando ~0,42 kg/sem contra un objetivo de ~0,41: en torno a 1.
    expect(r.goal!.ratio).toBeGreaterThan(0.8);
    expect(r.goal!.ratio).toBeLessThan(1.3);
  });

  it("si la tendencia es INCONCLUSIVE, no se expone pendiente observada ni razón", () => {
    // Regla clave: nadie puede construir un "vas al 60 % de tu objetivo" sobre
    // un número que el motor acaba de declarar indistinguible de cero.
    const r = analiza(
      serieDiaria(14, 82, -0.01, (i) => ruido(i) * 2),
      perdida,
    );
    expect(r.weight.status).toBe("INCONCLUSIVE");
    expect(r.goal!.observedKgPerWeek).toBeNull();
    expect(r.goal!.ratio).toBeNull();
    // Pero la pendiente cruda sigue disponible para dibujar la recta.
    expect(r.weight.trend!.slopePerWeek).not.toBeNull();
  });

  it("un objetivo de ritmo 0 (recomposición) no produce una razón absurda", () => {
    const recomp: BodyGoalInput = {
      type: "RECOMP",
      strategy: "RECOMP_MAINTAIN_WEIGHT",
      weeklyRatePct: 0,
      startWeightKg: kg(80),
      targetWeightKg: null,
    };
    const r = analiza(serieDiaria(28, 80, 0), recomp);
    expect(r.weight.status).toBe("MAINTAINING");
    expect(r.goal!.expectedDirection).toBe("FLAT");
    expect(r.goal!.targetKgPerWeek).toBe(0);
    // Dividir entre cero daría Infinity: se devuelve null a propósito.
    expect(r.goal!.ratio).toBeNull();
    expect(r.goal!.kgToTargetWeight).toBeNull();
  });

  it("no toca el objetivo que recibe", () => {
    const original = { ...perdida };
    analiza(serieDiaria(28, 84, -0.06, ruido), perdida);
    expect(perdida).toEqual(original);
  });
});

describe("inicio de fase (analysisStartLocalDate)", () => {
  it("sin declararlo, se analiza todo el historial disponible", () => {
    const r = analiza(serieDiaria(28, 84, -0.06, ruido));
    expect(r.analysisStartLocalDate).toBeNull();
    expect(r.weight.series).toHaveLength(28);
  });

  it("una fase anterior NO contamina la tendencia de la nueva", () => {
    // Seis semanas perdiendo y luego tres manteniendo. Sin declarar el inicio
    // de fase, la pendiente de la definición sigue tirando hacia abajo.
    const perdida = Array.from({ length: 42 }, (_, i) =>
      medicion(addDays(HOY, -(69 - i)), {
        weightKg: 84 - 0.064 * i + ruido(i),
      }),
    );
    const mantenimiento = Array.from({ length: 28 }, (_, i) =>
      medicion(addDays(HOY, -(27 - i)), { weightKg: 81.3 + ruido(i) }),
    );
    const todo = [...perdida, ...mantenimiento];
    const inicioDeFase = addDays(HOY, -27);

    const sinFase = analyzeBody({
      measurements: todo,
      todayLocalDate: HOY,
      goal: null,
    });
    const conFase = analyzeBody({
      measurements: todo,
      todayLocalDate: HOY,
      goal: null,
      analysisStartLocalDate: inicioDeFase,
    });

    expect(conFase.analysisStartLocalDate).toBe(inicioDeFase);
    // Solo entra la fase nueva: 70 pesajes pasan a 28.
    expect(sinFase.weight.series).toHaveLength(70);
    expect(conFase.weight.series).toHaveLength(28);
    // Y el cambio total deja de arrastrar los kilos de la etapa anterior.
    expect(sinFase.weight.totalChangeKg!).toBeLessThan(-2);
    expect(Math.abs(conFase.weight.totalChangeKg!)).toBeLessThan(1);
  });

  it("recortar por fase puede dejar sin datos suficientes, y eso se dice", () => {
    // Una fase que empezó anteayer no tiene tendencia. Es correcto: el motor
    // prefiere callarse a describir la etapa anterior.
    const r = analyzeBody({
      measurements: serieDiaria(60, 84, -0.06, ruido),
      todayLocalDate: HOY,
      goal: null,
      analysisStartLocalDate: addDays(HOY, -2),
    });
    expect(r.weight.status).toBe("INSUFFICIENT_DATA");
    expect(r.weight.series).toHaveLength(3);
  });

  it("una fecha de inicio inválida se ignora en vez de vaciar el análisis", () => {
    const serie = serieDiaria(28, 84, -0.06, ruido);
    const r = analyzeBody({
      measurements: serie,
      todayLocalDate: HOY,
      goal: null,
      analysisStartLocalDate: "ayer por la tarde",
    });
    expect(r.weight.series).toHaveLength(28);
    expect(r.weight.status).toBe("LOSING");
  });

  it("también recorta cintura y % graso, no solo el peso", () => {
    const bf = { bodyFatReliability: "ESTIMATED" } as const;
    const puntos = [
      medicion(addDays(HOY, -100), { waistCm: 100, bodyFatPct: 28, ...bf }),
      medicion(addDays(HOY, -60), { waistCm: 94, bodyFatPct: 24, ...bf }),
      medicion(addDays(HOY, -30), { waistCm: 92, bodyFatPct: 22, ...bf }),
      medicion(HOY, { waistCm: 91, bodyFatPct: 21, ...bf }),
    ];
    const conFase = analyzeBody({
      measurements: puntos,
      todayLocalDate: HOY,
      goal: null,
      analysisStartLocalDate: addDays(HOY, -60),
    });
    expect(conFase.waist.measurementsUsed).toBe(3);
    expect(conFase.bodyFat.measurementsUsed).toBe(3);
    // Sin recortar entrarían las cuatro.
    const sinFase = analyzeBody({
      measurements: puntos,
      todayLocalDate: HOY,
      goal: null,
    });
    expect(sinFase.waist.measurementsUsed).toBe(4);
    // Y sin recortar, esos −9 cm en tres meses sí superan el error de medida.
    expect(sinFase.waist.status).toBe("DECREASING");
    // Con la fase declarada, la lectura antigua queda fuera: −9 cm pasan a −3,
    // que ya no supera el error de medida.
    expect(conFase.waist.status).toBe("WITHIN_MEASUREMENT_ERROR");
  });
});

describe("metadatos", () => {
  it("devuelve la fecha de corte y la versión del motor", () => {
    const r = analiza(serieDiaria(28, 84, -0.06, ruido));
    expect(r.todayLocalDate).toBe(HOY);
    expect(r.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("la misma serie analizada con distinto corte da distinta ventana de datos", () => {
    const serie = serieDiaria(28, 84, -0.06, ruido);
    const hoy = analiza(serie);
    // Un mes después, sin pesajes nuevos, ya no hay nada reciente que analizar.
    const masTarde = analiza(serie, null, addDays(HOY, 60));
    expect(hoy.weight.status).toBe("LOSING");
    expect(masTarde.weight.status).toBe("INSUFFICIENT_DATA");
    // Pero el historial sigue completo: no se ha borrado nada.
    expect(masTarde.weight.series).toHaveLength(28);
  });
});
