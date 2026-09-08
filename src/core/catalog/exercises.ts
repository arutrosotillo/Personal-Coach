import type {
  Contraindication,
  Equipment,
  ExerciseStability,
  MovementPattern,
  MuscleGroupCode,
  MuscleRole,
} from "@/core/enums";
import { withExtraVariants } from "@/core/catalog/exercise-builders";
import { EXPANSION, EXTRA_VARIANTS } from "@/core/catalog/exercises-expansion";

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
  /**
   * Cuánto sostiene la trayectoria algo que no seas tú. Solo se declara en las
   * EXCEPCIONES: si se omite, la deduce el material
   * (`STABILITY_BY_EQUIPMENT`), que acierta en la inmensa mayoría. Decide el
   * RIR objetivo por defecto junto al rol y la fatiga sistémica.
   */
  stability?: ExerciseStability;
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

/**
 * Los 45 ejercicios originales, TAL CUAL estaban.
 *
 * No se tocan ni un número: sus rangos de repeticiones, pasos de carga y
 * descansos llevan meses en producción y el seed los reescribiría en cada
 * despliegue. Lo nuevo se añade en `exercises-expansion.ts`, y las variantes
 * que le faltaban a uno de estos se declaran allí como `EXTRA_VARIANTS` (solo
 * añaden filas; no modifican las que ya existen).
 *
 * Cinco nombres SÍ cambian, y por eso están renombrados aquí y en una migración
 * de datos: "Pullover en polea" → "Pullover", "Curl en máquina predicador" →
 * "Curl predicador", "Remo sentado en polea" → "Remo sentado", "Jalón
 * unilateral en polea" → "Jalón unilateral" y "Crunch en polea" → "Crunch
 * abdominal". Los cinco llevaban el MATERIAL metido en el nombre del
 * MOVIMIENTO, así que la máquina o la mancuerna del mismo ejercicio no tenían
 * dónde ir salvo creando un duplicado — que es justo el problema que esta
 * ampliación venía a evitar. La migración renombra la fila existente, así que
 * el historial (que cuelga del id) no se entera.
 */
