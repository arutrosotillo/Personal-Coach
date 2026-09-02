# Modelo de datos

Fuente de verdad ejecutable: `prisma/schema.prisma`. Este documento explica las decisiones; no duplica campo a campo.

## Convenciones

- IDs `cuid()` (portables a Postgres).
- Columnas "enum" = `String` validado por Zod (`src/core/enums.ts` es la fuente de verdad). Se mantienen como `String` a propósito, también en PostgreSQL: añadir un valor no debe requerir una migración.
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

- `BodyMeasurement` — `@@unique(profileId, localDate)`; peso, cintura y perímetros opcionales, BF% estimado opcional con su `bodyFatReliability`. **Fuente única de verdad del peso corporal** (ver la decisión de abajo).
- `ProgressPhoto` — pose, path relativo, soft-delete (F4 para la UI; tabla desde F1 por estabilidad).
- `DailyCheckIn` — `@@unique(profileId, localDate)`; todo opcional (kcal, proteína, pasos, hambre, energía, sueño, entrenó, notas). Su columna `weightKg` está **obsoleta**.
- `WeeklyCheckIn` — `@@unique(profileId, isoYear, isoWeek)`; snapshots calculados al cerrar + sensaciones preguntadas.
- `PersonalEvent` — tipo (12 valores), rango de fechas opcional, nota. **Sin implementar: la tabla existe desde F1 y está vacía; ningún motor ni pantalla la escribe o la lee todavía.** Su consumo por los motores (D0, R4b) y por las gráficas está especificado para F4–F5.

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

## Decisión: `BodyMeasurement` es la fuente única del peso corporal (B0)

`BodyMeasurement.weightKg` y `DailyCheckIn.weightKg` nacieron los dos en F1, con la misma clave `(profileId, localDate)` y los dos vacíos. Con dos sitios donde cabe el peso del mismo día, el motor de tendencia y el de nutrición acabarían leyendo números distintos para la misma fecha, y el fallo no se vería hasta que las cuentas no cuadraran.

- **`BodyMeasurement` es la única fuente longitudinal** de peso, perímetros y % graso. Todo motor, repositorio o pantalla que necesite "el peso" lo lee de aquí.
- **`DailyCheckIn.weightKg` queda obsoleta.** No se lee ni se escribe. La columna **no se borra todavía**: está vacía, quitarla es una migración destructiva que no arregla nada, y la retirada real va cuando F4 toque esa tabla de verdad. Mientras tanto el comentario del schema es la guarda.
- **Una fila por persona y día.** Toda escritura es un `upsert` contra `(profileId, localDate)`: registrar dos veces el mismo día actualiza, nunca duplica, y la última medición del día gana. Un pesaje no es un evento histórico que conservar; es el valor de ese día, y quien se pesa dos veces suele estar corrigiendo el primero.
- **Sin superficie IDOR en la escritura.** El cliente identifica la fila por FECHA, no por id, y el `profileId` sale siempre de la sesión (`requireProfileId()`). Solo el borrado necesita id, y ahí la guarda de propiedad es obligatoria.

### `bodyFatPct` y `bodyFatReliability`

El onboarding preguntaba el % graso y lo perdía: solo quedaba dentro del JSON de `AlgorithmDecision.inputSnapshot`, que es auditoría y no se consulta como serie. Ahora se guarda en `BodyMeasurement`, siempre acompañado de `bodyFatReliability` (`MEASURED` | `ESTIMATED`, enum en `src/core/enums.ts`).

La procedencia no es un adorno: una báscula de bioimpedancia doméstica tiene un error estándar de 3,1–7,5 puntos porcentuales frente a un modelo de 4 compartimentos, mientras que el **cambio** entre dos lecturas del mismo aparato baja a 1,7–2,6 pp porque el sesgo constante se cancela (Siedler & Tinsley 2023, `doi:10.1017/S0007114522003749`). Sin saber de dónde sale cada lectura no se puede distinguir un caso del otro. El % graso es siempre opcional y siempre una estimación; nunca se presenta como cifra absoluta.

## Decisión: check-in corporal y fases sin tablas nuevas (B4)

Tres necesidades, y solo una migración.

**Historial de fases → `Goal`, tal cual.** El modelo ya era historial: filas con `status`, nunca un registro mutable. Cambiar de estrategia cierra la fila activa (`SUPERSEDED`) y crea otra con `startDate` de hoy; corregir el ritmo o el peso objetivo edita la fila en sitio y NO toca `startDate`. La diferencia importa porque `startDate` es lo que se pasa como `analysisStartLocalDate` al motor corporal: abrir una fase reinicia lo que el motor considera "ahora".

- Regla exacta: **cambia `strategy` → fase nueva; cambia cualquier otra cosa → edición en sitio.** En esta app la dirección del peso la determina la estrategia y solo ella (`NUTRITION_CONFIG.weeklyRatePct` acota FAT_LOSS a negativos, LEAN_GAIN a positivos, RECOMP y MAINTENANCE a cero), así que pasar de −0,5 a −0,75 %/semana es la misma fase yendo más rápido. Vive en `core/body/goal-change.ts`, es pura y está probada por mutación.
- `SUPERSEDED` se añadió al enum `GoalStatus` sin migración (columna `String`). `ABANDONED` decía que te habías rendido y `COMPLETED` que habías llegado; ninguna es cierta al pasar de definición a mantenimiento.
- Cambiar de fase **no** recalcula el objetivo calórico ni toca el programa. Es una declaración de intención, no una orden para que los motores se reconfiguren.

