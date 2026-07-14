import type { MuscleGroupCode } from "@/core/enums";

/**
 * Divisiones por días disponibles (docs/TRAINING_ENGINE.md §1).
 * Cada día declara QUÉ grupos musculares se pueden trabajar ese día (su "menú"),
 * de forma equilibrada: los días de empuje cubren pecho/deltoides/tríceps, los
 * de tirón cubren espalda/deltoide posterior/bíceps, los de pierna cubren
 * cuádriceps/isquios/glúteo/gemelo. El generador reparte el VOLUMEN sobre estos
 * menús; la división en sí no favorece a ningún grupo — el único sesgo es la
 * prioridad que elige el usuario.
 */

const PUSH: MuscleGroupCode[] = [
  "PECHO_SUPERIOR",
  "PECHO_MEDIO_INFERIOR",
  "DELT_ANTERIOR",
  "DELT_LATERAL",
  "TRICEPS",
];

const PULL: MuscleGroupCode[] = [
  "DORSAL",
  "ESPALDA_ALTA",
  "DELT_POSTERIOR",
  "TRAPECIO_SUPERIOR",
  "BICEPS",
];

const LEGS: MuscleGroupCode[] = [
  "CUADRICEPS",
  "ISQUIOS",
  "GLUTEO",
  "GEMELO",
  "CORE",
];

const UPPER: MuscleGroupCode[] = [...PUSH, ...PULL];
const LOWER: MuscleGroupCode[] = LEGS;
// Full body de 3 días equilibrado: los grupos grandes (cuádriceps, isquios,
// pecho, dorsal, deltoide lateral) aparecen ≥2×; carga repartida ~6 grupos/día.
const FULL_A: MuscleGroupCode[] = [
  "CUADRICEPS",
  "PECHO_MEDIO_INFERIOR",
  "DORSAL",
  "DELT_LATERAL",
  "BICEPS",
  "GEMELO",
];
const FULL_B: MuscleGroupCode[] = [
  "ISQUIOS",
  "GLUTEO",
  "PECHO_SUPERIOR",
  "ESPALDA_ALTA",
  "DELT_POSTERIOR",
  "TRICEPS",
];
const FULL_C: MuscleGroupCode[] = [
  "CUADRICEPS",
  "PECHO_MEDIO_INFERIOR",
  "DORSAL",
  "DELT_LATERAL",
  "ISQUIOS",
  "TRICEPS",
];

export interface SplitDayMenu {
  name: string;
  groups: MuscleGroupCode[];
}

export interface SplitDefinition {
  type: string;
  label: string;
  days: SplitDayMenu[];
}

export function splitForDays(daysPerWeek: number): SplitDefinition {
  switch (daysPerWeek) {
    case 2:
      return {
        type: "FULL_BODY_2",
        label: "Full body 2 días",
        days: [
          { name: "Full body A", groups: [...UPPER, "CUADRICEPS", "ISQUIOS"] },
          {
            name: "Full body B",
            groups: [...UPPER, "ISQUIOS", "GLUTEO", "GEMELO"],
          },
        ],
      };
    case 3:
      return {
        type: "FULL_BODY_3",
        label: "Full body 3 días",
        days: [
          { name: "Full body A", groups: FULL_A },
          { name: "Full body B", groups: FULL_B },
          { name: "Full body C", groups: FULL_C },
        ],
      };
    case 4:
      return {
        type: "UPPER_LOWER_4",
        label: "Torso/Pierna 4 días",
        days: [
          { name: "Torso A", groups: UPPER },
          { name: "Pierna A", groups: LOWER },
          { name: "Torso B", groups: UPPER },
          { name: "Pierna B", groups: LOWER },
        ],
      };
    case 5:
      return {
        type: "PPL_UL_5",
        label: "Push/Pull/Pierna + Torso/Pierna 5 días",
        days: [
          { name: "Empuje", groups: PUSH },
          { name: "Tirón", groups: PULL },
          { name: "Pierna A", groups: LOWER },
          { name: "Torso", groups: UPPER },
          { name: "Pierna B", groups: LOWER },
        ],
      };
    case 6:
      return {
        type: "PPL_X2_6",
        label: "Push/Pull/Legs ×2 6 días",
        days: [
          { name: "Empuje A", groups: PUSH },
          { name: "Tirón A", groups: PULL },
          { name: "Pierna A", groups: LOWER },
          { name: "Empuje B", groups: PUSH },
          { name: "Tirón B", groups: PULL },
          { name: "Pierna B", groups: LOWER },
        ],
      };
    default:
      throw new Error(`daysPerWeek fuera de rango (2–6): ${daysPerWeek}`);
  }
}
