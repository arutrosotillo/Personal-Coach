# Recovery Engine — especificación v1.0

Motor puro determinista e independiente (`src/core/engines/recovery/`, F3). Produce **señales estructuradas**, jamás un "recovery score" numérico pseudocientífico. Training Engine y Nutrition Engine consumen su salida; Coach AI (F6) la usa para explicar relaciones, nunca la calcula.

## Inputs

- Pre-sesión (opcional, escala 1–5; si falta se imputa 3 = neutro): sueño, energía, estrés (invertida), DOMS por grupo.
- Post-sesión (chips 1–5): rendimiento percibido, pump, molestias articulares (+ articulación), fatiga, motivación.
- Duración real de sesiones vs mediana.
- Rendimiento objetivo (estados de estancamiento/caída por grupo del Training Engine).
- `DailyCheckIn`: horas de sueño, energía.
- `PersonalEvent`: enfermedad, estrés alto, mala semana de sueño, exámenes, trabajo intenso.

## Reglas de agregación

- Toda señal subjetiva se consume como **MM3** (media móvil de las 3 últimas sesiones válidas) o media semanal para decisiones semanales.
- **Ninguna señal con <3 muestras participa**: se considera "sin señal" (neutra) y degrada la confianza a MEDIUM como máximo.
- DOMS ≥4 en un grupo el día que toca entrenarlo → solo reordena la sesión; no cambia volumen.

## Output

```ts
type RecoveryAssessment = {
  status: "GOOD" | "WATCH" | "POOR" | "INSUFFICIENT_DATA";
  signals: RecoverySignal[]; // { kind, muscleGroup?, value, window, explanation }
  affectedScopes: string[]; // códigos de grupo muscular o "GLOBAL"
  confidence: "LOW" | "MEDIUM" | "HIGH";
};
```

Tipos de señal (`kind`): `PERFORMANCE_DROP`, `HIGH_FATIGUE`, `JOINT_PAIN`, `POOR_SLEEP`, `LOW_MOTIVATION`, `HIGH_STRESS`, `SESSION_DURATION_ANOMALY`, `PERSONAL_EVENT_CONTEXT`, `REPEATED_STALLING`.

Determinación de `status` (semanal):

- `INSUFFICIENT_DATA`: <3 muestras en todas las señales subjetivas y sin señales objetivas.
- `POOR`: ≥2 señales activas sostenidas 2 semanas (p. ej. fatiga MM ≥4 + sueño ≤2.5) o dolor articular en ≥2 articulaciones.
- `WATCH`: 1 señal activa sostenida, o ≥2 señales activas 1 semana.
- `GOOD`: resto.

Cada señal lleva su explicación con números ("fatiga reportada 4,3/5 de media en las últimas 2 semanas"), nunca un porcentaje agregado.

## Consumidores

- **Training Engine — volumen**: subir volumen exige `status = GOOD`; `POOR` sostenido dispara reducción (TRAINING_ENGINE.md §3).
- **Training Engine — deload**: las señales alimentan el score multi-señal (TRAINING_ENGINE.md §4); el umbral y la recomendación siguen siendo del Training Engine.
- **Nutrition Engine — R5**: energía ≤2/5 sostenida cuenta como "rendimiento deteriorándose" para subir kcal.
- **Safety Engine**: dolor ≥4/5 repetido en el mismo ejercicio → congelar progresión y sugerir profesional.
- **UI (F5)**: alertas de recuperación en Dashboard con las señales crudas.
- **Coach AI (F6)**: explica relaciones ("el descenso coincide con una semana marcada como exámenes y menos sueño") sin recalcular nada y sin afirmar causalidad.

## Qué NO hace

- No emite un número único de "recuperación".
- No ajusta nada por una única respuesta o sesión.
- No infiere causas: reporta señales y coincidencias temporales (PersonalEvents) como contexto.
