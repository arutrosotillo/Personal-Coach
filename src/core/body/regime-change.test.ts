import { describe, expect, it } from "vitest";

import { analyzeBody } from "@/core/body/analyze";
import { kg, type BodyMeasurementPoint } from "@/core/body/types";
import { BODY_CONFIG, type BodyConfig } from "@/core/config/body-config";
import { addDays } from "@/core/dates";

/**
 * CAMBIOS DE RÉGIMEN: cuánto tarda el motor en dejar de describir el pasado.
 *
 * Este fichero existe porque la política de elección de ventana se decidió con
 * datos, no por intuición, y la decisión tiene que quedar defendida frente a
 * quien la quiera cambiar mañana.
 *
 * La pregunta: alguien pierde peso durante seis semanas y luego pasa a
 * mantenimiento (o a volumen). ¿Cuántas semanas sigue el motor diciendo
 * "perdiendo peso", que ya es falso?
 *
 * Se comparan DOS políticas sobre EL MISMO código, cambiando solo la config:
 *   · `LONGEST_FIRST` — la escalera recorrida de mayor a menor. Con historial
 *     suficiente, 56 días acaba siendo la ventana permanente.
 *   · `PRIMARY_28` — la que usa la app: 28 primaria, 21/14 para historiales
 *     cortos, 56 solo como último recurso para datos dispersos.
 *
 * Las dos son igual de honestas estadísticamente: la ventana se decide ANTES
 * de mirar la pendiente y depende solo de qué datos hay. Lo que cambia es
 * cuánto pasado arrastran.
 */

const INICIO = "2026-01-05"; // lunes

const W14 = { days: 14, minMeasurements: 8, minSpanDays: 10 };
const W21 = { days: 21, minMeasurements: 10, minSpanDays: 15 };
const W28 = { days: 28, minMeasurements: 12, minSpanDays: 20 };
const W56 = { days: 56, minMeasurements: 8, minSpanDays: 42 };

/** La política descartada: siempre la ventana más larga disponible. */
const LONGEST_FIRST: BodyConfig = {
  ...BODY_CONFIG,
  trendWindows: [W56, W28, W21, W14],
};
/** La política elegida. Es exactamente la de producción. */
const PRIMARY_28: BodyConfig = {
  ...BODY_CONFIG,
  trendWindows: [W28, W21, W14, W56],
};

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type Cadencia = "diaria" | "3/sem" | "semanal";
function seRegistra(dia: number, cadencia: Cadencia): boolean {
  if (cadencia === "diaria") return true;
  if (cadencia === "3/sem")
    return dia % 7 === 0 || dia % 7 === 2 || dia % 7 === 4;
  return dia % 7 === 0;
}

interface Escenario {
  nombre: string;
  /** Días de la primera fase. Seis semanas. */
  fase1Dias: number;
  kgDia1: number;
  kgDia2: number;
  /** Salto instantáneo al cambiar de fase (retención, "whoosh"…). */
  escalonKg?: number;
  estadoViejo: string;
  estadoNuevo: string;
}

const ESCENARIOS: Escenario[] = [
  {
    nombre: "losing → maintaining",
    fase1Dias: 42,
    kgDia1: -0.064, // ≈ −0,45 kg/semana
    kgDia2: 0,
    estadoViejo: "LOSING",
    estadoNuevo: "MAINTAINING",
  },
  {
    nombre: "losing → gaining",
    fase1Dias: 42,
    kgDia1: -0.064,
    kgDia2: 0.025, // ≈ +0,18 kg/semana, volumen controlado
    estadoViejo: "LOSING",
    estadoNuevo: "GAINING",
  },
  {
    nombre: "gaining → maintaining",
    fase1Dias: 42,
    kgDia1: 0.025,
    kgDia2: 0,
    estadoViejo: "GAINING",
    estadoNuevo: "MAINTAINING",
  },
  {
    nombre: "escalón de −2 kg y estabilización",
    fase1Dias: 42,
    kgDia1: 0,
    kgDia2: 0,
    escalonKg: -2,
    estadoViejo: "MAINTAINING",
    estadoNuevo: "MAINTAINING",
  },
];