**Check-in periódico → derivado, sin estado.** Un check-in _es_ una medición de cintura: el peso ya tiene su vía rápida y lo que el check-in aporta es la cintura, que es la métrica de cadencia lenta. La cadencia sale de `max(localDate)` con `waistCm != null` (`core/body/check-in.ts`, cada 14 días). Sin tabla, sin marca y auto-corrigiéndose: si borras la medición, el check-in "no ocurrió". Para un perfil que nunca ha medido cintura el estado es `NEVER_DONE` y el próximo vence HOY — nunca una deuda retroactiva desde el alta.

**`WeeklyCheckIn` NO se usa para esto.** Es un snapshot semanal ISO de nutrición y adherencia (`avgWeightKg`, `weightTrendKgPerWeek`, adherencias, fatiga/hambre/motivación): una caché de salidas de los motores de F4. Sigue vacía y sin consumidores. Reutilizarla por el parecido del nombre habría mezclado dos cosas distintas.

### Limitación conocida: `startDate` no distingue un cambio de ritmo importante

`Goal.startDate` marca el comienzo de una FASE, y una fase la define la estrategia. Un cambio grande de `weeklyRatePct` dentro de la misma estrategia —de −0,25 a −0,75 %/semana, por ejemplo— es una edición en sitio: no mueve `startDate` y por tanto no reinicia la ventana de tendencia.

Eso es correcto para la tendencia en sí (la dirección del peso no cambia, y los pesajes anteriores siguen describiendo lo mismo), pero **no es del todo correcto para comparar observado contra objetivo**: durante las primeras semanas tras el cambio, `goal.ratio` compara una pendiente medida sobre datos de dos ritmos distintos contra el ritmo nuevo. El número no es falso, pero es una media de dos regímenes.

**Decisión: NO se resuelve todavía.** Arreglarlo bien exigiría o una segunda fecha en `Goal` (`rateChangedAt`) o un historial de ediciones, y ninguna de las dos se justifica antes de ver qué consumidores necesitan de verdad esa precisión. Hoy el único que lee `ratio` es la tarjeta de objetivo de `/progress`, que lo enseña junto al ritmo real y al margen de error, así que el sesgo es visible. Revisar en B5/B6, cuando haya consumidores reales que decidan algo con ese número.

### `BodyMeasurement.waistProtocol` — la única migración

El error de medida de la cintura depende de cuántas tomas se promediaron: ~5,4 cm de cambio mínimo detectable con una, ~3,1 cm con la media de tres (Barrios 2016, `doi:10.1186/s12874-016-0150-2`). Sin esta columna solo cabían dos opciones y las dos eran malas: seguir aplicando 5,4 a mediciones que merecen 3,1, o bajar la constante global y aplicar a las mediciones de una sola toma —onboarding incluido— una precisión que no tienen.

- `null` = desconocido, y el motor lo trata como `SINGLE`. La columna no tiene `DEFAULT` a propósito: rellenar el pasado con un valor inventado era justo el problema.
- Solo el check-in, que pide las tres tomas, puede declarar `MEAN_OF_THREE`. Editar la cintura a mano desde el historial la deja en `null`.
- Cuando en la ventana conviven los dos protocolos, **manda el peor**: una serie no puede ser más precisa que su medida más burda.
- Las tres tomas crudas **no se persisten**. Lo que cambia el comportamiento del motor es el protocolo, no los valores sueltos; la media es el valor representativo y la dispersión ya se valida en la frontera (se rechaza si superan 5 cm de diferencia). Guardarlas permitiría estimar el error de medida propio de cada persona, pero nada lo consume. Añadir esa columna después es aditivo.

## Decisión: tablas de Coach AI pospuestas a Fase 6

`AIConversation`, `AIMessage`, `AISummary`, `AIUsage`, `AIProviderConfig`, `AIMemoryItem` **no** están en la migración inicial. Motivo: solo se referencian entre sí y a `profileId` (sin FKs entrantes desde entidades centrales), así que añadirlas después es una migración aditiva trivial; crearlas hoy sería esquema especulativo. Sus definiciones acordadas viven en `AI_COACH.md` §Modelo de datos. (Revisado explícitamente en F1 frente al plan v2, que las creaba en F1; se eligió la opción más simple.)

## Migraciones y seed

- `pnpm db:migrate` (prisma migrate dev) con SQL commiteado; nunca `db push` fuera de spikes.
- Seed idempotente (`pnpm db:seed`): upsert por claves naturales (`MuscleGroup.code`, `Exercise.name`, `ExerciseVariant (exerciseId, name)`); versión de seed en `AppSetting`. Ejecutarlo dos veces no duplica nada (verificado por test de integración).
- El seed NO crea perfil: el onboarding es el único camino de creación de datos personales. `SEED_DEMO=1` (futuro) añadirá historial sintético.
