# Fase 3 — Investigación y diseño (auditoría científica + programa manual)

Documento de investigación. **No implementa nada.** Distingue en cada punto:
**[FUERTE]** evidencia científica sólida · **[RAZONABLE]** evidencia razonable pero
incierta · **[HEURÍSTICA]** decisión de producto/convención sin respaldo fuerte.

Números de volumen calculados con el generador **real** (`generateInitialProgram`)
sobre el catálogo real (`src/core/catalog/exercises.ts`), no estimados.

---

## 1. Cómo funciona el sistema actualmente

**Generación de programa** (`src/core/program/generate-initial-program.ts`, v2.0.0):
determinista. Para cada nº de días hay una división fija (`splits.ts`) que declara
qué grupos se pueden tocar cada día. El generador reparte un **objetivo de series
DIRECTAS semanales por grupo** (`BASELINE_WEEKLY_SETS` + `PRIORITY_BONUS_SETS`,
techo `MAX_WEEKLY_SETS=20`, suelo `MIN_WEEKLY_SETS`) rellenando cada día ejercicio
a ejercicio: elige el grupo más necesitado, un ejercicio del catálogo cuyo grupo
PRIMARIO sea ese, y le asigna `ceil(need)` series acotado a `SETS_PER_EXERCISE`
(min 2, max 4, **maxPriority 5**) y al tope por grupo/sesión (`standard 4 / priority 6`).
Descuenta el volumen fraccional de cada contribución (`sets × factor`) del "restante"
de todos los grupos que el ejercicio toca. Presupuesto de tiempo por minutos/sesión.

**RIR**: fijo por rol (`TARGET_RIR`): compuesto pesado 3, compuesto 2, aislamiento 1.
No hay progresión de RIR dentro del mesociclo (la doc §2 la menciona pero **no está
implementada**).

**e1RM**: Epley con reps efectivas (`reps+min(rir,4)`), null si >12. Se persiste por
serie; solo tendencia intra-variante.

**Progresión (Fase 2B, implementada)**: `src/core/training/progression.ts`. Double
progression **solo-sugerencia, efímera**, nunca modifica el programa ni baja el peso:
`START/INCREASE_LOAD/ADD_REP/HOLD`. Ancla a `exerciseVariantId`, prescripción del
snapshot. Es agnóstica a cómo se creó el programa.

**Deload / mesociclos / D0–D10**: **especificados en `TRAINING_ENGINE.md` §2–§6 pero
NO implementados** (F3). El deload es un score multiseñal reactivo (rendimiento,
fatiga, dolor articular, estancamiento, sueño, motivación, semanas-sin-deload);
"≥5 → recomendar, nunca automático". Mesociclo 4–8 sem. Estancamiento por regresión
lineal de e1RM.

---

## 2. Evidencia científica relevante (con fuerza y fuentes)

- **Dosis-respuesta de volumen** — Pelland et al. 2025, *Sports Medicine* (67 estudios,
  2 058 sujetos): hipertrofia y fuerza **aumentan con el volumen con rendimientos
  decrecientes** (más marcados en fuerza). Para hipertrofia la curva **no muestra un
  techo claro** en el rango estudiado, pero el margen por serie se estrecha y la
  incertidumbre a volúmenes altos es grande. **Modelaron el conteo fraccional
  (directo 1.0 / indirecto 0.5 / no cuenta 0) y lo consideran esencial.** [FUERTE la
  dirección; RAZONABLE los rendimientos decrecientes; HEURÍSTICA dónde está el óptimo].
- **Schoenfeld, Ogborn & Krieger 2017** (15 estudios): ~+0.37 %/serie/semana; ganancias
  ya con ≤4–6 series/sem (relevante para principiantes). Pocos estudios >20 series →
  el "~10 series" es una inflexión en datos escasos, **no un techo**. [FUERTE dirección].
- **Baz-Valle et al. 2022**: banda práctica **12–20 series/músculo/sem** para entrenados
  jóvenes. [HEURÍSTICA/RAZONABLE — síntesis experta, no óptimo medido].
- **Rampa de volumen** — Enes et al. 2024, *MSSE* (12 sem, entrenados): añadir series
  cada 2 sem mejoró **fuerza**; hipertrofia **pequeña e incierta** vs volumen constante.
  Ninguna meta demuestra que rampar MEV→MRV supere a un volumen moderado constante
  para hipertrofia. [HEURÍSTICA leaning RAZONABLE].