const BASE_EXERCISES: ExerciseSeed[] = [
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
      "Montaje — En máquina, ajusta el asiento para que los agarres queden a la altura media del pecho, no del cuello. Espalda y cabeza apoyadas y pies planos en el suelo.\n" +
      "Ejecución — Empuja hasta casi estirar los brazos, sin bloquear los codos de golpe. Vuelve controlando unos dos segundos, hasta notar que el pecho se estira.\n" +
      "Error típico — Subir los hombros hacia las orejas al empujar. Mantén los omóplatos apoyados y hacia abajo toda la serie.",
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
      "Montaje — Ajusta el rodillo para que apriete los muslos y no te levantes del asiento. Agarre algo más ancho que los hombros. Torso casi vertical, con una inclinación mínima hacia atrás que no cambia durante la serie.\n" +
      "Ejecución — Tira llevando los codos hacia abajo y atrás, hasta la clavícula. Aprieta un segundo y sube dejando que los brazos se estiren del todo, notando cómo tira la espalda arriba.\n" +
      "Error típico — Tirar con los brazos y echarse hacia atrás para ayudarse. Piensa en bajar los codos, no en bajar la barra.",
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
    name: "Jalón unilateral",
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
    name: "Pullover",
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
    name: "Remo sentado",
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
    name: "Curl estricto",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Espalda y glúteos pegados a la pared, codos quietos pegados al torso. Cero balanceo: si necesitas la cadera para subirla, pesa demasiado.",
    contributions: [
      c("BICEPS", "PRIMARY", 1.0),
      c("ANTEBRAZO", "SECONDARY", 0.25),
    ],
    variants: [
      {
        name: "Barra recta",
        equipment: "BARBELL",
        loadStepKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 10,
        defaultRestSeconds: 90,
        contraindications: ["WRIST", "ELBOW"],
        isDefault: true,
      },
      {
        name: "Barra EZ",
        equipment: "EZ_BAR",
        loadStepKg: 2.5,
        repRangeMin: 6,
        repRangeMax: 10,
        defaultRestSeconds: 90,
        contraindications: ["WRIST"],
      },
    ],
  },
  {
    name: "Curl spider",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    instructions:
      "Boca abajo sobre un banco inclinado, brazos colgando en vertical. Cierra del todo arriba sin mover el hombro; baja controlado.",
    contributions: [c("BICEPS", "PRIMARY", 1.0)],
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
      {
        name: "Mancuernas",
        equipment: "DUMBBELL",
        loadStepKg: 2,
        repRangeMin: 10,
        repRangeMax: 15,
        defaultRestSeconds: 75,
        contraindications: [],
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
    name: "Curl predicador",
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
      "Montaje — De pie frente a la polea alta, un paso atrás y el tronco ligeramente inclinado. Codos pegados al costado y fijos ahí toda la serie.\n" +
      "Ejecución — Estira los brazos hacia abajo hasta el final y aprieta un segundo; con cuerda, separa las manos al llegar abajo. Vuelve dejando que el antebrazo suba sin mover el codo.\n" +
      "Error típico — Que los codos se abran o se vayan hacia delante al final. Lo único que se mueve es el antebrazo.",
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
      "Montaje — Espalda y cadera pegadas al respaldo. Pies en la plataforma a la anchura de la cadera; cuanto más altos y separados los pongas, más glúteo y menos cuádriceps.\n" +
      "Ejecución — Baja doblando las rodillas hasta que el muslo se acerque al pecho, o hasta donde la cadera siga pegada al respaldo. Empuja con todo el pie y no bloquees las rodillas arriba.\n" +
      "Error típico — Bajar tanto que la cadera se despegue y la lumbar se redondee. Ese punto es tu tope: baja un dedo menos.",
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
      "Montaje — De pie, pies a la anchura de la cadera, el peso pegado a los muslos. Rodillas un poco flexionadas y FIJAS: no se doblan más durante la serie.\n" +
      "Ejecución — Lleva la cadera hacia atrás, como si empujaras una puerta con el culo, dejando que el peso baje rozando la pierna. Para cuando notes tirar detrás del muslo, normalmente por debajo de la rodilla. Sube extendiendo la cadera y apretando el glúteo.\n" +
      "Error típico — Bajar doblando la espalda en vez de echando la cadera atrás. La espalda va recta todo el rato: el movimiento es de cadera, no de columna.",
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
      "Montaje — Sentada con la espalda apoyada, el rodillo de arriba por encima de las rodillas y el de abajo sobre el tobillo. Ajusta el respaldo para que la rodilla coincida con el eje de giro de la máquina.\n" +
      "Ejecución — Dobla las rodillas hasta el final del recorrido y aprieta un segundo. Vuelve despacio dejando que la pierna se estire del todo.\n" +
      "Error típico — Levantar la cadera del asiento para llegar más lejos. Si te pasa, baja peso.",
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
      "Montaje — Espalda alta apoyada en el borde del banco (o en el respaldo de la máquina), justo por debajo de los omóplatos. La almohadilla o la barra van sobre el hueso de la cadera, nunca sobre el abdomen. Pies planos a la anchura de la cadera, colocados para que arriba las espinillas queden verticales.\n" +
      "Ejecución — Empuja con los talones y sube hasta formar una línea recta de rodillas a hombros. Aprieta el glúteo un segundo arriba. Baja controlando dos segundos, sin soltar del todo la tensión abajo.\n" +
      "Error típico — Subir arqueando la lumbar en vez de extendiendo la cadera. Si arriba notas tirón en la espalda baja, mete la pelvis hacia dentro y sube un poco menos.",
    contributions: [
      c("GLUTEO", "PRIMARY", 1.0),
      c("ISQUIOS", "SECONDARY", 0.5),
    ],
    variants: [
      {
        name: "Barra",
        equipment: "BARBELL",
        // Carga libre, pero la espalda va apoyada en el banco y fallar es
        // sentarse: no es la barra encima que justifica reserva extra.
        stability: "SUPPORTED",
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
    name: "Crunch abdominal",
    movementPattern: "CORE",
    systemicFatigue: 1,
    instructions:
      "Montaje — De rodillas y de espaldas a la polea alta, con la cuerda sujeta a los lados de la cara. La cadera queda fija: ni se sienta ni se mueve durante la serie.\n" +
      "Ejecución — Enrolla la espalda llevando las costillas hacia la pelvis, como si te hicieras una bola. Aprieta abajo un segundo y sube despacio.\n" +
      "Error típico — Bajar doblando la cadera con la espalda recta. Eso lo hace la cadera, no el abdomen: la espalda tiene que redondearse.",
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

/**
 * El catálogo que consume el seed: los 45 originales con las variantes que les
 * faltaban, más la ampliación. El orden es estable (base y después ampliación)
 * para que el seed sea determinista y su diff se pueda leer.
 */
export const EXERCISES: ExerciseSeed[] = [
  ...withExtraVariants(BASE_EXERCISES, EXTRA_VARIANTS),
  ...EXPANSION,
];
