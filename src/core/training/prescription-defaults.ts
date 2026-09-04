import {
  COMPOUND_PATTERNS,
  RIR_STABILITY_ADJUST,
  STABILITY_BY_EQUIPMENT,
  TARGET_RIR,
} from "@/core/config/training-config";

/**
 * RIR objetivo por defecto de una VARIANTE concreta. Puro y determinista.
 *
 * Hasta F3.2d esto dependía solo del ejercicio (`movementPattern` +
 * `systemicFatigue`), así que las cuatro variantes de "Press inclinado"
 * —barra, mancuernas, multipower y máquina— recibían el mismo objetivo, y la
 * sentadilla en multipower el mismo que la sentadilla con barra libre. El
 * patrón de movimiento describe QUÉ músculos trabajan y cuánto cuesta
 * sistémicamente; no dice nada sobre qué pasa si fallas, que es justo lo que
 * decide cuánta reserva merece la pena dejar.
 *
 * El modelo son tres factores, ninguno nuevo salvo el tercero:
 *
 *   1. ROL — compuesto o aislamiento (`movementPattern`).
 *   2. COSTE SISTÉMICO — `systemicFatigue` 1..3 del ejercicio.
 *   3. ESTABILIDAD — de la variante (`ExerciseStability`), con el material como
 *      default y declaración explícita para las excepciones.
 *
 * El ajuste solo se aplica a los COMPUESTOS, y eso es deliberado. Lo que lo
 * justifica —la consecuencia del fallo, la peor fiabilidad del RIR reportado y
 * el deterioro técnico— son argumentos sobre multiarticulares libres. En un
 * aislamiento fallar es soltar el peso: un curl con barra al fallo no es más
 * peligroso que uno en polea, así que subirle la reserva sería inventarse un
 * riesgo. Un aislamiento se entrena al fallo se haga con lo que se haga.
 *
 * Y dos topes que impiden que el ajuste degenere:
 *
 *   · un COMPUESTO nunca baja de 1 — llevar todas las series de un
 *     multiarticular al fallo es caro en fatiga se haga en máquina o no, y la
 *     evidencia no compra nada a cambio (Refalo 2023, Robinson 2024);
 *   · un compuesto nunca sube de 2, que es la reserva máxima que prescribimos.
 *
 * Ejemplos que el modelo separa y el anterior no:
 *   Sentadilla trasera barra (SQUAT, sf 3, FREE)      → 2
 *   Sentadilla trasera multipower (SQUAT, sf 3, GUIDED) → 1
 *   Press banca barra (H_PUSH, sf 2, FREE)            → 2
 *   Press banca máquina (H_PUSH, sf 2, GUIDED)        → 1
 *   Remo con barra (H_PULL, sf 3, FREE)               → 2
 *   Remo con apoyo pectoral máquina (H_PULL, sf 2, GUIDED) → 1
 *   Zancada búlgara mancuernas (LUNGE, sf 2, SUPPORTED)    → 1
 *   Elevación lateral (ISOLATION, sf 1, SUPPORTED)    → 0
 *   Curl con barra (ISOLATION, sf 1, FREE)            → 0  (el material no importa)
 *
 * Se usa como default EDITABLE al añadir un ejercicio a un programa (builder y
 * editor). Nunca reescribe lo ya prescrito: `TemplateExercise.targetRir` y
 * `WorkoutExercise.targetRir` son snapshots y no se tocan.
 */
export function defaultTargetRir(
  movementPattern: string,
  systemicFatigue: number,
  /** Estabilidad declarada de la variante; `null`/ausente = la del material. */
  stability?: string | null,
  /** Material de la variante. Sin él no hay default y se asume SUPPORTED. */
  equipment?: string | null,
): number {
  if (!COMPOUND_PATTERNS.has(movementPattern)) return TARGET_RIR.isolation;

  const base =
    systemicFatigue >= 3 ? TARGET_RIR.compoundHeavy : TARGET_RIR.compound;
  const adjust = RIR_STABILITY_ADJUST[resolveStability(stability, equipment)];
  return Math.min(
    Math.max(base + adjust, TARGET_RIR.compound),
    TARGET_RIR.compoundHeavy,
  );
}

/**
 * Estabilidad efectiva de una variante: la declarada si la hay, y si no la que
 * predice su material. `SUPPORTED` (ajuste 0) es el default de último recurso:
 * ante la duda, ni endurecer ni relajar la prescripción.
 */
export function resolveStability(
  stability?: string | null,
  equipment?: string | null,
): string {
  if (stability && stability in RIR_STABILITY_ADJUST) return stability;
  if (equipment && equipment in STABILITY_BY_EQUIPMENT) {
    return STABILITY_BY_EQUIPMENT[equipment];
  }
  return "SUPPORTED";
}
