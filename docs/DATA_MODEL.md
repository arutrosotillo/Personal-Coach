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
- `Goal` — tipo (FAT_LOSS/RECOMP/LEAN_GAIN/MAINTENANCE), estado, ritmo semanal (% peso/sem), peso objetivo opcional. Historial de objetivos = filas, no updates.
- `UserPreference` — clave/valor JSON validado (preferencias UI y de coach).
- `AppSetting` — clave/valor de sistema (versión de seed, etc.).

**Cuerpo y check-ins**
- `BodyMeasurement` — `@@unique(profileId, localDate)`; peso, cintura y perímetros opcionales, BF% estimado opcional.
- `ProgressPhoto` — pose, path relativo, soft-delete (F4 para la UI; tabla desde F1 por estabilidad).
- `DailyCheckIn` — `@@unique(profileId, localDate)`; todo opcional (peso, kcal, proteína, pasos, hambre, energía, sueño, entrenó, notas).
- `WeeklyCheckIn` — `@@unique(profileId, isoYear, isoWeek)`; snapshots calculados al cerrar + sensaciones preguntadas.
- `PersonalEvent` — tipo (12 valores), rango de fechas opcional, nota. Lo consumen los motores (D0, R4b) y las gráficas.

**Catálogo de entrenamiento**
- `MuscleGroup` — 16 grupos con `code` único (seed fijo; DELT_LATERAL, DORSAL, PECHO_SUPERIOR…).
- `Exercise` — nombre, patrón de movimiento, instrucciones cortas, activo/custom.
- `ExerciseMuscleContribution` — (ejercicio, grupo, rol, factor 0–1). **Los factores son aproximaciones operativas para contar volumen, no hechos científicos** — se documenta también en la UI.
- `ExerciseVariant` — el nivel donde vive el historial y la progresión (equipamiento, incremento mínimo de carga `loadStepKg`, contraindicaciones). Nunca se comparan cargas entre variantes.

**Programa**
- `TrainingProgram` → `Mesocycle` (estado, semanas, semana actual) → `WorkoutTemplate` (día) → `TemplateExercise` (variante, series base, rango de reps, RIR objetivo, descanso).
- `WorkoutSession` / `WorkoutExercise` / `SetLog` — definidos en el schema desde F1 (estables y centrales), operativos en F2. `SetLog` denormaliza `exerciseVariantId` + `localDate` con índice compuesto: historial y gráfica e1RM en una query.
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
