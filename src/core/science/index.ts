import type { ProgressionReasonCode } from "@/core/training/progression";

/**
 * FUENTE ÚNICA de la filosofía, las reglas explicadas y la bibliografía.
 *
 * La consumen tres sitios y deben decir exactamente lo mismo:
 *   · la sección «Ciencia» de la app (`/science`);
 *   · los prompts de Coach AI (`src/ai/prompts.ts`), para que la IA explique
 *     las reglas REALES del motor y no una versión inventada;
 *   · la documentación (`docs/TRAINING_ENGINE.md`).
 *
 * Regla innegociable: nada de vender heurísticas como hechos. Cada afirmación
 * lleva su nivel de evidencia, y las referencias solo se muestran si su
 * identificador está VERIFICADO.
 */

export type EvidenceLevel = "STRONG" | "REASONABLE" | "HEURISTIC";

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  STRONG: "Evidencia fuerte",
  REASONABLE: "Evidencia razonable",
  HEURISTIC: "Heurística del sistema",
};

export const EVIDENCE_MEANING: Record<EvidenceLevel, string> = {
  STRONG:
    "Varios meta-análisis o ensayos concordantes, con dirección estable y efectos consistentes.",
  REASONABLE:
    "Un meta-análisis o pocos ensayos de calidad, o un efecto pequeño y con incertidumbre.",
  HEURISTIC:
    "Decisión de producto defendible, informada por la evidencia pero no demostrada. No es ciencia: es una elección nuestra.",
};

export interface Citation {
  id: string;
  authors: string;
  year: number;
  title: string;
  journal: string;
  doi?: string;
  pmid?: string;
  /** Nota honesta sobre los límites de esa referencia. */
  caveat?: string;
}

/**
 * Bibliografía. TODAS estas referencias se han verificado contra PubMed,
 * Crossref o el editor. Si algún día se añade una sin verificar, no se muestra.
 */
