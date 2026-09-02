import { describe, expect, it } from "vitest";

import {
  exponentialMovingAverage,
  linearRegression,
  tCritical975,
} from "@/core/body/stats";

/** Serie con una pendiente exacta y sin ruido. */
function ramp(days: number, start: number, perDay: number) {
  return Array.from({ length: days }, (_, i) => ({
    dayOffset: i,
    value: start + perDay * i,
  }));
}

describe("linearRegression", () => {
  it("no devuelve nada con menos de 3 puntos: harían falta 2 para la recta y 1 más para el error", () => {
    expect(linearRegression([])).toBeNull();
    expect(linearRegression([{ dayOffset: 0, value: 80 }])).toBeNull();
    expect(
      linearRegression([
        { dayOffset: 0, value: 80 },
        { dayOffset: 7, value: 79 },
      ]),
    ).toBeNull();
  });

  it("no devuelve nada si todas las observaciones caen el mismo día", () => {
    // Sin variación en el eje X no hay pendiente definida. Antes de la guarda
    // esto era una división por cero que producía NaN silencioso.
    expect(
      linearRegression([
        { dayOffset: 3, value: 80 },
        { dayOffset: 3, value: 81 },
        { dayOffset: 3, value: 82 },
      ]),
    ).toBeNull();
  });

  it("recupera exactamente la pendiente de una recta sin ruido, con residuos nulos", () => {
    const r = linearRegression(ramp(14, 82, -0.05))!;
    expect(r.slopePerDay).toBeCloseTo(-0.05, 10);
    expect(r.intercept).toBeCloseTo(82, 10);
    expect(r.residualSd).toBeCloseTo(0, 10);
    // Sin residuos no hay incertidumbre: el intervalo colapsa.
    expect(r.ciHalfWidthPerDay).toBeCloseTo(0, 10);
    expect(r.n).toBe(14);
    expect(r.spanDays).toBe(13);
  });

  it("una serie constante tiene pendiente 0", () => {
    const r = linearRegression(ramp(14, 80, 0))!;
    expect(r.slopePerDay).toBeCloseTo(0, 10);
    expect(r.residualSd).toBeCloseTo(0, 10);
  });

  it("usa el DÍA de calendario, no el índice: los huecos no comprimen el tiempo", () => {
    // Mismos cuatro valores, una vez en días consecutivos y otra separados
    // 7 días. La pendiente por día tiene que ser siete veces menor.
    const densa = linearRegression([
      { dayOffset: 0, value: 84 },
      { dayOffset: 1, value: 83 },
      { dayOffset: 2, value: 82 },
      { dayOffset: 3, value: 81 },
    ])!;
    const espaciada = linearRegression([
      { dayOffset: 0, value: 84 },
      { dayOffset: 7, value: 83 },
      { dayOffset: 14, value: 82 },
      { dayOffset: 21, value: 81 },
    ])!;
    expect(densa.slopePerDay).toBeCloseTo(-1, 10);
    expect(espaciada.slopePerDay).toBeCloseTo(-1 / 7, 10);
  });

  it("el intervalo se estrecha al añadir días, con el mismo ruido", () => {
    // Mismo patrón de ruido determinista en las dos series.
    const ruido = (i: number) => (i % 3 === 0 ? 0.4 : i % 3 === 1 ? -0.3 : 0.1);
    const corta = linearRegression(
      Array.from({ length: 8 }, (_, i) => ({
        dayOffset: i,
        value: 82 - 0.05 * i + ruido(i),
      })),
    )!;
    const larga = linearRegression(
      Array.from({ length: 28 }, (_, i) => ({
        dayOffset: i,
        value: 82 - 0.05 * i + ruido(i),
      })),
    )!;
    expect(larga.ciHalfWidthPerDay).toBeLessThan(corta.ciHalfWidthPerDay);
  });

  it("con muy pocos grados de libertad el intervalo es enorme (la t protege del exceso de confianza)", () => {
    // 3 puntos = 1 grado de libertad = t de 12,706. Aunque los residuos sean
    // minúsculos, el intervalo no puede fingir precisión.
    const r = linearRegression([
      { dayOffset: 0, value: 82.0 },
      { dayOffset: 1, value: 81.9 },
      { dayOffset: 2, value: 81.85 },
    ])!;
    expect(r.n).toBe(3);
    expect(r.ciHalfWidthPerDay).toBeGreaterThan(Math.abs(r.slopePerDay) * 0.5);
  });
});