- **Proximidad al fallo / RIR** — Refalo 2023 (*Sports Med*, ES≈0.15–0.21) y Robinson/
  Refalo 2024 (*Sports Med*, 55 hipertrofia + 67 fuerza): **más cerca del fallo → algo
  más de hipertrofia (efecto pequeño)**; **la fuerza es casi insensible al RIR**.
  Grgic 2021: fallo vs no-fallo → hipertrofia/fuerza similares. **El fallo NO es
  necesario** y cuesta fatiga desproporcionada, sobre todo en compuestos. [FUERTE en
  fuerza; RAZONABLE el pequeño beneficio en hipertrofia].
- **Precisión del RIR** — Halperin/Steele: los levantadores **subestiman** las reps que
  les quedan; entrenados ≈ ±1–2 reps, novatos ±4–5; la precisión mejora **cerca del
  fallo** (0–2). [FUERTE]. → RIR es fiable **solo en entrenados y a RIR bajo**.
- **Frecuencia** — Schoenfeld 2019 (25 estudios, volumen igualado): con volumen
  igualado, la frecuencia (1×/2×/3×) **no cambia la hipertrofia**; es un vehículo para
  repartir volumen. ≥2×/sem como default sensato. [FUERTE].
- **Progresión carga vs reps** — Plotkin et al. 2022, *PeerJ*: progresar **carga o reps
  produce hipertrofia equivalente**. → Los dos brazos de la double progression son
  intercambiables; no hace falta añadir peso externo para crecer. [FUERTE].
- **Periodización** — Grgic 2017/2021 y meta 2022: para **hipertrofia** el estilo
  (lineal vs ondulante) y "periodizar vs no" es **indiferente**; periodizar ayuda a la
  **fuerza**. [FUERTE].
- **Deload** — "Gaining more from doing less?" 2024 y RCTs: los deloads **no mejoran la
  hipertrofia**; sirven como **gestión de fatiga** sin penalizar ganancias. Consenso
  Delphi 2023: práctica casi universal, marco fitness-fatiga, **no prueba de
  superioridad**. [HEURÍSTICA].
- **Selección de ejercicio / posición alargada** — Wolf 2023 y metas 2024: **entrenar
  en posición alargada ≥ ROM completo > posición acortada** (ES≈0.28, pequeño pero
  consistente). Variación regional moderada ayuda; rotación excesiva diluye. [RAZONABLE].

**Filosofías (caracterizadas, no adoptadas):** RP/Israetel (MEV/MAV/MRV, rampa a MRV,
deloads) es coherente y útil como marco de autorregulación, pero **la precisión de sus
landmarks y la superioridad de la rampa/deload para hipertrofia no están probadas** —
son heurísticas presentadas como constantes. Kinobody/O'Gallagher (bajo volumen, alta
intensidad, RPT al fallo en compuestos) es eficiente y válido para fuerza/estética, pero
para **maximizar hipertrofia en entrenados** sus volúmenes suelen quedar **por debajo de
la banda productiva** y su RPT al fallo en compuestos maximiza justo la fatiga que la
literatura desaconseja. **Síntesis defendible = punto medio**: volumen efectivo moderado
y progresivo, ≥2×/sem, RIR 1–3 con fallo reservado a aislamientos, double progression
como motor, selección con sesgo a posición alargada, deloads como seguro de fatiga.

---

## 3. Qué está científicamente bien

- **Conteo de volumen fraccional (directo + indirecto ponderado)** — validado por
  Pelland 2025 (que usa exactamente directo 1.0 / indirecto 0.5). El enfoque del app es
  correcto de concepto. [FUERTE].
- **RIR fijo por rol (compuesto pesado 3, compuesto 2, aislamiento 1)** — bien alineado:
  moderado, reserva el fallo para lo de bajo coste de fatiga. [RAZONABLE/FUERTE].
- **Double progression solo-sugerencia (2B), nunca baja peso automático, nunca añade
  sets sola** — alineado con Plotkin (carga↔reps intercambiables) y con la preferencia
  del usuario. [FUERTE].