export const CITATIONS: Citation[] = [
  {
    id: "refalo2023",
    authors: "Refalo MC, Helms ER, Trexler ET, Hamilton DL, Fyfe JJ",
    year: 2023,
    title:
      "Influence of Resistance Training Proximity-to-Failure on Skeletal Muscle Hypertrophy: A Systematic Review with Meta-analysis",
    journal: "Sports Medicine 53(3):649–665",
    doi: "10.1007/s40279-022-01784-y",
    pmid: "36334240",
  },
  {
    id: "robinson2024",
    authors:
      "Robinson ZP, Pelland JC, Remmert JF, Refalo MC, Jukic I, Steele J, Zourdos MC",
    year: 2024,
    title:
      "Exploring the Dose–Response Relationship Between Estimated Resistance Training Proximity to Failure, Strength Gain, and Muscle Hypertrophy: A Series of Meta-Regressions",
    journal: "Sports Medicine 54(9):2209–2231",
    doi: "10.1007/s40279-024-02069-2",
    pmid: "38970765",
    caveat:
      "Los autores describen un ajuste de modelo modesto y un análisis exploratorio: la dirección es sólida, la magnitud exacta no.",
  },
  {
    id: "halperin2022",
    authors:
      "Halperin I, Malleron T, Har-Nir I, Androulakis-Korakakis P, Wolf M, Fisher J, Steele J",
    year: 2022,
    title:
      "Accuracy in Predicting Repetitions to Task Failure in Resistance Exercise: A Scoping Review and Exploratory Meta-analysis",
    journal: "Sports Medicine 52(2):377–390",
    doi: "10.1007/s40279-021-01559-x",
    pmid: "34542869",
  },
  {
    id: "remmert2023",
    authors: "Remmert JF, Laurson KR, Zourdos MC",
    year: 2023,
    title:
      "Accuracy of Predicted Intraset Repetitions in Reserve (RIR) in Single- and Multi-Joint Resistance Exercises Among Trained and Untrained Men and Women",
    journal: "Perceptual and Motor Skills 130(3):1239–1254",
    doi: "10.1177/00315125231169868",
    pmid: "37036795",
  },
  {
    id: "plotkin2022",
    authors:
      "Plotkin D, Coleman M, Van Every D, Maldonado J, Oberlin D, Israetel M, Feather J, Alto A, Vigotsky AD, Schoenfeld BJ",
    year: 2022,
    title:
      "Progressive overload without progressing load? The effects of load or repetition progression on muscular adaptations",
    journal: "PeerJ 10:e14142",
    doi: "10.7717/peerj.14142",
    pmid: "36199287",
  },
  {
    id: "pelland2026",
    authors: "Pelland JC, Remmert JF, Robinson ZP, Hinson SR, Zourdos MC",
    year: 2026,
    title:
      "The Resistance Training Dose Response: Meta-Regressions Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains",
    journal: "Sports Medicine 56(2):481–505",
    doi: "10.1007/s40279-025-02344-w",
    pmid: "41343037",
  },
  {
    id: "schoenfeld2017",
    authors: "Schoenfeld BJ, Ogborn D, Krieger JW",
    year: 2017,
    title:
      "Dose-response relationship between weekly resistance training volume and increases in muscle mass: A systematic review and meta-analysis",
    journal: "Journal of Sports Sciences 35(11):1073–1082",
    doi: "10.1080/02640414.2016.1210197",
    pmid: "27433992",
  },
  {
    id: "schoenfeld2019",
    authors: "Schoenfeld BJ, Grgic J, Krieger JW",
    year: 2019,
    title:
      "How many times per week should a muscle be trained to maximize muscle hypertrophy? A systematic review and meta-analysis of studies examining the effects of resistance training frequency",
    journal: "Journal of Sports Sciences 37(11):1286–1295",
    doi: "10.1080/02640414.2018.1555906",
    pmid: "30558493",
  },
  {
    id: "bosquet2007",
    authors: "Bosquet L, Montpetit J, Arvisais D, Mujika I",
    year: 2007,
    title: "Effects of tapering on performance: a meta-analysis",
    journal: "Medicine & Science in Sports & Exercise 39(8):1358–1365",
    doi: "10.1249/mss.0b013e31806010e0",
    pmid: "17762369",
    caveat:
      "El corpus es mayoritariamente de deportes de resistencia, no de entrenamiento de fuerza: sostiene la DIRECCIÓN (recortar volumen sin tocar intensidad) mejor que la cifra exacta aplicada a la hipertrofia.",
  },
  {
    id: "coleman2024",
    authors:
      "Coleman M, Burke R, Augustin F, Piñero A, Maldonado J, Fisher JP, Israetel M, Androulakis-Korakakis P, Swinton PA, Oberlin D, Schoenfeld BJ",
    year: 2024,
    title:
      "Gaining more from doing less? The effects of a one-week deload period during supervised resistance training on muscular adaptations",
    journal: "PeerJ 12:e16777",
    doi: "10.7717/peerj.16777",
    pmid: "38274324",
  },
  {
    id: "enes2024",
    authors: "Enes A, Alves RC, Schoenfeld BJ, et al.",
    year: 2024,
    title:
      "Effects of Different Weekly Set Progressions on Muscular Adaptations in Trained Males: Is There a Dose-Response Effect?",
    journal: "Medicine & Science in Sports & Exercise 56(3):553–563",
    doi: "10.1249/MSS.0000000000003317",
    pmid: "37796222",
  },
  {
    id: "acsm2026",
    authors:
      "Currier BS, D'Souza AC, Singh MAF, Lowisz CV, Rawson ES, Schoenfeld BJ, et al.",
    year: 2026,
    title:
      "Position Stand. Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews",
    journal: "Medicine & Science in Sports & Exercise 58(4):851–872",
    doi: "10.1249/MSS.0000000000003897",
    pmid: "41843416",
    caveat:
      "Cita verificada. Las cifras concretas que resumimos proceden de resúmenes públicos del position stand, no del texto completo (de pago).",
  },
];

export const CITATION_BY_ID: Record<string, Citation> = Object.fromEntries(
  CITATIONS.map((c) => [c.id, c]),
);

export interface Principle {
  id: string;
  title: string;
  /** Qué hace la app. Una o dos frases, sin jerga. */
  summary: string;
  /** Detalle opcional con los números concretos. */
  detail?: string;
  evidence: EvidenceLevel;
  citations: string[];
}

