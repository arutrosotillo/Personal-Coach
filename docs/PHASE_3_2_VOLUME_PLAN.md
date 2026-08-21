# Fase 3.2 — Revisión del volumen del generador (plan técnico y de producto)

**No implementa.** Números **validados** con un prototipo del generador revisado ejecutado
sobre el catálogo real (`scratch/vol2.ts`, desechable). Fuerza de cada decisión:
**[FUERTE]** · **[RAZONABLE]** · **[HEURÍSTICA de producto]**. Base científica en
`docs/PHASE_3_RESEARCH.md`.

---

## 1. Causa raíz del volumen actual

El generador (`generate-initial-program.ts`) reparte un **objetivo semanal por grupo**
(`BASELINE_WEEKLY_SETS`, 6–9) restando el volumen fraccional (directo+indirecto), pero:

1. **Arranca en el techo por ejercicio**: `need = remaining[group]` (empieza en el
   objetivo, 6–9) → `ceil(need)` grande → recortado a `SETS_PER_EXERCISE.max = 4` (5 en
   prioridad). Resultado: **el primer ejercicio de cada grupo agarra 4 series** (5 si
   prioridad) la semana 1. Confirmado: 3 días = 12 ejercicios a 4 series.
2. **El objetivo semanal = volumen de partida** (sin margen para progresar).
3. **Suelo/warning sobre series DIRECTAS** (`MIN_WEEKLY_SETS`), ignorando el indirecto →
   contradicción real (glúteo 11.3 efectivas + aviso "solo caben 2 directas < 3").
4. **El objetivo no escala con los días** → 6 días fragmenta en sesiones de 5–6 series
   con el mismo volumen que 3 días.
5. **Densidad de sesión sin tope** → 24 series / 74 min.
6. **Prioridad infla el ejercicio** (maxPriority 5) en vez de subir el objetivo semanal.

**No es código roto**: es un modelo de volumen mal calibrado.

---

## 2. Nuevo modelo de volumen

Un único concepto rector: **volumen EFECTIVO semanal por músculo** =
`directas×1.0 + Σ(indirectas × factor)` (el factor lo aporta el catálogo). Todo —
objetivos, distribución, avisos— razona en efectivo.

- **AIM (`EFFECTIVE_TARGET`)**: volumen efectivo que se intenta repartir. **Conservador**:
  punto de partida con recorrido, no techo (evidencia: rendimientos decrecientes sin
  techo claro, Pelland 2025; ganancias ya con volúmenes bajos, Schoenfeld 2017). [RAZONABLE]
- **Suelo directo (`DIRECT_MIN`)**: series directas mínimas para asegurar estímulo directo
  (que un músculo no viva SOLO de indirecto). `0` = puede vivir de indirecto (glúteo,
  delt. anterior, trapecio, antebrazo, core). No genera aviso por sí mismo. [HEURÍSTICA]
- **Aviso derivado (sin tabla extra)**: solo si `DIRECT_MIN[g] > 0` **y**
  `efectivo[g] < 0.6 × objetivo[g]`. Mata el aviso contradictorio (glúteo tiene
  `DIRECT_MIN 0` → nunca avisa; su efectivo 10.5 es correcto). [HEURÍSTICA]
- **Experiencia** (`trainingYears`): multiplicador del objetivo. Principiante 0.75,
  intermedio 1.0, avanzado 1.15 (banda; nunca techo duro). [RAZONABLE dirección; HEURÍSTICA números]
- **Días**: multiplicador suave (2:0.9, 3:1.0, 4:1.0, 5:1.08, 6:1.12). Más días suben
  **poco** el volumen semanal; el efecto principal es **repartir** (frecuencia + sesiones
  más cortas). [HEURÍSTICA; alineado con "frecuencia reparte volumen", Schoenfeld 2019]
- **Prioridad**: `+5` efectivo al objetivo del grupo **y** 1 slot más/día
  (`GROUP_DAY_CAP` 3→4), **nunca** subir las series por ejercicio. [HEURÍSTICA]
- **Por ejercicio**: min 2, **max 3** (se elimina `maxPriority 5`). 4+ series requeriría
  una razón específica que hoy no existe → no se permite al inicio. [RAZONABLE]
- **Por músculo/sesión**: 3 (estándar), 4 (prioridad). [HEURÍSTICA]
- **Densidad de sesión**: tope blando **18 series de trabajo/sesión**. [HEURÍSTICA]
- **Frecuencia**: se persigue ≥2× para músculos grandes **donde la división lo permite**
  (no se fuerza en 3 días full-body). [FUERTE que ≥2× es buen default; RAZONABLE no forzarlo]

---

## 3. Constantes propuestas (validadas en el prototipo)

