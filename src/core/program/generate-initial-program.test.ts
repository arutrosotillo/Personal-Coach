import { describe, expect, it } from "vitest";

import { EXERCISES } from "@/core/catalog/exercises";
import {
  DIRECT_MIN,
  SESSION_SET_CAP,
  SETS_PER_EXERCISE,
} from "@/core/config/training-config";
import type { Equipment, MuscleGroupCode } from "@/core/enums";
import {
  experienceFromYears,
  generateInitialProgram,
} from "@/core/program/generate-initial-program";
import type {
  CatalogExercise,
  GeneratedProgram,
  GeneratorInput,
} from "@/core/program/types";

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
    minutesPerSession: 75,
    equipment: FULL_GYM,
    contraindications: [],
    excludedExerciseNames: [],
    priorityMuscles: [],
    goalType: "RECOMP",
    experienceLevel: "intermediate",
    catalog: testCatalog(),
    ...overrides,
  };
}

const vol = (p: GeneratedProgram, g: MuscleGroupCode) =>
  p.volumeByGroup.find((v) => v.group === g)!;
const directOf = (p: GeneratedProgram, g: MuscleGroupCode) =>
  vol(p, g).directSets;
const effectiveOf = (p: GeneratedProgram, g: MuscleGroupCode) =>
  vol(p, g).fractionalSets;
const freqOf = (p: GeneratedProgram, g: MuscleGroupCode) => vol(p, g).frequency;
const maxSetsPerExercise = (p: GeneratedProgram) =>
  Math.max(...p.days.flatMap((d) => d.exercises.map((e) => e.sets)));
const maxSessionSets = (p: GeneratedProgram) =>
  Math.max(...p.days.map((d) => d.exercises.reduce((a, e) => a + e.sets, 0)));
const totalSets = (p: GeneratedProgram) =>
  p.days.reduce((s, d) => s + d.exercises.reduce((a, e) => a + e.sets, 0), 0);

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

describe("F3.2 — guardrail de series por ejercicio", () => {
  it.each([2, 3, 4, 5, 6])(
    "ningún ejercicio supera el máximo (%i días, equilibrado)",
    (days) => {
      const p = generateInitialProgram(baseInput({ daysPerWeek: days }));
      expect(maxSetsPerExercise(p)).toBeLessThanOrEqual(SETS_PER_EXERCISE.max);
    },
  );

  it("la prioridad NO convierte ejercicios en 4–5 series", () => {
    const p = generateInitialProgram(
      baseInput({
        daysPerWeek: 4,
        priorityMuscles: ["DELT_LATERAL", "BICEPS"],
      }),
    );
    expect(maxSetsPerExercise(p)).toBeLessThanOrEqual(SETS_PER_EXERCISE.max);
    // El bíceps priorizado gana por frecuencia/volumen semanal, no por series/ej.
    for (const d of p.days) {
      for (const e of d.exercises) {
        if (e.muscleGroup === "BICEPS")
          expect(e.sets).toBeLessThanOrEqual(SETS_PER_EXERCISE.max);
      }
    }
  });
});

describe("F3.2 — densidad de sesión", () => {
  it.each([3, 4, 5, 6])(
    "ninguna sesión supera SESSION_SET_CAP (%i días)",
    (days) => {
      const p = generateInitialProgram(baseInput({ daysPerWeek: days }));
      expect(maxSessionSets(p)).toBeLessThanOrEqual(SESSION_SET_CAP);
    },
  );
});

describe("F3.2 — warnings por volumen EFECTIVO (no directo)", () => {
  it("el glúteo, muy servido por indirecto, NO genera aviso pese a poco directo", () => {
    const p = generateInitialProgram(baseInput({ daysPerWeek: 3 }));
    const glute = vol(p, "GLUTEO");
    // Mucho efectivo (indirecto de sentadillas/RDL/hip thrust), poco/ningún directo.
    expect(glute.fractionalSets).toBeGreaterThan(glute.directSets);
    expect(glute.fractionalSets).toBeGreaterThan(6);
    expect(p.warnings.join(" ")).not.toMatch(/[Gg]l[úu]teo/);
  });

  it("todo aviso habla de series EFECTIVAS, nunca 'solo N directas'", () => {
    for (const days of [2, 3, 4, 5, 6]) {
      const p = generateInitialProgram(
        baseInput({ daysPerWeek: days, minutesPerSession: 60 }),
      );
      for (const w of p.warnings) {
        expect(w).toMatch(/efectivas/);
        expect(w).not.toMatch(/directas/);
      }
    }
  });

  it("los músculos que viven de indirecto (DIRECT_MIN 0) nunca se avisan", () => {
    const p = generateInitialProgram(
      baseInput({ daysPerWeek: 3, minutesPerSession: 45 }),
    );
    for (const g of Object.keys(DIRECT_MIN) as MuscleGroupCode[]) {
      if (DIRECT_MIN[g] === 0) {
        expect(p.warnings.join(" ")).not.toContain(`${g}`.replace(/_/g, " "));
      }
    }
  });
});