export interface PhilosophySection {
  id: string;
  title: string;
  /** Etiqueta corta para el índice de `/science`. Por defecto, `title`. */
  short?: string;
  intro: string;
  principles: Principle[];
}

/** La filosofía completa, por secciones. Es lo que se muestra en `/science`. */
export const PHILOSOPHY: PhilosophySection[] = [
  {
    id: "objetivo",
    short: "Filosofía",
    title: "Nuestra filosofía",
    intro:
      "Personal Coach entrena por tendencia, no por sesión. Progresa primero en repeticiones y después en carga, con la mayoría del trabajo cerca —pero no encima— del fallo, y un volumen moderado que solo cambia cuando hay evidencia acumulada.",
    principles: [
      {
        id: "objetivo-doble",
        title: "Fuerza e hipertrofia a la vez",
        summary:
          "El plan busca las dos cosas: la carga construye fuerza y el trabajo cercano al fallo construye músculo. No hace falta elegir en un programa general.",
        evidence: "REASONABLE",
        citations: ["robinson2024", "acsm2026"],
      },
      {
        id: "tendencia",
        title: "Una sesión no es información; una tendencia sí",
        summary:
          "Ninguna decisión importante se toma con un solo día. Bajar la carga exige dos exposiciones comparables; señalar fatiga exige señales repetidas.",
        detail:
          "El motivo es de medida, no de filosofía: el RIR que reportas tiene ~1 repetición de error típico y el e1RM estimado ronda el ±5 %. Por debajo de eso no hay señal que leer.",
        evidence: "REASONABLE",
        citations: ["halperin2022"],
      },
      {
        id: "sin-pr",
        title: "No hay que batir un récord cada día",
        summary:
          "Con ganancias reales de ~0,5–1 % por semana, el progreso semanal esperado es más pequeño que el error de medida. Exigir un PR semanal sería exigir ruido.",
        evidence: "HEURISTIC",
        citations: [],
      },
    ],
  },
  {
    id: "overload",
    short: "Overload",
    title: "Progressive overload",
    intro:
      "Double progression: primero se suben repeticiones dentro del rango, después la carga. Los dos brazos producen la misma hipertrofia, así que el orden es una elección práctica.",
    principles: [
      {
        id: "reps-o-carga",
        title: "Subir reps o subir carga funciona igual para hipertrofia",
        summary:
          "En un ensayo de 8 semanas con 43 personas entrenadas, progresar en carga o en repeticiones produjo el mismo crecimiento.",
        evidence: "STRONG",
        citations: ["plotkin2022"],
      },
      {
        id: "double-progression",
        title: "Cómo funciona en la práctica: 3×6–8 @2 RIR",
        summary:
          "Eliges una carga con la que cierres 6 repeticiones dejando ~2 en reserva. Cada sesión subes la serie más floja. Cuando cierras 8 en casi todas, sube la carga.",
        detail:
          "80×6/6/6 → objetivo 7/7/7 · 80×8/8/6 → objetivo 8/8/7 · 80×8/8/7 → sube a 82,5 kg buscando 7 reps (no 6: la equivalencia carga↔repeticiones dice que a 82,5 kg te corresponden ~7). El rango se considera cerrado con n−1 series en el techo y ninguna por debajo de repMax−1.",
        evidence: "HEURISTIC",
        citations: ["plotkin2022"],
      },
      {
        id: "volumen-no-es-overload",
        title: "Añadir series no es la palanca principal",
        summary:
          "El motor nunca añade ni quita series por su cuenta. Rampar volumen mejora la fuerza con evidencia razonable, pero para hipertrofia el beneficio es pequeño e incierto.",
        evidence: "REASONABLE",
        citations: ["enes2024"],
      },
    ],
  },
  {
    id: "rir",
    short: "RIR",
    title: "RIR y proximidad al fallo",
    intro:
      "RIR = repeticiones en reserva: cuántas te habrías podido hacer más. RIR 2 significa que paraste con dos en el depósito.",
    principles: [
      {
        id: "fallo-no-necesario",
        title: "El fallo absoluto no es necesario para crecer",
        summary:
          "Con el volumen igualado, entrenar al fallo produce prácticamente la misma hipertrofia que quedarse a 1–3 repeticiones.",
        detail:
          "El meta-análisis de referencia encuentra un efecto trivial a favor del fallo (ES 0,19; IC 95 % 0,00–0,37) que desaparece al comparar fallo muscular momentáneo contra no-fallo (ES 0,12; IC −0,13–0,37).",
        evidence: "STRONG",
        citations: ["refalo2023", "acsm2026"],
      },
      {
        id: "fuerza-carga",
        title: "Para fuerza manda la carga, no la proximidad al fallo",
        summary:
          "En la meta-regresión de 243 efectos sobre 55 estudios, el RIR no tiene relación apreciable con las ganancias de fuerza.",
        evidence: "STRONG",
        citations: ["robinson2024"],
      },
      {
        id: "banda-rir",
        title: "Por qué aceptamos una banda de ±1",
        summary:
          "El RIR autoinformado tiene ~1 repetición de error típico y se infravalora de media. Exigir «exactamente 2» sería decidir dentro del ruido del propio dato.",
        detail:
          "Por eso el motor acepta como válido cualquier esfuerzo con RIR ≥ objetivo − 1, y solo frena cuando llegas al fallo con una prescripción que pedía reserva. La estimación es además más precisa cerca del fallo, no menos.",
        evidence: "HEURISTIC",
        citations: ["halperin2022", "remmert2023"],
      },
      {
        id: "objetivos-rir",
        title: "Nuestros objetivos: 3 / 2 / 1",
        summary:
          "Compuestos pesados 3 RIR, compuestos 2, aislamientos 1. En un aislamiento llegar al fallo no se penaliza; en un compuesto pesado sí frena la subida la primera vez.",
        detail:
          "Que el objetivo deba variar por tipo de ejercicio es una elección nuestra: no hay ningún estudio que asigne distintos RIR a distintas categorías de ejercicio, y el subgrupo meta-analítico más pertinente sale nulo. Lo sostenemos por coste de fatiga y riesgo técnico, no por fisiología demostrada.",
        evidence: "HEURISTIC",
        citations: ["remmert2023", "acsm2026"],
      },
    ],
  },
  {
    id: "volumen",
    short: "Volumen",
    title: "Volumen",
    intro:
      "El volumen se cuenta en series EFECTIVAS por músculo y semana: las series directas cuentan 1, y el trabajo indirecto cuenta una fracción.",
    principles: [
      {
        id: "fraccional",
        title: "El trabajo indirecto cuenta, pero menos",
        summary:
          "Un press inclinado no es solo pecho superior: también carga pecho medio, deltoides anterior y tríceps. Cada uno suma su fracción.",
        detail:
          "La mejor meta-regresión disponible comparó explícitamente contar el trabajo indirecto como 1,0, como 0,5 o como 0, y el conteo fraccional fue el mejor soportado por los datos. Los factores concretos de nuestro catálogo son aproximaciones operativas, no medidas.",
        evidence: "REASONABLE",
        citations: ["pelland2026"],
      },
      {
        id: "dosis-respuesta",
        title: "Más volumen ayuda, con rendimientos decrecientes",
        summary:
          "La relación es positiva y sin techo claro en el rango estudiado, pero cada serie extra aporta menos que la anterior y cuesta fatiga y tiempo.",
        evidence: "STRONG",
        citations: ["pelland2026", "schoenfeld2017"],
      },
      {
        id: "arranque-conservador",
        title: "Arrancamos bajo a propósito",
        summary:
          "El programa inicial se sitúa en una banda conservadora de ~6–10 series efectivas por músculo, para dejar margen de progresión.",
        detail:
          "Honestidad obligada: el position stand de 2026 sitúa la hipertrofia en ≥10 series por músculo y semana, así que nuestra banda de partida está en el borde inferior. Es un punto de partida de producto, no un óptimo.",
        evidence: "HEURISTIC",
        citations: ["acsm2026", "schoenfeld2017"],
      },
      {
        id: "frecuencia",
        title: "Frecuencia: repartir, no multiplicar",
        summary:
          "Con el volumen igualado, entrenar un músculo 1, 2 o 3 veces por semana da lo mismo. Repartimos en ≥2 días porque las sesiones salen más cortas y manejables.",
        evidence: "STRONG",
        citations: ["schoenfeld2019"],
      },
    ],
  },
  {
    id: "fatiga",
    short: "Fatiga",
    title: "Fatiga y descarga",
    intro:
      "La descarga se RECOMIENDA cuando hay evidencia, nunca por calendario y nunca de forma automática.",
    principles: [
      {
        id: "deload-no-potencia",
        title: "Una descarga es gestión de fatiga, no un potenciador",
        summary:
          "En el único ensayo directo, el grupo que dejó de entrenar una semana a mitad de bloque no ganó más músculo y ganó MENOS fuerza que el que siguió. Por eso aquí la descarga es reactiva y nunca por calendario.",
        detail:
          'Cuidado con estirar esa conclusión más de lo que da: el estudio probó UNA estrategia (cese total del entrenamiento) durante 9 semanas en 39 personas entrenadas. Los propios autores señalan que un deload puede hacerse de muchas formas distintas del cese, y dejan abierto si un periodo de entrenamiento reducido evitaría esa pérdida de fuerza. Lo que sostiene es "no dejes de entrenar por calendario", no la receta concreta que usamos.',
        evidence: "REASONABLE",
        citations: ["coleman2024"],
      },
      {
        id: "senales",
        title: "Qué miramos, y con qué peso",
        summary:
          "Las señales objetivas (rendimiento medido) pesan más que los chips subjetivos. Recomendar una descarga exige al menos una señal objetiva: tres días seguidos sintiéndote mal no bastan.",
        detail:
          "Objetivas (rendimiento medido): caída en varios ejercicios (3 pts), un solo ejercicio en caída (1), meseta generalizada (2). Conductual: sesiones acortadas repetidas (2). Subjetivas: fatiga ≥4/5 repetida (2), rendimiento percibido bajo (1), motivación baja (1). Calendario: ≥8 semanas seguidas sin parar (1). Se recomienda con ≥5 puntos y ≥2 de ellos objetivos. Acortar sesiones NO cuenta como objetiva: correlaciona con la fatiga, pero también con la agenda.",
        evidence: "HEURISTIC",
        citations: ["coleman2024"],
      },
      {
        id: "dolor",
        title: "El dolor articular va por su cuenta",
        summary:
          "No suma puntos de fatiga: escala su propio aviso y tiene precedencia sobre cualquier ajuste de carga. Si duele, se cambia el ejercicio antes que el peso.",
        evidence: "HEURISTIC",
        citations: [],
      },
      {
        id: "receta-descarga",
        title: "Qué es una descarga aquí: la mitad de las series",
        summary:
          "Una semana con la mitad de tus series habituales (mínimo 1 por ejercicio), los MISMOS kilos y el mismo RIR objetivo. Una sola palanca: se recorta el volumen y se deja la intensidad intacta.",
        detail:
          "Recortar el volumen a la mitad cae dentro del 41–60 % que el meta-análisis de taper de Bosquet identifica como óptimo sin tocar intensidad ni frecuencia — con la salvedad de que ese trabajo es sobre todo de deportes de resistencia, por eso la etiqueta no es «fuerte». Mantener los kilos es deliberado: la exposición a carga alta es lo que conserva las adaptaciones, y añadir ADEMÁS repeticiones en reserva dejaría la semana cerca de no entrenar. La única excepción es el dolor articular: ahí sí se baja un 10 % la carga, porque la articulación manda. Y nada de esto se aplica solo: es una recomendación que aceptas o ignoras.",
        evidence: "REASONABLE",
        citations: ["bosquet2007", "coleman2024"],
      },
      {
        id: "meseta",
        title: "Una meseta es un aviso, no una orden",
        summary:
          "Cuando llevas varias exposiciones seguidas sin mejorar repeticiones ni carga, la app te lo señala. Y ahí se queda: no te añade series, no te cambia el ejercicio y no te manda descargar por su cuenta.",
        detail:
          "Estancarse unas semanas es parte normal de entrenar, y las causas posibles son muchas —fatiga, sueño, comida, técnica, o simplemente que ese ejercicio ya no admite saltos finos—. Como el dato por sí solo no distingue entre ellas, la app te da el aviso con sus números y la decisión la tomas tú. Solo cuenta como evidencia de fatiga acumulada si se estanca la MITAD o más de tus ejercicios a la vez: uno solo suele ser cosa del ejercicio, no de tu recuperación.",
        evidence: "HEURISTIC",
        citations: [],
      },
      {
        id: "tiempo",
        title: "El historial envejece",
        summary:
          "Un rendimiento de hace seis semanas no vale lo mismo que el de la semana pasada: baja la confianza y se suspenden las subidas hasta reconfirmar. El tiempo nunca baja la carga por sí solo.",
        evidence: "HEURISTIC",
        citations: [],
      },
    ],
  },
  {
    id: "ia",
    short: "AI Coach",
    title: "Coach AI",
    intro:
      "El motor determinista decide; la IA interpreta y explica. Nunca al revés.",
    principles: [
      {
        id: "ia-rol",
        title: "La IA no decide nada",
        summary:
          "Todos los números —cargas, repeticiones, RIR, volumen, señales de fatiga— los calculan los motores deterministas antes de hablar con el modelo. La IA recibe esos hechos ya cocinados y los interpreta.",
        detail:
          "No puede modificar tu programa, tus series, tus cargas ni recomendar una descarga por su cuenta: no existe ninguna operación de escritura en esa capa. Si contradice al motor o cita un número que no está en sus datos, la respuesta se descarta y ves la explicación determinista.",
        evidence: "HEURISTIC",
        citations: [],
      },
      {
        id: "ia-limites",
        title: "Lo que no sabe, lo dice",
        summary:
          "Si la app no registra tu peso corporal, tus calorías o tu sueño, la IA lo sabe y no puede inventarlos. Puede darte pautas generales; no cifras personales que nadie ha medido.",
        evidence: "HEURISTIC",
        citations: [],
      },
    ],
  },
];