Efectivo semanal, intermedio (× experiencia × días; prioridad +5):

| grupo | EFFECTIVE_TARGET | DIRECT_MIN | aviso si efectivo < |
|---|---|---|---|
| Pecho superior | 6 | 3 | 3.6 |
| Pecho medio/inf | 8 | 3 | 4.8 |
| Deltoide anterior | 6 | 0 | (nunca) |
| Deltoide lateral | 8 | 5 | 4.8 |
| Deltoide posterior | 6 | 3 | 3.6 |
| Dorsal | 9 | 5 | 5.4 |
| Espalda alta | 7 | 3 | 4.2 |
| Trapecio superior | 4 | 0 | (nunca) |
| Bíceps | 8 | 4 | 4.8 |
| Tríceps | 8 | 3 | 4.8 |
| Antebrazo | 3 | 0 | (nunca) |
| Cuádriceps | 9 | 5 | 5.4 |
| Isquios | 8 | 3 | 4.8 |
| Glúteo | 8 | 0 | (nunca) |
| Gemelo | 7 | 4 | 4.2 |
| Core | 5 | 0 | (nunca) |

Escalares: `EXPERIENCE_MULT {0.75,1.0,1.15}` · `DAY_MULT {2:0.9,3:1.0,4:1.0,5:1.08,6:1.12}`
· `PRIORITY_BONUS_EFFECTIVE 5` · `SETS_PER_EXERCISE {min:2,max:3}` ·
`GROUP_DAY_CAP {standard:3,priority:4}` · `SESSION_SET_CAP 18` · `WARN_FRACTION 0.6`.
RIR sin cambios (fijo por rol; ver PHASE_3_RESEARCH §8).

Todos son **puntos de partida** editables en `training-config.ts`; ninguno es una verdad
fisiológica (COACH_PHILOSOPHY §7).

---

## 4. Lógica de fractional sets

**El modelo de contribución YA es correcto y graduado** — auditado (43 ejercicios):
PRIMARY siempre 1.0; SECONDARY ∈ {0.25 (17×), 0.5 (29×), 0.75 (4×)} + un 0.3 aislado
(Press banca→delt. ant.). Es exactamente el enfoque que valida Pelland 2025 (directo 1.0
/ indirecto ponderado). **No hay que tocar los factores** (evita falsa precisión).

Cambios mínimos:
- **Normalizar el 0.3 → 0.25** (Press banca, delt. anterior) para dejar solo tres cubos
  {0.25 = ligero, 0.5 = moderado, 0.75 = alto}. Documentar el significado de cada cubo en
  `DATA_MODEL.md`.
- **`effectiveSets[g] = Σ sets×factor`** (ya se calcula como `fractionalSets`). Objetivos,
  suelos y avisos pasan a leer efectivo. **Nunca** el indirecto solo satisface el
  `DIRECT_MIN` (por eso hay dos conceptos). [FUERTE que el indirecto cuenta; HEURÍSTICA los cubos]

---

## 5. Lógica de prioridades

Antes: prioridad → `maxPriority 5` series por ejercicio + `+4` al objetivo directo →
"todos los ejercicios de pecho a 5 series". Ahora:
- Prioridad **sube el objetivo efectivo** (`+5`) y **añade 1 slot/día** (cap 3→4),
  manteniendo **max 3 series por ejercicio**.
- El volumen extra entra como **más frecuencia / un ejercicio más**, no series más grandes.
- **Límite honesto del catálogo**: un músculo con pocos ejercicios primarios (p.ej.
  deltoide lateral: "Remo al mentón" + "Elevación lateral") **no puede** absorber toda la
  prioridad → su efectivo se estanca aunque el objetivo suba. Es correcto (no inventamos
  volumen imposible); se puede mejorar **ampliando el catálogo** (tarea de producto, no del
  generador). Validado: prioridad pecho/bíceps **sí** sube (freq 2, +ejercicio); prioridad
  delt. lateral se topa en el catálogo.

---

## 6. Lógica por número de días

- **3 días** (full-body): ~51–53 series/sem, sesiones 16–18 (≤67 min). Frecuencia 2× para
  los grandes empujes/tirones; algunos músculos 1× (inherente al full-body de 3 días).
- **4 días** (torso/pierna): ~59 series/sem, sesiones ≤18, **frecuencia 2× para casi todos
  los grandes**, sin avisos.
- **5 días** (PPL+UL): ~71 series/sem, sesiones 15–17, frecuencia 2× para los grandes,
  delt. anterior/trapecio ganan trabajo directo.
- **6 días** (PPL×2): ~75 series/sem, sesiones **12–15** (bajan respecto a 3 días), sin
  fragmentos de 5–6 series absurdos.