- **Deload reactivo multiseñal (spec §4), nunca automático** — alineado con la evidencia
  (reactivo > calendario arbitrario). [RAZONABLE].
- **e1RM solo como tendencia intra-variante, con "~"** — honesto. [FUERTE].
- **≥2×/sem para grupos grandes** como objetivo del reparto — correcto. [FUERTE].
- **Trazabilidad y snapshots** — buena base; el motor es agnóstico al origen del programa.

---

## 4. Qué es cuestionable

1. **Volumen inicial demasiado alto y "todo a tope" desde la semana 1** (ver §6).
2. **El objetivo semanal = volumen de partida** (sin rampa): la semana 1 arranca en el
   objetivo pleno en vez de en un punto conservador. [choca con la idea de MEV→construir].
3. **El volumen NO escala con los días**: 3 días = 60 series directas/sem; 6 días = 69.
   Más días → sesiones diminutas (5–6 series), no más volumen semanal. Backwards.
4. **Suelo/objetivo sobre series DIRECTAS, ignorando el indirecto**: contradicción real
   (glúteo 11.3 efectivas y a la vez AVISO "solo caben 2 directas < mínimo 3").
5. **Sesiones muy densas**: 3 días día A = 24 series / 74 min.
6. **Volumen indirecto redundante no acotado** (glúteo 9.3 indirectas de sentadilla+RDL+
   hip thrust+prensa).
7. **Repetición del mismo ejercicio** entre días (Remo al mentón 2–3×) por menú estrecho.
8. **Sin sesgo a posición alargada** en la selección. [oportunidad barata, RAZONABLE].
9. **La 3→2→1→0 de RIR de la spec no está justificada** (Robinson/Refalo: beneficio
   pequeño, más fatiga). Mantener RIR fijo moderado es igual de eficaz con menos fatiga.
10. **RIR de novatos tratado como fiable**: para principiantes el RIR es ruido (±4–5);
    la progresión debería guiarse por reps, no por RIR.

---

## 5. Bugs conceptuales encontrados

- **B1 — Contradicción directo/fraccional (real).** `MIN_WEEKLY_SETS` y los avisos se
  evalúan sobre `directSets` (`generate-initial-program.ts:309`), ignorando el enorme
  volumen indirecto. Resultado observado: glúteo con **11.3 series efectivas** genera el
  aviso "solo caben 2 series directas (mínimo 3)". El sistema regaña por infra-entrenar
  un músculo que está **sobre-estimulado**. Debe razonar en **volumen efectivo**.
- **B2 — El volumen no escala con la frecuencia/días.** El objetivo semanal es fijo por
  grupo con independencia de los días; con 6 días se fragmenta en sesiones de 5–6 series
  (`Empuje B: 6 series`, `Tirón B: 5 series`). Más días debería permitir algo más de
  volumen semanal y/o ≥2× de frecuencia, no relleno.
- **B3 — Arranque en el techo por ejercicio.** `SETS_PER_EXERCISE.max=4` (5 prioridad)
  hace que casi todos los ejercicios arranquen en 4 series la **semana 1** (ver §6),
  dejando poco margen para progresar antes de estar ya en volumen alto. Confunde "más
  volumen inicial" con "tener recorrido de progresión".
- **B4 — Indirecto redundante no acotado.** El "restante" se descuenta pero nada impide
  acumular indirecto muy por encima del objetivo efectivo (glúteo, trapecio, delt.
  anterior).
- **B5 — Redundancia de ejercicio.** El menú de un grupo con una sola opción compuesta
  (delt. lateral → "Remo al mentón") fuerza el mismo ejercicio varios días.

Ninguno es un bug de código roto: el generador hace lo que dice. Son **decisiones de
diseño** que producen volumen/estructura no óptimos.

---

## 6. Auditoría de volumen con números reales

Series efectivas = **directas + Σ(indirectas × factor)** (factor del catálogo; valida
Pelland con 0.5 de referencia). "indir.ef" = efectivas − directas.

### 6.1 Distribución de series POR EJERCICIO en la semana 1 (la sospecha del usuario)

