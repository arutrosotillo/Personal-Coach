import { describe, expect, it } from "vitest";

import { estimateOneRepMax } from "./e1rm";

describe("estimateOneRepMax (Epley con reps efectivas)", () => {
  it("con 1 rep a RIR 0 devuelve el propio peso", () => {
    // effectiveReps = 1 → 100 × (1 + 1/30) = 103,33 → 103,3
    expect(estimateOneRepMax(100, 1, 0)).toBe(103.3);
  });

  it("suma el RIR a las reps efectivas (más esfuerzo reservado ⇒ mayor 1RM)", () => {
    const sinRir = estimateOneRepMax(100, 5, 0);
    const conRir = estimateOneRepMax(100, 5, 2);
    expect(sinRir).not.toBeNull();
    expect(conRir).not.toBeNull();
    expect(conRir!).toBeGreaterThan(sinRir!);
    // 100 × (1 + (5+2)/30) = 123,33 → 123,3
    expect(conRir).toBe(123.3);
  });

  it("limita la contribución del RIR a 4 (RIR alto no infla la estimación)", () => {
    expect(estimateOneRepMax(100, 5, 10)).toBe(estimateOneRepMax(100, 5, 4));
  });

  it("devuelve null cuando las reps efectivas superan 12 (fuera de rango fiable)", () => {
    expect(estimateOneRepMax(100, 13, 0)).toBeNull();
    expect(estimateOneRepMax(100, 10, 3)).toBeNull();
  });

  it("devuelve null con peso o reps no positivos", () => {
    expect(estimateOneRepMax(0, 5, 0)).toBeNull();
    expect(estimateOneRepMax(100, 0, 0)).toBeNull();
    expect(estimateOneRepMax(-50, 5, 0)).toBeNull();
  });

  it("trata RIR nulo/indefinido como 0", () => {
    expect(estimateOneRepMax(80, 8, null)).toBe(estimateOneRepMax(80, 8, 0));
    expect(estimateOneRepMax(80, 8, undefined)).toBe(
      estimateOneRepMax(80, 8, 0),
    );
  });
});
