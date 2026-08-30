import { describe, expect, it } from "vitest";

import { customExerciseSchema } from "./custom-exercise";

/**
 * El formulario es la única puerta por la que entra un ejercicio que los
 * motores no han visto nunca. Cada caso de abajo es un dato que, si pasara,
 * envenenaría en silencio el conteo de volumen o la sugerencia de carga.
 */

const valido = {
  name: "Remo en máquina Hammer",
  movementPattern: "HORIZONTAL_PULL" as const,
  systemicFatigue: 2,
  primaryMuscle: "ESPALDA_ALTA" as const,
  secondaryMuscles: [{ group: "BICEPS" as const, factor: 0.5 }],
  variantName: "Máquina",
  equipment: "MACHINE" as const,
  loadStepKg: 5,
  repRangeMin: 8,
  repRangeMax: 12,
  restSeconds: 90,
  contraindications: [],
};

/** Primer mensaje de error, para afirmar sobre el porqué y no solo sobre el fallo. */
function motivo(input: unknown): string {
  const r = customExerciseSchema.safeParse(input);
  expect(r.success).toBe(false);
  return r.success ? "" : (r.error.issues[0]?.message ?? "");
}

describe("customExerciseSchema", () => {
  it("acepta un ejercicio completo y conserva sus números", () => {
    const r = customExerciseSchema.safeParse(valido);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.primaryMuscle).toBe("ESPALDA_ALTA");
    expect(r.data.secondaryMuscles).toEqual([
      { group: "BICEPS", factor: 0.5 },
    ]);
    expect(r.data.loadStepKg).toBe(5);
  });

  it("los secundarios y las contraindicaciones son opcionales", () => {
    const { secondaryMuscles, contraindications, ...sinOpcionales } = valido;
    void secondaryMuscles;
    void contraindications;
    const r = customExerciseSchema.safeParse(sinOpcionales);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.secondaryMuscles).toEqual([]);
    expect(r.data.contraindications).toEqual([]);
  });

  it("rechaza un factor secundario fuera de los cubos del catálogo", () => {
    expect(
      motivo({
        ...valido,
        secondaryMuscles: [{ group: "BICEPS", factor: 0.6 }],
      }),
    ).toContain("0,75");
  });

  it("rechaza el rango invertido, que haría imposible cerrarlo", () => {
    expect(
      motivo({ ...valido, repRangeMin: 12, repRangeMax: 8 }),
    ).toContain("techo del rango");
  });

  it("rechaza repetir el músculo principal como secundario (contaría doble)", () => {
    expect(
      motivo({
        ...valido,
        secondaryMuscles: [{ group: "ESPALDA_ALTA", factor: 0.5 }],
      }),
    ).toContain("no puede repetirse");
  });

  it("rechaza dos veces el mismo secundario", () => {
    expect(
      motivo({
        ...valido,
        secondaryMuscles: [
          { group: "BICEPS", factor: 0.5 },
          { group: "BICEPS", factor: 0.25 },
        ],
      }),
    ).toContain("repetido");
  });

  it("rechaza una exigencia sistémica fuera de 1..3", () => {
    expect(motivo({ ...valido, systemicFatigue: 4 })).toContain("1 a 3");
  });

  it("acepta incremento 0 (peso corporal o banda): el motor progresa por reps", () => {
    const r = customExerciseSchema.safeParse({ ...valido, loadStepKg: 0 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.loadStepKg).toBe(0);
  });

  it("rechaza un incremento negativo", () => {
    expect(motivo({ ...valido, loadStepKg: -2.5 })).toContain("negativo");
  });

  it("rechaza un grupo muscular que no existe en el seed", () => {
    expect(
      customExerciseSchema.safeParse({ ...valido, primaryMuscle: "PECHO" })
        .success,
    ).toBe(false);
  });

  it("recorta el nombre y exige longitud mínima sobre lo recortado", () => {
    const r = customExerciseSchema.safeParse({ ...valido, name: "  Remo  " });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.name).toBe("Remo");
    expect(motivo({ ...valido, name: "  a  " })).toContain("3 caracteres");
  });
});