| Programa | 2 series | 3 series | 4 series | 5 series |
|---|---|---|---|---|
| 3 días equilibrado | 3 ej. | 2 ej. | **12 ej.** | — |
| 4 días equilibrado | 10 ej. | 2 ej. | **11 ej.** | — |
| 4 días con prioridad | 6 ej. | 2 ej. | **10 ej.** | **3 ej.** |
| 5 días equilibrado | 8 ej. | 3 ej. | **11 ej.** | — |

**Confirmado: la mayoría de ejercicios arrancan en 4 series (el máximo) desde la
semana 1; con prioridad, 5.** Esto es lo que viste. Es el techo por ejercicio, no una
progresión.

### 6.2 Volumen semanal por músculo — 3 días equilibrado (75 min)

Total: **60 series directas/sem**. Día A = 24 series/74 min, Día B = 20, Día C = 16.

| Músculo | dir | indir.ef | **total.ef** | frec | target |
|---|---|---|---|---|---|
| Glúteo | 2 | 9.3 | **11.3** | 1 | 6 |
| Bíceps | 4 | 5.5 | **9.5** | 1 | 7 |
| Dorsal | 7 | 2 | **9** | 2 | 9 |
| Tríceps | 4 | 5 | **9** | 2 | 7 |
| Deltoide lateral | 8 | 0 | **8** | 2 | 8 |
| Cuádriceps | 8 | 0 | **8** | 2 | 9 |
| Isquios | 7 | 1 | **8** | 2 | 8 |
| Deltoide posterior | 4 | 2.8 | **6.8** | 1 | 6 |
| Espalda alta | 4 | 2.8 | **6.8** | 1 | 6 |
| Trapecio superior | 0 | 6.8 | **6.8** | 0 | 3 |
| Pecho medio/inf | 4 | 2 | **6** | 1 | 6 |
| Pecho superior | 4 | 0 | **4** | 1 | 6 |
| Gemelo | 4 | 0 | **4** | 1 | 6 |

AVISO real emitido: *"Glúteo: solo caben 2 series directas (mínimo 3)"* — pese a 11.3
efectivas (**B1**). Frecuencia = 1 para glúteo, bíceps, pecho, gemelo (**por debajo del
≥2× recomendado**).

### 6.3 Otros programas (resumen)

- **4 días torso/pierna**: 70 directas/sem. Torso B = 23 series. Glúteo 13.3 ef.,
  bíceps 9.5, tríceps 9.5. Varios grupos a frecuencia 1.
- **4 días prioridad (delt. lat + bíceps)**: 73 directas/sem; ejercicios de 5 series;
  bíceps 14.5 ef., delt. lateral 10.
- **5 días**: 69 directas/sem. **6 días**: **69** directas/sem con sesiones de relleno
  (Empuje B 6 series, Tirón B 5). → **B2** evidente.
- **3 días FAT_LOSS** (factor 0.85): 57 directas/sem — bien que reduzca, pero sigue con
  24 series el día A y todo a 4 series.

**Veredicto:** el volumen **efectivo semanal** (8–13/músculo en grupos grandes) cae
dentro de la banda productiva para un **entrenado**, pero: (a) arranca ahí desde la
semana 1 sin recorrido; (b) con 4–5 series por ejercicio; (c) sesiones de hasta 24
series; (d) no escala con días; (e) el suelo directo contradice el indirecto. Para un
**principiante** (la mayoría de usuarios nuevos) es **demasiado**.

---

## 7. Propuesta revisada de volumen

Principios: **razonar en volumen efectivo** (dir + Σ indir×factor), **arrancar
conservador con recorrido**, **la progresión (reps/carga) es el motor; añadir series es
secundario y deliberado**.

- **P1 — Objetivos y suelos en EFECTIVO, no en directo.** Sustituir `BASELINE_WEEKLY_SETS`
  y `MIN_WEEKLY_SETS` (directos) por objetivos de **volumen efectivo** por músculo. El
  generador reparte hasta alcanzar el efectivo, contando el indirecto. Arregla **B1** y
  **B4** (el indirecto que ya cubre un músculo reduce su necesidad de directo). [RAZONABLE]
- **P2 — Arrancar por debajo del objetivo (semana 1 = punto de partida, no objetivo
  pleno).** Banda de partida por experiencia (usar `trainingYears`):
  - principiante (0–1 años): ~**8–10** efectivas/músculo grande;
  - intermedio (2–4): ~**10–14**;
  - avanzado (5+): ~**12–16** (nunca techo duro; rendimientos decrecientes).
  [RAZONABLE la dirección; HEURÍSTICA los números exactos]