El volumen semanal sube **suavemente** con los días; lo que baja es la **densidad por
sesión** — exactamente el objetivo. [RAZONABLE]

---

## 7. BEFORE vs AFTER (programas reales)

| Programa | Métrica | **BEFORE** (actual) | **AFTER** (prototipo) |
|---|---|---|---|
| 3 días balanced | series/ejercicio | 12×4, 2×3, 3×2 | **16×3, 2×2 (ninguno 4–5)** |
| | sesión más grande | 24 series / 74 min | **18 / 58 min** |
| | total/semana | 60 | 52 |
| | glúteo | 2 dir / 11.3 ef + **aviso contradictorio** | 3 dir / 10.5 ef, **sin aviso** |
| 4 días balanced | total/semana | 70 | 59 |
| | sesión más grande | 23 series | **18** |
| | series/ejercicio | 11×4… | **todos ×3**, sin avisos |
| 4 días prioridad | series/ejercicio | 3×**5**, 10×4 | **todos ×3**; prioridad sube freq/volumen |
| 5 días | total/semana | 69 | 71 (mejor distribuido) |
| 6 días | estructura | 69, **Empuje B 6 / Tirón B 5** | 75, sesiones **12–15**, sin fragmentos |

**Ejemplo AFTER — 3 días balanced, día A (58 min, 18 series):** Prensa 3×10–15@2 ·
Jalón unilateral 3×10–15@2 · Fondos 3×6–12@2 · Remo al mentón 3×12–20@2 · Elevación de
talones 3×8–12@1 · Curl bayesian 3×10–15@1. Efectivo/músculo 6–10.5, conservador, con
recorrido para progresar reps→carga.

---

## 8. Edge cases (degradación razonable)

- **Prioridad múltiple**: cada grupo prioritario sube su objetivo; el reparto respeta topes
  → sin sesiones infladas. Validado.
- **Pocos días (2)**: `DAY_MULT 0.9`, full-body 2×; frecuencia limitada, aceptable.
- **Muchos días (6)**: más frecuencia + sesiones cortas, no volumen absurdo. Validado.
- **Catálogo pequeño / músculo con pocos ejercicios**: el objetivo puede no alcanzarse →
  **aviso solo si efectivo < 0.6×objetivo y `DIRECT_MIN>0`** (real, no contradictorio); se
  repite el mejor ejercicio disponible (limitación de catálogo, señalada).
- **Multiarticulares / mucho indirecto (glúteo, delt. ant., trapecio)**: `DIRECT_MIN 0` →
  viven de indirecto, **nunca** generan aviso pese a no tener trabajo directo. Arregla B1.
- **Ejercicio que contribuye a varios músculos**: el efectivo se acredita a todos por su
  factor; el "restante" baja para todos → no se sobre-prescribe.
- **Constraints imposibles** (equipo/tiempo/contraindicaciones): se llena lo que cabe;
  avisos solo por déficit efectivo real. Nunca el absurdo "solo 2 directas" con 11 efectivas.

---

## 9. Cambios exactos de código

**`src/core/config/training-config.ts`**: sustituir `BASELINE_WEEKLY_SETS` y
`MIN_WEEKLY_SETS` por `EFFECTIVE_TARGET` + `DIRECT_MIN`; `SETS_PER_EXERCISE` →
`{min:2,max:3}` (quitar `maxPriority`); `MAX_SETS_PER_GROUP_PER_SESSION` → `{standard:3,
priority:4}`; añadir `EXPERIENCE_MULT`, `DAY_MULT`, `PRIORITY_BONUS_EFFECTIVE`,
`SESSION_SET_CAP`, `WARN_FRACTION`. `MAX_WEEKLY_SETS` deja de ser el mecanismo principal
(el objetivo ya es conservador); se mantiene como tope duro de seguridad.

**`src/core/program/generate-initial-program.ts`**: `computeWeeklyTargets` → objetivos
**efectivos** × experiencia × días (+ prioridad); `need`/`isNeedy`/`sets` acotados por el
nuevo modelo; añadir contador de densidad por sesión (`SESSION_SET_CAP`); cap por grupo/día
según prioridad; **avisos sobre efectivo** (`DIRECT_MIN>0 && efectivo < WARN_FRACTION×objetivo`).
`GeneratorInput` gana `experienceLevel` (derivado de `trainingYears` en el servicio; sin
schema nuevo). `RIR` y selección: sin cambios de lógica salvo (opcional) sesgo a posición
alargada — se puede aplazar a una sub-fase.

**Representación de contribución**: sin cambios salvo normalizar el `0.3→0.25` en el seed
`exercises.ts` (y en la DB vía re-seed; el seed es idempotente).

