import { afterEach, describe, expect, it, vi } from "vitest";

import { analyzeBody } from "@/core/body/analyze";
import { linearRegression } from "@/core/body/stats";
import { cm, kg, type BodyMeasurementPoint } from "@/core/body/types";
import { addDays } from "@/core/dates";

/**
 * Invariantes del motor corporal. No son ejemplos felices: son propiedades que
 * deben cumplirse para CUALQUIER entrada, y se comprueban sobre muchas series
 * generadas.
 *
 * El generador es un LCG con semilla: pseudoaleatorio para cubrir terreno,
 * pero perfectamente reproducible. Un test que falla una vez de cada veinte no
 * sirve para nada.
 */

const HOY = "2026-08-31";

/** Congruencial lineal (Numerical Recipes). Determinista por semilla. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface SerieOpts {
  days: number;
  startKg: number;
  kgPerDay: number;
  noiseKg: number;
  /** Probabilidad de que un día NO tenga pesaje. */
  missingRate: number;
}

function generarSerie(seed: number, opts: SerieOpts): BodyMeasurementPoint[] {
  const rand = prng(seed);
  const out: BodyMeasurementPoint[] = [];
  for (let i = 0; i < opts.days; i++) {
    if (rand() < opts.missingRate) continue;
    const noise = (rand() * 2 - 1) * opts.noiseKg;
    out.push({
      localDate: addDays(HOY, -(opts.days - 1 - i)),
      weightKg: kg(opts.startKg + opts.kgPerDay * i + noise),
      waistCm: null,
      waistProtocol: null,
      bodyFatPct: null,
      bodyFatReliability: null,
    });
  }
  return out;
}