- **P3 — Menos series por ejercicio al inicio.** `SETS_PER_EXERCISE.max` de 4→**3** (y
  quitar el bonus a 5 en prioridad; la prioridad sube el objetivo semanal, no las series
  por ejercicio). Un músculo llega a su volumen con 2 ejercicios × 3 series, no con 1×4–5.
  Arregla **B3**. [RAZONABLE]
- **P4 — Escalar volumen con los días y garantizar ≥2× de frecuencia** para músculos
  grandes: el objetivo efectivo crece modestamente con más días disponibles, y el reparto
  asegura que cada grupo grande aparezca ≥2 días. Arregla **B2** y las frecuencias 1.
  [RAZONABLE la frecuencia; HEURÍSTICA el escalado]
- **P5 — Tope de densidad de sesión.** Límite blando de series de trabajo por sesión
  (p.ej. ~18–20) y por músculo/sesión (ya existe, 4/6 → bajar a **3–4**), para no producir
  sesiones de 24 series. [HEURÍSTICA]
- **P6 — Rampa de volumen deliberada dentro del mesociclo** (opcional, F3.3): +1 serie a
  un grupo cada 1–2 semanas **solo si la recuperación lo permite** (señales de deload
  bajas), hasta un máximo, luego deload. Marcado como gestión, no como "más = mejor".
  [HEURÍSTICA leaning RAZONABLE]
- **FAT_LOSS**: mantener el factor reductor (0.85) — correcto en déficit.

Efecto esperado (proyección; a validar re-ejecutando el generador tras implementar):
3 días pasaría de ~60 a ~**40–46** directas/sem, ejercicios a 2–3 series, día A ~16–18
series, sin el aviso contradictorio de glúteo, con pecho/gemelo/bíceps a frecuencia 2.

---

## 8. Propuesta revisada de RIR

- **Mantener RIR fijo por rol** (compuesto pesado 3, compuesto 2, aislamiento 1). Está
  bien alineado con la evidencia y es simple. [RAZONABLE/FUERTE].
- **NO implementar la rampa 3→2→1→0** como si mejorara la hipertrofia (Robinson/Refalo:
  beneficio pequeño, más fatiga). Como MUCHO, una reducción suave de 1 punto en la última
  semana de acumulación **como gestión de fatiga**, etiquetada [HEURÍSTICA] — opcional y
  de baja prioridad.
- **Reservar el fallo (RIR 0) a aislamientos/máquinas**; nunca en compuestos pesados. Ya
  lo hace el motor 2B (near-failure bloquea la subida). [RAZONABLE].
- **Principiantes**: no confiar en su RIR (±4–5 reps). Progresión guiada por **reps
  (double progression)**, RIR con peso bajo en la confianza. El motor 2B ya imputa RIR y
  degrada confianza; añadir un modo "principiante" que ignore RIR para decidir. [FUERTE
  la premisa; HEURÍSTICA el corte por años].

---

## 9. Propuesta revisada de progressive overload

Prioridad de progresión **exactamente como pide el usuario**, y ya casi lo hace 2B:

1. **Técnica** primero (regla `LOW_TECHNIQUE` latente → activar captura de técnica ligera).
2. **Completar el rango de reps** (no subir si alguna serie < repMin).
3. **Progresar reps** (`ADD_REP`) dentro del rango.
4. **Progresar carga** (`INCREASE_LOAD`) al cerrar el techo con RIR ≥ objetivo.
5. **Añadir volumen solo cuando se justifique** — **NO** semanalmente. Añadir series es un
   evento de **límite de mesociclo** (P6), gated por recuperación, nunca automático por
   "una buena sesión". Plotkin valida que reps/carga ya bastan para crecer.

Reglas deterministas (extensión del motor 2B, mismo estilo testeable):

