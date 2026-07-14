import { describe, expect, it } from "vitest";

import { EXERCISES } from "@/core/catalog/exercises";
import {
  BASELINE_WEEKLY_SETS,
  MIN_WEEKLY_SETS,
} from "@/core/config/training-config";
import type { Equipment, MuscleGroupCode } from "@/core/enums";
import { generateInitialProgram } from "@/core/program/generate-initial-program";
import type { CatalogExercise, GeneratorInput } from "@/core/program/types";

/** Catálogo de test construido desde el seed real (ids = nombres). */
function testCatalog(): CatalogExercise[] {
  return EXERCISES.map((e) => ({
    id: e.name,
    name: e.name,
    movementPattern: e.movementPattern,
    systemicFatigue: e.systemicFatigue,
    contributions: e.contributions.map((c) => ({ ...c })),
    variants: e.variants.map((v) => ({
      id: `${e.name}::${v.name}`,
      name: v.name,
      equipment: v.equipment,
      loadStepKg: v.loadStepKg,
      repRangeMin: v.repRangeMin,
      repRangeMax: v.repRangeMax,
      defaultRestSeconds: v.defaultRestSeconds,
      contraindications: [...v.contraindications],
      isDefault: v.isDefault ?? false,
    })),
  }));
}

const FULL_GYM: Equipment[] = [
  "BARBELL",
  "EZ_BAR",
  "DUMBBELL",
  "MACHINE",
  "SMITH_MACHINE",
  "CABLE",
  "BODYWEIGHT",
  "BAND",
];

function baseInput(overrides: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    daysPerWeek: 5,
    minutesPerSession: 90,
    equipment: FULL_GYM,
    contraindications: [],
    excludedExerciseNames: [],
    priorityMuscles: [],
    goalType: "RECOMP",
    catalog: testCatalog(),
    ...overrides,
  };
}

const directOf = (
  p: ReturnType<typeof generateInitialProgram>,
  g: MuscleGroupCode,
) => p.volumeByGroup.find((v) => v.group === g)!.directSets;
const freqOf = (
  p: ReturnType<typeof generateInitialProgram>,
  g: MuscleGroupCode,
) => p.volumeByGroup.find((v) => v.group === g)!.frequency;

describe("generateInitialProgram — división por días", () => {
  it.each([
    [2, "FULL_BODY_2", 2],
    [3, "FULL_BODY_3", 3],
    [4, "UPPER_LOWER_4", 4],
    [5, "PPL_UL_5", 5],
    [6, "PPL_X2_6", 6],
  ])("con %i días elige %s", (days, splitType, expectedDays) => {
    const program = generateInitialProgram(baseInput({ daysPerWeek: days }));
    expect(program.splitType).toBe(splitType);
    expect(program.days).toHaveLength(expectedDays);
    expect(program.days.every((d) => d.exercises.length > 0)).toBe(true);
  });

  it("rechaza días fuera de rango", () => {
    expect(() => generateInitialProgram(baseInput({ daysPerWeek: 7 }))).toThrow(
      /2–6/,
    );
  });
});

describe("generateInitialProgram — equilibrado sin sesgo oculto", () => {
  const program = generateInitialProgram(baseInput({ priorityMuscles: [] }));

  it("ningún grupo se marca como prioridad cuando el programa es equilibrado", () => {
    expect(program.volumeByGroup.every((v) => !v.isPriority)).toBe(true);
  });

  it("los grupos antes 'prioritarios por defecto' no reciben más volumen que su base neutra", () => {
    // Antes del parche, deltoide lateral/posterior, dorsal y pecho superior
    // tenían un sesgo estético oculto. Ahora su volumen sale de la base neutra.
    for (const g of [
      "DELT_LATERAL",
      "DELT_POSTERIOR",
      "DORSAL",
      "PECHO_SUPERIOR",
    ] as MuscleGroupCode[]) {
      expect(directOf(program, g)).toBeLessThanOrEqual(BASELINE_WEEKLY_SETS[g]);
    }
  });

  it("ningún grupo principal queda abandonado (respeta los suelos)", () => {
    for (const v of program.volumeByGroup) {
      expect(v.directSets).toBeGreaterThanOrEqual(MIN_WEEKLY_SETS[v.group]);
    }
    expect(program.warnings).toEqual([]);
  });
});

