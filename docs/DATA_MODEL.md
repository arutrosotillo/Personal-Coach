# Modelo de datos

Fuente de verdad ejecutable: `prisma/schema.prisma`. Este documento explica las decisiones; no duplica campo a campo.

## Convenciones

- IDs `cuid()` (portables a Postgres).
- Columnas "enum" = `String` validado por Zod (`src/core/enums.ts` es la fuente de verdad; SQLite no soporta enums nativos). Al migrar a Postgres pueden promoverse.
- `localDate` = `String` `YYYY-MM-DD` para días del usuario (único campo autoritativo para unicidad diaria y gráficas); `DateTime` UTC solo para auditoría.
- DB siempre métrica (kg/cm/kcal).
- Soft-delete (`deletedAt`) solo en entidades referenciadas por historial (Exercise, ExerciseVariant, plantillas, programas, fotos). Los logs se borran hard (borrar un log es una corrección deliberada).
- Snapshots contra reescritura del pasado: `WorkoutExercise` copia la prescripción de la plantilla en el momento de crear la sesión; `NutritionLog` copia los macros aunque venga de plantilla.
- Fotos: JAMÁS en la base de datos; filesystem `data/photos/` con path relativo en `ProgressPhoto` (F4).

## Entidades (F1 — migración inicial)

**Identidad y objetivo**

- `UserProfile` — sexo (para cálculo energético), fecha de nacimiento, altura, timezone, unitSystem. Una fila en la práctica, pero todo cuelga de `profileId`: multi-usuario futuro = añadir auth, no re-modelar.
- `Goal` — `strategy` (la intención elegida por el usuario en lenguaje natural: FAT_LOSS_MUSCLE_PRESERVATION / RECOMP_MAINTAIN_WEIGHT / LEAN_GAIN / MAINTENANCE) + `type` (comportamiento calórico interno derivado), estado, `startWeightKg`, ritmo semanal (% peso/sem), peso objetivo opcional. La estrategia separa la intención del comportamiento calórico para que "recomposición" nunca se confunda con "mantenimiento" cuando el usuario quiere perder peso. Historial de objetivos = filas, no updates.
- `UserPreference` — clave/valor JSON validado (preferencias UI y de coach).
- `AppSetting` — clave/valor de sistema (versión de seed, etc.).

**Cuerpo y check-ins**

- `BodyMeasurement` — `@@unique(profileId, localDate)`; peso, cintura y perímetros opcionales, BF% estimado opcional.
- `ProgressPhoto` — pose, path relativo, soft-delete (F4 para la UI; tabla desde F1 por estabilidad).
- `DailyCheckIn` — `@@unique(profileId, localDate)`; todo opcional (peso, kcal, proteína, pasos, hambre, energía, sueño, entrenó, notas).
- `WeeklyCheckIn` — `@@unique(profileId, isoYear, isoWeek)`; snapshots calculados al cerrar + sensaciones preguntadas.
- `PersonalEvent` — tipo (12 valores), rango de fechas opcional, nota. Lo consumen los motores (D0, R4b) y las gráficas.

**Catálogo de entrenamiento**

- `MuscleGroup` — 16 grupos con `code` único (seed fijo; DELT_LATERAL, DORSAL, PECHO_SUPERIOR…). Sin campo de prioridad: los volúmenes de partida viven en `training-config.ts` y la única prioridad es la que elige el usuario.
- `Exercise` — nombre, patrón de movimiento, instrucciones cortas, activo/custom.
- `ExerciseMuscleContribution` — (ejercicio, grupo, rol, factor 0–1). **Los factores son aproximaciones operativas para contar volumen, no hechos científicos** — se documenta también en la UI.
- `ExerciseVariant` — el nivel donde vive el historial y la progresión (equipamiento, incremento mínimo de carga `loadStepKg`, contraindicaciones). Nunca se comparan cargas entre variantes.

**Programa**