- Conservar `START/INCREASE_LOAD/ADD_REP/HOLD` (2B) tal cual.
- Añadir (F3.4, desde la doc D0–D10, subconjunto honesto):
  - **`DECREASE_LOAD`** solo tras **caída sostenida de e1RM** (≥2 sesiones válidas con
    Δe1RM < −X% y RIR ≤ objetivo) — nunca por una sesión floja. [RAZONABLE].
  - **`ADD_SET` / `REMOVE_SET`** solo a nivel de **mesociclo**, no por sesión, y gated por
    señales de recuperación. [HEURÍSTICA].
  - Deprecar de la spec: `CALIBRACION`/`RECONSTRUCCION` como modos complejos y el `D6a`
    de rango extendido — no aportan valor todavía (no overengineering).

---

## 10. Propuesta de mesociclos / deload

- **Mantener el modelo reactivo multiseñal** (spec §4) usando lo que ya guardamos:
  `perceivedPerformance`, `pump`, `jointPain`, `fatigue`, `motivation` (feedback de sesión)
  + caída de rendimiento/e1RM + estancamiento. Score → **recomendar** deload, **nunca
  automático**, listando las señales con números. [RAZONABLE].
- **Reformular la comunicación**: el deload es **seguro de fatiga**, NO un potenciador de
  hipertrofia (la evidencia no lo respalda). Nada de "deload cada N semanas mejora las
  ganancias". [FUERTE que no lo mejora].
- **Fallback programado como conveniencia**, no como óptimo: un aviso suave si pasan
  ≥6–8 semanas sin deload, pero siempre supeditado a las señales reales. [HEURÍSTICA].
- **Mesociclo**: acumulación ~3–6 semanas + deload, longitud dirigida por fatiga, no por
  un óptimo de crecimiento (no existe). Periodización elaborada = opcional, no requerida
  para hipertrofia (Grgic). [FUERTE].
- **Transición entre mesociclos**: simple. Grupo que terminó bien → arranca el siguiente
  ~1–2 series efectivas por encima; mal → igual o menos. Sin la aritmética compleja de la
  spec. [HEURÍSTICA].

---

## 11. Diseño del Custom Program Builder

**Idea clave (verificada en código):** un programa generado son solo filas en
`TrainingProgram → Mesocycle → WorkoutTemplate → TemplateExercise`. Nada aguas abajo
(`startOrResumeSession`, `getVariantHistory`, `buildSuggestions`, `finishSession`) sabe
cómo se creó: todo se ancla a `templateId`/`exerciseVariantId`. **Un programa manual que
aterrice en las mismas filas hereda sesiones, snapshots, "última vez", mini-historial y
progresión sin ninguna máquina nueva.**

**Flujo de persistencia** — nuevo `createManualProgram(input, now)` que replica el bloque
transaccional de `onboarding.service.ts` (archiva el programa activo previo con
`isActive:false` y crea `TrainingProgram → Mesocycle(ordinal 1) → WorkoutTemplate[] →
TemplateExercise[]` con los mismos campos). No reutilizar `completeOnboarding` (ese toca
Goal/Nutrition/preferencias). Se construye el borrador en cliente y se envía **una vez**
(atómico, Zod), luego redirige a `/program`.

**Trazabilidad** — un programa manual **no crea `AlgorithmDecision` ni `Recommendation`**.
No viola la regla "toda Recommendation nace 1:1 de una AlgorithmDecision" (esa regla
restringe las Recommendations que existen, no obliga a que todo programa tenga una;
`NutritionTarget` ya admite `source MANUAL` sin recomendación). "Generado vs manual" es
**derivable** (¿existe una recomendación `INITIAL_PROGRAM` con `scopeId=program.id`?), que
es justo lo que ya computa `getProgramRationale` (devuelve null → el `/program` cae al
`description`). La razón del usuario va en `TrainingProgram.description`.

**`restoreInitialProgram`** hace `findFirstOrThrow` sobre la recomendación `INITIAL_PROGRAM`
→ **lanza para un programa manual**. Debe: ocultarse en UI (prop `canRestore = rationale
!== null`) y **fallar suave** en el servicio (mensaje amable, no excepción). No hay
"regenerar" para manual — correcto e intencionado.