describe("tCritical975", () => {
  it("usa la t de Student con pocos grados de libertad y converge a la normal", () => {
    expect(tCritical975(1)).toBeCloseTo(12.706, 3);
    expect(tCritical975(10)).toBeCloseTo(2.228, 3);
    expect(tCritical975(30)).toBeCloseTo(2.042, 3);
    expect(tCritical975(200)).toBeCloseTo(1.96, 3);
  });

  it("sin grados de libertad no hay intervalo posible", () => {
    expect(tCritical975(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("exponentialMovingAverage", () => {
  it("el primer punto siembra la EMA y no se puede winsorizar", () => {
    const [first] = exponentialMovingAverage([{ dayOffset: 0, value: 82.3 }]);
    expect(first.ema).toBe(82.3);
    expect(first.used).toBe(82.3);
    expect(first.winsorized).toBe(false);
    expect(first.gapDays).toBe(0);
  });

  it("va por detrás de la serie: ese retardo es el precio del suavizado", () => {
    // Escalón de 82 a 80. Con alpha 0,15 la EMA tarda ~18 días en cubrir el
    // 95 % del salto, así que a los 5 días sigue claramente por encima.
    const puntos = [
      ...Array.from({ length: 5 }, (_, i) => ({ dayOffset: i, value: 82 })),
      ...Array.from({ length: 5 }, (_, i) => ({ dayOffset: 5 + i, value: 80 })),
    ];
    const out = exponentialMovingAverage(puntos);
    const ultima = out[out.length - 1];
    expect(ultima.value).toBe(80);
    expect(ultima.ema).toBeGreaterThan(80.5);
    expect(ultima.ema).toBeLessThan(82);
  });

  it("un hueco de varios días hace pesar más al dato nuevo, sin interpolar los días vacíos", () => {
    // Mismo valor nuevo, una vez al día siguiente y otra 14 días después. La
    // EMA tiene que haberse movido MÁS en el segundo caso, y en los dos casos
    // la serie devuelta tiene exactamente 2 puntos: no se inventan los días
    // intermedios.
    const seguido = exponentialMovingAverage([
      { dayOffset: 0, value: 82 },
      { dayOffset: 1, value: 80 },
    ]);
    const conHueco = exponentialMovingAverage([
      { dayOffset: 0, value: 82 },
      { dayOffset: 14, value: 80 },
    ]);
    expect(seguido).toHaveLength(2);
    expect(conHueco).toHaveLength(2);
    expect(conHueco[1].ema).toBeLessThan(seguido[1].ema);
    expect(conHueco[1].gapDays).toBe(14);
  });

  it("acota el atípico pero conserva el crudo intacto", () => {
    const out = exponentialMovingAverage([
      { dayOffset: 0, value: 82 },
      { dayOffset: 1, value: 82 },
      // Error de tecleo: 8,2 en vez de 82.
      { dayOffset: 2, value: 8.2 },
      { dayOffset: 3, value: 82 },
    ]);
    const atipico = out[2];
    expect(atipico.winsorized).toBe(true);
    // El crudo viaja intacto: el motor NUNCA modifica la medición original.
    expect(atipico.value).toBe(8.2);
    // Y el valor usado se queda pegado a la banda del 2,5 %.
    expect(atipico.used).toBeCloseTo(82 * 0.975, 5);
    // La EMA apenas se entera.
    expect(atipico.ema).toBeGreaterThan(81);
  });

  it("no winsoriza el ruido fisiológico normal", () => {
    // ±1 kg sobre 82 es 1,2 %: dentro de la banda del 2,5 %, tiene que pasar.
    const out = exponentialMovingAverage([
      { dayOffset: 0, value: 82 },
      { dayOffset: 1, value: 83 },
      { dayOffset: 2, value: 81 },
      { dayOffset: 3, value: 82.6 },
    ]);
    expect(out.every((p) => !p.winsorized)).toBe(true);
    expect(out.every((p) => p.used === p.value)).toBe(true);
  });

  it("una serie constante da una EMA constante", () => {
    const out = exponentialMovingAverage(
      Array.from({ length: 20 }, (_, i) => ({ dayOffset: i, value: 75 })),
    );
    for (const p of out) expect(p.ema).toBeCloseTo(75, 10);
  });
});
