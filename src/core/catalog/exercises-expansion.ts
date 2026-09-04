import { ex, type VariantDraft } from "@/core/catalog/exercise-builders";
import type { ExerciseSeed } from "@/core/catalog/exercises";

/**
 * Ampliación del catálogo (F3.2e).
 *
 * El catálogo original cubría 45 ejercicios: suficiente para generar un
 * programa, insuficiente para que alguien encuentre lo que de verdad hace en su
 * gimnasio. Faltaban cosas tan normales como el peso muerto, la zancada, el
 * remo en T, el press Arnold o la rueda abdominal, y la señal de que el hueco
 * era real es que un usuario tuvo que crearse a mano "Sentadilla búlgara" y
 * "Remo bajo polea" — dos ejercicios que ningún catálogo serio debería
 * obligarte a inventar.
 *
 * ── Cómo se decide Exercise vs ExerciseVariant ──────────────────────────────
 *
 * `Exercise` es el MOVIMIENTO; `ExerciseVariant` es CÓMO lo cargas. La frontera
 * no es estética: es la clave con la que viven el historial, el e1RM, la
 * progresión, el RIR objetivo y las notas. Dos reglas operativas:
 *
 *  · Si comparar cargas entre las dos cosas tiene sentido dentro de la misma
 *    serie de progresión → son la misma identidad y no van separadas.
 *  · Si cambian los MÚSCULOS que trabajan o sus factores, es otro `Exercise`:
 *    las contribuciones son del ejercicio, no de la variante. Por eso la
 *    dominada supina va aparte de la pronada (más bíceps) y el press declinado
 *    va aparte del plano, pero "banca con barra" y "banca en máquina" son la
 *    misma identidad con dos variantes.
 *
 * Consecuencia práctica: nada de `Chest Press Machine` + `Machine Chest Press`
 * + `Press de pecho en máquina`. Eso es una variante `Máquina` de `Press
 * banca`, y se declara como tal en `EXTRA_VARIANTS`.
 *
 * ── Metadata ────────────────────────────────────────────────────────────────
 *
 * Cada entrada declara a mano lo que importa —patrón, músculo primario,
 * secundarios con su factor, fatiga sistémica, contraindicaciones— y deja a
 * `ex()` solo los números de material (paso de carga, rango, descanso). Los
 * factores son aproximaciones operativas para contar volumen, no fisiología
 * medida (docs/DATA_MODEL.md).
 */

// ── Atajos de variante, para que la declaración se lea de un vistazo ────────
const barra = (o: Partial<VariantDraft> = {}): VariantDraft => ({
  equipment: "BARBELL",
  ...o,
});
const mancuernas = (o: Partial<VariantDraft> = {}): VariantDraft => ({
  equipment: "DUMBBELL",
  ...o,
});
const maquina = (o: Partial<VariantDraft> = {}): VariantDraft => ({
  equipment: "MACHINE",
  ...o,
});
const polea = (o: Partial<VariantDraft> = {}): VariantDraft => ({
  equipment: "CABLE",
  ...o,
});
const multipower = (o: Partial<VariantDraft> = {}): VariantDraft => ({
  equipment: "SMITH_MACHINE",
  ...o,
});
const ez = (o: Partial<VariantDraft> = {}): VariantDraft => ({
  equipment: "EZ_BAR",
  ...o,
});
const corporal = (o: Partial<VariantDraft> = {}): VariantDraft => ({
  equipment: "BODYWEIGHT",
  ...o,
});
const banda = (o: Partial<VariantDraft> = {}): VariantDraft => ({
  equipment: "BAND",
  ...o,
});