/**
 * Traducción de cada `reasonCode` del motor a lenguaje llano. La usa la sección
 * «Ciencia» y, sobre todo, el prompt de «¿Por qué hago esto?»: así la IA
 * explica la regla REAL y no una inventada.
 */
export const REASON_CODE_EXPLANATIONS: Record<ProgressionReasonCode, string> = {
  NO_HISTORY:
    "Primera vez con este ejercicio: el motor no inventa un peso, lo eliges tú.",
  SESSION_INCOMPLETE:
    "La última sesión registró menos de la mitad de las series previstas: con media sesión no se ajusta nada.",
  ATYPICAL_LOAD_DROP:
    "La carga registrada cae mucho respecto a la sesión anterior y con esfuerzo de sobra: puede ser un error de registro, así que se pide confirmarlo antes de tomarla como referencia.",
  REPEATED_UNDERPERFORMANCE:
    "Dos exposiciones comparables por debajo del mínimo del rango: la carga no permite la prescripción, así que baja.",
  STUCK_BELOW_RANGE:
    "Cuatro exposiciones seguidas sin llegar al mínimo del rango. Independientemente de cómo se sienta el esfuerzo, la carga es demasiada.",
  CLOSED_RANGE_AT_FAILURE:
    "Cerraste el rango pero con más esfuerzo del prescrito. Se consolida una vez; si se repite, se sube igualmente.",
  INCOMPLETE_FOR_INCREASE:
    "Cerraste el rango pero con menos series de las previstas. La serie que falta suele ser la que más informa.",
  NEEDS_RIR_CONFIRMATION:
    "Cerraste el rango pero sin ningún RIR registrado: sin ese dato hay que verlo dos veces antes de mover la carga.",
  MIXED_LOADS:
    "Las series no fueron todas al mismo peso, así que la lectura del motor es parcial y no propone una subida que quedaría por debajo de lo ya movido.",
  RANGE_CLOSED:
    "Rango cerrado con el esfuerzo previsto: toca subir carga, con un objetivo de repeticiones calculado por equivalencia.",
  RANGE_CLOSED_AFTER_FAILURE:
    "Has cerrado el rango dos veces seguidas con más esfuerzo del previsto: quedarse ya no aporta, se sube.",
  LOAD_CLEARLY_TOO_LIGHT:
    "Hiciste bastantes más repeticiones que el techo del rango: la carga se quedó corta y se permite un salto doble.",
  EXTEND_RANGE:
    "El incremento mínimo del material es demasiado grande para el rango, así que se extiende el techo de repeticiones hasta que el salto sea alcanzable.",
  STEP_TOO_BIG_FOR_RANGE:
    "Ni extendiendo el rango cabe el siguiente escalón del material: hacen falta discos fraccionales o una variante con incrementos más finos.",
  NO_LOAD_STEP:
    "Ejercicio sin carga externa cuantificable: se progresa con repeticiones y recorrido.",
  NO_LOAD_STEP_CAPPED:
    "Sin carga que añadir y con las repeticiones muy altas: toca una variante más difícil.",
  ONE_OFF_UNDERPERFORMANCE:
    "El rendimiento quedó por debajo del rango una vez. No se cambia nada por una sesión.",
  NEAR_FAILURE_HOLD:
    "Llegaste al fallo o casi sin cerrar el rango: se mantiene la carga y se buscan repeticiones con algo de reserva.",
  ADD_REP:
    "Dentro del rango: mismo peso, subiendo la serie más floja hasta cerrar el techo.",
  STALE_HISTORY:
    "Han pasado semanas desde esa sesión: se vuelve con el mismo peso para reconfirmar antes de subir. El tiempo no baja la carga.",
  HOLD_DEFAULT: "Mantener la carga y consolidar.",
  RECOVERY_VETO:
    "Había una subida lista, pero hay dolor articular o una descarga recomendada. La salud y la recuperación mandan sobre la progresión: la subida queda en pausa, no se pierde.",
};