function serie(
  e: Escenario,
  cadencia: Cadencia,
  hastaDia: number,
  seed: number,
): BodyMeasurementPoint[] {
  const rand = prng(seed);
  const out: BodyMeasurementPoint[] = [];
  let peso = 84;
  for (let d = 0; d <= hastaDia; d++) {
    if (d > 0) peso += d <= e.fase1Dias ? e.kgDia1 : e.kgDia2;
    if (d === e.fase1Dias + 1 && e.escalonKg) peso += e.escalonKg;
    if (!seRegistra(d, cadencia)) continue;
    out.push({
      localDate: addDays(INICIO, d),
      weightKg: kg(peso + (rand() * 2 - 1) * 0.45),
      waistCm: null,
      waistProtocol: null,
      bodyFatPct: null,
      bodyFatReliability: null,
    });
  }
  return out;
}

interface Recorrido {
  /** Semanas tras el cambio hasta dejar de AFIRMAR el estado viejo. */
  dejaElViejo: number | null;
  estados: string[];
  ventanas: Array<number | null>;
}

function recorrer(
  e: Escenario,
  cadencia: Cadencia,
  config: BodyConfig,
  seed: number,
  semanas = 16,
): Recorrido {
  const estados: string[] = [];
  const ventanas: Array<number | null> = [];
  let dejaElViejo: number | null = null;

  for (let semana = 1; semana <= semanas; semana++) {
    const dia = e.fase1Dias + semana * 7;
    const { weight } = analyzeBody(
      {
        measurements: serie(e, cadencia, dia, seed),
        todayLocalDate: addDays(INICIO, dia),
        goal: null,
      },
      config,
    );
    estados.push(weight.status);
    ventanas.push(weight.windowDays);
    if (dejaElViejo === null && weight.status !== e.estadoViejo) {
      dejaElViejo = semana;
    }
  }
  return { dejaElViejo, estados, ventanas };
}

const SEMILLAS = [1, 7, 42, 1234, 98765];
const CADENCIAS: Cadencia[] = ["diaria", "3/sem", "semanal"];

/** Mediana de las semillas; `Infinity` si alguna nunca cambió. */
function medianaSemanas(
  e: Escenario,
  cadencia: Cadencia,
  config: BodyConfig,
): number {
  const valores = SEMILLAS.map(
    (s) => recorrer(e, cadencia, config, s).dejaElViejo ?? Infinity,
  ).sort((a, b) => a - b);
  return valores[Math.floor(valores.length / 2)];
}

const CASOS = ESCENARIOS.flatMap((e) =>
  CADENCIAS.map((cadencia) => ({
    nombre: `${e.nombre} · ${cadencia}`,
    e,
    cadencia,
  })),
);

describe("28-primary deja de describir el pasado antes que longest-first", () => {
  it.each(CASOS)("$nombre", ({ e, cadencia }) => {
    const lento = medianaSemanas(e, cadencia, LONGEST_FIRST);
    const rapido = medianaSemanas(e, cadencia, PRIMARY_28);
    // Nunca peor. En cadencia semanal empatan, porque ahí las dos políticas
    // acaban eligiendo la misma ventana de 56: no hay otra que cumpla.
    expect(rapido).toBeLessThanOrEqual(lento);
  });

  it("con datos frecuentes la mejora es de varias semanas, no marginal", () => {
    // Este es el caso que motivó el cambio: un usuario maduro que se pesa a
    // diario y termina su definición. Con longest-first seguía leyendo
    // "perdiendo peso" mes y medio después de haber dejado de perderlo.
    const [perdidaAMantenimiento] = ESCENARIOS;
    const lento = medianaSemanas(
      perdidaAMantenimiento,
      "diaria",
      LONGEST_FIRST,
    );
    const rapido = medianaSemanas(perdidaAMantenimiento, "diaria", PRIMARY_28);

    expect(lento).toBeGreaterThanOrEqual(6);
    expect(rapido).toBeLessThanOrEqual(3);
  });

  it("un cambio de dirección franco se detecta en 2 semanas en vez de 5", () => {
    const cambioDeDireccion = ESCENARIOS[1]; // losing → gaining
    expect(medianaSemanas(cambioDeDireccion, "diaria", LONGEST_FIRST)).toBe(5);
    expect(medianaSemanas(cambioDeDireccion, "diaria", PRIMARY_28)).toBe(2);
  });
});

