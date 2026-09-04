import { describe, expect, it } from "vitest";

import type { MuscleGroupCode } from "@/core/enums";
import { MUSCLE_GROUPS } from "@/core/catalog/muscle-groups";
import type { CatalogExercise } from "@/core/program/types";
import { computeWeeklyVolume } from "./weekly-volume";

/**
 * El conteo tiene que dar EXACTAMENTE lo mismo que el reparto del generador,
 * porque los dos números se enseñan juntos. Cada caso comprueba el valor y la
 * regla que lo produce.
 */

const targets = Object.fromEntries(
  MUSCLE_GROUPS.map((g) => [g.code, 10]),
) as Record<MuscleGroupCode, number>;

/** Press: pecho primario, tríceps y deltoide anterior a media contribución. */
const press: CatalogExercise = {
  id: "press",
  name: "Press banca",
  movementPattern: "HORIZONTAL_PUSH",
  systemicFatigue: 2,
  contributions: [
    { group: "PECHO_MEDIO_INFERIOR", role: "PRIMARY", factor: 1.0 },
    { group: "TRICEPS", role: "SECONDARY", factor: 0.5 },
    { group: "DELT_ANTERIOR", role: "SECONDARY", factor: 0.5 },
  ],
  variants: [
    {
      id: "press-barra",
      name: "Barra",
      equipment: "BARBELL",
      stability: null,
      loadStepKg: 2.5,
      repRangeMin: 6,
      repRangeMax: 10,
      defaultRestSeconds: 180,
      contraindications: [],
      isDefault: true,
    },
  ],
};

/** Extensión: tríceps primario y nada más. */
const extension: CatalogExercise = {
  id: "ext",
  name: "Extensión de tríceps",
  movementPattern: "ISOLATION",
  systemicFatigue: 1,
  contributions: [{ group: "TRICEPS", role: "PRIMARY", factor: 1.0 }],
  variants: [
    {
      id: "ext-polea",
      name: "Polea",
      equipment: "CABLE",
      stability: null,
      loadStepKg: 2.5,
      repRangeMin: 10,
      repRangeMax: 15,
      defaultRestSeconds: 75,
      contraindications: [],
      isDefault: true,
    },
  ],
};

const catalog = [press, extension];

function grupo(
  result: ReturnType<typeof computeWeeklyVolume>,
  code: MuscleGroupCode,
) {
  const v = result.byGroup.find((g) => g.group === code);
  if (!v) throw new Error(`falta ${code}`);
  return v;
}