/**
 * Resumen ejecutable de las reglas del motor, para inyectar en el prompt de
 * Coach AI. Es texto, no lógica: la lógica vive en `progression.ts`. Si las dos
 * divergen, manda el motor — y esta constante hay que actualizarla.
 */
export const ENGINE_RULES_SUMMARY = `
REGLAS DEL MOTOR DE PROGRESIÓN (v2, deterministas):
- Double progression: primero repeticiones dentro del rango, después carga.
- "Rango cerrado" = n−1 series en el techo del rango y ninguna por debajo de (techo − 1).
  Con 3 series: 8/8/8 y 8/8/7 SÍ cierran; 8/8/6 y 8/7/7 NO.
- ADD_REP mantiene el peso y sube la serie más floja, con trinquete: nunca pide
  menos de lo ya logrado a esa carga.
- INCREASE_LOAD sube UN incremento del material (dos solo si superaste el techo
  del rango en ≥3 reps, con RIR registrado y sin pasar del 10 % de la carga).
  El objetivo de repeticiones tras subir se calcula por equivalencia carga↔reps,
  no se resetea al mínimo del rango.
- Esfuerzo compatible = RIR ≥ objetivo − 1 (banda por el error de medida del RIR).
  Llegar al fallo con objetivo ≥2 frena la subida la primera vez; a la segunda sube igual.
- DECREASE_LOAD exige DOS exposiciones comparables con la mediana por debajo del
  mínimo del rango (o cuatro ignorando el RIR). Nunca por una sesión mala.
- El RIR ausente no se imputa: baja la confianza y bloquea el salto doble.
- Historial de ≥3 semanas: se suspenden las subidas hasta reconfirmar; ≥6 semanas,
  confianza mínima. El tiempo nunca baja la carga por sí solo.
- El motor NUNCA añade ni quita series, ni cambia el programa, ni aplica descargas.
- Con dolor articular repetido o una descarga recomendada, las SUBIDAS DE CARGA
  quedan suspendidas (la salud y la recuperación tienen precedencia). Progresar
  en repeticiones sigue permitido, y la carga nunca baja por este motivo.

REGLAS DEL MOTOR DE FATIGA (deterministas):
- Recomendar descarga exige ≥5 puntos Y ≥2 puntos de señales OBJETIVAS.
- Las señales subjetivas (fatiga, motivación, rendimiento percibido) por sí solas
  nunca bastan, y toda señal exige repetición.
- El dolor articular no puntúa: escala su propio aviso y tiene precedencia.
- Acortar sesiones repetidamente suma puntos pero NO cuenta como señal objetiva.
- La descarga sugerida recorta VOLUMEN (mitad de las series) y mantiene la carga
  y el RIR objetivo. Una sola palanca, no dos.
- Nada se aplica automáticamente: es una recomendación.
`.trim();
