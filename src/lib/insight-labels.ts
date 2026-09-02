import type { GoalAssessmentCode } from "@/core/insights";

/**
 * El insight, en español.
 *
 * REGLAS DEL COPY, y son las mismas invariantes del motor traducidas a prosa:
 *
 *   1. Se describen DOS HECHOS SIMULTÁNEOS, nunca una relación causal. La
 *      palabra "porque" no aparece en este archivo, y hay un test que lo
 *      comprueba.
 *   2. Nada de recetas. Ni "come más", ni "reduce el déficit", ni "descansa".
 *      Con peso y cargas no se puede saber cuál de esas cosas —si alguna— es
 *      la que toca, y proponerla sería inventar.
 *   3. Nada de veredictos sobre el cuerpo. Ni "estás perdiendo músculo" ni
 *      "estás ganando grasa": eso no se deduce de la báscula ni de la barra.
 *   4. Lenguaje no absoluto. "Coincide con", "a la vez", "por ahora".
 *
 * Cada entrada tiene un titular corto y un cuerpo que sitúa el dato. Las cifras
 * las pone el componente a partir de `insight.numbers`: aquí no se calcula nada.
 */

export interface InsightCopy {
  headline: string;
  body: string;
}

export const GOAL_ASSESSMENT_COPY: Record<GoalAssessmentCode, InsightCopy> = {
  LOSING_PERFORMANCE_UP: {
    headline: "Bajas de peso y tus cargas suben.",
    // No se dice "en un déficit": la app no registra ingesta, así que no
    // puede afirmar que lo haya. Lo que sí sabe es que el peso baja.
    body: "Las dos señales van a la vez en la dirección que buscabas, y es la combinación más difícil de conseguir mientras el peso baja.",
  },
  LOSING_PERFORMANCE_HELD: {
    headline: "Bajas de peso y tu rendimiento se mantiene.",
    body: "Perder peso sin que el entrenamiento se resienta es lo que se busca en una fase de definición.",
  },
  LOSING_PERFORMANCE_DOWN: {
    headline: "Tu peso baja y varios ejercicios han ido hacia atrás.",
    body: "Son dos hechos a la vez. Con peso y cargas no se puede saber si uno explica el otro: podrían ir juntos por muchas razones, o por ninguna. Merece que lo mires tú, con lo que sabes de tu semana.",
  },
  GAINING_PERFORMANCE_UP: {
    headline: "Ganas peso y tus cargas suben.",
    body: "Las dos señales acompañan a la fase de volumen que elegiste.",
  },
  GAINING_PERFORMANCE_HELD: {
    headline: "Ganas peso y tu rendimiento se mantiene.",
    body: "El peso se mueve como pediste. El entrenamiento, por ahora, ni sube ni baja.",
  },
  GAINING_PERFORMANCE_DOWN: {
    headline: "Tu peso sube y varios ejercicios han ido hacia atrás.",
    body: "Son dos hechos a la vez, y esta combinación es la menos esperable en una fase de volumen. El motor no puede decir a qué se debe; merece que lo mires con lo que sabes de estas semanas.",
  },
  RECOMP_SIGNAL: {
    headline: "Tu peso se mantiene y tus cargas suben.",
    body: "La báscula quieta y la barra subiendo es compatible con una mejora de composición corporal. Es una lectura razonable de los datos, no una medición: para verlo de verdad harían falta la cintura y el tiempo.",
  },
  WEIGHT_NOT_MOVING: {
    headline: "Tu peso no se está moviendo.",
    body: "Tu objetivo pide moverlo, y por ahora la tendencia dice que se mantiene. El dato es ese; qué hacer con él es una decisión tuya.",
  },
  MOVING_AGAINST_GOAL: {
    headline: "Tu peso se mueve en la dirección contraria a tu objetivo.",
    body: "Puede ser el objetivo el que ya no encaja, y no el peso: si has cambiado de plan, actualiza tu objetivo desde el check-in.",
  },
  HOLDING_AS_INTENDED: {
    headline: "Tu peso se mantiene, que es justo lo que buscabas.",
    body: "Y tu rendimiento se sostiene con él.",
  },
  WEIGHT_DRIFTING: {
    headline: "Tu objetivo es mantener el peso, pero se está moviendo.",
    body: "La tendencia lleva ya varias semanas en una dirección. Si el cambio es deliberado, puedes actualizar tu objetivo desde el check-in.",
  },
};
