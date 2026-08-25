import type {
  Contraindication,
  Equipment,
  MovementPattern,
  MuscleGroupCode,
  MuscleRole,
} from "@/core/enums";

/**
 * Catálogo seed de ejercicios (~45 ejercicios, ~60 variantes).
 * Los factores de contribución muscular son APROXIMACIONES OPERATIVAS para
 * contar volumen fraccional — no hechos científicos (docs/DATA_MODEL.md).
 * El historial y la progresión viven a nivel de VARIANTE.
 *
 * Factores (cubos; evita falsa precisión): PRIMARY = 1.0 (músculo objetivo);
 * SECONDARY ∈ {0.75 alto · 0.5 moderado · 0.25 ligero}. El volumen EFECTIVO de un
 * músculo = Σ(series × factor) (directo + indirecto), respaldado por Pelland 2026.
 */

export interface ContributionSeed {
  group: MuscleGroupCode;
  role: MuscleRole;
  factor: number; // 0..1
}

export interface VariantSeed {
  name: string;
  equipment: Equipment;
  loadStepKg: number;
  repRangeMin: number;
  repRangeMax: number;
  defaultRestSeconds: number;
  contraindications: Contraindication[];
  isDefault?: boolean;
}

export interface ExerciseSeed {
  name: string;
  movementPattern: MovementPattern;
  systemicFatigue: 1 | 2 | 3;
  instructions: string;
  contributions: ContributionSeed[];
  variants: VariantSeed[];
}

const c = (
  group: MuscleGroupCode,
  role: MuscleRole,
  factor: number,
): ContributionSeed => ({
  group,
  role,
  factor,
});