**Capacidades** — la edición **por ejercicio ya está construida** y funciona sobre
cualquier programa activo (todas asertan `program:{ profileId, isActive:true }`):
`editTemplateExercise`, `changeTemplateVariant`, `reorderTemplateExercise`,
`removeTemplateExercise`, `addTemplateExercise` (+ sus actions). **Nuevo solo a nivel de
día**: `createManualProgram`, `addDay`, `renameDay`, `removeDay`. `removeDay` debe repetir
la danza de ordinales/soft-delete que ya hace `restoreInitialProgram` (el
`@@unique([mesocycleId, ordinal])` no filtra `deletedAt` en SQLite; una plantilla con
sesiones se soft-borra y se mueve a ordinal negativo).

**Validación** — nuevo `manual-program.ts` (Zod) reutilizando los límites de
`template-edit.ts`. Mínimo: ≥1 día, cada día ≥1 ejercicio, `daysPerWeek = days.length`
(derivado). El selector de variantes reutiliza `listSubstitutionOptions()`.

**Relación con recomendaciones** — sin cambios: entreno → historial → `buildSuggestions`
sugiere "próxima: 82.5 kg" **efímero**; el usuario acepta/ignora. Un futuro "aplicar
sugerencia al programa" es un envoltorio fino de `editTemplateExerciseAction`, y **solo
aplica a series/reps/RIR** — la **carga no es campo de `TemplateExercise`** (vive en
`SetLog`), así que "aplicar +2.5 kg" no toca el programa: es simplemente el peso de la
próxima sesión. **Nada modifica el programa en silencio** (`finishSession` no lo toca).

**Casos límite**: día vacío bloqueado en creación; variante duplicada en un día permitida
con aviso suave (historial por variante se fusiona); no permitir borrar el último día;
cambiar manual↔generado archiva el previo y el historial (por variante, scoped a perfil)
sobrevive; restaurar deshabilitado para manual.

**UX/pantallas**: nuevo CTA "Crear mi programa" → `/program/new` (junto a onboarding),
que reutiliza los patrones de `program-editor.tsx` (day cards, `VariantPicker`,
`NumberField`) en modo borrador; "Guardar" → `createManualProgramAction` → `/program`.
Ediciones posteriores por el `ProgramEditor` existente (con restore oculto).

---

## 12. Arquitectura necesaria

- **Migraciones: CERO.** Todo usa columnas existentes. Un `TrainingProgram.source
  "GENERATED"|"MANUAL"` sería *nice-to-have* auto-documentación pero es **redundante** con
  la comprobación derivable → no en v1. Si se derivara en muchos sitios, la única
  migración mínima justificada sería `source String @default("GENERATED")` (sin backfill).
- **Reutilizado sin cambios**: todo el pipeline de sesión/snapshot/historial/progresión,
  las 5 ediciones por ejercicio, `listSubstitutionOptions`, `getProfileOverview`,
  `getProgramRationale` (ruta null), `NumberField`/`VariantPicker`.
- **Nuevo (pequeño)**: `manual-program.service.ts` (`createManualProgram`), `addDay/
  renameDay/removeDay` en `program-edit.service.ts` + actions, `manual-program.ts` (Zod),
  página `/program/new` + componente builder (JSX en gran parte reutilizado), prop
  `canRestore`, y el fallo suave de `restoreInitialProgram`.
- Para la **revisión de volumen** (§7): cambios **solo en `training-config.ts` y
  `generate-initial-program.ts`** (targeting por efectivo, arranque, escalado por días,
  densidad, sesgo a posición alargada en `pickExercise`). No toca sesiones ni schema.

---

## 13. F3 existente: conservar / modificar / eliminar

**Conservar**: conteo fraccional; double progression 2B; deload reactivo multiseñal;
e1RM como tendencia; RIR fijo por rol; trazabilidad/snapshots; ≥2× frecuencia objetivo.

**Modificar**:
- Volumen: targeting y suelos **en efectivo** (B1); arranque conservador con rampa (B3);
  escalar con días + garantizar ≥2× (B2); tope de densidad; sesgo a posición alargada.
- RIR: **quitar** la rampa 3→2→1→0 obligatoria; mantener fijo.
- Progresión: añadir `DECREASE_LOAD` (solo por caída sostenida) y `ADD_SET/REMOVE_SET`
  (solo a límite de mesociclo, gated por recuperación).
- Deload/mesociclo: reformular como gestión de fatiga; transición simple.

