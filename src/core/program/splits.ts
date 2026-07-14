import type { SplitDay } from "@/core/program/types";

/**
 * Divisiones por días disponibles (docs/TRAINING_ENGINE.md §1).
 * Sesgo moderado hacia Tier A (delt lateral/posterior, dorsal, pecho superior)
 * sin abandonar piernas. Las series son el punto de partida conservador;
 * los motores de F3 las ajustarán con datos.
 */

const FULL_BODY_A: SplitDay = {
  name: "Full Body A",
  slots: [
    { group: "CUADRICEPS", kind: "COMPOUND", sets: 3 },
    { group: "PECHO_SUPERIOR", kind: "COMPOUND", sets: 3 },
    { group: "DORSAL", kind: "COMPOUND", sets: 3 },
    { group: "DELT_LATERAL", kind: "ISOLATION", sets: 3 },
    { group: "TRICEPS", kind: "ISOLATION", sets: 2 },
  ],
};

const FULL_BODY_B: SplitDay = {
  name: "Full Body B",
  slots: [
    { group: "ISQUIOS", kind: "COMPOUND", sets: 3 },
    { group: "ESPALDA_ALTA", kind: "COMPOUND", sets: 3 },
    { group: "PECHO_MEDIO_INFERIOR", kind: "COMPOUND", sets: 2 },
    { group: "DELT_POSTERIOR", kind: "ISOLATION", sets: 3 },
    { group: "BICEPS", kind: "ISOLATION", sets: 2 },
    { group: "GEMELO", kind: "ISOLATION", sets: 2 },
  ],
};

const FULL_BODY_C: SplitDay = {
  name: "Full Body C",
  slots: [
    { group: "CUADRICEPS", kind: "COMPOUND", sets: 2 },
    { group: "DORSAL", kind: "COMPOUND", sets: 3 },
    { group: "DELT_ANTERIOR", kind: "COMPOUND", sets: 2 },
    { group: "DELT_LATERAL", kind: "ISOLATION", sets: 3 },
    { group: "DELT_POSTERIOR", kind: "ISOLATION", sets: 2 },
    { group: "CORE", kind: "ISOLATION", sets: 2 },
  ],
};

const TORSO_A: SplitDay = {
  name: "Torso A",
  slots: [
    { group: "DORSAL", kind: "COMPOUND", sets: 3 },
    { group: "ESPALDA_ALTA", kind: "COMPOUND", sets: 3 },
    { group: "PECHO_SUPERIOR", kind: "COMPOUND", sets: 3 },
    { group: "DELT_POSTERIOR", kind: "ISOLATION", sets: 3 },
    { group: "DELT_LATERAL", kind: "ISOLATION", sets: 3 },
    { group: "BICEPS", kind: "ISOLATION", sets: 2 },
  ],
};

const PIERNA_A: SplitDay = {
  name: "Pierna A",
  slots: [
    { group: "CUADRICEPS", kind: "COMPOUND", sets: 3 },
    { group: "CUADRICEPS", kind: "COMPOUND", sets: 2 },
    { group: "ISQUIOS", kind: "ISOLATION", sets: 3 },
    { group: "GEMELO", kind: "ISOLATION", sets: 3 },
    { group: "DELT_LATERAL", kind: "ISOLATION", sets: 3 },
  ],
};

const TORSO_B: SplitDay = {
  name: "Torso B",
  slots: [
    { group: "PECHO_SUPERIOR", kind: "COMPOUND", sets: 3 },
    { group: "DORSAL", kind: "COMPOUND", sets: 3 },
    { group: "DELT_ANTERIOR", kind: "COMPOUND", sets: 2 },
    { group: "DELT_LATERAL", kind: "ISOLATION", sets: 3 },
    { group: "TRICEPS", kind: "ISOLATION", sets: 3 },
    { group: "BICEPS", kind: "ISOLATION", sets: 2 },
  ],
};

const PIERNA_B: SplitDay = {
  name: "Pierna B",
  slots: [
    { group: "ISQUIOS", kind: "COMPOUND", sets: 3 },
    { group: "CUADRICEPS", kind: "COMPOUND", sets: 2 },
    { group: "CUADRICEPS", kind: "ISOLATION", sets: 2 },
    { group: "GEMELO", kind: "ISOLATION", sets: 3 },
    { group: "DELT_POSTERIOR", kind: "ISOLATION", sets: 3 },
  ],
};