describe("la ventana elegida refleja el estado ACTUAL, no todo el historial", () => {
  it("un usuario maduro que se pesa a diario razona sobre 28 días, no sobre 56", () => {
    const { ventanas } = recorrer(ESCENARIOS[0], "diaria", PRIMARY_28, 42);
    expect(ventanas.every((v) => v === 28)).toBe(true);

    // La política descartada lo habría fijado en 56 para siempre.
    const antes = recorrer(ESCENARIOS[0], "diaria", LONGEST_FIRST, 42);
    expect(antes.ventanas.every((v) => v === 56)).toBe(true);
  });

  it("56 días sigue disponible como último recurso para quien se pesa una vez por semana", () => {
    // La razón de conservar el escalón largo: con 4 pesajes en 28 días no hay
    // ninguna ventana corta que cumpla, y sin el fallback esta persona no
    // tendría tendencia nunca.
    const { ventanas } = recorrer(ESCENARIOS[0], "semanal", PRIMARY_28, 42);
    expect(ventanas.every((v) => v === 56)).toBe(true);
  });

  it("y la escalera corta cubre a quien todavía no tiene 28 días", () => {
    const catorceDias = Array.from({ length: 14 }, (_, i) => ({
      localDate: addDays(INICIO, i),
      weightKg: kg(84 - 0.06 * i),
      waistCm: null,
      waistProtocol: null,
      bodyFatPct: null,
      bodyFatReliability: null,
    }));
    const r = analyzeBody(
      {
        measurements: catorceDias,
        todayLocalDate: addDays(INICIO, 13),
        goal: null,
      },
      PRIMARY_28,
    );
    expect(r.weight.windowDays).toBe(14);
    expect(r.weight.status).toBe("LOSING");
  });
});

describe("el estado viejo no se queda para siempre", () => {
  // Ir con retraso es aceptable; quedarse anclado en una fase que terminó hace
  // cuatro meses, no. Se excluye el escenario del escalón, donde la fase nueva
  // y la vieja son la misma (estable → estable).
  const conCambioReal = CASOS.filter(
    (c) => c.e.estadoViejo !== c.e.estadoNuevo,
  );

  it.each(conCambioReal)("$nombre", ({ e, cadencia }) => {
    // Se cuentan semillas en vez de exigir cero: con un intervalo del 95 % un
    // veredicto direccional falso es esperable de vez en cuando, y un test que
    // exigiera perfección estaría midiendo la suerte de la semilla. Lo que
    // vigila es que el motor no se quede sistemáticamente anclado.
    const ancladas = SEMILLAS.filter((seed) => {
      const { estados } = recorrer(e, cadencia, PRIMARY_28, seed);
      return estados[estados.length - 1] === e.estadoViejo;
    });
    expect(ancladas.length).toBeLessThanOrEqual(1);
  });
});

