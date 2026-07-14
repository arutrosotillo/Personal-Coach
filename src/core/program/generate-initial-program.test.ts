import { describe, expect, it } from "vitest";

import { EXERCISES } from "@/core/catalog/exercises";
import type { Equipment } from "@/core/enums";
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
    daysPerWeek: 4,
    minutesPerSession: 90,
    equipment: FULL_GYM,
    contraindications: [],
    excludedExerciseNames: [],
    priorityMuscles: [],
    goalType: "FAT_LOSS",
    catalog: testCatalog(),
    ...overrides,
  };
}

describe("generateInitialProgram — división por días", () => {
  it.each([
    [2, "FULL_BODY_2", 2],
    [3, "FULL_BODY_3", 3],
    [4, "TORSO_PIERNA_4", 4],
    [5, "TORSO_PIERNA_ESPECIALIZACION_5", 5],
    [6, "PPL_X2_6", 6],
  ])("con %i días elige %s", (days, splitType, expectedDays) => {
    const program = generateInitialProgram(baseInput({ daysPerWeek: days }));
    expect(program.splitType).toBe(splitType);
    expect(program.days).toHaveLength(expectedDays);
    expect(program.days.every((d) => d.exercises.length > 0)).toBe(true);
  });

  it("rechaza días fuera de rango", () => {
    expect(() => generateInitialProgram(baseInput({ daysPerWeek: 7 }))).toThrow(/2–6/);
  });
});

describe("generateInitialProgram — restricciones duras", () => {
  it("respeta el equipamiento disponible (solo mancuernas y peso corporal)", () => {
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

  it("excluye ejercicios prohibidos por el usuario", () => {
    const program = generateInitialProgram(
      baseInput({ excludedExerciseNames: ["Press inclinado", "Sentadilla trasera"] }),
    );
    const names = program.days.flatMap((d) => d.exercises.map((e) => e.exerciseName));
    expect(names).not.toContain("Press inclinado");
    expect(names).not.toContain("Sentadilla trasera");
  });

  it("evita variantes contraindicadas para molestias declaradas (rodilla)", () => {
    const program = generateInitialProgram(baseInput({ contraindications: ["KNEE"] }));
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

describe("generateInitialProgram — prioridades estéticas", () => {
  it("sesga el volumen semanal hacia Tier A sin abandonar piernas (4 días)", () => {
    const program = generateInitialProgram(baseInput());
    const sets = program.weeklySetsByGroup;
    // Tier A con volumen claro
    expect(sets.DELT_LATERAL ?? 0).toBeGreaterThanOrEqual(8);
    expect(sets.DELT_POSTERIOR ?? 0).toBeGreaterThanOrEqual(6);
    expect(sets.DORSAL ?? 0).toBeGreaterThanOrEqual(6);
    expect(sets.PECHO_SUPERIOR ?? 0).toBeGreaterThanOrEqual(6);
    // Piernas presentes en ≥2 sesiones
    const legDays = program.days.filter((d) =>
      d.exercises.some((e) => ["CUADRICEPS", "ISQUIOS", "GLUTEO"].includes(e.muscleGroup)),
    );
    expect(legDays.length).toBeGreaterThanOrEqual(2);
    expect(sets.CUADRICEPS ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("la explicación menciona las prioridades y que es un plan inicial", () => {
    const program = generateInitialProgram(baseInput());
    expect(program.explanation).toMatch(/deltoide lateral/i);
    expect(program.explanation).toMatch(/punto de partida/i);
    expect(program.explanation.length).toBeGreaterThan(50);
  });
});

describe("generateInitialProgram — presupuesto de tiempo", () => {
  it("recorta trabajo no prioritario cuando la sesión no cabe (45 min)", () => {
    const short = generateInitialProgram(baseInput({ minutesPerSession: 45 }));
    const long = generateInitialProgram(baseInput({ minutesPerSession: 120 }));
    const shortSets = short.days.reduce(
      (sum, d) => sum + d.exercises.reduce((s, e) => s + e.sets, 0),
      0,
    );
    const longSets = long.days.reduce(
      (sum, d) => sum + d.exercises.reduce((s, e) => s + e.sets, 0),
      0,
    );
    expect(shortSets).toBeLessThan(longSets);
    expect(short.warnings.some((w) => /recortada/.test(w))).toBe(true);
    // Los Tier A sobreviven al recorte
    expect(short.weeklySetsByGroup.DELT_LATERAL ?? 0).toBeGreaterThanOrEqual(8);
  });

  it("protege del recorte a los grupos priorizados por el usuario", () => {
    const withoutPriority = generateInitialProgram(baseInput({ minutesPerSession: 40 }));
    const withPriority = generateInitialProgram(
      baseInput({ minutesPerSession: 40, priorityMuscles: ["BICEPS"] }),
    );
    const bicepsSets = (p: typeof withPriority) =>
      p.days.reduce(
        (sum, d) =>
          sum +
          d.exercises.filter((e) => e.muscleGroup === "BICEPS").reduce((s, e) => s + e.sets, 0),
        0,
      );
    expect(bicepsSets(withPriority)).toBeGreaterThanOrEqual(bicepsSets(withoutPriority));
    expect(bicepsSets(withPriority)).toBeGreaterThan(0);
  });
});

describe("generateInitialProgram — determinismo y trazabilidad", () => {
  it("mismo input produce exactamente el mismo output", () => {
    const a = generateInitialProgram(baseInput());
    const b = generateInitialProgram(baseInput());
    expect(a).toEqual(b);
  });

  it("no repite el mismo ejercicio dentro de un día", () => {
    const program = generateInitialProgram(baseInput({ daysPerWeek: 6 }));
    for (const day of program.days) {
      const ids = day.exercises.map((e) => e.exerciseId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("expone ruleId y versión para la AlgorithmDecision", () => {
    const program = generateInitialProgram(baseInput());
    expect(program.ruleId).toBe("program.initial.torso_pierna_4");
    expect(program.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
