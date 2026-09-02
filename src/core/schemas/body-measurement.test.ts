import { describe, expect, it } from "vitest";

import {
  bodyMeasurementSchema,
  deleteBodyMeasurementSchema,
} from "@/core/schemas/body-measurement";

/** Lo mínimo que se acepta: una fecha y un dato. */
const VALIDO = { localDate: "2026-08-31", weightKg: 82.4 };

function error(input: unknown): string | null {
  const parsed = bodyMeasurementSchema.safeParse(input);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "");
}

describe("bodyMeasurementSchema — lo que acepta", () => {
  it("una medición solo con peso", () => {
    const parsed = bodyMeasurementSchema.parse(VALIDO);
    expect(parsed.weightKg).toBe(82.4);
    // Los ausentes se normalizan a null, no a undefined: la escritura declara
    // el estado COMPLETO del día y `undefined` no borraría nada.
    expect(parsed.waistCm).toBeNull();
    expect(parsed.bodyFatPct).toBeNull();
    expect(parsed.bodyFatReliability).toBeNull();
  });

  it("una medición completa", () => {
    const parsed = bodyMeasurementSchema.parse({
      localDate: "2026-08-31",
      weightKg: 82.4,
      waistCm: 88,
      bodyFatPct: 17.5,
      bodyFatReliability: "MEASURED",
    });
    expect(parsed.waistCm).toBe(88);
    expect(parsed.bodyFatReliability).toBe("MEASURED");
  });

  it("solo cintura, sin peso: registrar una cosa no obliga a registrar la otra", () => {
    expect(error({ localDate: "2026-08-31", waistCm: 88 })).toBeNull();
  });

  it("null explícito es equivalente a omitir", () => {
    const parsed = bodyMeasurementSchema.parse({
      localDate: "2026-08-31",
      weightKg: 82,
      waistCm: null,
      bodyFatPct: null,
      bodyFatReliability: null,
    });
    expect(parsed.waistCm).toBeNull();
  });
});

describe("bodyMeasurementSchema — rangos", () => {
  it.each([
    ["peso demasiado bajo", { ...VALIDO, weightKg: 29 }, /30 y 300/],
    ["peso demasiado alto", { ...VALIDO, weightKg: 301 }, /30 y 300/],
    ["cintura fuera de rango", { ...VALIDO, waistCm: 39 }, /40 y 200/],
    ["cintura absurda", { ...VALIDO, waistCm: 201 }, /40 y 200/],
  ])("rechaza %s", (_nombre, input, patron) => {
    expect(error(input)).toMatch(patron);
  });

  it("rechaza un % de grasa fuera de rango, con su procedencia", () => {
    const conMetodo = { bodyFatReliability: "ESTIMATED" as const };
    expect(error({ ...VALIDO, bodyFatPct: 2, ...conMetodo })).toMatch(/3 y 60/);
    expect(error({ ...VALIDO, bodyFatPct: 61, ...conMetodo })).toMatch(
      /3 y 60/,
    );
  });

  it("acepta los extremos exactos del rango", () => {
    expect(error({ ...VALIDO, weightKg: 30 })).toBeNull();
    expect(error({ ...VALIDO, weightKg: 300 })).toBeNull();
    expect(error({ localDate: VALIDO.localDate, waistCm: 40 })).toBeNull();
  });

  it("un peso en libras tecleado por error cae dentro del rango y NO se detecta", () => {
    // Limitación consciente: 82,4 kg son 181,7 lb, que es un peso plausible.
    // El rango detecta el dígito de más, no el cambio de unidad. Contra eso
    // solo protege que la base sea siempre métrica y que la UI no ofrezca
    // libras (CLAUDE.md).
    expect(error({ ...VALIDO, weightKg: 181.7 })).toBeNull();
  });
});

describe("bodyMeasurementSchema — reglas de coherencia", () => {
  it("rechaza una fecha con formato inválido", () => {
    expect(error({ ...VALIDO, localDate: "31/08/2026" })).toMatch(/AAAA-MM-DD/);
    expect(error({ ...VALIDO, localDate: "2026-13-01" })).toMatch(/AAAA-MM-DD/);
  });

  it("rechaza una medición sin ningún dato: sería una fecha vacía", () => {
    expect(error({ localDate: "2026-08-31" })).toMatch(/al menos un dato/);
    expect(
      error({
        localDate: "2026-08-31",
        weightKg: null,
        waistCm: null,
        bodyFatPct: null,
      }),
    ).toMatch(/al menos un dato/);
  });

  it("rechaza un % de grasa sin procedencia", () => {
    // Un porcentaje sin saber de dónde sale no es comparable con ninguna otra
    // lectura, así que no sirve para una serie temporal.
    expect(error({ ...VALIDO, bodyFatPct: 17 })).toMatch(/no son comparables/);
  });

  it("rechaza una procedencia sin % de grasa", () => {
    expect(error({ ...VALIDO, bodyFatReliability: "MEASURED" })).toMatch(
      /falta el % de grasa/,
    );
  });

  it("rechaza una procedencia que no es del enum", () => {
    const parsed = bodyMeasurementSchema.safeParse({
      ...VALIDO,
      bodyFatPct: 17,
      bodyFatReliability: "A_OJO",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("bodyMeasurementSchema — lo que NO acepta por diseño", () => {
  it("ignora un profileId enviado desde el cliente", () => {
    // Si el schema lo dejara pasar, existiría un camino por el que alguien
    // podría intentar escribir sobre otro perfil. El dueño sale SIEMPRE de la
    // cookie, así que aquí no hay campo que suplantar.
    const parsed = bodyMeasurementSchema.parse({
      ...VALIDO,
      profileId: "el-perfil-de-otro",
    });
    expect(parsed).not.toHaveProperty("profileId");
  });

  it("ignora un id enviado en el guardado", () => {
    // Guardar es un upsert contra (perfil, fecha). No hay id que apuntar a la
    // fila de otra persona.
    const parsed = bodyMeasurementSchema.parse({ ...VALIDO, id: "cualquiera" });
    expect(parsed).not.toHaveProperty("id");
  });
});

describe("deleteBodyMeasurementSchema", () => {
  it("exige un id no vacío", () => {
    expect(deleteBodyMeasurementSchema.safeParse({ id: "" }).success).toBe(
      false,
    );
    expect(deleteBodyMeasurementSchema.safeParse({}).success).toBe(false);
    expect(deleteBodyMeasurementSchema.safeParse({ id: "abc" }).success).toBe(
      true,
    );
  });

  it("acota la longitud para no aceptar basura arbitraria", () => {
    expect(
      deleteBodyMeasurementSchema.safeParse({ id: "x".repeat(65) }).success,
    ).toBe(false);
  });
});