describe("los falsos positivos direccionales se quedan donde deben", () => {
  /** Serie genuinamente plana: cualquier LOSING o GAINING aquí es un error. */
  function plana(seed: number, dias: number): BodyMeasurementPoint[] {
    const rand = prng(seed);
    return Array.from({ length: dias }, (_, i) => ({
      localDate: addDays(INICIO, i),
      weightKg: kg(84 + (rand() * 2 - 1) * 0.45),
      waistCm: null,
      waistProtocol: null,
      bodyFatPct: null,
      bodyFatReliability: null,
    }));
  }

  it("sobre peso realmente estable, la tasa se mantiene en el entorno del 5 % nominal", () => {
    // El intervalo es del 95 %, así que por construcción se espera acertar
    // ~19 de cada 20 veces. Lo que este test vigila no es que nunca falle
    // —eso sería imposible— sino que la tasa no se dispare, que es lo que
    // pasaría si el intervalo estuviera mal calculado (por ejemplo,
    // regresando sobre la EMA en vez de sobre los pesajes).
    let evaluaciones = 0;
    let direccionales = 0;

    for (let seed = 1; seed <= 40; seed++) {
      for (let dias = 28; dias <= 70; dias += 7) {
        const { weight } = analyzeBody(
          {
            measurements: plana(seed, dias),
            todayLocalDate: addDays(INICIO, dias - 1),
            goal: null,
          },
          PRIMARY_28,
        );
        if (weight.status === "INSUFFICIENT_DATA") continue;
        evaluaciones++;
        if (weight.status === "LOSING" || weight.status === "GAINING") {
          direccionales++;
        }
      }
    }

    expect(evaluaciones).toBeGreaterThan(200);
    expect(direccionales / evaluaciones).toBeLessThan(0.1);
  });

  it("y una serie plana SIN ruido nunca produce una dirección", () => {
    for (const peso of [60, 84, 110]) {
      const { weight } = analyzeBody(
        {
          measurements: Array.from({ length: 28 }, (_, i) => ({
            localDate: addDays(INICIO, i),
            weightKg: kg(peso),
            waistCm: null,
            waistProtocol: null,
            bodyFatPct: null,
            bodyFatReliability: null,
          })),
          todayLocalDate: addDays(INICIO, 27),
          goal: null,
        },
        PRIMARY_28,
      );
      expect(weight.status).toBe("MAINTAINING");
    }
  });
});

describe("la banda plana tiene que ser alcanzable en la ventana primaria", () => {
  it("con la banda al 0,10 % el motor nunca puede afirmar que mantienes a 28 días", () => {
    // Es un test de equivalencia: exige que el intervalo ENTERO quepa dentro
    // de la banda. A 28 días con ruido realista el intervalo mide ya
    // ~±0,12 kg/sem, así que una banda de 0,08 (0,10 % de 84 kg) es
    // inalcanzable — y el usuario se queda en INCONCLUSIVE para siempre.
    const bandaEstrecha: BodyConfig = {
      ...PRIMARY_28,
      flatBandPctPerWeek: 0.1,
    };
    const { estados } = recorrer(ESCENARIOS[0], "diaria", bandaEstrecha, 42);
    expect(estados).not.toContain("MAINTAINING");

    // Con la banda de producción, sí.
    const conBandaReal = recorrer(ESCENARIOS[0], "diaria", PRIMARY_28, 42);
    expect(conBandaReal.estados).toContain("MAINTAINING");
  });

  it("pero sigue siendo estrecha: perder al ritmo objetivo nunca se lee como mantener", () => {
    // 0,25 %/semana es el objetivo de pérdida más suave que la app permite
    // fijar. La banda está al 60 % de eso, así que quien lo cumple lee LOSING.
    const enObjetivoSuave = Array.from({ length: 28 }, (_, i) => ({
      localDate: addDays(INICIO, i),
      weightKg: kg(84 - (0.0025 * 84 * i) / 7),
      waistCm: null,
      waistProtocol: null,
      bodyFatPct: null,
      bodyFatReliability: null,
    }));
    const r = analyzeBody(
      {
        measurements: enObjetivoSuave,
        todayLocalDate: addDays(INICIO, 27),
        goal: null,
      },
      PRIMARY_28,
    );
    expect(r.weight.status).toBe("LOSING");
    expect(r.weight.trend!.slopePerWeek).toBeCloseTo(-0.21, 2);
  });
});