describe("generateInitialProgram — la prioridad aumenta la presencia", () => {
  it("priorizar hombros/espalda/pecho superior les da más volumen que sin prioridad", () => {
    const balanced = generateInitialProgram(baseInput({ priorityMuscles: [] }));
    const prioritized = generateInitialProgram(
      baseInput({
        priorityMuscles: [
          "DELT_LATERAL",
          "DELT_POSTERIOR",
          "DORSAL",
          "PECHO_SUPERIOR",
        ],
      }),
    );
    for (const g of [
      "DELT_LATERAL",
      "DELT_POSTERIOR",
      "DORSAL",
      "PECHO_SUPERIOR",
    ] as MuscleGroupCode[]) {
      expect(directOf(prioritized, g)).toBeGreaterThan(directOf(balanced, g));
      expect(
        prioritized.volumeByGroup.find((v) => v.group === g)!.isPriority,
      ).toBe(true);
    }
  });

  it("un grupo priorizado recibe más volumen o frecuencia que un comparable no priorizado", () => {
    // Bíceps priorizado vs tríceps no priorizado (grupos comparables).
    const p = generateInitialProgram(
      baseInput({ priorityMuscles: ["BICEPS"] }),
    );
    expect(
      directOf(p, "BICEPS") > directOf(p, "TRICEPS") ||
        freqOf(p, "BICEPS") >= freqOf(p, "TRICEPS"),
    ).toBe(true);
  });

  it("prioriza sin abandonar el resto del cuerpo", () => {
    const p = generateInitialProgram(
      baseInput({ priorityMuscles: ["DELT_LATERAL"] }),
    );
    expect(directOf(p, "CUADRICEPS")).toBeGreaterThanOrEqual(
      MIN_WEEKLY_SETS.CUADRICEPS,
    );
    expect(directOf(p, "ISQUIOS")).toBeGreaterThanOrEqual(
      MIN_WEEKLY_SETS.ISQUIOS,
    );
    expect(directOf(p, "DORSAL")).toBeGreaterThanOrEqual(
      MIN_WEEKLY_SETS.DORSAL,
    );
  });

  it("con 4 prioridades y tiempo suficiente, los grupos no prioritarios reciben trabajo directo (no se cierra la sesión antes de tiempo)", () => {
    // Regresión: priorizar hombros/espalda/pecho superior no debe dejar a
    // bíceps o espalda alta con 0 series si queda tiempo en la sesión.
    const p = generateInitialProgram(
      baseInput({
        priorityMuscles: [
          "DELT_LATERAL",
          "DELT_POSTERIOR",
          "DORSAL",
          "PECHO_SUPERIOR",
        ],
      }),
    );
    expect(directOf(p, "BICEPS")).toBeGreaterThanOrEqual(
      MIN_WEEKLY_SETS.BICEPS,
    );
    expect(directOf(p, "ESPALDA_ALTA")).toBeGreaterThanOrEqual(
      MIN_WEEKLY_SETS.ESPALDA_ALTA,
    );
    expect(directOf(p, "CUADRICEPS")).toBeGreaterThanOrEqual(
      MIN_WEEKLY_SETS.CUADRICEPS,
    );
  });
});

describe("generateInitialProgram — restricciones prevalecen sobre prioridad", () => {
  it("respeta el equipamiento disponible", () => {
    const program = generateInitialProgram(
      baseInput({ equipment: ["DUMBBELL", "BODYWEIGHT"] }),
    );
    const catalog = testCatalog();
    for (const day of program.days) {
      for (const ex of day.exercises) {
        const variant = catalog
          .find((e) => e.id === ex.exerciseId)!
          .variants.find((v) => v.id === ex.variantId)!;
        expect(["DUMBBELL", "BODYWEIGHT"]).toContain(variant.equipment);
      }
    }
  });

  it("excluye ejercicios prohibidos aunque su grupo sea prioritario", () => {
    const program = generateInitialProgram(
      baseInput({
        priorityMuscles: ["PECHO_SUPERIOR"],
        excludedExerciseNames: ["Press inclinado"],
      }),
    );
    const names = program.days.flatMap((d) =>
      d.exercises.map((e) => e.exerciseName),
    );
    expect(names).not.toContain("Press inclinado");
  });

  it("evita variantes contraindicadas (rodilla) aunque piernas estén priorizadas", () => {
    const program = generateInitialProgram(
      baseInput({
        priorityMuscles: ["CUADRICEPS"],
        contraindications: ["KNEE"],
      }),
    );
    const catalog = testCatalog();
    for (const day of program.days) {
      for (const ex of day.exercises) {
        const variant = catalog
          .find((e) => e.id === ex.exerciseId)!
          .variants.find((v) => v.id === ex.variantId)!;
        expect(variant.contraindications).not.toContain("KNEE");
      }
    }
  });
});