**`src/server/services/onboarding.service.ts`**: pasar `experienceLevel` a
`generateInitialProgram` (de `trainingYears`). Sin cambios de persistencia.

**Warnings/validation**: la lista `warnings` del programa pasa a efectivo; el bloque "Por
qué este programa" (`program-rationale`) muestra efectivo + frecuencia por músculo.

**Docs**: `TRAINING_ENGINE.md §1` (modelo efectivo, constantes, prioridad, días),
`DATA_MODEL.md` (cubos de contribución 0.25/0.5/0.75), `IMPLEMENTATION_PLAN.md`.

**Migración de DB: NINGUNA.** (Solo re-seed del catálogo por el 0.3→0.25, idempotente.)

---

## 10. Tests (invariantes, no congelar outputs)

Unit sobre `generateInitialProgram` con el catálogo real, para 3/4/5/6 días × {balanced,
prioridad, principiante} (parametrizado):
- **Ningún ejercicio supera 3 series** en el programa inicial (fija B3).
- **Ninguna sesión supera `SESSION_SET_CAP`** series de trabajo.
- **Los avisos usan efectivo**: para el caso glúteo (mucho indirecto, poco directo) **no**
  hay aviso; regresión explícita del caso "11 efectivas, 0 aviso" (fija B1).
- **La prioridad aumenta el volumen semanal del grupo** (objetivo y, si el catálogo lo
  permite, efectivo/frecuencia) **sin** subir las series por ejercicio por encima de 3.
- **6 días no implica volumen semanal desproporcionado vs 3 días** (ratio acotado, p.ej.
  total_6d ≤ ~1.6 × total_3d) y **la densidad por sesión de 6 días ≤ la de 3 días** (fija B2).
- **Frecuencia ≥2 para músculos grandes cuando la división lo permite** (4/5/6 días).
- **El trabajo indirecto cuenta**: el efectivo de un músculo con contribuciones indirectas
  > sus series directas.
- **Ningún músculo con volumen extremo accidental** (efectivo ≤ un techo de seguridad).
- **Determinismo**: mismo input → mismo programa (ya existe).

Preferencia por **invariantes fisiológicas/de producto**, no snapshots frágiles del output
exacto (el output puede cambiar al ajustar constantes sin romper la invariante).

---

## 11. Riesgos

- **Calibración de constantes**: los números son puntos de partida; podrían quedar algo
  altos/bajos para algún perfil. Mitigación: son config aislada; el prototipo ya validó que
  el resultado es conservador y sin avisos absurdos. [riesgo bajo]
- **Escalado por días demasiado generoso**: 6 días = 75 vs 3 días = 52 (~+44%). Es por más
  slots, no por el multiplicador; la densidad por sesión baja. Si se quiere más plano, bajar
  `DAY_MULT` de 5–6 días. [decisión de producto]
- **Prioridad topada por catálogo** (delt. lateral): no es un fallo del generador; se
  comunica y se resuelve ampliando el catálogo (fuera de F3.2).
- **Experiencia poco visible en 3 días**: los suelos `DIRECT_MIN` mantienen el volumen del
  principiante cerca del intermedio en full-body de 3 días. Aceptable (compuestos a 3
  series); opción: `max 2` series/ejercicio para principiantes. [decisión de producto]
- **Regeneración de programas existentes**: el cambio afecta a **nuevos** programas; los
  existentes conservan su snapshot (no se reescriben). `restoreInitialProgram` regeneraría
  con el nuevo modelo — comportamiento deseado.

---

## 12. Orden de implementación

1. **Constantes + modelo efectivo en `training-config.ts`** (aislado, sin tocar lógica aún).
2. **`generate-initial-program.ts`**: targeting efectivo, max 3/ejercicio, densidad, cap por
   día, prioridad, avisos efectivos, `experienceLevel`. + normalizar 0.3→0.25 en el seed.
3. **Suite de tests de invariantes** (§10) — TDD sobre los casos reales.
4. **Servicio onboarding**: pasar `experienceLevel`; bloque "por qué" muestra efectivo.
5. **Docs** (TRAINING_ENGINE, DATA_MODEL) + verificación final (typecheck/lint/tests/build,
   E2E de onboarding sigue verde) + reviewers (ciencia, generador, tests).

Cada paso con checks y commit pequeño. Sin migración de DB.

---

### Qué apruebas aquí
Las **reglas numéricas y fisiológicas** de §2–§3 (objetivos efectivos, suelos, max 3
series, prioridad, escalado por días, densidad) y el enfoque de avisos por efectivo. Una
vez aprobadas, implemento en el orden de §12 (aún sin tocar el generador hasta tu OK).