describe("computeWeeklyVolume", () => {
  it("las series directas suman 1.0 a su músculo primario", () => {
    const r = computeWeeklyVolume({
      entries: [{ variantId: "press-barra", dayKey: "d1", sets: 3 }],
      catalog,
      targets,
      priorityMuscles: [],
    });
    expect(grupo(r, "PECHO_MEDIO_INFERIOR").directSets).toBe(3);
    expect(grupo(r, "PECHO_MEDIO_INFERIOR").fractionalSets).toBe(3);
  });

  it("las indirectas suman su factor, y NO cuentan como directas", () => {
    const r = computeWeeklyVolume({
      entries: [{ variantId: "press-barra", dayKey: "d1", sets: 3 }],
      catalog,
      targets,
      priorityMuscles: [],
    });
    // 3 series × 0.5 de contribución
    expect(grupo(r, "TRICEPS").fractionalSets).toBe(1.5);
    expect(grupo(r, "TRICEPS").directSets).toBe(0);
  });

  it("directo e indirecto del mismo músculo se acumulan", () => {
    const r = computeWeeklyVolume({
      entries: [
        { variantId: "press-barra", dayKey: "d1", sets: 3 }, // tríceps 1.5
        { variantId: "ext-polea", dayKey: "d1", sets: 3 }, // tríceps 3.0
      ],
      catalog,
      targets,
      priorityMuscles: [],
    });
    expect(grupo(r, "TRICEPS").fractionalSets).toBe(4.5);
    expect(grupo(r, "TRICEPS").directSets).toBe(3);
  });

  it("la frecuencia cuenta días DISTINTOS, no series", () => {
    const r = computeWeeklyVolume({
      entries: [
        { variantId: "press-barra", dayKey: "lunes", sets: 3 },
        { variantId: "press-barra", dayKey: "lunes", sets: 3 },
        { variantId: "press-barra", dayKey: "jueves", sets: 3 },
      ],
      catalog,
      targets,
      priorityMuscles: [],
    });
    expect(grupo(r, "PECHO_MEDIO_INFERIOR").frequency).toBe(2);
    expect(grupo(r, "PECHO_MEDIO_INFERIOR").directSets).toBe(9);
  });

  it("el estímulo indirecto NO suma frecuencia (ya está en el efectivo)", () => {
    const r = computeWeeklyVolume({
      entries: [{ variantId: "press-barra", dayKey: "lunes", sets: 3 }],
      catalog,
      targets,
      priorityMuscles: [],
    });
    expect(grupo(r, "TRICEPS").fractionalSets).toBe(1.5);
    expect(grupo(r, "TRICEPS").frequency).toBe(0);
  });

  it("una variante desconocida no se traga las series: las declara aparte", () => {
    const r = computeWeeklyVolume({
      entries: [
        { variantId: "press-barra", dayKey: "d1", sets: 3 },
        { variantId: "borrado", dayKey: "d1", sets: 4 },
      ],
      catalog,
      targets,
      priorityMuscles: [],
    });
    expect(r.unattributedSets).toBe(4);
    expect(grupo(r, "PECHO_MEDIO_INFERIOR").fractionalSets).toBe(3);
  });

  it("marca los músculos prioritarios y arrastra su objetivo", () => {
    const r = computeWeeklyVolume({
      entries: [],
      catalog,
      targets: { ...targets, DELT_LATERAL: 13 },
      priorityMuscles: ["DELT_LATERAL"],
    });
    expect(grupo(r, "DELT_LATERAL").isPriority).toBe(true);
    expect(grupo(r, "DELT_LATERAL").targetSets).toBe(13);
    expect(grupo(r, "BICEPS").isPriority).toBe(false);
  });

  it("sin series, todos los grupos salen a cero (y salen los 16)", () => {
    const r = computeWeeklyVolume({
      entries: [],
      catalog,
      targets,
      priorityMuscles: [],
    });
    expect(r.byGroup).toHaveLength(16);
    expect(r.byGroup.every((g) => g.fractionalSets === 0)).toBe(true);
    expect(r.unattributedSets).toBe(0);
  });

  it("ignora entradas de 0 o menos series", () => {
    const r = computeWeeklyVolume({
      entries: [
        { variantId: "press-barra", dayKey: "d1", sets: 0 },
        { variantId: "press-barra", dayKey: "d2", sets: -2 },
      ],
      catalog,
      targets,
      priorityMuscles: [],
    });
    expect(grupo(r, "PECHO_MEDIO_INFERIOR").fractionalSets).toBe(0);
    expect(grupo(r, "PECHO_MEDIO_INFERIOR").frequency).toBe(0);
    expect(r.unattributedSets).toBe(0);
  });

  it("redondea el efectivo a un decimal (evita 4.499999999)", () => {
    const r = computeWeeklyVolume({
      entries: [{ variantId: "press-barra", dayKey: "d1", sets: 7 }],
      catalog,
      targets,
      priorityMuscles: [],
    });
    // 7 × 0.5 = 3.5 exacto, pero el redondeo debe estar aplicado igualmente
    expect(grupo(r, "TRICEPS").fractionalSets).toBe(3.5);
    expect(
      Number.isInteger(grupo(r, "TRICEPS").fractionalSets * 10),
    ).toBe(true);
  });
});