/** 5.º día de especialización hombro/espalda (docs/TRAINING_ENGINE.md §1.6). */
const ESPECIALIZACION: SplitDay = {
  name: "Hombro y espalda",
  slots: [
    { group: "DORSAL", kind: "COMPOUND", sets: 3 },
    { group: "ESPALDA_ALTA", kind: "COMPOUND", sets: 2 },
    { group: "DELT_LATERAL", kind: "ISOLATION", sets: 4 },
    { group: "DELT_POSTERIOR", kind: "ISOLATION", sets: 4 },
    { group: "CORE", kind: "ISOLATION", sets: 2 },
  ],
};

const PUSH_A: SplitDay = {
  name: "Empuje A",
  slots: [
    { group: "PECHO_SUPERIOR", kind: "COMPOUND", sets: 3 },
    { group: "DELT_ANTERIOR", kind: "COMPOUND", sets: 2 },
    { group: "DELT_LATERAL", kind: "ISOLATION", sets: 4 },
    { group: "TRICEPS", kind: "ISOLATION", sets: 3 },
  ],
};

const PULL_A: SplitDay = {
  name: "Tirón A",
  slots: [
    { group: "DORSAL", kind: "COMPOUND", sets: 3 },
    { group: "ESPALDA_ALTA", kind: "COMPOUND", sets: 3 },
    { group: "DELT_POSTERIOR", kind: "ISOLATION", sets: 3 },
    { group: "BICEPS", kind: "ISOLATION", sets: 3 },
  ],
};

const LEGS_A: SplitDay = {
  name: "Pierna A",
  slots: [
    { group: "CUADRICEPS", kind: "COMPOUND", sets: 3 },
    { group: "CUADRICEPS", kind: "COMPOUND", sets: 2 },
    { group: "ISQUIOS", kind: "ISOLATION", sets: 3 },
    { group: "GEMELO", kind: "ISOLATION", sets: 3 },
  ],
};

const PUSH_B: SplitDay = {
  name: "Empuje B",
  slots: [
    { group: "PECHO_MEDIO_INFERIOR", kind: "COMPOUND", sets: 3 },
    { group: "PECHO_SUPERIOR", kind: "ISOLATION", sets: 2 },
    { group: "DELT_LATERAL", kind: "ISOLATION", sets: 4 },
    { group: "TRICEPS", kind: "ISOLATION", sets: 2 },
  ],
};

const PULL_B: SplitDay = {
  name: "Tirón B",
  slots: [
    { group: "DORSAL", kind: "COMPOUND", sets: 3 },
    { group: "ESPALDA_ALTA", kind: "COMPOUND", sets: 2 },
    { group: "DELT_POSTERIOR", kind: "ISOLATION", sets: 4 },
    { group: "BICEPS", kind: "ISOLATION", sets: 2 },
  ],
};

const LEGS_B: SplitDay = {
  name: "Pierna B",
  slots: [
    { group: "ISQUIOS", kind: "COMPOUND", sets: 3 },
    { group: "GLUTEO", kind: "COMPOUND", sets: 2 },
    { group: "CUADRICEPS", kind: "ISOLATION", sets: 2 },
    { group: "GEMELO", kind: "ISOLATION", sets: 3 },
    { group: "CORE", kind: "ISOLATION", sets: 2 },
  ],
};

export interface SplitDefinition {
  type: string;
  label: string;
  days: SplitDay[];
}

export function splitForDays(daysPerWeek: number): SplitDefinition {
  switch (daysPerWeek) {
    case 2:
      return {
        type: "FULL_BODY_2",
        label: "Full body 2 días",
        days: [FULL_BODY_A, FULL_BODY_B],
      };
    case 3:
      return {
        type: "FULL_BODY_3",
        label: "Full body 3 días",
        days: [FULL_BODY_A, FULL_BODY_B, FULL_BODY_C],
      };
    case 4:
      return {
        type: "TORSO_PIERNA_4",
        label: "Torso/Pierna 4 días",
        days: [TORSO_A, PIERNA_A, TORSO_B, PIERNA_B],
      };
    case 5:
      return {
        type: "TORSO_PIERNA_ESPECIALIZACION_5",
        label: "Torso/Pierna + especialización 5 días",
        days: [TORSO_A, PIERNA_A, TORSO_B, PIERNA_B, ESPECIALIZACION],
      };
    case 6:
      return {
        type: "PPL_X2_6",
        label: "Push/Pull/Legs ×2 6 días",
        days: [PUSH_A, PULL_A, LEGS_A, PUSH_B, PULL_B, LEGS_B],
      };
    default:
      throw new Error(`daysPerWeek fuera de rango (2–6): ${daysPerWeek}`);
  }
}