describe("F3.2 — el trabajo indirecto participa", () => {
  const p = generateInitialProgram(baseInput());
  it("un músculo con mucho indirecto tiene efectivo > directo", () => {
    for (const g of [
      "DELT_ANTERIOR",
      "TRICEPS",
      "GLUTEO",
    ] as MuscleGroupCode[]) {
      expect(effectiveOf(p, g)).toBeGreaterThan(directOf(p, g));
    }
  });
  it("volumeByGroup expone directo, efectivo, frecuencia y objetivo", () => {
    for (const v of p.volumeByGroup) {
      expect(v.fractionalSets).toBeGreaterThanOrEqual(v.directSets);
      expect(v.targetSets).toBeGreaterThan(0);
    }
  });
});

describe("F3.2 — prioridad controlada", () => {
  it("priorizar un grupo aumenta su objetivo semanal y su volumen/frecuencia", () => {
    const balanced = generateInitialProgram(baseInput({ daysPerWeek: 4 }));
    const prio = generateInitialProgram(
      baseInput({ daysPerWeek: 4, priorityMuscles: ["BICEPS"] }),
    );
    expect(vol(prio, "BICEPS").targetSets).toBeGreaterThan(
      vol(balanced, "BICEPS").targetSets,
    );
    expect(vol(prio, "BICEPS").isPriority).toBe(true);
    // Sube volumen efectivo O frecuencia (según lo que permita el catálogo).
    expect(
      effectiveOf(prio, "BICEPS") > effectiveOf(balanced, "BICEPS") ||
        freqOf(prio, "BICEPS") > freqOf(balanced, "BICEPS"),
    ).toBe(true);
  });

  it("prioriza sin abandonar el resto del cuerpo (efectivo razonable)", () => {
    const p = generateInitialProgram(
      baseInput({ daysPerWeek: 5, priorityMuscles: ["DELT_LATERAL"] }),
    );
    for (const g of ["CUADRICEPS", "ISQUIOS", "DORSAL"] as MuscleGroupCode[]) {
      expect(effectiveOf(p, g)).toBeGreaterThan(4);
    }
  });

  it("soporta prioridad múltiple sin inflar series por ejercicio", () => {
    const p = generateInitialProgram(
      baseInput({
        daysPerWeek: 5,
        priorityMuscles: ["DELT_LATERAL", "BICEPS", "DORSAL"],
      }),
    );
    expect(maxSetsPerExercise(p)).toBeLessThanOrEqual(SETS_PER_EXERCISE.max);
  });
});

describe("F3.2 — escalado por días", () => {
  it("más días NO multiplican absurdamente el volumen semanal", () => {
    const d3 = totalSets(generateInitialProgram(baseInput({ daysPerWeek: 3 })));
    const d6 = totalSets(generateInitialProgram(baseInput({ daysPerWeek: 6 })));
    expect(d6).toBeGreaterThanOrEqual(d3); // más días permiten algo más
    expect(d6).toBeLessThanOrEqual(d3 * 1.75); // pero no se dispara
  });

  it("más días reducen (o mantienen) la densidad por sesión", () => {
    const d3 = maxSessionSets(
      generateInitialProgram(baseInput({ daysPerWeek: 3 })),
    );
    const d6 = maxSessionSets(
      generateInitialProgram(baseInput({ daysPerWeek: 6 })),
    );
    expect(d6).toBeLessThanOrEqual(d3);
  });

  it("frecuencia ≥2 para músculos grandes cuando la división lo permite (4–5 días)", () => {
    for (const days of [4, 5]) {
      const p = generateInitialProgram(baseInput({ daysPerWeek: days }));
      for (const g of ["CUADRICEPS", "DORSAL"] as MuscleGroupCode[]) {
        expect(freqOf(p, g)).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("F3.2 — experiencia calibra el punto inicial", () => {
  it("experienceFromYears mapea correctamente", () => {
    expect(experienceFromYears(0)).toBe("beginner");
    expect(experienceFromYears(1)).toBe("beginner");
    expect(experienceFromYears(3)).toBe("intermediate");
    expect(experienceFromYears(5)).toBe("advanced");
    expect(experienceFromYears(10)).toBe("advanced");
  });

  it("el principiante arranca con objetivo menor que el avanzado", () => {
    const beginner = generateInitialProgram(
      baseInput({ experienceLevel: "beginner" }),
    );
    const advanced = generateInitialProgram(
      baseInput({ experienceLevel: "advanced" }),
    );
    const targetTotal = (p: GeneratedProgram) =>
      p.volumeByGroup.reduce((s, v) => s + v.targetSets, 0);
    expect(targetTotal(beginner)).toBeLessThan(targetTotal(advanced));
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
    expect(totalSets(short)).toBeLessThan(totalSets(long));
    for (const d of short.days) {
      expect(d.estimatedMinutes).toBeLessThanOrEqual(45);
    }
  });

  it("no repite dos ejercicios idénticos (mismo grupo+ejercicio) el mismo día", () => {
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
    const total = (p: GeneratedProgram) =>
      p.volumeByGroup.reduce((s, v) => s + v.targetSets, 0);
    expect(total(cut)).toBeLessThan(total(recomp));
  });

  it("expone ruleId y versión para la AlgorithmDecision", () => {
    const program = generateInitialProgram(baseInput());
    expect(program.ruleId).toBe("program.initial.ppl_ul_5");
    expect(program.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
