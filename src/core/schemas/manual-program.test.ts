import { describe, expect, it } from "vitest";

import { manualProgramSchema } from "./manual-program";

const ex = (over = {}) => ({
  exerciseVariantId: "v1",
  baseSets: 3,
  repRangeMin: 8,
  repRangeMax: 12,
  targetRir: 2,
  restSeconds: 120,
  ...over,
});
const day = (over = {}) => ({ name: "Día 1", exercises: [ex()], ...over });

describe("manualProgramSchema — integridad estructural (no fisiológica)", () => {
  it("acepta un programa mínimo válido (1 día, 1 ejercicio)", () => {
    expect(
      manualProgramSchema.safeParse({ name: "Mi rutina", days: [day()] })
        .success,
    ).toBe(true);
  });

  it("permite prescripciones que el generador NO permitiría (5×5, RIR 0)", () => {
    const r = manualProgramSchema.safeParse({
      name: "Fuerza",
      days: [
        day({
          exercises: [
            ex({ baseSets: 5, repRangeMin: 5, repRangeMax: 5, targetRir: 0 }),
          ],
        }),
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza programa sin días", () => {
    expect(manualProgramSchema.safeParse({ name: "x", days: [] }).success).toBe(
      false,
    );
  });

  it("rechaza día sin ejercicios", () => {
    expect(
      manualProgramSchema.safeParse({
        name: "x",
        days: [{ name: "Día 1", exercises: [] }],
      }).success,
    ).toBe(false);
  });

  it("rechaza nombre de programa vacío", () => {
    expect(
      manualProgramSchema.safeParse({ name: "  ", days: [day()] }).success,
    ).toBe(false);
  });

  it("rechaza más de 7 días", () => {
    const days = Array.from({ length: 8 }, (_, i) =>
      day({ name: `Día ${i + 1}` }),
    );
    expect(manualProgramSchema.safeParse({ name: "x", days }).success).toBe(
      false,
    );
  });

  it("rechaza series o descanso fuera de rango estructural", () => {
    expect(
      manualProgramSchema.safeParse({
        name: "x",
        days: [day({ exercises: [ex({ baseSets: 0 })] })],
      }).success,
    ).toBe(false);
    expect(
      manualProgramSchema.safeParse({
        name: "x",
        days: [day({ exercises: [ex({ restSeconds: 5 })] })],
      }).success,
    ).toBe(false);
  });
});