export const EXPANSION: ExerciseSeed[] = [
  // ══════════════════════════════════════════════════════ PECHO ════════════
  ex({
    name: "Press declinado",
    pattern: "HORIZONTAL_PUSH",
    fatigue: 2,
    instructions:
      "Banco declinado 15–30°. Baja al pecho bajo y empuja sin bloquear con rebote.",
    primary: "PECHO_MEDIO_INFERIOR",
    secondary: [
      ["TRICEPS", 0.5],
      ["DELT_ANTERIOR", 0.25],
    ],
    variants: [
      barra({ contra: ["SHOULDER"] }),
      mancuernas({ contra: ["SHOULDER"] }),
      maquina(),
    ],
  }),
  ex({
    name: "Flexiones",
    pattern: "HORIZONTAL_PUSH",
    fatigue: 1,
    instructions:
      "Cuerpo en línea, codos a ~45°. Baja hasta rozar el suelo con el pecho.",
    primary: "PECHO_MEDIO_INFERIOR",
    secondary: [
      ["TRICEPS", 0.5],
      ["DELT_ANTERIOR", 0.5],
      ["CORE", 0.25],
    ],
    variants: [
      corporal({ name: "Peso corporal / lastre", reps: [8, 20] }),
      corporal({
        name: "Manos elevadas (más fácil)",
        reps: [10, 25],
        step: 0,
      }),
      corporal({ name: "Pies elevados (más difícil)", reps: [6, 15] }),
    ],
  }),
  ex({
    name: "Press en el suelo",
    pattern: "HORIZONTAL_PUSH",
    fatigue: 2,
    instructions:
      "Tumbado en el suelo: el recorrido se corta al tocar los tríceps. Sin rebotar los codos.",
    primary: "PECHO_MEDIO_INFERIOR",
    secondary: [
      ["TRICEPS", 0.75],
      ["DELT_ANTERIOR", 0.25],
    ],
    variants: [barra(), mancuernas()],
  }),
  ex({
    name: "Cruce de poleas alto a bajo",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Poleas altas, trayectoria descendente hasta juntar delante de la cadera.",
    primary: "PECHO_MEDIO_INFERIOR",
    secondary: [["DELT_ANTERIOR", 0.25]],
    variants: [polea()],
  }),

  // ══════════════════════════════════════════ ESPALDA · TIRÓN VERTICAL ═════
  ex({
    name: "Dominadas supinas",
    pattern: "VERTICAL_PULL",
    fatigue: 2,
    instructions:
      "Agarre supino a la anchura de los hombros. Pecho al barra, sin balanceo.",
    primary: "DORSAL",
    secondary: [
      ["BICEPS", 0.75],
      ["ESPALDA_ALTA", 0.25],
    ],
    variants: [
      corporal({ name: "Peso corporal / lastre", reps: [5, 10], rest: 180 }),
      maquina({ name: "Máquina asistida", reps: [6, 12] }),
    ],
  }),

  // ══════════════════════════════════════ ESPALDA · TIRÓN HORIZONTAL ══════
  ex({
    name: "Remo invertido",
    pattern: "HORIZONTAL_PULL",
    fatigue: 1,
    instructions:
      "Barra a la altura de la cadera, cuerpo en línea. Lleva el esternón a la barra.",
    primary: "ESPALDA_ALTA",
    secondary: [
      ["DORSAL", 0.5],
      ["BICEPS", 0.5],
      ["CORE", 0.25],
    ],
    variants: [
      corporal({ name: "Peso corporal / lastre", reps: [8, 15] }),
      multipower({ name: "Multipower (barra fija)", reps: [8, 15] }),
    ],
  }),
  ex({
    name: "Remo en T",
    pattern: "HORIZONTAL_PULL",
    fatigue: 3,
    instructions:
      "Cadera atrás, espalda neutra. Tira del agarre al abdomen sin tirones de lumbar.",
    primary: "ESPALDA_ALTA",
    secondary: [
      ["DORSAL", 0.75],
      ["BICEPS", 0.5],
      ["DELT_POSTERIOR", 0.25],
    ],
    variants: [
      barra({ name: "Barra en landmine", contra: ["LOWER_BACK"] }),
      maquina({
        name: "Máquina con apoyo pectoral",
        stability: "GUIDED",
        contra: [],
      }),
    ],
  }),
  ex({
    name: "Remo Pendlay",
    pattern: "HORIZONTAL_PULL",
    fatigue: 3,
    instructions:
      "Torso paralelo al suelo. Cada repetición arranca con la barra parada en el suelo.",
    primary: "ESPALDA_ALTA",
    secondary: [
      ["DORSAL", 0.5],
      ["BICEPS", 0.5],
      ["ISQUIOS", 0.25],
    ],
    variants: [barra({ reps: [5, 8], contra: ["LOWER_BACK"] })],
  }),
  ex({
    name: "Remo tumbado en banco",
    pattern: "HORIZONTAL_PULL",
    fatigue: 2,
    instructions:
      "Boca abajo en un banco alto. El pecho no se despega: sin ayuda de cadera.",
    primary: "ESPALDA_ALTA",
    secondary: [
      ["DORSAL", 0.5],
      ["BICEPS", 0.5],
      ["DELT_POSTERIOR", 0.25],
    ],
    variants: [
      // Tumbado boca abajo en el banco: fallar es soltar la barra al suelo, no
      // quedarse debajo de ella. No merece la reserva de un remo de pie.
      barra({ reps: [8, 12], stability: "SUPPORTED" }),
      mancuernas(),
    ],
  }),
  ex({
    name: "Remo Meadows",
    pattern: "HORIZONTAL_PULL",
    fatigue: 2,
    instructions:
      "Landmine desde un lado, agarre en el extremo. Tirón unilateral largo.",
    primary: "DORSAL",
    secondary: [
      ["ESPALDA_ALTA", 0.5],
      ["BICEPS", 0.5],
    ],
    variants: [
      // Un extremo anclado y agarre unilateral: fallar es soltar. La reserva
      // de un remo con barra libre aquí sobra.
      barra({ name: "Barra en landmine", reps: [8, 12], stability: "SUPPORTED" }),
    ],
  }),

  // ══════════════════════════════════════════════════════ HOMBRO ══════════
  ex({
    name: "Press Arnold",
    pattern: "VERTICAL_PUSH",
    fatigue: 2,
    instructions:
      "Empieza con las palmas hacia ti y rota mientras empujas. Sin arquear la lumbar.",
    primary: "DELT_ANTERIOR",
    secondary: [
      ["DELT_LATERAL", 0.5],
      ["TRICEPS", 0.5],
    ],
    variants: [mancuernas({ name: "Mancuernas sentado", contra: ["SHOULDER"] })],
  }),
  ex({
    name: "Elevación frontal",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Sube hasta la altura de los ojos con el codo casi extendido. Sin impulso de cadera.",
    primary: "DELT_ANTERIOR",
    variants: [mancuernas(), polea({ name: "Polea con cuerda" }), banda()],
  }),

  // ══════════════════════════════════════════════════════ BÍCEPS ══════════
  ex({
    name: "Curl con mancuernas",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Codos pegados al torso. Supina al subir y baja controlando la última parte.",
    primary: "BICEPS",
    secondary: [["ANTEBRAZO", 0.25]],
    variants: [
      mancuernas({ name: "Mancuernas simultáneo" }),
      mancuernas({ name: "Mancuernas alterno" }),
    ],
  }),
  ex({
    name: "Curl en polea",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Polea baja, codos quietos. La tensión no se pierde abajo: ahí está la gracia.",
    primary: "BICEPS",
    secondary: [["ANTEBRAZO", 0.25]],
    variants: [
      polea({ name: "Polea con barra" }),
      polea({ name: "Polea unilateral" }),
    ],
  }),
  ex({
    name: "Curl concentrado",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Sentado, codo apoyado en el muslo. Sube sin mover el hombro y aprieta arriba.",
    primary: "BICEPS",
    variants: [mancuernas({ name: "Mancuerna unilateral" })],
  }),

  // ══════════════════════════════════════════════════════ TRÍCEPS ═════════
  ex({
    name: "Press JM",
    pattern: "HORIZONTAL_PUSH",
    fatigue: 2,
    instructions:
      "A medio camino entre press cerrado y francés: baja la barra hacia la barbilla con los codos adelantados.",
    primary: "TRICEPS",
    secondary: [["PECHO_MEDIO_INFERIOR", 0.25]],
    variants: [
      barra({ reps: [6, 10], contra: ["ELBOW"] }),
      multipower({ contra: ["ELBOW"] }),
    ],
  }),
  ex({
    name: "Patada de tríceps",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Codo alto y quieto. Extiende hasta bloquear suave y aprieta un segundo.",
    primary: "TRICEPS",
    variants: [
      polea({ name: "Polea unilateral" }),
      mancuernas({ name: "Mancuerna unilateral" }),
    ],
  }),

  // ══════════════════════════════════════════════════ CUÁDRICEPS ══════════
  ex({
    name: "Sentadilla frontal",
    pattern: "SQUAT",
    fatigue: 3,
    instructions:
      "Barra sobre los deltoides, codos altos. Torso vertical y bajada controlada.",
    primary: "CUADRICEPS",
    secondary: [
      ["GLUTEO", 0.5],
      ["CORE", 0.5],
    ],
    variants: [
      barra({ contra: ["KNEE", "WRIST"] }),
      multipower({ contra: ["KNEE"] }),
    ],
  }),
  ex({
    name: "Sentadilla goblet",
    pattern: "SQUAT",
    fatigue: 2,
    instructions:
      "Mancuerna al pecho, codos dentro de las rodillas. Baja hasta donde la espalda aguante neutra.",
    primary: "CUADRICEPS",
    secondary: [
      ["GLUTEO", 0.5],
      ["CORE", 0.25],
    ],
    variants: [mancuernas({ name: "Mancuerna al pecho", reps: [8, 15] })],
  }),
  ex({
    name: "Sentadilla pendular",
    pattern: "SQUAT",
    fatigue: 2,
    instructions:
      "La máquina lleva la trayectoria: baja profundo con el talón apoyado.",
    primary: "CUADRICEPS",
    secondary: [["GLUTEO", 0.5]],
    variants: [maquina()],
  }),
  ex({
    name: "Sentadilla con cinturón",
    pattern: "SQUAT",
    fatigue: 2,
    instructions:
      "Carga en la cadera, columna descargada. Ideal cuando la lumbar es el límite.",
    primary: "CUADRICEPS",
    secondary: [["GLUTEO", 0.5]],
    variants: [maquina({ name: "Máquina / cinturón" })],
  }),
  ex({
    name: "Sentadilla sissy",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Rodillas adelante, cadera extendida. Recorrido corto y muy controlado.",
    primary: "CUADRICEPS",
    variants: [
      corporal({ name: "Peso corporal / lastre", contra: ["KNEE"] }),
      maquina({ contra: ["KNEE"] }),
    ],
  }),
  ex({
    name: "Zancada",
    pattern: "LUNGE",
    fatigue: 2,
    instructions:
      "Paso largo, torso erguido. La rodilla de atrás baja sin golpear el suelo.",
    primary: "CUADRICEPS",
    secondary: [
      ["GLUTEO", 0.75],
      ["ISQUIOS", 0.25],
    ],
    variants: [
      mancuernas({ name: "Mancuernas · hacia atrás", reps: [8, 12] }),
      mancuernas({ name: "Mancuernas · caminando", reps: [8, 15] }),
      mancuernas({ name: "Mancuernas · hacia delante", reps: [8, 12] }),
      barra({ name: "Barra · hacia atrás", reps: [6, 10] }),
      multipower({ name: "Multipower · estática" }),
    ],
  }),
  ex({
    name: "Sentadilla dividida",
    pattern: "LUNGE",
    fatigue: 2,
    instructions:
      "Pies fijos en tijera durante toda la serie. Sube empujando con el talón delantero.",
    primary: "CUADRICEPS",
    secondary: [["GLUTEO", 0.75]],
    variants: [mancuernas(), multipower(), corporal({ reps: [10, 20] })],
  }),
  ex({
    name: "Subida al cajón",
    pattern: "LUNGE",
    fatigue: 2,
    instructions:
      "Cajón a la altura de la rodilla. Sube sin impulso del pie de abajo.",
    primary: "CUADRICEPS",
    secondary: [["GLUTEO", 0.75]],
    variants: [mancuernas(), corporal({ reps: [10, 20] })],
  }),

  // ═══════════════════════════════════════════ ISQUIOS · GLÚTEO ═══════════
  ex({
    name: "Peso muerto convencional",
    pattern: "HINGE",
    fatigue: 3,
    instructions:
      "Barra pegada a la pierna, espalda neutra. Empuja el suelo; no tires con la lumbar.",
    primary: "ISQUIOS",
    secondary: [
      ["GLUTEO", 0.75],
      ["ESPALDA_ALTA", 0.5],
      ["CORE", 0.5],
      ["TRAPECIO_SUPERIOR", 0.5],
    ],
    variants: [barra({ reps: [3, 8], rest: 210, contra: ["LOWER_BACK"] })],
  }),
  ex({
    name: "Peso muerto sumo",
    pattern: "HINGE",
    fatigue: 3,
    instructions:
      "Pies anchos, puntas abiertas, caderas más bajas. Abre las rodillas al subir.",
    primary: "GLUTEO",
    secondary: [
      ["ISQUIOS", 0.75],
      ["CUADRICEPS", 0.5],
      ["ESPALDA_ALTA", 0.25],
    ],
    variants: [barra({ reps: [3, 8], rest: 210, contra: ["LOWER_BACK", "HIP"] })],
  }),
  ex({
    name: "Peso muerto con barra hexagonal",
    pattern: "HINGE",
    fatigue: 3,
    instructions:
      "Dentro de la barra, agarre neutro. Más cuádriceps y menos exigencia lumbar.",
    primary: "CUADRICEPS",
    secondary: [
      ["GLUTEO", 0.75],
      ["ISQUIOS", 0.5],
      ["TRAPECIO_SUPERIOR", 0.25],
    ],
    variants: [barra({ name: "Barra hexagonal", reps: [5, 10], rest: 180 })],
  }),
  ex({
    name: "Peso muerto piernas rígidas",
    pattern: "HINGE",
    fatigue: 3,
    instructions:
      "Rodillas casi extendidas y fijas. Baja hasta notar el isquio, sin redondear.",
    primary: "ISQUIOS",
    secondary: [
      ["GLUTEO", 0.5],
      ["CORE", 0.25],
    ],
    variants: [
      barra({ reps: [6, 12], contra: ["LOWER_BACK"] }),
      mancuernas({ contra: ["LOWER_BACK"] }),
    ],
  }),
  ex({
    name: "Buenos días",
    pattern: "HINGE",
    fatigue: 3,
    instructions:
      "Barra en la espalda, cadera atrás con la espalda neutra. Carga moderada siempre.",
    primary: "ISQUIOS",
    secondary: [
      ["GLUTEO", 0.5],
      ["CORE", 0.5],
    ],
    variants: [
      barra({ reps: [8, 12], contra: ["LOWER_BACK"] }),
      multipower({ contra: ["LOWER_BACK"] }),
    ],
  }),
  ex({
    name: "Curl nórdico",
    pattern: "ISOLATION",
    fatigue: 2,
    instructions:
      "Tobillos fijos, cadera extendida. Baja lo más lento que puedas y ayúdate con las manos.",
    primary: "ISQUIOS",
    secondary: [["GLUTEO", 0.25]],
    variants: [corporal({ name: "Peso corporal", step: 0, reps: [4, 10] })],
  }),
  ex({
    name: "Elevación glúteo-isquios",
    pattern: "ISOLATION",
    fatigue: 2,
    instructions:
      "En banco GHD. Sube con isquios y glúteo, sin tirón de lumbar.",
    primary: "ISQUIOS",
    secondary: [["GLUTEO", 0.5]],
    variants: [corporal({ name: "Banco GHD / lastre", reps: [6, 12] })],
  }),
  ex({
    name: "Curl femoral de pie",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Una pierna cada vez, cadera quieta. Aprieta arriba sin mover el tronco.",
    primary: "ISQUIOS",
    variants: [
      maquina({ name: "Máquina unilateral" }),
      polea({ name: "Polea con tobillera" }),
    ],
  }),
  ex({
    name: "Puente de glúteo",
    pattern: "HINGE",
    fatigue: 1,
    instructions:
      "Espalda en el suelo, barbilla al pecho. Extiende cadera y aprieta arriba 1 s.",
    primary: "GLUTEO",
    secondary: [["ISQUIOS", 0.25]],
    variants: [
      // Misma excepción que el hip thrust: carga libre, pero apoyado y con
      // salida trivial. Fallar es bajar la cadera al suelo.
      barra({ name: "Barra", reps: [10, 15], rest: 120, stability: "SUPPORTED" }),
      corporal({ reps: [12, 25] }),
    ],
  }),
  ex({
    name: "Empuje de cadera en polea",
    pattern: "HINGE",
    fatigue: 1,
    instructions:
      "Polea baja entre las piernas. Cadera atrás y extiende de pie sin arquear.",
    primary: "GLUTEO",
    secondary: [["ISQUIOS", 0.5]],
    variants: [polea({ name: "Polea con cuerda", reps: [10, 20] })],
  }),
  ex({
    name: "Hiperextensión 45°",
    pattern: "HINGE",
    fatigue: 2,
    instructions:
      "Banco a 45°. Redondea ligeramente para glúteo o mantén neutro para isquio.",
    primary: "ISQUIOS",
    secondary: [
      ["GLUTEO", 0.75],
      ["CORE", 0.25],
    ],
    variants: [
      corporal({ name: "Banco 45° / lastre", reps: [10, 20], rest: 90 }),
    ],
  }),
  ex({
    name: "Hiperextensión inversa",
    pattern: "HINGE",
    fatigue: 2,
    instructions:
      "Tronco fijo, las piernas hacen el recorrido. Sin balanceo ni latigazo.",
    primary: "GLUTEO",
    secondary: [["ISQUIOS", 0.5]],
    variants: [maquina({ reps: [10, 20] })],
  }),
  ex({
    name: "Patada de glúteo",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Cadera cuadrada, extiende la pierna sin arquear la lumbar. Aprieta arriba.",
    primary: "GLUTEO",
    variants: [
      polea({ name: "Polea con tobillera" }),
      maquina({ name: "Máquina de patada" }),
    ],
  }),
  ex({
    name: "Abducción de cadera",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Sentado o de pie. Abre sin girar la pelvis y controla la vuelta.",
    primary: "GLUTEO",
    variants: [
      maquina(),
      polea({ name: "Polea con tobillera" }),
      banda({ name: "Banda" }),
    ],
  }),

  // ══════════════════════════════════════════════════════ CORE ════════════
  ex({
    name: "Rueda abdominal",
    pattern: "CORE",
    fatigue: 1,
    instructions:
      "Rueda hacia delante sin que la lumbar se arquee. Vuelve con el abdomen, no con la cadera.",
    primary: "CORE",
    variants: [
      corporal({
        name: "Rueda (de rodillas)",
        step: 0,
        reps: [6, 15],
        contra: ["LOWER_BACK"],
      }),
      corporal({
        name: "Rueda (de pie)",
        step: 0,
        reps: [4, 10],
        contra: ["LOWER_BACK"],
      }),
    ],
  }),
  ex({
    name: "Crunch invertido",
    pattern: "CORE",
    fatigue: 1,
    instructions:
      "Lleva las rodillas al pecho despegando la cadera. Sin impulso de piernas.",
    primary: "CORE",
    variants: [
      corporal({ name: "Peso corporal", step: 0, reps: [10, 20] }),
      corporal({ name: "Banco declinado", reps: [10, 20] }),
    ],
  }),
  ex({
    name: "Encogimiento en banco declinado",
    pattern: "CORE",
    fatigue: 1,
    instructions:
      "Sube redondeando la espalda, no con la cadera. Lastre al pecho si sobra recorrido.",
    primary: "CORE",
    variants: [
      corporal({
        name: "Banco declinado / lastre",
        reps: [10, 20],
        contra: ["LOWER_BACK"],
      }),
    ],
  }),
  ex({
    name: "Press Pallof",
    pattern: "CORE",
    fatigue: 1,
    instructions:
      "De lado a la polea. Extiende los brazos sin dejar que el tronco rote.",
    primary: "CORE",
    variants: [polea(), banda()],
  }),
  ex({
    name: "Rotación en polea",
    pattern: "CORE",
    fatigue: 1,
    instructions:
      "Gira desde el tronco con la cadera estable. Controla siempre la vuelta.",
    primary: "CORE",
    variants: [
      polea({ name: "Polea alta a baja (leñador)" }),
      polea({ name: "Polea baja a alta" }),
    ],
  }),
  ex({
    name: "Paseo del granjero",
    pattern: "CORE",
    fatigue: 2,
    instructions:
      "Camina erguido con carga en las dos manos. La serie la marca la distancia o el tiempo.",
    primary: "ANTEBRAZO",
    secondary: [
      ["CORE", 0.75],
      ["TRAPECIO_SUPERIOR", 0.5],
    ],
    variants: [
      mancuernas({ reps: [1, 3], rest: 120 }),
      barra({ name: "Barra hexagonal", reps: [1, 3], rest: 120 }),
    ],
  }),
  ex({
    name: "Paseo maleta",
    pattern: "CORE",
    fatigue: 1,
    instructions:
      "Carga en UNA mano. Camina sin inclinarte hacia el lado libre.",
    primary: "CORE",
    secondary: [["ANTEBRAZO", 0.75]],
    variants: [mancuernas({ name: "Mancuerna unilateral", reps: [1, 3], rest: 90 })],
  }),

  // ═══════════════════════════════════════════════════ ANTEBRAZO ══════════
  ex({
    name: "Curl de muñeca",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Antebrazos apoyados, palmas arriba. Recorrido completo y sin rebote.",
    primary: "ANTEBRAZO",
    variants: [
      ez({ reps: [12, 20], contra: ["WRIST"] }),
      mancuernas({ reps: [12, 20], contra: ["WRIST"] }),
    ],
  }),
  ex({
    name: "Extensión de muñeca",
    pattern: "ISOLATION",
    fatigue: 1,
    instructions:
      "Antebrazos apoyados, palmas abajo. Cargas bajas: el recorrido es corto.",
    primary: "ANTEBRAZO",
    variants: [
      ez({ reps: [12, 20], contra: ["WRIST"] }),
      mancuernas({ reps: [12, 20], contra: ["WRIST"] }),
    ],
  }),
];

