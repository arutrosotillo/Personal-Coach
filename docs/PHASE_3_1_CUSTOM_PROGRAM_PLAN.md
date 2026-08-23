# Fase 3.1 — Custom Program Builder (plan técnico)

**No implementa.** Todo verificado contra el código real (no asumido). Objetivo: poder
**crear un programa manual desde cero** que, una vez guardado, aterrice en **exactamente
las mismas filas** que el generado (`TrainingProgram → Mesocycle → WorkoutTemplate →
TemplateExercise`) y use **el mismo motor** de sesiones, snapshots, historial y progresión.

## 1. Arquitectura actual reutilizable (verificado)

- **Las cuatro tablas** (`prisma/schema.prisma`) son exactamente lo que un programa manual
  necesita: `TrainingProgram(name, daysPerWeek, description?, isActive, deletedAt?)` →
  `Mesocycle(ordinal, status, weeksPlanned)` → `WorkoutTemplate(name, ordinal, deletedAt?)`
  con `@@unique([mesocycleId, ordinal])` → `TemplateExercise(exerciseVariantId, ordinal,
  baseSets, repRangeMin/Max, targetRir, restSeconds)` con `@@unique([templateId, ordinal])`.
  **No hay campo `source`.**
- **La persistencia del generado** (`onboarding.service.ts:178-205`) es un `create` anidado
  de esas cuatro tablas + una `AlgorithmDecision`(engine `program-generator`) 1:1 con una
  `Recommendation`(type `INITIAL_PROGRAM`, scopeId=program.id). El manual replica el `create`
  de las cuatro tablas y **omite** la traza (no hay algoritmo).
- **Session runner / snapshots**: `startOrResumeSession` (`workout-session.service.ts:44-82`)
  copia `TemplateExercise → WorkoutExercise` de **cualquier** plantilla del perfil
  (`mesocycle: { program: { profileId } }`), sin comprobar el origen.
- **Historial**: `getVariantHistory` / `lastWorkingSetsForVariants` (`workout.repo.ts`)
  se anclan a `exerciseVariantId` **scoped al perfil, NO al programa** → el historial cruza
  programas.
- **Progresión**: `buildSuggestions` (`progression.service.ts`) lee el snapshot de la sesión
  + el historial por variante. **Puro y agnóstico al origen.**
- **Editor de F2A** (`program-editor.tsx` + `program-edit.service.ts` + `program.action.ts`):
  editar series/reps/RIR/descanso, cambiar variante, reordenar, quitar, **añadir** ejercicio
  — **todas funcionan sobre cualquier programa activo** (asertan `program:{profileId,
  isActive:true}`), incluido uno manual, sin cambios.
- **`getProgramRationale`** (`program.repo.ts:22-38`) devuelve `null` si no hay
  `INITIAL_PROGRAM` para el programa → **"manual vs generado" es DERIVABLE**, sin persistir.

**Verificación de la conclusión previa (grep exhaustivo):** el único punto del pipeline
sesión/historial/progresión que menciona el programa es `getTodayOverview` con `isActive`
(que un programa manual satisface). **Ningún código asume que el programa venga del
onboarding/generador.** La conclusión anterior (cero migración, mismas cuatro tablas) se
**confirma**.

## 2. Qué falta realmente (lo único nuevo en backend)

1. **Crear un programa manual** (`createManualProgram`): réplica transaccional del `create`
   anidado del onboarding, archivando el activo anterior. NO existe.
2. **Operaciones de DÍA**: hoy no hay `addDay / renameDay / removeDay / reorderDay` (la única
   `workoutTemplate.create` vive dentro de `restoreInitialProgram`). El editor de F2A solo
   opera a nivel de **ejercicio**. Ni siquiera un programa generado puede añadir/quitar días.
3. **Gating de `restoreInitialProgram`**: hace `findFirstOrThrow({type:"INITIAL_PROGRAM"})`
   (`program-edit.service.ts:179`) → **lanza para un programa manual**. Debe ocultarse y
   fallar suave.
4. **Punto de entrada** al builder y elección "generar vs crear".

Todo lo demás (sesión, snapshot, historial, progresión, edición por ejercicio) **se reutiliza
sin tocar**.

## 3. Propuesta UX (mobile-first)

**Entrada:**
- `/program` **sin programa**: dos CTAs — **"Generar mi plan"** (→ `/onboarding`) y
  **"Crear mi programa"** (→ `/program/new`).