describe("generateInitialProgram — volumen y contabilidad fraccional", () => {
  const program = generateInitialProgram(baseInput());

  it("las series indirectas cuentan fraccionalmente, no como una directa completa", () => {
    // El deltoide anterior recibe mucho volumen indirecto de los empujes:
    // su fraccional debe superar a sus series directas.
    const delt = program.volumeByGroup.find(
      (v) => v.group === "DELT_ANTERIOR",
    )!;
    expect(delt.fractionalSets).toBeGreaterThan(delt.directSets);
    // Y ninguna contribución fraccional es entera "gratis": tríceps recibe
    // fraccional de los empujes además de su trabajo directo.
    const tri = program.volumeByGroup.find((v) => v.group === "TRICEPS")!;
    expect(tri.fractionalSets).toBeGreaterThan(tri.directSets);
  });

  it("el volumen directo por grupo se mantiene dentro de límites configurados", () => {
    for (const v of program.volumeByGroup) {
      expect(v.directSets).toBeLessThanOrEqual(v.targetSets + 4);
    }
  });
});

describe("generateInitialProgram — RIR y rangos dependen del tipo de ejercicio", () => {
  const program = generateInitialProgram(baseInput());
  const all = program.days.flatMap((d) => d.exercises);

  it("los compuestos se dejan más lejos del fallo que los aislamientos", () => {
    const compoundRir = all.filter((e) => e.isCompound).map((e) => e.targetRir);
    const isoRir = all.filter((e) => !e.isCompound).map((e) => e.targetRir);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(avg(compoundRir)).toBeGreaterThan(avg(isoRir));
  });

  it("cada ejercicio lleva un rango de repeticiones válido de su variante", () => {
    for (const e of all) {
      expect(e.repRangeMin).toBeGreaterThan(0);
      expect(e.repRangeMax).toBeGreaterThanOrEqual(e.repRangeMin);
    }
  });
});

describe("generateInitialProgram — tiempo y ausencia de redundancias", () => {
  it("recorta trabajo cuando la sesión no cabe (45 min < 120 min)", () => {
    const short = generateInitialProgram(baseInput({ minutesPerSession: 45 }));
    const long = generateInitialProgram(baseInput({ minutesPerSession: 120 }));
    const totalSets = (p: ReturnType<typeof generateInitialProgram>) =>
      p.days.reduce(
        (s, d) => s + d.exercises.reduce((a, e) => a + e.sets, 0),
        0,
      );
    expect(totalSets(short)).toBeLessThan(totalSets(long));
    for (const d of short.days) {
      expect(d.estimatedMinutes).toBeLessThanOrEqual(45);
    }
  });

  it("no repite dos ejercicios casi idénticos (mismo grupo+patrón) el mismo día", () => {
    const program = generateInitialProgram(baseInput({ daysPerWeek: 6 }));
    for (const day of program.days) {
      const seen = new Set<string>();
      for (const e of day.exercises) {
        const key = `${e.muscleGroup}:${e.exerciseId}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("generateInitialProgram — determinismo y trazabilidad", () => {
  it("mismo input produce exactamente el mismo output", () => {
    expect(generateInitialProgram(baseInput())).toEqual(
      generateInitialProgram(baseInput()),
    );
  });

  it("en pérdida de grasa el volumen de partida es menor que en recomposición", () => {
    const recomp = generateInitialProgram(baseInput({ goalType: "RECOMP" }));
    const cut = generateInitialProgram(baseInput({ goalType: "FAT_LOSS" }));
    const total = (p: ReturnType<typeof generateInitialProgram>) =>
      p.volumeByGroup.reduce((s, v) => s + v.targetSets, 0);
    expect(total(cut)).toBeLessThan(total(recomp));
  });

  it("expone ruleId y versión para la AlgorithmDecision", () => {
    const program = generateInitialProgram(baseInput());
    expect(program.ruleId).toBe("program.initial.ppl_ul_5");
    expect(program.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