/** Barajado determinista (Fisher-Yates con el mismo LCG). */
function barajar<T>(items: readonly T[], seed: number): T[] {
  const rand = prng(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const ESCENARIOS: Array<{ nombre: string; opts: SerieOpts }> = [
  {
    nombre: "pérdida diaria limpia",
    opts: {
      days: 30,
      startKg: 84,
      kgPerDay: -0.06,
      noiseKg: 0.3,
      missingRate: 0,
    },
  },
  {
    nombre: "ganancia lenta con huecos",
    opts: {
      days: 45,
      startKg: 70,
      kgPerDay: 0.02,
      noiseKg: 0.5,
      missingRate: 0.3,
    },
  },
  {
    nombre: "peso estable muy ruidoso",
    opts: {
      days: 60,
      startKg: 91,
      kgPerDay: 0,
      noiseKg: 0.9,
      missingRate: 0.15,
    },
  },
  {
    nombre: "serie corta y dispersa",
    opts: {
      days: 20,
      startKg: 62,
      kgPerDay: -0.03,
      noiseKg: 0.4,
      missingRate: 0.6,
    },
  },
  {
    nombre: "historial largo",
    opts: {
      days: 120,
      startKg: 100,
      kgPerDay: -0.08,
      noiseKg: 0.6,
      missingRate: 0.1,
    },
  },
];

/** Cada escenario con cinco semillas: 25 series por invariante. */
const CASOS = ESCENARIOS.flatMap(({ nombre, opts }) =>
  [1, 7, 42, 1234, 98765].map((seed) => ({
    nombre: `${nombre} (semilla ${seed})`,
    serie: generarSerie(seed, opts),
    seed,
  })),
);

afterEach(() => {
  vi.useRealTimers();
});

describe("invariante: el orden de entrada es irrelevante", () => {
  it.each(CASOS)("$nombre", ({ serie, seed }) => {
    const referencia = analyzeBody({
      measurements: serie,
      todayLocalDate: HOY,
      goal: null,
    });
    for (const s of [seed, seed + 1, seed + 2]) {
      const revuelta = analyzeBody({
        measurements: barajar(serie, s),
        todayLocalDate: HOY,
        goal: null,
      });
      expect(revuelta).toEqual(referencia);
    }
    // Y al revés del todo.
    expect(
      analyzeBody({
        measurements: [...serie].reverse(),
        todayLocalDate: HOY,
        goal: null,
      }),
    ).toEqual(referencia);
  });
});

describe("invariante: el motor no modifica lo que recibe", () => {
  it.each(CASOS)("$nombre", ({ serie }) => {
    // Congelar de verdad: si el motor intentara escribir, en modo estricto
    // —y los módulos ESM lo son— lanzaría.
    const congelada = Object.freeze(serie.map((m) => Object.freeze({ ...m })));
    const copia = JSON.parse(JSON.stringify(serie));
    analyzeBody({
      measurements: congelada,
      todayLocalDate: HOY,
      goal: null,
    });
    expect(JSON.parse(JSON.stringify(serie))).toEqual(copia);
  });
});

describe("invariante: no se lee el reloj del sistema", () => {
  it.each(CASOS.slice(0, 10))("$nombre", ({ serie }) => {
    // La MISMA entrada con dos relojes del sistema completamente distintos
    // tiene que dar el mismo resultado, byte a byte. Si en algún sitio se
    // colara un `new Date()` o un `Date.now()`, esto reventaría.
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    const pasado = analyzeBody({
      measurements: serie,
      todayLocalDate: HOY,
      goal: null,
    });

    vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
    const futuro = analyzeBody({
      measurements: serie,
      todayLocalDate: HOY,
      goal: null,
    });

    expect(futuro).toEqual(pasado);
  });
});

describe("invariante: nada posterior al corte entra en el análisis", () => {
  it.each(CASOS)("$nombre", ({ serie, seed }) => {
    const rand = prng(seed);
    const futuros: BodyMeasurementPoint[] = Array.from(
      { length: 10 },
      (_, i) => ({
        localDate: addDays(HOY, i + 1),
        // Valores absurdos: si colaran, se notaría.
        weightKg: kg(30 + rand() * 200),
        waistCm: cm(40 + rand() * 100),
        waistProtocol: "SINGLE",
        bodyFatPct: null,
        bodyFatReliability: null,
      }),
    );
    expect(
      analyzeBody({
        measurements: [...serie, ...futuros],
        todayLocalDate: HOY,
        goal: null,
      }),
    ).toEqual(
      analyzeBody({ measurements: serie, todayLocalDate: HOY, goal: null }),
    );
  });
});

describe("invariante: el intervalo de confianza contiene siempre la pendiente", () => {
  it.each(CASOS)("$nombre", ({ serie }) => {
    const { weight } = analyzeBody({
      measurements: serie,
      todayLocalDate: HOY,
      goal: null,
    });
    if (!weight.trend) return;
    const t = weight.trend;
    expect(t.ciLowPerWeek).toBeLessThanOrEqual(t.slopePerWeek);
    expect(t.ciHighPerWeek).toBeGreaterThanOrEqual(t.slopePerWeek);
    expect(t.ciHalfWidthPerWeek).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(t.slopePerWeek)).toBe(true);
    expect(Number.isFinite(t.ciHalfWidthPerWeek)).toBe(true);
  });
});

describe("invariante: el veredicto es coherente con su intervalo", () => {
  it.each(CASOS)("$nombre", ({ serie }) => {
    const { weight } = analyzeBody({
      measurements: serie,
      todayLocalDate: HOY,
      goal: null,
    });
    const t = weight.trend;

    if (weight.status === "INSUFFICIENT_DATA") {
      expect(t).toBeNull();
      return;
    }
    expect(t).not.toBeNull();

    // Ningún veredicto direccional puede tener el cero dentro del intervalo.
    if (weight.status === "LOSING") expect(t!.ciHighPerWeek).toBeLessThan(0);
    if (weight.status === "GAINING") expect(t!.ciLowPerWeek).toBeGreaterThan(0);
    // Y el inconcluyente, al contrario: el cero tiene que estar dentro.
    if (weight.status === "INCONCLUSIVE") {
      expect(t!.ciLowPerWeek).toBeLessThanOrEqual(0);
      expect(t!.ciHighPerWeek).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("invariante: añadir un punto repetido no mueve bruscamente la tendencia", () => {
  it.each(CASOS)("$nombre", ({ serie }) => {
    const antes = analyzeBody({
      measurements: serie,
      todayLocalDate: HOY,
      goal: null,
    });
    if (!antes.weight.trend) return;

    // El mismo día y el mismo valor otra vez: colapsa a su propia media, así
    // que el resultado no debería moverse en absoluto.
    const mitad = serie[Math.floor(serie.length / 2)];
    const despues = analyzeBody({
      measurements: [...serie, { ...mitad }],
      todayLocalDate: HOY,
      goal: null,
    });
    expect(despues.weight.trend!.slopePerWeek).toBeCloseTo(
      antes.weight.trend.slopePerWeek,
      10,
    );
    expect(despues.weight.status).toBe(antes.weight.status);
  });
});

describe("invariante: trasladar toda la serie no cambia la pendiente", () => {
  it.each(CASOS)("$nombre", ({ serie }) => {
    // Sumar 5 kg a todos los pesajes describe a otra persona con exactamente
    // la misma trayectoria: la pendiente tiene que ser la misma.
    const desplazada = serie.map((m) => ({
      ...m,
      weightKg: m.weightKg === null ? null : kg(m.weightKg + 5),
    }));

    const a = analyzeBody({
      measurements: serie,
      todayLocalDate: HOY,
      goal: null,
    });
    const b = analyzeBody({
      measurements: desplazada,
      todayLocalDate: HOY,
      goal: null,
    });
    if (!a.weight.trend || !b.weight.trend) return;

    // Tolerancia amplia a propósito: la winsorización y la banda plana SÍ
    // dependen del nivel absoluto (son porcentajes del peso), así que la
    // igualdad no puede ser exacta. Lo que se comprueba es que no hay
    // dependencia estructural del nivel.
    expect(b.weight.trend.slopePerWeek).toBeCloseTo(
      a.weight.trend.slopePerWeek,
      1,
    );
  });
});

describe("invariante: más pendiente real, más pendiente estimada", () => {
  it.each([1, 7, 42, 1234, 98765])("semilla %i", (seed) => {
    const base = { days: 40, startKg: 85, noiseKg: 0.4, missingRate: 0.1 };
    const pendientes = [-0.12, -0.06, 0, 0.04, 0.09];
    const estimadas = pendientes.map((kgPerDay) => {
      const { weight } = analyzeBody({
        measurements: generarSerie(seed, { ...base, kgPerDay }),
        todayLocalDate: HOY,
        goal: null,
      });
      return weight.trend?.slopePerWeek ?? null;
    });

    for (const e of estimadas) expect(e).not.toBeNull();
    for (let i = 1; i < estimadas.length; i++) {
      expect(estimadas[i]!).toBeGreaterThan(estimadas[i - 1]!);
    }
  });
});

describe("invariante: una serie perfectamente constante nunca es direccional", () => {
  it.each([60, 70.5, 84, 100, 120])("a %i kg", (peso) => {
    const serie: BodyMeasurementPoint[] = Array.from(
      { length: 30 },
      (_, i) => ({
        localDate: addDays(HOY, -(29 - i)),
        weightKg: kg(peso),
        waistCm: null,
        waistProtocol: null,
        bodyFatPct: null,
        bodyFatReliability: null,
      }),
    );
    const { weight } = analyzeBody({
      measurements: serie,
      todayLocalDate: HOY,
      goal: null,
    });
    expect(weight.status).toBe("MAINTAINING");
    expect(weight.trend!.slopePerWeek).toBeCloseTo(0, 8);
    expect(weight.totalChangeKg).toBeCloseTo(0, 8);
  });
});

describe("invariante: la regresión es invariante al origen de los días", () => {
  it.each([0, 1, 100, -50, 3650])("desplazando %i días", (offset) => {
    const valores = [82.3, 81.6, 82.5, 81.9, 81.2, 81.5, 80.8, 80.4];
    const a = linearRegression(
      valores.map((value, i) => ({ dayOffset: i, value })),
    )!;
    const b = linearRegression(
      valores.map((value, i) => ({ dayOffset: i + offset, value })),
    )!;
    // Mover el origen no puede cambiar ni la pendiente ni su incertidumbre.
    expect(b.slopePerDay).toBeCloseTo(a.slopePerDay, 10);
    expect(b.ciHalfWidthPerDay).toBeCloseTo(a.ciHalfWidthPerDay, 10);
    expect(b.residualSd).toBeCloseTo(a.residualSd, 10);
  });
});

describe("invariante: las unidades no se pueden confundir por accidente", () => {
  it("el compilador rechaza centímetros donde van kilos", () => {
    const punto: BodyMeasurementPoint = {
      localDate: HOY,
      // @ts-expect-error `Cm` no es asignable a `Kg`: ese es todo el objetivo
      // de marcar los tipos. En tiempo de ejecución los dos son `number`, así
      // que sin la marca esto compilaría sin una queja.
      weightKg: cm(88),
      waistCm: null,
      waistProtocol: null,
      bodyFatPct: null,
      bodyFatReliability: null,
    };
    expect(punto.localDate).toBe(HOY);
  });

  it("el compilador rechaza un número pelado sin marcar", () => {
    const punto: BodyMeasurementPoint = {
      localDate: HOY,
      // @ts-expect-error un `number` crudo no entra: la frontera tiene que
      // marcarlo con `kg()` a propósito, y ese acto deliberado es justo donde
      // se detectaría el error de unidades.
      weightKg: 84,
      waistCm: null,
      waistProtocol: null,
      bodyFatPct: null,
      bodyFatReliability: null,
    };
    expect(punto.localDate).toBe(HOY);
  });
});