- `/program` **con programa activo**: acción secundaria **"Crear un programa nuevo"** que
  ofrece generar/manual; el manual avisa "esto archiva tu programa actual (tu historial se
  conserva)".
- *(Opcional, fast-follow)* la elección "generar vs crear" dentro del onboarding requiere
  separar `completeOnboarding` (perfil/objetivo/nutrición) de la creación del programa. Se
  deja fuera de F3.1 para no tocar la transacción de onboarding; el manual se crea después.

**Builder (`/program/new`)** — editor **progresivo** sobre un **borrador en memoria**, se
persiste **de una sola vez**. Diseño afinado por el reviewer de UX móvil:

- **Arranque directo**: borrador con "Día 1" vacío y foco en "+ Añadir ejercicio". El nombre
  del programa (default "Mi programa") es editable arriba pero **no bloquea** ni va primero.
- **Acordeón de días**: tarjetas colapsables con **solo una expandida a la vez**; al añadir
  día se autoexpande la nueva. Día colapsado = resumen ("Día 2 · 5 ejercicios"). Evita el
  scroll infinito con varios días.
- **Añadir ejercicio en 1 tap/ejercicio**: la hoja de búsqueda (reutiliza `VariantPicker`)
  **permanece abierta** tras cada añadido (check/toast breve); cierras al terminar. Filtros
  como **chips** de músculo/equipo (no selects); fila de "usados en este programa"; autofoco
  del buscador solo al tocarlo (no abrir teclado de golpe).
- **Fila de ejercicio COLAPSADA** por defecto: muestra el resumen "3×8–12 · RIR 2 · 90s" y
  solo expande controles al tocar (los defaults del catálogo suelen bastar). Controles sin
  teclado: **series** stepper; **reps** como rango dual "8–12"; **RIR** en **chips 0–4**;
  **descanso** en pasos de 15 s. (Único componente nuevo real: el chip-group + el resumen
  de fila; el resto reutiliza `NumberField`.)
- **Reordenar** ↑↓ (≥44px) separado de quitar/sustituir (overflow) para no compartir target
  con acciones destructivas; drag se aplaza a validar en uso real.
- **Sin pantalla de "revisar" aparte**: el editor colapsado ES la revisión. Al pie, un panel
  **plegable y pasivo** de **volumen efectivo por músculo** (reutiliza el bloque "por qué")
  para detectar huecos antes de guardar — informativo, no bloqueante.
- **Guardar**: barra fija; deshabilitado hasta válido (≥1 día con ≥1 ejercicio) **con
  microcopy del motivo**; spinner → toast "Programa creado" → redirige. Aviso de descarte al
  salir con cambios.

**Mismo componente en dos modos (crear/editar)**: el builder y la edición posterior deben ser
el **mismo** editor en modo "borrador nuevo" vs "editar programa activo", no dos UIs. Es
decir, se **extiende `program-editor.tsx`** con controles de día + un modo borrador, en lugar
de crear un editor de días paralelo. El botón "Restaurar plan inicial" se **oculta** en
manuales (`canRestore`).

**Accesibilidad** (del review): `aria-label` en es-ES en todos los botones-icono
("Subir ejercicio", "Quitar Press banca"…); mover foco al elemento nuevo al añadir; steppers
con `aria-valuenow`/`aria-label`; chips RIR como `radiogroup`; confirmación destructiva con
foco inicial en "Cancelar".

**Tras guardar**: se reutiliza el mismo editor (F2A + controles de día) para toda edición.

### Archivado *(decisión aprobada: A — copy honesto, sin reactivación aún)*
Crear un programa **archiva** el activo (`isActive:false`, **no** se borra; historial intacto).
El aviso dirá exactamente: *"Tu programa actual se archiva (no se borra) y tu historial se
conserva"*, **sin** prometer reactivación en un tap. "Reactivar programa archivado" queda
como **fast-follow** (fuera de F3.1). La elección "generar vs crear" vive en **`/program`**
(dos CTAs en vacío; "Crear un programa nuevo" con programa activo); la elección dentro del
onboarding se aplaza (no se toca la transacción de `completeOnboarding`).

## 4. Defaults inteligentes (derivable vs heurística)

Al añadir un ejercicio (una variante del catálogo):
- **Rango de reps** (`repRangeMin/Max`): **DERIVABLE** del catálogo — `ExerciseVariant`
  ya trae `repRangeMin/repRangeMax` rol-apropiados (`listLibrary()` los expone).