- `TrainingProgram` → `Mesocycle` (estado, semanas, semana actual) → `WorkoutTemplate` (día) → `TemplateExercise` (variante, series base, rango de reps, RIR objetivo, descanso).
- `WorkoutSession` / `WorkoutExercise` / `SetLog` — definidos en el schema desde F1 (estables y centrales), operativos en F2. `SetLog` denormaliza `exerciseVariantId` + `localDate` con índice compuesto: historial y gráfica e1RM en una query.
  - `WorkoutSession.weekKind` (`ACCUMULATION | DELOAD`) se escribe al FINALIZAR la sesión. Vale `DELOAD` solo si se cumplen las dos cosas: el motor recomendaba descarga en esa fecha (consultado antes de marcarla completada, así que no se cuenta a sí misma) y las series registradas quedan por debajo del 70 % de las que prescribe la plantilla. Lo consumen el motor de fatiga (esas sesiones no cuentan como "acortadas") y el contador de semanas de acumulación (se ancla en la última). Ver TRAINING_ENGINE.md §1e.
  - `WorkoutSession.weekNumber` se DERIVA de las fechas al crear la sesión (semanas ISO desde la primera del mesociclo). `Mesocycle.currentWeek` no lo incrementa nadie y no se lee.

  **`SetLog.rir` — semántica y límite histórico (Fase 3.2c).** `rir` es el esfuerzo que **el usuario reportó**, y es distinto de `WorkoutExercise.targetRir`, que es la **prescripción**. `null` significa **"no lo sé" / sin registrar**, y NUNCA se rellena solo: ni la UI lo prerrellena con el objetivo, ni el motor lo imputa. **Límite conocido:** antes de la Fase 3.2c la pantalla de ejecución prerrellenaba el campo con `targetRir`. Esas filas **se pueden localizar** por `completedAt` (la columna no se toca al reescribir), pero **no se puede saber si el valor de una de ellas fue elegido o heredado del prefill** — y un prefill es la entrada más permisiva posible para el motor (`rir === targetRir` nunca marca esfuerzo excesivo). No se corrigen retrospectivamente: no se inventa información. **Los datos de RIR fiables empiezan en la Fase 3.2c.** Si algún día existe historial anterior relevante, la opción honesta es mapearlo a `null` ("no lo sé") al leerlo, no reinterpretarlo.

  **Asimetría abierta (pendiente):** esta garantía cubre `SetLog.rir`. `reps` y `weightKg` SÍ se prerrellenan (con la última vez, o con el objetivo del motor al pulsar "Aplicar"), y son la evidencia que decide la progresión. Es defendible —son magnitudes que el usuario verifica físicamente y edita con steppers a un tap— pero conviene tenerlo escrito: el motor puede realimentarse si alguien completa series sin mirar.

  **`SetLog.technique`** existe en el schema pero **no se captura en ninguna pantalla**, así que **ningún motor tiene reglas que dependan de ella** (decisión explícita de F3.2c: no queremos una regla "científica" imposible de disparar). Si algún día se captura, la regla de técnica se añade entonces.

- `RecoveryCheckIn` — feedback post-sesión por grupo muscular (escala 1–5), operativo en F2/F3.

**Nutrición**

- `NutritionTarget` — serie temporal de objetivos (`@@unique(profileId, effectiveFrom)`), `source` MANUAL|ALGORITHM|ONBOARDING, enlace opcional (0..1) a la recomendación que lo produjo. El onboarding crea el primero (estimación inicial, F4 lo hace operativo).
- `NutritionLog`, `MealTemplate` — F4 para la UI; tablas desde F1.

**Trazabilidad**

- `AlgorithmDecision` — engine, versión, ruleId, inputSnapshot JSON, output JSON, explicación, fecha de evaluación.
- `Recommendation` — 1:1 con su decisión (`decisionId @unique`), tipo, scope, prioridad, estado, título, cuerpo, payload. El generador de programa inicial (F1) ya registra su decisión aquí: la trazabilidad nace con el primer dato.

## Decisión: tablas de Coach AI pospuestas a Fase 6

`AIConversation`, `AIMessage`, `AISummary`, `AIUsage`, `AIProviderConfig`, `AIMemoryItem` **no** están en la migración inicial. Motivo: solo se referencian entre sí y a `profileId` (sin FKs entrantes desde entidades centrales), así que añadirlas después es una migración aditiva trivial; crearlas hoy sería esquema especulativo. Sus definiciones acordadas viven en `AI_COACH.md` §Modelo de datos. (Revisado explícitamente en F1 frente al plan v2, que las creaba en F1; se eligió la opción más simple.)

## Migraciones y seed

- `pnpm db:migrate` (prisma migrate dev) con SQL commiteado; nunca `db push` fuera de spikes.
- Seed idempotente (`pnpm db:seed`): upsert por claves naturales (`MuscleGroup.code`, `Exercise.name`, `ExerciseVariant (exerciseId, name)`); versión de seed en `AppSetting`. Ejecutarlo dos veces no duplica nada (verificado por test de integración).
- El seed NO crea perfil: el onboarding es el único camino de creación de datos personales. `SEED_DEMO=1` (futuro) añadirá historial sintético.