/**
 * Variantes que se añaden a ejercicios que YA existían.
 *
 * Aquí es donde se evita el catálogo lleno de duplicados: "press de pecho en
 * máquina", "chest press" y "máquina de press horizontal" no son tres
 * ejercicios, son la variante `Máquina` de `Press banca` — y la variante ya
 * existía. Lo que faltaba era el resto del material.
 */
export const EXTRA_VARIANTS: Record<string, VariantDraft[]> = {
  "Press banca": [
    multipower({ contra: ["SHOULDER"] }),
    maquina({ name: "Máquina convergente" }),
  ],
  "Press inclinado": [maquina({ name: "Máquina convergente" })],
  "Fondos en paralelas": [
    maquina({ name: "Máquina asistida", reps: [8, 15] }),
    maquina({ name: "Máquina de fondos", reps: [8, 12] }),
  ],
  Dominadas: [
    corporal({ name: "Agarre neutro", reps: [5, 10], rest: 180 }),
    maquina({ name: "Máquina asistida", reps: [6, 12] }),
  ],
  "Jalón al pecho": [
    polea({ name: "Polea agarre ancho" }),
    polea({ name: "Polea agarre neutro" }),
  ],
  // "Pullover en polea" se renombra a "Pullover" en la migración de datos: el
  // movimiento existe con polea, máquina y mancuerna, y el nombre viejo dejaba
  // fuera a los otros dos o invitaba a crear un ejercicio duplicado.
  Pullover: [
    maquina({ name: "Máquina" }),
    mancuernas({ name: "Mancuerna en banco" }),
  ],
  "Remo sentado": [
    polea({ name: "Polea agarre ancho" }),
    polea({ name: "Polea unilateral" }),
    maquina({ name: "Máquina sentado" }),
    maquina({ name: "Máquina de discos" }),
  ],
  "Remo con apoyo pectoral": [
    maquina({ name: "Máquina unilateral" }),
    maquina({ name: "Máquina de discos" }),
  ],
  "Remo con mancuerna": [maquina({ name: "Máquina unilateral con apoyo" })],
  Encogimientos: [
    multipower(),
    maquina(),
    polea({ name: "Polea baja" }),
  ],
  "Press militar": [
    multipower({ contra: ["SHOULDER"] }),
    mancuernas({ name: "Mancuernas de pie", contra: ["SHOULDER"] }),
  ],
  "Elevación lateral": [
    mancuernas({ name: "Mancuernas sentado" }),
    polea({ name: "Polea unilateral inclinado" }),
    banda(),
  ],
  "Aperturas invertidas": [polea({ name: "Polea unilateral" })],
  // "Curl en máquina predicador" se renombra a "Curl predicador": el banco
  // Scott no es solo una máquina, y separarlo obligaba a crear un duplicado.
  "Curl predicador": [
    ez({ name: "Barra EZ en banco Scott" }),
    mancuernas({ name: "Mancuerna unilateral" }),
  ],
  "Curl martillo": [mancuernas({ name: "Cruzado al pecho" })],
  "Curl inverso": [
    polea({ name: "Polea con barra" }),
    mancuernas(),
  ],
  // Skull crusher = press francés. Las variantes son de material, no otro
  // ejercicio.
  "Press francés": [
    barra({ name: "Barra recta", reps: [8, 12], rest: 90 }),
    mancuernas(),
    polea({ name: "Polea en banco" }),
  ],
  "Extensión de tríceps en polea": [
    polea({ name: "Polea unilateral supino" }),
    polea({ name: "Polea con barra en V" }),
  ],
  "Extensión de tríceps sobre la cabeza": [
    polea({ name: "Polea con barra" }),
    mancuernas({ name: "Mancuerna unilateral" }),
  ],
  "Prensa de piernas": [
    maquina({ name: "Prensa horizontal" }),
    maquina({ name: "Prensa vertical" }),
  ],
  "Extensión de cuádriceps": [maquina({ name: "Máquina unilateral" })],
  "Zancada búlgara": [
    multipower(),
    barra(),
  ],
  "Hip thrust": [
    multipower(),
    mancuernas({ name: "Mancuerna sobre la cadera" }),
  ],
  "Elevación de talones de pie": [
    maquina({ name: "En prensa de piernas" }),
    corporal({ name: "Peso corporal unilateral", reps: [12, 25] }),
    maquina({ name: "Burro (donkey)" }),
  ],
  "Elevación de talones sentado": [multipower()],
  "Elevación de piernas colgado": [
    corporal({ name: "Peso corporal (rodillas)", reps: [10, 20], step: 0 }),
  ],
  Plancha: [corporal({ name: "Peso corporal con lastre", reps: [1, 3] })],
  "Crunch abdominal": [
    polea({ name: "Polea de rodillas con barra" }),
    maquina({ name: "Máquina" }),
  ],
  "Jalón unilateral": [maquina({ name: "Máquina unilateral" })],
};