- **Descanso** (`restSeconds`): **DERIVABLE** — `ExerciseVariant.defaultRestSeconds`.
- **Series** (`baseSets`) = **3**: **HEURÍSTICA nueva** (coincide con el default ya usado en
  `addTemplateExercise`). Editable; **el límite de 3 del generador NO aplica al manual**.
- **RIR** (`targetRir`) por **ROL** *(decisión aprobada)*: reutiliza `TARGET_RIR` de F3.2
  (compuesto pesado 3 / compuesto 2 / aislamiento 1) vía la lógica `costKindOf`
  (patrón de movimiento + `systemicFatigue`). Requiere exponer `systemicFatigue` en el picker
  (`listLibrary()` ya trae `movementPattern`; se añade `systemicFatigue`, lectura, sin
  migración) y un pequeño helper puro `defaultTargetRir(movementPattern, systemicFatigue)` en
  core. Editable.

## 5. Migración: **NINGUNA** (verificado)

Todo usa columnas existentes. El discriminante "manual vs generado" se **deriva** de la
existencia de la `Recommendation` `INITIAL_PROGRAM` (lo que ya computa `getProgramRationale`).
Un `TrainingProgram.source` sería redundante → **no**. Si en el futuro se derivara en muchos
sitios, la única migración mínima sería `source String @default("GENERATED")` (sin backfill),
pero **no es necesaria para F3.1**.

## 6. Reemplazar / cambiar programa