export const EXERCISES: ExerciseSeed[] = [
  // ============ PECHO SUPERIOR ============
  {
    name: "Press inclinado",
    movementPattern: "HORIZONTAL_PUSH",
    systemicFatigue: 2,
    instructions:
      "Banco a 30°. Baja la barra/mancuernas al pecho alto con control y empuja sin rebotar.",
    contributions: [
      c("PECHO_SUPERIOR", "PRIMARY", 1.0),
      c("PECHO_MEDIO_INFERIOR", "SECONDARY", 0.5),
      c("DELT_ANTERIOR", "SECONDARY", 0.5),
      c("TRICEPS", "SECONDARY", 0.5),
    ],
    variants: [
      {
        name: "Barra",
        equipment: "BARBELL",
        loadStepKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 10,
        defaultRestSeconds: 180,
        contraindications: ["SHOULDER"],
        isDefault: true,
      },
      {
        name: "Mancuernas",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 150,
        contraindications: ["SHOULDER"],
      },
      {
        name: "Multipower",
        equipment: "SMITH_MACHINE",
        loadStepKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 10,
        defaultRestSeconds: 150,
        contraindications: ["SHOULDER"],
      },
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 120,
        contraindications: [],
      },
    ],
  },
  {
    name: "Cruce de poleas bajo a alto",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Poleas bajas, trayectoria ascendente hacia el pecho alto. Aprieta arriba 1 s.",
    contributions: [
      c("PECHO_SUPERIOR", "PRIMARY", 1.0),
      c("DELT_ANTERIOR", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Polea",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 75,
        contraindications: [],
        isDefault: true,
      },
    ],
  },

  // ============ PECHO MEDIO/INFERIOR ============
  {
    name: "Press banca",
    movementPattern: "HORIZONTAL_PUSH",
    systemicFatigue: 2,
    instructions:
      "Escápulas retraídas, pies firmes. Baja al pecho medio y empuja recto.",
    contributions: [
      c("PECHO_MEDIO_INFERIOR", "PRIMARY", 1.0),
      c("PECHO_SUPERIOR", "SECONDARY", 0.5),
      c("TRICEPS", "SECONDARY", 0.5),
      c("DELT_ANTERIOR", "SECONDARY", 0.25), // press plano: estímulo ligero del delt. anterior
    ],
    variants: [
      {
        name: "Barra",
        equipment: "BARBELL",
        loadStepKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 10,
        defaultRestSeconds: 180,
        contraindications: ["SHOULDER"],
        isDefault: true,
      },
      {
        name: "Mancuernas",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 150,
        contraindications: ["SHOULDER"],
      },
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 120,
        contraindications: [],
      },
    ],
  },
  {
    name: "Aperturas",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Codos semiflexionados fijos. Abre hasta estirar el pecho sin dolor y cierra.",
    contributions: [
      c("PECHO_MEDIO_INFERIOR", "PRIMARY", 1.0),
      c("PECHO_SUPERIOR", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Polea (contractora)",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 75,
        contraindications: ["SHOULDER"],
        isDefault: true,
      },
      {
        name: "Máquina (pec deck)",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 90,
        contraindications: ["SHOULDER"],
      },
      {
        name: "Mancuernas",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 90,
        contraindications: ["SHOULDER"],
      },
    ],
  },
  {
    name: "Fondos en paralelas",
    movementPattern: "HORIZONTAL_PUSH",
    systemicFatigue: 2,
    instructions:
      "Torso ligeramente inclinado. Baja hasta estirar el pecho; sube sin bloquear con rebote.",
    contributions: [
      c("PECHO_MEDIO_INFERIOR", "PRIMARY", 1.0),
      c("TRICEPS", "SECONDARY", 0.75),
      c("DELT_ANTERIOR", "SECONDARY", 0.5),
    ],
    variants: [
      {
        name: "Peso corporal / lastre",
        equipment: "BODYWEIGHT",
        loadStepKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 12,
        defaultRestSeconds: 150,
        contraindications: ["SHOULDER", "ELBOW"],
        isDefault: true,
      },
    ],
  },

  // ============ DELTOIDE ANTERIOR ============
  {
    name: "Press militar",
    movementPattern: "VERTICAL_PUSH",
    systemicFatigue: 2,
    instructions:
      "De pie o sentado, core firme. Empuja vertical sin arquear la lumbar.",
    contributions: [
      c("DELT_ANTERIOR", "PRIMARY", 1.0),
      c("DELT_LATERAL", "SECONDARY", 0.5),
      c("TRICEPS", "SECONDARY", 0.5),
      c("PECHO_SUPERIOR", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Barra",
        equipment: "BARBELL",
        loadStepKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 10,
        defaultRestSeconds: 180,
        contraindications: ["SHOULDER", "LOWER_BACK"],
        isDefault: true,
      },
      {
        name: "Mancuernas sentado",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 150,
        contraindications: ["SHOULDER"],
      },
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 120,
        contraindications: [],
      },
    ],
  },

  // ============ DELTOIDE LATERAL ============
  {
    name: "Elevación lateral",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Sube hasta la horizontal guiando con los codos; baja con control, sin balanceo.",
    contributions: [c("DELT_LATERAL", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Mancuernas",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 90,
        contraindications: [],
        isDefault: true,
      },
      {
        name: "Polea unilateral",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 75,
        contraindications: [],
      },
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 75,
        contraindications: [],
      },
    ],
  },
  {
    // Segundo patrón para deltoide lateral (además de la elevación), para dar
    // variedad y no depender de un único ejercicio.
    name: "Remo al mentón con agarre ancho",
    movementPattern: "VERTICAL_PULL",
    systemicFatigue: 1,
    instructions:
      "Agarre ancho; sube los codos hacia los lados hasta la altura de los hombros, sin encoger el cuello.",
    contributions: [
      c("DELT_LATERAL", "PRIMARY", 1.0),
      c("TRAPECIO_SUPERIOR", "SECONDARY", 0.5),
    ],
    variants: [
      {
        name: "Polea",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 75,
        contraindications: ["SHOULDER"],
        isDefault: true,
      },
      {
        name: "Mancuernas",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 75,
        contraindications: ["SHOULDER"],
      },
    ],
  },

  // ============ DELTOIDE POSTERIOR ============
  {
    name: "Face pull",
    movementPattern: "HORIZONTAL_PULL",
    systemicFatigue: 1,
    instructions:
      "Polea a la cara con cuerda, codos altos, rota externo al final. Ligero y limpio.",
    contributions: [
      c("DELT_POSTERIOR", "PRIMARY", 1.0),
      c("ESPALDA_ALTA", "SECONDARY", 0.5),
      c("TRAPECIO_SUPERIOR", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Polea (cuerda)",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 75,
        contraindications: [],
        isDefault: true,
      },
      {
        name: "Banda",
        equipment: "BAND",
        loadStepKg: 0,
        repRangeMin: 15,
        repRangeMax: 25,
        defaultRestSeconds: 60,
        contraindications: [],
      },
    ],
  },
  {
    name: "Aperturas invertidas",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Inclinado o en máquina, abre hacia atrás con codos semiflexionados fijos.",
    contributions: [
      c("DELT_POSTERIOR", "PRIMARY", 1.0),
      c("ESPALDA_ALTA", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Máquina (pec deck inverso)",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 75,
        contraindications: [],
        isDefault: true,
      },
      {
        name: "Mancuernas inclinado",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 75,
        contraindications: ["LOWER_BACK"],
      },
      {
        name: "Polea cruzada",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 75,
        contraindications: [],
      },
    ],
  },

  // ============ DORSAL ============
  {
    name: "Dominadas",
    movementPattern: "VERTICAL_PULL",
    systemicFatigue: 2,
    instructions:
      "Agarre algo mayor que hombros. Sube el pecho a la barra; baja hasta estirar.",
    contributions: [
      c("DORSAL", "PRIMARY", 1.0),
      c("BICEPS", "SECONDARY", 0.5),
      c("ESPALDA_ALTA", "SECONDARY", 0.25),
      c("DELT_POSTERIOR", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Peso corporal / lastre",
        equipment: "BODYWEIGHT",
        loadStepKg: 2.5,
        repRangeMin: 5,
        repRangeMax: 10,
        defaultRestSeconds: 180,
        contraindications: ["SHOULDER", "ELBOW"],
        isDefault: true,
      },
    ],
  },
  {
    name: "Jalón al pecho",
    movementPattern: "VERTICAL_PULL",
    systemicFatigue: 2,
    instructions:
      "Lleva la barra a la clavícula con el torso casi vertical. Estira del todo arriba.",
    contributions: [
      c("DORSAL", "PRIMARY", 1.0),
      c("BICEPS", "SECONDARY", 0.5),
      c("ESPALDA_ALTA", "SECONDARY", 0.25),
      c("DELT_POSTERIOR", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Polea agarre medio",
        equipment: "CABLE",
        loadStepKg: 5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 120,
        contraindications: [],
        isDefault: true,
      },
      {
        name: "Polea agarre estrecho supino",
        equipment: "CABLE",
        loadStepKg: 5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 120,
        contraindications: ["ELBOW"],
      },
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 120,
        contraindications: [],
      },
    ],
  },
  {
    name: "Jalón unilateral en polea",
    movementPattern: "VERTICAL_PULL",
    systemicFatigue: 1,
    instructions:
      "De rodillas o sentado, tira del maneral hacia la cadera sintiendo el dorsal.",
    contributions: [c("DORSAL", "PRIMARY", 1.0), c("BICEPS", "SECONDARY", 0.5)],
    variants: [
      {
        name: "Polea",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 90,
        contraindications: [],
        isDefault: true,
      },
    ],
  },
  {
    name: "Pullover en polea",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Brazos casi rectos, lleva la barra de la altura de la cara al muslo arqueando solo el hombro.",
    contributions: [
      c("DORSAL", "PRIMARY", 1.0),
      c("PECHO_MEDIO_INFERIOR", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Polea alta",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 75,
        contraindications: ["SHOULDER"],
        isDefault: true,
      },
    ],
  },

  // ============ ESPALDA ALTA ============
  {
    name: "Remo con apoyo pectoral",
    movementPattern: "HORIZONTAL_PULL",
    systemicFatigue: 2,
    instructions:
      "Pecho apoyado. Tira con los codos hacia atrás y junta escápulas al final.",
    contributions: [
      c("ESPALDA_ALTA", "PRIMARY", 1.0),
      c("DORSAL", "SECONDARY", 0.5),
      c("BICEPS", "SECONDARY", 0.5),
      c("DELT_POSTERIOR", "SECONDARY", 0.5),
    ],
    variants: [
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 120,
        contraindications: [],
        isDefault: true,
      },
      {
        name: "Mancuernas en banco inclinado",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 120,
        contraindications: [],
      },
    ],
  },
  {
    name: "Remo con barra",
    movementPattern: "HORIZONTAL_PULL",
    systemicFatigue: 3,
    instructions:
      "Bisagra de cadera ~45°, espalda neutra. Tira al abdomen bajo sin impulso lumbar.",
    contributions: [
      c("ESPALDA_ALTA", "PRIMARY", 1.0),
      c("DORSAL", "SECONDARY", 0.5),
      c("BICEPS", "SECONDARY", 0.5),
      c("ISQUIOS", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Barra",
        equipment: "BARBELL",
        loadStepKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 10,
        defaultRestSeconds: 150,
        contraindications: ["LOWER_BACK"],
        isDefault: true,
      },
    ],
  },
  {
    name: "Remo sentado en polea",
    movementPattern: "HORIZONTAL_PULL",
    systemicFatigue: 2,
    instructions:
      "Agarre neutro. Tira al abdomen con el torso estable; estira controlado.",
    contributions: [
      c("ESPALDA_ALTA", "PRIMARY", 1.0),
      c("DORSAL", "SECONDARY", 0.5),
      c("BICEPS", "SECONDARY", 0.5),
      c("DELT_POSTERIOR", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Polea agarre estrecho",
        equipment: "CABLE",
        loadStepKg: 5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 120,
        contraindications: [],
        isDefault: true,
      },
    ],
  },
  {
    name: "Remo con mancuerna",
    movementPattern: "HORIZONTAL_PULL",
    systemicFatigue: 2,
    instructions:
      "Rodilla y mano en banco. Tira de la mancuerna a la cadera sin rotar el torso.",
    contributions: [
      c("ESPALDA_ALTA", "PRIMARY", 1.0),
      c("DORSAL", "SECONDARY", 0.5),
      c("BICEPS", "SECONDARY", 0.5),
    ],
    variants: [
      {
        name: "Mancuerna",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 120,
        contraindications: [],
        isDefault: true,
      },
    ],
  },

  // ============ TRAPECIO SUPERIOR ============
  {
    name: "Encogimientos",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Sube los hombros hacia las orejas, pausa 1 s arriba, baja lento.",
    contributions: [c("TRAPECIO_SUPERIOR", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Mancuernas",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: [],
        isDefault: true,
      },
      {
        name: "Barra",
        equipment: "BARBELL",
        loadStepKg: 2.5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 90,
        contraindications: ["LOWER_BACK"],
      },
    ],
  },

  // ============ BÍCEPS ============
  {
    name: "Curl con barra",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions: "Codos pegados al torso. Sube sin balanceo; baja en 2 s.",
    contributions: [
      c("BICEPS", "PRIMARY", 1.0),
      c("ANTEBRAZO", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Barra EZ",
        equipment: "EZ_BAR",
        loadStepKg: 2.5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 90,
        contraindications: ["WRIST"],
        isDefault: true,
      },
      {
        name: "Barra recta",
        equipment: "BARBELL",
        loadStepKg: 2.5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 90,
        contraindications: ["WRIST", "ELBOW"],
      },
    ],
  },
  {
    name: "Curl inclinado con mancuernas",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Banco a 55–60°, brazos colgando. Estiramiento completo abajo, sin abrir codos.",
    contributions: [c("BICEPS", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Mancuernas",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 90,
        contraindications: ["SHOULDER"],
        isDefault: true,
      },
    ],
  },
  {
    name: "Curl bayesian en polea",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "De espaldas a la polea baja, brazo atrás. Curl con máximo estiramiento.",
    contributions: [c("BICEPS", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Polea",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: [],
        isDefault: true,
      },
    ],
  },
  {
    name: "Curl martillo",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Agarre neutro. Sube sin girar la muñeca; trabaja braquial y antebrazo.",
    contributions: [
      c("BICEPS", "PRIMARY", 1.0),
      c("ANTEBRAZO", "SECONDARY", 0.5),
    ],
    variants: [
      {
        name: "Mancuernas",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: [],
        isDefault: true,
      },
      {
        name: "Polea con cuerda",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: [],
      },
    ],
  },
  {
    name: "Curl en máquina predicador",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Brazos apoyados. Extiende casi del todo abajo; no rebotes en el estiramiento.",
    contributions: [c("BICEPS", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: ["ELBOW"],
        isDefault: true,
      },
    ],
  },

  // ============ TRÍCEPS ============
  {
    name: "Extensión de tríceps en polea",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Codos fijos al torso. Extiende del todo y controla la vuelta.",
    contributions: [c("TRICEPS", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Polea con cuerda",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: [],
        isDefault: true,
      },
      {
        name: "Polea con barra",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: ["WRIST"],
      },
    ],
  },
  {
    name: "Extensión de tríceps sobre la cabeza",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Polea baja de espaldas. Extiende sobre la cabeza buscando el estiramiento de la cabeza larga.",
    contributions: [c("TRICEPS", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Polea con cuerda",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: ["SHOULDER", "ELBOW"],
        isDefault: true,
      },
      {
        name: "Mancuerna a dos manos",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 90,
        contraindications: ["SHOULDER", "ELBOW"],
      },
    ],
  },
  {
    name: "Press francés",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Tumbado, baja la EZ a la frente con codos fijos; extiende sin abrirlos.",
    contributions: [c("TRICEPS", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Barra EZ",
        equipment: "EZ_BAR",
        loadStepKg: 2.5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 90,
        contraindications: ["ELBOW"],
        isDefault: true,
      },
    ],
  },
  {
    name: "Press cerrado",
    movementPattern: "HORIZONTAL_PUSH",
    systemicFatigue: 2,
    instructions:
      "Agarre a la anchura de hombros. Codos pegados; empuja concentrado en tríceps.",
    contributions: [
      c("TRICEPS", "PRIMARY", 1.0),
      c("PECHO_MEDIO_INFERIOR", "SECONDARY", 0.5),
      c("DELT_ANTERIOR", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Barra",
        equipment: "BARBELL",
        loadStepKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 10,
        defaultRestSeconds: 150,
        contraindications: ["WRIST", "SHOULDER"],
        isDefault: true,
      },
      {
        name: "Multipower",
        equipment: "SMITH_MACHINE",
        loadStepKg: 2.5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 120,
        contraindications: ["WRIST"],
      },
    ],
  },

  // ============ ANTEBRAZO ============
  {
    name: "Curl inverso",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions: "Agarre prono. Sube sin balanceo; el antebrazo manda.",
    contributions: [
      c("ANTEBRAZO", "PRIMARY", 1.0),
      c("BICEPS", "SECONDARY", 0.5),
    ],
    variants: [
      {
        name: "Barra EZ",
        equipment: "EZ_BAR",
        loadStepKg: 2.5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: ["WRIST"],
        isDefault: true,
      },
    ],
  },

  // ============ CUÁDRICEPS ============
  {
    name: "Sentadilla trasera",
    movementPattern: "SQUAT",
    systemicFatigue: 3,
    instructions:
      "Barra alta, profundidad según movilidad. Rodillas en línea con los pies.",
    contributions: [
      c("CUADRICEPS", "PRIMARY", 1.0),
      c("GLUTEO", "SECONDARY", 0.75),
      c("CORE", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Barra",
        equipment: "BARBELL",
        loadStepKg: 2.5,
        repRangeMin: 5,
        repRangeMax: 8,
        defaultRestSeconds: 180,
        contraindications: ["KNEE", "LOWER_BACK", "HIP"],
        isDefault: true,
      },
      {
        name: "Multipower",
        equipment: "SMITH_MACHINE",
        loadStepKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 10,
        defaultRestSeconds: 180,
        contraindications: ["KNEE", "LOWER_BACK"],
      },
    ],
  },
  {
    name: "Prensa de piernas",
    movementPattern: "SQUAT",
    systemicFatigue: 2,
    instructions:
      "Pies a la anchura de cadera. Baja profundo sin despegar la lumbar del respaldo.",
    contributions: [
      c("CUADRICEPS", "PRIMARY", 1.0),
      c("GLUTEO", "SECONDARY", 0.5),
    ],
    variants: [
      {
        name: "Prensa 45°",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 150,
        contraindications: ["KNEE"],
        isDefault: true,
      },
      {
        // Recorrido parcial con pies altos: opción de cuádriceps más amable
        // con la rodilla (menos flexión profunda).
        name: "Prensa recorrido parcial (amable con rodilla)",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 120,
        contraindications: [],
      },
    ],
  },
  {
    name: "Extensión de cuádriceps",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions: "Extiende del todo con pausa arriba; baja en 2 s.",
    contributions: [c("CUADRICEPS", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 12,
        repRangeMax: 20,
        defaultRestSeconds: 90,
        contraindications: ["KNEE"],
        isDefault: true,
      },
    ],
  },
  {
    name: "Zancada búlgara",
    movementPattern: "LUNGE",
    systemicFatigue: 2,
    instructions:
      "Pie trasero elevado. Baja vertical; empuja con el talón delantero.",
    contributions: [
      c("CUADRICEPS", "PRIMARY", 1.0),
      c("GLUTEO", "SECONDARY", 0.75),
    ],
    variants: [
      {
        name: "Mancuernas",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 120,
        contraindications: ["KNEE", "HIP"],
        isDefault: true,
      },
      {
        name: "Peso corporal",
        equipment: "BODYWEIGHT",
        loadStepKg: 2.5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 90,
        contraindications: ["KNEE"],
      },
    ],
  },
  {
    name: "Sentadilla hack",
    movementPattern: "SQUAT",
    systemicFatigue: 2,
    instructions:
      "Espalda pegada al respaldo. Baja profundo con las rodillas siguiendo los pies.",
    contributions: [
      c("CUADRICEPS", "PRIMARY", 1.0),
      c("GLUTEO", "SECONDARY", 0.5),
    ],
    variants: [
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 150,
        contraindications: ["KNEE"],
        isDefault: true,
      },
    ],
  },

  // ============ ISQUIOS ============
  {
    name: "Peso muerto rumano",
    movementPattern: "HINGE",
    systemicFatigue: 3,
    instructions:
      "Bisagra de cadera, espalda neutra. Baja hasta estirar isquios; sube apretando glúteo.",
    contributions: [
      c("ISQUIOS", "PRIMARY", 1.0),
      c("GLUTEO", "SECONDARY", 0.75),
      c("CORE", "SECONDARY", 0.5),
      c("TRAPECIO_SUPERIOR", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Barra",
        equipment: "BARBELL",
        loadStepKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 10,
        defaultRestSeconds: 180,
        contraindications: ["LOWER_BACK", "HIP"],
        isDefault: true,
      },
      {
        name: "Mancuernas",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 150,
        contraindications: ["LOWER_BACK"],
      },
    ],
  },
  {
    name: "Curl femoral tumbado",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions: "Cadera pegada al banco. Flexiona completo y baja lento.",
    contributions: [c("ISQUIOS", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 90,
        contraindications: ["KNEE"],
        isDefault: true,
      },
    ],
  },
  {
    name: "Curl femoral sentado",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Mayor estiramiento que tumbado. Flexiona completo con pausa.",
    contributions: [c("ISQUIOS", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 90,
        contraindications: ["KNEE"],
        isDefault: true,
      },
    ],
  },

  // ============ GLÚTEO ============
  {
    name: "Hip thrust",
    movementPattern: "HINGE",
    systemicFatigue: 2,
    instructions:
      "Espalda alta apoyada en banco. Extiende cadera y aprieta arriba 1 s sin hiperextender.",
    contributions: [
      c("GLUTEO", "PRIMARY", 1.0),
      c("ISQUIOS", "SECONDARY", 0.5),
    ],
    variants: [
      {
        name: "Barra",
        equipment: "BARBELL",
        loadStepKg: 2.5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 150,
        contraindications: ["HIP", "LOWER_BACK"],
        isDefault: true,
      },
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 120,
        contraindications: ["HIP"],
      },
    ],
  },

  // ============ GEMELO ============
  {
    name: "Elevación de talones de pie",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions: "Estira abajo 1 s, sube completo con pausa. Rodillas rectas.",
    contributions: [c("GEMELO", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 90,
        contraindications: ["ANKLE"],
        isDefault: true,
      },
      {
        name: "Multipower",
        equipment: "SMITH_MACHINE",
        loadStepKg: 2.5,
        repRangeMin: 8,
        repRangeMax: 12,
        defaultRestSeconds: 90,
        contraindications: ["ANKLE"],
      },
    ],
  },
  {
    name: "Elevación de talones sentado",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions: "Rodilla a 90°: trabaja el sóleo. Rango completo con pausas.",
    // El gemelo sentado carga poco la articulación del tobillo: opción amable
    // para quien declara molestias de tobillo (evita quedarse sin gemelo).
    contributions: [c("GEMELO", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Máquina",
        equipment: "MACHINE",
        loadStepKg: 5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: [],
        isDefault: true,
      },
    ],
  },

  // ============ CORE ============
  {
    name: "Crunch en polea",
    movementPattern: "CORE",
    systemicFatigue: 1,
    instructions:
      "De rodillas, flexiona el tronco llevando codos a muslos. El abdomen tira, no los brazos.",
    contributions: [c("CORE", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Polea con cuerda",
        equipment: "CABLE",
        loadStepKg: 2.5,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: ["LOWER_BACK"],
        isDefault: true,
      },
    ],
  },
  {
    name: "Plancha",
    movementPattern: "CORE",
    systemicFatigue: 1,
    instructions:
      "Cuerpo en línea, glúteo apretado. Progresa en tiempo o con lastre.",
    contributions: [c("CORE", "PRIMARY", 1.0)],
    variants: [
      {
        name: "Peso corporal",
        equipment: "BODYWEIGHT",
        loadStepKg: 2.5,
        repRangeMin: 1,
        repRangeMax: 1,
        defaultRestSeconds: 60,
        contraindications: ["LOWER_BACK"],
        isDefault: true,
      },
    ],
  },
  {
    name: "Elevación de piernas colgado",
    movementPattern: "CORE",
    systemicFatigue: 1,
    instructions:
      "Colgado de barra, sube las piernas con pelvis en retroversión, sin balanceo.",
    contributions: [
      c("CORE", "PRIMARY", 1.0),
      c("ANTEBRAZO", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Peso corporal",
        equipment: "BODYWEIGHT",
        loadStepKg: 0,
        repRangeMin: 8,
        repRangeMax: 15,
        defaultRestSeconds: 90,
        contraindications: ["SHOULDER", "LOWER_BACK"],
        isDefault: true,
      },
    ],
  },
];