**Eliminar/deprioritizar** (no overengineering): modos `CALIBRACION`/`RECONSTRUCCION`;
`D6a` rango extendido; aritmética compleja de transición de mesociclo; cualquier "techo
duro de volumen" o mensajería de "deload mejora ganancias".

---

## 14. Tests que deberían fijar las reglas

**Científicos/deterministas del generador** (unit, sobre `generateInitialProgram` con el
catálogo real, como el script de auditoría):
- El **volumen efectivo** por músculo grande cae en la banda de partida por experiencia
  (no en el techo); ningún músculo supera un tope efectivo.
- **Suelo en efectivo**: no se emite aviso de "infra-entrenado" para un músculo cuyo
  efectivo ya cubre el objetivo (fija **B1**: regresión del caso glúteo).
- **Series por ejercicio ≤ 3** al inicio (fija **B3**).
- **Volumen semanal no decrece al añadir días** y **frecuencia ≥2** para músculos grandes
  (fija **B2**).
- **Densidad**: series de trabajo por sesión ≤ tope; por músculo/sesión ≤ tope.
- **Ningún ejercicio repetido** más de N veces en el programa (fija **B5**).
- **Determinismo**: mismo input → mismo programa.

**RIR**: targets fijos por rol; ausencia de rampa; fallo solo en aislamientos.

**Progresión** (extiende los 2B existentes): `DECREASE_LOAD` solo tras caída sostenida;
`ADD_SET` solo a límite de mesociclo; nunca baja/añade por una sesión.

**Deload**: score dispara recomendación (nunca automático) desde las señales guardadas;
posponer suma; reactivo domina al calendario.

**Programa manual** (integración): `createManualProgram` produce **exactamente la misma
forma de tablas** que un generado; una sesión de un programa manual usa el mismo snapshot
y da la misma sugerencia; el historial por variante cruza el cambio manual↔generado;
`restoreInitialProgram` deshabilitado/suave para manual; validación Zod (≥1 día, ≥1
ejercicio/día). E2E móvil: crear programa manual → entrenar → sugerencia aparece.

---

## 15. Plan de implementación por fases

Orden por **valor/riesgo**, cada fase con checks (typecheck/lint/tests/build) y commits
pequeños, como en 2A/2B. Reviewers por fase (ciencia, datos, UX, tests), verificados
contra el código.

- **F3.1 — Custom Program Builder** (cero migración, independiente, alto valor, bajo
  riesgo). Servicio + actions de día, Zod, `/program/new`, `canRestore`, fallo suave del
  restore, tests + E2E. **Recomiendo empezar por aquí**: desbloquea "hazme mi programa" y
  no depende de la ciencia del volumen.
- **F3.2 — Revisión de volumen del generador** (solo `training-config.ts` +
  `generate-initial-program.ts`): targeting por efectivo, arranque conservador, escalado
  por días + frecuencia ≥2, tope de densidad, sesgo a posición alargada, menos series por
  ejercicio. Suite de tests científicos del §14. Aborda directamente tu queja de volumen.
- **F3.3 — Mesociclos + deload reactivo** (motor determinista sobre señales ya guardadas;
  recomienda, nunca automático) + rampa de volumen opcional.
- **F3.4 — Extensión del motor de progresión** (`DECREASE_LOAD` por caída sostenida;
  `ADD_SET`/`REMOVE_SET` a límite de mesociclo). Reutiliza y extiende 2B.

Fuera de alcance / futuro: análisis de fotos, IA (F6), PWA (F7).

---

### Fuentes (verificadas)
Pelland et al. 2025 *Sports Medicine* (dosis-respuesta, 67 est.) ·
Schoenfeld/Ogborn/Krieger 2017 (volumen) · Baz-Valle 2022 (banda 12–20) ·
Enes 2024 *MSSE* (rampa de series) · Refalo 2023 y Robinson/Refalo 2024 *Sports Medicine*
(proximidad al fallo) · Grgic 2021 (fallo vs no-fallo) · Schoenfeld/Grgic/Krieger 2019
(frecuencia) · Plotkin 2022 *PeerJ* (carga vs reps) · Grgic 2017/2021 + meta 2022
(periodización) · "Gaining more from doing less?" 2024 y consenso Delphi 2023 (deload) ·
Halperin/Steele (precisión RIR) · Wolf 2023 / Kassiano (posición alargada).