`createManualProgram` replica el archivado del onboarding
(`onboarding.service.ts:103`: `trainingProgram.updateMany({where:{profileId,isActive:true},
data:{isActive:false}})`) y crea el nuevo activo, **en una transacción**. El programa
anterior queda `isActive:false` (no borrado): sus mesociclos/plantillas/**sesiones**
permanecen. `getProfileOverview`/`getTodayOverview` recogen el nuevo activo sin cambios.

## 7. Historial (nunca desaparece)

- Las **sesiones completadas** y sus **snapshots** (`WorkoutExercise`) pertenecen al mesociclo
  del programa antiguo; **no se tocan** al crear/cambiar de programa.
- `getVariantHistory` está **scoped al perfil, no al programa** → si dentro de 3 meses vuelves
  a "Press banca" (misma `exerciseVariantId`, en un programa manual nuevo), su **historial,
  e1RM y tendencia previos siguen ahí**. Verificado.
- Editar el programa después **no** reescribe historia (probado en F2A: el snapshot es
  independiente de la plantilla).

## 8. Relación exacta con `progression.ts`

Idéntica a un generado: manual `Bench 3×6–8@2` → `startOrResumeSession` (snapshot) →
`SetLog`s → `getVariantHistory`(variantId) → `buildSuggestions` → sugerencia efímera
"próxima: 82.5 kg". Verificado que **ningún** código del motor asume origen. Un futuro
"aplicar sugerencia al programa" reutilizaría `editTemplateExerciseAction` (solo series/
reps/RIR; la carga vive en `SetLog`, no en la plantilla) — igual para manual y generado.

## 9. Validaciones (invariantes, sin fisiología agresiva)

`src/core/schemas/manual-program.ts` (Zod), reutilizando límites de `template-edit.ts`:
- Programa: `name` 1–80; `days` **1–7** (el schema permite cualquier nº; 7 como tope UX).
- Día: `name` 1–60; `exercises` **≥1**.
- Ejercicio: `exerciseVariantId` no vacío; `baseSets` **1–10** (permite 5×5 — el máx 3 del
  generador **no** aplica); `repRangeMin/Max` 1–50 con `repMin ≤ repMax` (se normaliza);
  `targetRir` 0–5; `restSeconds` 30–600.
- **Ordinales**: los asigna el servidor por el orden del array (no los edita el usuario).
- **Duplicado de variante en un día**: permitido (supersets/repeticiones); como mucho un
  **aviso informativo**, nunca bloqueo.
- Los límites del generador (F3.2) **no** se convierten en límites del manual: como mucho
  warnings informativos (p.ej. "5 series es alto"), no bloqueos.

## 10. Componentes / services / actions nuevos

**Nuevo (backend):**
- `src/core/schemas/manual-program.ts` — Zod del borrador.
- `src/server/services/manual-program.service.ts` — `createManualProgram(profileId, input,
  now)` (transaccional; archiva + crea las cuatro tablas).
- En `program-edit.service.ts`: `addDay`, `renameDay`, `removeDay` (con la danza de
  ordinales/soft-delete que ya usa `restoreInitialProgram` para plantillas con sesiones),
  `reorderDay` (swap de ordinales con temporal `-1`, como `reorderTemplateExercise`).
- En `program.action.ts`: `createManualProgramAction`, `addDayAction`, `renameDayAction`,
  `removeDayAction`, `reorderDayAction`. Guard de `restoreInitialProgram` (soft-fail).

**Nuevo (UI):**
- `src/app/program/new/page.tsx` + `ProgramBuilder` (cliente) — reutiliza `VariantPicker`,
  `NumberField`, `Card`, `Drawer`.
- CTAs de entrada en `src/app/program/page.tsx`.
- `ProgramEditor` (F2A): **añadir controles de día** (add/rename/remove/reorder) + prop
  `canRestore` para ocultar restaurar en manuales.

**Reutilizado sin cambios:** todo el pipeline de sesión/snapshot/historial/progresión, las
5 ediciones por ejercicio, `listLibrary`/`listSubstitutionOptions`, `getProfileOverview`,
`getProgramRationale` (ruta null), `NumberField`/`VariantPicker`.

**Repo:** el picker del builder reutiliza `listLibrary()` (ya expone repRange + rest por
variante). Sin repo nuevo.

## 11. Tests

- **Unit** (schema): validación (≥1 día, día ≥1 ejercicio, sets>0, repMin≤repMax, RIR/rest
  válidos, 5 series permitido, nombre requerido); normalización de repMin/Max.
- **Integración** (`manual-program.test.ts`, DB real): `createManualProgram` produce
  **exactamente la misma forma** de tablas que un generado (compara shape); múltiples días;
  archiva el activo anterior y **conserva** su historial; ordinales 1..N consistentes.
  Day-ops: addDay/renameDay/removeDay (con y sin sesiones → soft-delete)/reorderDay.
  **Programa manual → startOrResumeSession → snapshot correcto → logSet → finishSession →
  `buildSuggestions` sugiere** (mismo motor). **Editar después no modifica historia**
  (regresión del snapshot). **Cambiar de programa preserva sesiones anteriores** y el
  historial por variante cruza el cambio. **Programa generado sigue funcionando.**
  **restore**: para manual → `canRestore` false y el servicio falla suave (no lanza); para
  generado → sigue funcionando.
- **E2E móvil** (`custom-program.spec.ts`): crear programa manual (nombre, día, añadir
  ejercicios con defaults, guardar) → aparece en `/program` → empezar sesión → registrar →
  finalizar → **segunda sesión muestra "última vez"/sugerencia** del ejercicio manual.
- Reutilizar el helper `seedCompletedSessionWithSets` donde ayude.

## 12. Edge cases

- **Día vacío**: bloqueado al crear (`exercises ≥ 1`); post-hoc, `removeTemplateExercise`
  puede vaciarlo → "Empezar" deshabilitado si 0 ejercicios.
- **Borrar el último día**: `removeDay` lo rechaza (invariante ≥1 día).
- **removeDay de un día con sesiones**: soft-delete + ordinal negativo (historial intacto).
- **Variante duplicada en un día**: permitido (aviso suave; "última vez" se fusiona por
  variante).
- **Cambiar manual↔generado**: archiva el previo; historial (por variante, por perfil)
  sobrevive.
- **restore en manual**: oculto + soft-fail (nunca lanza).
- **1–7 días**: soportado (el schema no restringe; el generador seguía en 2–6, el manual no).
- **Sin perfil (primer uso)**: el manual requiere un perfil (lo crea el onboarding); F3.1
  ofrece el builder desde `/program` (perfil ya existe). La elección en onboarding es
  fast-follow (§3).

## 13. Plan de implementación por commits

1. **Schema Zod + `createManualProgram` + action** (archiva + crea las 4 tablas) + unit/
   integración de "misma forma que el generado" y archivado.
2. **Day-ops** (`addDay/renameDay/removeDay/reorderDay`) service+actions + integración
   (incluida la rama soft-delete con sesiones).
3. **Gating de restore** (`canRestore` derivado de `getProgramRationale`; soft-fail del
   servicio) + tests.
4. **Builder UI** (`/program/new` + `ProgramBuilder`) + CTAs de entrada en `/program`.
5. **Controles de día en `ProgramEditor`** (edición posterior) + `canRestore`.
6. **E2E móvil** + reviewers (UX, correctness, integridad de historial) + verificación final
   (typecheck/lint/unit/integración/E2E/build) + docs.

Cada commit pequeño, verde y sin migración. `progression.ts`, sesiones y snapshots **no se
tocan**.
