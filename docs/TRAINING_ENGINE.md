# Training Engine — especificación v1.0

Motor puro determinista (`src/core/engines/training/`, F3; el generador de programa inicial en `src/core/program/` desde F1). Todos los umbrales viven en `src/core/config/`. Ninguna decisión con datos aislados. Señales de recuperación: las calcula el propio motor de fatiga (§1e) a partir de los chips de sesión. RECOVERY_ENGINE.md describe un motor separado que NO se construyó.

## 0. Grupos musculares y prioridades

16 grupos (códigos en seed): PECHO_SUPERIOR, PECHO_MEDIO_INFERIOR, DELT_ANTERIOR, DELT_LATERAL, DELT_POSTERIOR, DORSAL, ESPALDA_ALTA, TRAPECIO_SUPERIOR, BICEPS, TRICEPS, ANTEBRAZO, CUADRICEPS, ISQUIOS, GLUTEO, GEMELO, CORE.

**Sin prioridad estética por defecto.** No existe ningún "tier" oculto: el programa es equilibrado salvo que el usuario elija en el onboarding entre 1 y 6 grupos a priorizar (o "programa equilibrado, sin prioridad"). La única palanca de prioridad es esa selección explícita. "Cintura estrecha" es objetivo de nutrición + V-taper, no un sesgo del generador.

## 1. Generación de programa inicial (F1)

Implementada en `src/core/program/generate-initial-program.ts` (versión **3.0.0**, modelo de **volumen efectivo** de Fase 3.2; ver `docs/PHASE_3_2_VOLUME_PLAN.md`). Reparte un **objetivo de volumen efectivo semanal por grupo** sobre los menús de la división elegida. Determinista, sin progresión ni ajuste adaptativo (eso es F3.3/F3.4).

**Volumen efectivo** = `series directas × 1.0 + Σ(series indirectas × factor)`. El conteo fraccional directo/indirecto está respaldado por la literatura (Pelland 2026 lo modela) **[EVIDENCIA RAZONABLE]**; los NÚMEROS concretos son un **punto de partida conservador de PRODUCTO**, no óptimos universales.

**Objetivos de partida** (`training-config.ts`, `EFFECTIVE_TARGET`): banda inicial conservadora (~6–10 efectivas/músculo) con margen para progresar — **[HEURÍSTICA DE PRODUCTO]**, no un "óptimo científico" (la evidencia indica dosis-respuesta con rendimientos decrecientes y sin techo claro). Se escala por **experiencia** (`EXPERIENCE_MULT`: 0.75/1.0/1.15 según `trainingYears`) **[heurística conservadora]** y por **días** (`DAY_MULT`: 5d +8 %, 6d +12 %) **[heurística de generación; más días REPARTEN, no una dosis-respuesta demostrada]**. En déficit se reduce un 15 % (`FAT_LOSS_VOLUME_FACTOR`).

**Prioridad**: sube el **objetivo efectivo semanal** del grupo (`PRIORITY_BONUS_EFFECTIVE` +5), **nunca** las series por ejercicio. Su efecto real es más **frecuencia** (más días con el grupo) y algo más de volumen efectivo. El aviso de "desatendido" usa el objetivo BASE (sin el bonus), para no encender avisos engañosos al priorizar. Límite honesto: un músculo con pocos ejercicios primarios en el catálogo (p.ej. deltoide lateral) no puede absorber toda la prioridad — se comunica, no se inventa volumen imposible.

**División por días** (`splits.ts`): 2 → Full Body A/B · 3 → Full Body A/B/C · 4 → Torso/Pierna · 5 → Push/Pull/Pierna + Torso/Pierna · 6 → PPL×2.

**Reparto**: cada día se llena al grupo más necesitado (**prioridad primero**, luego mayor déficit de volumen efectivo restante). Guardrails **[HEURÍSTICA]**: **máx 3 series por ejercicio** (`SETS_PER_EXERCISE.max` — no un límite fisiológico; 4+ requeriría una razón que hoy no existe), máx por grupo/sesión (`MAX_SETS_PER_GROUP_PER_SESSION` 3/4), y **tope de densidad ≤18 series de trabajo/sesión** (`SESSION_SET_CAP`, guardrail de fatiga/UX). El volumen indirecto cuenta fraccionalmente, nunca como serie directa completa.

**Suelo directo** (`DIRECT_MIN`): asegura estímulo **directo** mínimo (que un músculo no viva solo de indirecto); `0` = puede cubrirse con indirecto. **Aviso** de músculo desatendido solo si `DIRECT_MIN[g] > 0` **y** su volumen **efectivo** `< WARN_FRACTION (0.6) × objetivo`: así nunca se avisa por pocas series directas cuando el indirecto ya cubre al músculo (p.ej. el glúteo, ~10 efectivas de piernas, no genera aviso).

**Frecuencia** ≥2×/semana para músculos grandes es una **preferencia de distribución cuando la división lo permite**, no una restricción dura: si la estructura del programa la hace inviable para algún músculo, se degrada con elegancia (no se rompe la rutina por forzarla) **[FUERTE que ≥2× es buen default; el no forzarlo es de producto]**.

**Selección de ejercicio**: filtra por equipamiento, contraindicaciones (lesiones) y exclusiones — **las restricciones prevalecen sobre la prioridad**. Prefiere compuesto si el grupo necesita mucho volumen y aún no tiene compuesto ese día; desempata por variedad (no repetir ejercicio en el programa), menor fatiga sistémica y orden alfabético (determinismo). No repite el mismo ejercicio dos veces el mismo día.

**RIR y rango** (`TARGET_RIR` + `RIR_STABILITY_ADJUST`): la BASE por rol es compuesto pesado RIR 2, compuesto RIR 1, aislamiento RIR 0 (fallo) —"compuesto pesado" es `systemicFatigue ≥ 3`—, y sobre esa base se aplica un ajuste de ±1 por la ESTABILIDAD de la variante que se va a hacer: carga libre y sin apoyo `+1`, guiada (máquina, multipower, polea) `−1`, apoyada `0`. Acotado a 1..2 en compuestos y 0..1 en aislamientos, así que "máquina" nunca significa "al fallo" ni "barra" significa siempre 2. El patrón de movimiento describe qué músculos trabajan y cuánto cuesta recuperarse; no dice nada sobre qué pasa si fallas, que es lo que decide cuánta reserva compensa: sentadilla con barra libre y sentadilla en multipower son el mismo patrón y la misma fatiga sistémica, y hasta F3.2d recibían el mismo objetivo. Lo justifican la consecuencia real del fallo, la peor fiabilidad del RIR reportado en multiarticulares libres (Halperin 2022) y el deterioro técnico cerca del fallo **[RAZONABLE en la dirección, HEURÍSTICA en la magnitud]**. Dejar reserva **no compra hipertrofia** (la evidencia apunta al revés: Robinson 2024, Refalo 2023) — compra fatiga más barata y menos riesgo técnico, así que solo se paga donde ese coste es real **[HEURÍSTICA]**. Con objetivo 1 ó 0 el motor de progresión no frena nunca por esfuerzo: cerrar el rango al fallo sube la carga a la primera. El rango de repeticiones lo aporta cada variante del catálogo (rol-apropiado). **Presupuesto de tiempo**: overhead 10 min + coste por serie (compuesto pesado 4, compuesto 3, aislamiento 2); al pasarse, se recorta o se cierra la sesión sin añadir ejercicios de una sola serie.

**Salida**: `volumeByGroup` (directo, fraccional, frecuencia, objetivo, prioridad) alimenta el bloque "Por qué este programa" y la trazabilidad (`AlgorithmDecision`).

### Base científica (referencias)

Volumen inicial conservador con margen de progresión y rendimientos decrecientes del volumen: Schoenfeld et al. 2017 (meta-análisis dosis-respuesta), Baz-Valle et al. 2022 (revisión de volumen). Rangos amplios de repeticiones válidos para hipertrofia (~5–30 con proximidad al fallo): Schoenfeld et al. 2021. Cercanía al fallo sin fallo sistemático (RIR 1–3): Refalo et al. 2023. Frecuencia como vehículo para distribuir volumen, sin efecto independiente grande a volumen igualado: Schoenfeld et al. 2019. Series indirectas cuentan pero menos que las directas: base para la contabilidad fraccional. Los números concretos son puntos de partida operativos, no verdades fisiológicas (ver COACH_PHILOSOPHY.md §7).

## 1b. Motor de progresión (implementado — v2.1.0, Fase 3.2b/3.2e)

`src/core/training/progression.ts`. Puro, determinista y **solo-sugerencia**: nunca modifica el
programa, ni el volumen, ni recomienda deload. Umbrales en `PROGRESSION` (`training-config.ts`).
Diseño y justificación completos en `docs/TRAINING_ENGINE_FINAL_AUDIT.md`.

**Filosofía**: double progression (primero repeticiones dentro del rango, después carga), decidida
sobre **tendencia** y no sobre una sesión aislada. Una mala sesión no baja la carga; dos
exposiciones comparables sí. Nunca exige un PR.

**Entrada**: prescripción del snapshot vigente + **las últimas `HISTORY_WINDOW` (6) exposiciones**
válidas de la variante (series WORKING completadas de sesiones COMPLETED), de la más antigua a la
más reciente.

**Banda de RIR**: un esfuerzo es COMPATIBLE si `rir ≥ targetRir − RIR_BAND` (1), y claramente MÁS
DURO si `rir < targetRir − RIR_BAND` o `rir = 0` con objetivo ≥ 2. Motivo: el error típico de
estimación del RIR es ~1 repetición (Halperin 2022), así que exigir igualdad estricta decide dentro
del ruido. Se conserva la distinción: `8/8/8 @0` **no** recibe el mismo trato que `8/8/8 @2`.

**RIR ausente (`null`)**: NUNCA se imputa al objetivo ni cuenta como evidencia positiva. No veta la
evidencia de repeticiones, pero degrada la confianza y bloquea el salto doble.

**Rango cerrado** = `n−1` series en `repRangeMax` y ninguna por debajo de `repRangeMax − 1`
(3 series: `8/8/8` y `8/8/7` sí; `8/8/6` y `8/7/7` no).

**Solo se comparan series al MISMO peso de trabajo.** El peso de referencia de una exposición es
la mediana baja de los pesos de sus series; las series a cualquier otro peso quedan fuera de las
repeticiones, la mediana, el rango cerrado, el RIR y el trinquete — siguen contando para
`SESSION_INCOMPLETE`, para `mixedLoads` y para la señal informativa. Sin esto, `12×9 / 12×7 / 14×8`
se resumía como "en 12 kg (9/7/8)" —falso, las 8 fueron a 14 kg— y las repeticiones hechas a una
carga MENOR entraban en el trinquete de una carga mayor.

**"Bajo rango"** = menos de la MITAD de las series comparables llegó a `repMin`. Con un número
impar de series es equivalente a la mediana; con uno par deja de convertir a la peor serie en juez
(con 2 series la mediana baja ES la peor, así que `9/7` en un rango de 8–12 se leía como fracaso).
Cuando la mitad sí llega y la mediana no, el diagnóstico es `SET_DROP_OFF`: la carga permite el
rango —lo demuestra la serie que entró— y lo que falla es la caída entre series. **Y la carga nunca
baja si la última exposición mejoró el total de repeticiones** respecto a la anterior a ese mismo
peso: no se corrige lo que está mejorando. No es un estado absorbente, porque en cuanto el total se
estanca o cae, la bajada se ejecuta.

**Escalera de decisión** (la primera regla que aplica gana):

| #   | Condición                                                                          | Acción · `reasonCode`                                                                      |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0   | Sin exposiciones                                                                   | `START` · `NO_HISTORY` (no inventa peso)                                                   |
| 1   | `n < ceil(plannedSets × 0,5)`                                                      | `HOLD` · `SESSION_INCOMPLETE`                                                              |
| 1b  | Carga < 75 % de la exposición anterior y con esfuerzo sobrado                      | `HOLD` · `ATYPICAL_LOAD_DROP` (un typo no reancla el ejercicio)                            |
| 2   | 2 exposiciones **bajo rango**, pesos no decrecientes y sin pararse lejos del fallo | `DECREASE_LOAD` · `REPEATED_UNDERPERFORMANCE`                                              |
| 2b  | 4 exposiciones al mismo peso **bajo rango**, **ignorando el RIR**                  | `DECREASE_LOAD` · `STUCK_BELOW_RANGE`                                                      |
| 3a  | Rango cerrado con esfuerzo mayor del prescrito, 1ª vez                             | `HOLD` · `CLOSED_RANGE_AT_FAILURE`                                                         |
| 3b  | Rango cerrado y `loadStepKg = 0`                                                   | `ADD_REP` · `NO_LOAD_STEP` / `HOLD` · `NO_LOAD_STEP_CAPPED`                                |
| 3c  | Rango cerrado con menos series de las previstas                                    | `ADD_REP` · `INCOMPLETE_FOR_INCREASE` (media sesión no sube la carga)                      |
| 3d  | Rango cerrado sin ningún RIR registrado y sin confirmar dos veces                  | `HOLD` · `NEEDS_RIR_CONFIRMATION`                                                          |
| 3e  | Rango cerrado con cargas mezcladas y el salto no supera el top set                 | `HOLD` · `MIXED_LOADS` (un "sube" nunca puede descargar)                                   |
| 3f  | Rango cerrado y el salto cabe en el rango                                          | `INCREASE_LOAD` · `RANGE_CLOSED` / `RANGE_CLOSED_AFTER_FAILURE` / `LOAD_CLEARLY_TOO_LIGHT` |
| 3g  | Rango cerrado y el salto NO cabe                                                   | `ADD_REP` · `EXTEND_RANGE`, o `HOLD` · `STEP_TOO_BIG_FOR_RANGE`                            |
| 4b  | Mediana `< repMin` pero **la mitad de las series sí llegó**                        | `HOLD` · `SET_DROP_OFF` (es caída entre series, no carga: no se tocan los kilos)           |
| 4   | Mediana de reps `< repMin` (1ª vez)                                                | `HOLD` · `ONE_OFF_UNDERPERFORMANCE`                                                        |
| 5   | Fallo o casi sin cerrar el rango (con salida por estancamiento a `DECREASE_LOAD`)  | `HOLD` · `NEAR_FAILURE_HOLD`                                                               |
| 6   | Alguna serie bajo el techo                                                         | `ADD_REP` · `ADD_REP` (sube el **suelo**: la serie más floja)                              |
| 7   | Resto                                                                              | `HOLD` · `HOLD_DEFAULT` (red de seguridad inalcanzable)                                    |

**Señales informativas** (`signals`, nunca cambian la acción): `PLATEAU_SIGNAL` (3 exposiciones al
mismo peso sin batir el mejor total y sin mejorar en la ventana mostrada), `MIXED_LOADS` (las
series no fueron todas a la misma carga: la lectura del motor es parcial) y `RANGE_TOO_WIDE`.

**`RANGE_TOO_WIDE`**: el ancho ÚTIL de un rango es lo que cuesta, en repeticiones, subir UN escalón
del material a la carga actual (`repMax − equivalentReps(w, repMax, w + step)`). Con saltos del 4 %
son ~2 reps; con mancuernas de 8 kg de 2 en 2 (25 %) son ~9. Tras `RANGE_WIDTH_EXPOSURES` (3)
exposiciones al mismo peso sin cerrar el rango, si el rango sobrepasa ese ancho útil en
`RANGE_WIDTH_MARGIN_REPS` (2) repeticiones o más, el motor lo **comenta** con los números y propone
un techo —el más alto que la última exposición ya habría cerrado— **sin tocar el suelo del usuario
ni reescribir la prescripción**: el rango se cambia en el programa. Donde el salto es grande, el
rango ancho es necesario y la señal calla.

**Estados absorbentes: prohibidos por diseño.** Toda rama de `HOLD` tiene salida — cerrar el rango
al fallo sube a la segunda, quedarse corto baja a la segunda (o a la cuarta si el RIR lo bloquea),
llegar al fallo sin cerrar el rango baja si se estanca, y el salto imposible escala a "cambia de
variante". Fijado por las simulaciones longitudinales de `progression.sim.test.ts`.

**Tamaño del salto**: normalmente **un** incremento del material. **Dos** solo si la mediana supera
el techo del rango en ≥3 reps, con esfuerzo compatible y RIR registrado, y sin pasar del 10 % de la
carga. **Nunca** un salto grande para igualar el e1RM matemáticamente.

**Objetivos por serie (`setTargets`) con TRINQUETE**: ninguna serie pide menos de lo que ya
lograste en ese hueco con esa misma carga, así que un día flojo no rebaja el plan consolidado
(`8/7/7` seguido de `7/6/6` sigue apuntando a `8/7/7`). El trinquete se reinicia al cambiar de carga.

**Los objetivos NUNCA crecen de una serie a la siguiente.** A carga fija la fatiga se acumula
dentro de la sesión, así que un objetivo como `9/8/9` no describe nada que pueda ocurrir: pide que
la tercera serie supere a la segunda estando más cansado. Cuando el historial tiene esa forma es
ruido (un descanso largo, una serie mal contada, una serie a otro peso) y se recorta hacia ABAJO
—nunca hacia arriba, que sería exigir un PR en las series anteriores—; el suelo de `minReps + 1`
devuelve después la exigencia a su sitio.

**ADD_REP sube el SUELO, y el texto lo dice.** Subir "la serie más floja" y subir el suelo de
repeticiones es lo mismo salvo cuando todas las series van EMPATADAS: ahí el suelo son todas
(`11/11/11` → `12/12/12`), y el mensaje tiene que decir "una repetición más en cada serie" en vez de
"sube la serie más floja", que era falso. Con `targetRir ≤ 1` y objetivo plano se añade además el
aviso de que las últimas series caigan es normal y no penaliza.

**Objetivo de reps tras subir**: `floor(equivalentReps(pesoRef, medianaReps, pesoNuevo))`, acotado
al rango — Epley usado como modelo **relativo intra-variante**, jamás como afirmación de 1RM. Si ese
valor queda por debajo de `repMin`, el incremento mínimo del material no cabe en el rango y se
**extiende el techo** (hasta `repMax + 5`) hasta que quepa.

**Salida**: `action`, `reasonCode`, `suggestedWeightKg`, `suggestedReps`, **`setTargets`** (objetivo
por serie, longitud `plannedSets`), `confidence` (3 niveles), `explanation` con los números, y
**`signals`** informativas.

**`PLATEAU_SIGNAL`**: 3 exposiciones al mismo peso sin batir el mejor total de repeticiones. Es
**solo informativa** — viaja en `signals`, nunca cambia la acción y nunca dispara volumen, deload,
cambio de ejercicio ni de mesociclo. Es input para F3.3/F3.4 y Coach AI.

**Confianza**: `HIGH` = ≥3 exposiciones válidas + RIR completo + sesión completa · `MEDIUM` = ≥2
exposiciones o datos parciales · `LOW` = 1 exposición, sesión incompleta o **ningún RIR registrado**.

**Fuera de alcance del motor (F3.3/F3.4)**: fatiga sistémica, deload, mesociclos, `ADD_SET`/
`REMOVE_SET`, sustitución por dolor, y la regla de técnica (hoy `technique` no se captura, así que
ninguna regla depende de ella).

## 1c. Calidad del dato de RIR (Fase 3.2c)

**Objetivo ≠ registrado.** `WorkoutExercise.targetRir` es la prescripción; `SetLog.rir` es lo que el
usuario reportó. La pantalla de ejecución muestra el objetivo (`objetivo N RIR`) y deja el valor
registrado **sin rellenar**: los chips 0–4 conviven con **"No lo sé"**, que es el estado por defecto
y se persiste como `null`. "Repetir" copia el PLAN (peso y repeticiones), **nunca** el esfuerzo.
Corregir el RIR de una serie ya completada vuelve a guardarla (upsert idempotente).

**`rir = null` en el motor**: no se imputa al objetivo ni cuenta como evidencia positiva. No veta la
evidencia de repeticiones (progresar por reps sigue siendo válido), pero degrada la confianza a
`LOW` cuando falta en toda la sesión y **bloquea el salto doble de carga**. Un RIR de fallo
REGISTRADO manda sobre las series sin registrar.

**e1RM**: sin RIR registrado **no se estima** (`estimateOneRepMax` devuelve `null`). Tratar `null`
como 0 equivaldría a suponer que la serie fue al fallo — el sesgo más optimista posible — y haría
que la tendencia cayera al dejar de registrar el RIR. `bestSet`/`currentE1rm`/`trend` ya caen a
tonelaje cuando falta.

**Límite histórico**: antes de esta fase la UI prerrellenaba el campo con `targetRir`. Esas filas se
pueden localizar por `completedAt`, pero no se puede saber si su valor fue elegido; no se corrigen
retrospectivamente. **Los datos de RIR fiables empiezan en la Fase 3.2c** (ver DATA_MODEL.md).

**Técnica**: `SetLog.technique` no se captura en ninguna pantalla, así que **ninguna regla del motor
depende de ella** (se descarta la regla D3 de §2 hasta que exista la captura).

**Fuera de alcance**: `fatigue`, `jointPain`, `motivation`, `pump` y `perceivedPerformance` se
guardan al finalizar la sesión pero **no alimentan ninguna decisión automática**. Quedan preparados
para F3.3.

## 1d. Recencia del historial (Fase 3.3)

El motor de progresión recibe `todayLocalDate` y la fecha de cada exposición. El tiempo **nunca
cambia la carga por sí solo**; lo que hace es:

- **Degradar la confianza**: con la última exposición a ≥`STALE_MIN_DAYS` (21 d) la confianza no
  puede ser ALTA; a ≥`OLD_MIN_DAYS` (42 d) es BAJA.
- **Suspender el avance**: con historial viejo, cerrar el rango produce `HOLD` ·
  `STALE_HISTORY` — «vuelve con el mismo peso para reconfirmar». No se baja la carga por un parón.
  La puerta va **antes** de las ramas sin carga externa: a peso corporal el desentrenamiento pega
  antes, no después, así que tampoco ahí se pide superar una marca de hace seis semanas.
- **Romper rachas**: dos exposiciones separadas por `RUN_GAP_DAYS` (21 d) o más no son
  comparables, así que no cuentan juntas para bajar carga ni para detectar mesetas, y una caída de
  carga al volver de un parón no se trata como atípica. Es deliberadamente **el mismo número** que
  `STALE_MIN_DAYS`: sería incoherente que 21 días fuesen «comparables» para bajarte la carga y
  «demasiado viejos» para subírtela.

Sin `todayLocalDate` el motor se comporta como antes (`numbers.daysSinceLast = -1`).

## 1e. Fatiga y deload reactivo (Fase 3.3)

`src/core/training/fatigue.ts` (+ `analysis.ts`, que combina progresión y fatiga). Puro,
determinista y **solo recomienda**: no toca el programa, ni las series, ni la carga, ni el
mesociclo.

**Dos reglas que gobiernan el motor:**

1. **Una mala sesión no es información.** Toda señal exige repetición o varios ejercicios afectados.
2. **Lo subjetivo no basta.** Recomendar descarga exige ≥`MIN_OBJECTIVE_SCORE` puntos de señales
   OBJETIVAS. Tres chips malos seguidos jamás mandan a descargar por sí solos.

| Señal                       | Tipo       | Peso | Dispara con                                                 |
| --------------------------- | ---------- | ---- | ----------------------------------------------------------- |
| `PERFORMANCE_DECLINE`       | objetiva   | 3    | regresión en ≥`max(2, 25 %)` de los ejercicios seguidos     |
| `WIDESPREAD_PLATEAU`        | objetiva   | 2    | ≥50 % de los ejercicios (y ≥2) con `PLATEAU_SIGNAL`         |
| `SINGLE_LIFT_DECLINE`       | objetiva   | 1    | exactamente 1 ejercicio en regresión (crédito parcial)      |
| `SESSION_COMPLETION_DROP`   | conductual | 2    | ≥2 de las últimas 4 sesiones con <70 % de series            |
| `HIGH_FATIGUE_SUSTAINED`    | subjetiva  | 2    | fatiga ≥4/5 en ≥2 de las últimas 4                          |
| `LOW_PERCEIVED_PERFORMANCE` | subjetiva  | 1    | rendimiento percibido ≤2/5 en ≥2                            |
| `LOW_MOTIVATION_SUSTAINED`  | subjetiva  | 1    | motivación ≤2/5 en ≥3 (señal de adherencia)                 |
| `LONG_ACCUMULATION`         | calendario | 1    | ≥8 semanas seguidas sin parar (red suave, nunca suficiente) |

**`SESSION_COMPLETION_DROP` es CONDUCTUAL, no objetiva**: correlaciona con la fatiga, pero también
con la agenda y con una máquina ocupada. Suma al `score` y **no** cuenta para `objectiveScore`, así
que por sí sola no puede habilitar una recomendación de descarga con el rendimiento medido intacto.

**Qué cuenta como «regresión»** (`analysis.ts`): que el motor haya bajado la carga, que lleve ≥2
exposiciones consecutivas bajo el rango (`REPEATED_UNDERPERFORMANCE`, `STUCK_BELOW_RANGE`), o que el
**peso de trabajo actual esté por debajo del máximo de la ventana** sin que el motor esté ya pidiendo
avanzar. Un mal día suelto (`ONE_OFF_UNDERPERFORMANCE`) **no** es una regresión: no mueve la carga.

**Decisión**: `score ≥5` **y** `objectiveScore ≥2` → `DELOAD_RECOMMENDED` · `score ≥3` →
`DELOAD_WATCH` · resto → `NO_DELOAD` · <3 sesiones en 21 días → `INSUFFICIENT_DATA`.

**Dolor articular**: vía SEPARADA. No puntúa (para no contaminar la lectura de fatiga), escala su
propio aviso (`NONE` → `WATCH` → `ACTION`) y tiene precedencia sobre cualquier ajuste de carga
(COACH_PHILOSOPHY §2).

**Precedencia (COACH_PHILOSOPHY §2)**: con `jointPain: ACTION` o `DELOAD_RECOMMENDED`, las subidas
de carga quedan **suspendidas** en las dos pantallas (`applyRecoveryVeto`, `src/core/training/veto.ts`).
Convierte `INCREASE_LOAD` en `HOLD` · `RECOVERY_VETO` sobre el peso de referencia, conserva la subida
en una señal, **nunca baja la carga** y no toca `ADD_REP`. Se aplica DESPUÉS del veredicto de fatiga y
no lo realimenta: si lo hiciera, el propio veto contaría como evidencia de fatiga.

**Plan de descarga sugerido** (advisory, nunca aplicado): 1 semana, **mitad de series** (mín. 1 por
ejercicio) y **misma carga y mismo RIR objetivo** (−10 % de carga solo si hay dolor articular).
**Una sola palanca**: se recorta el volumen y se deja la intensidad intacta. El recorte a la mitad
cae dentro del 41–60 % que el meta-análisis de taper de Bosquet et al. 2007 (PMID 17762369)
identifica como óptimo sin tocar intensidad ni frecuencia — **[EVIDENCIA RAZONABLE]**, porque ese
meta-análisis es mayoritariamente de deportes de resistencia.

Lo que sostiene Coleman et al. 2024 (PeerJ 12:e16777) y lo que **no**: probó una semana de **cese
total** a mitad de un bloque de 9 semanas en 39 personas entrenadas, y encontró misma hipertrofia y
PEOR fuerza. Eso respalda que el disparador sea reactivo y no de calendario; **no** respalda la
receta concreta, que es precisamente la condición que el estudio no probó. Los PESOS y umbrales son
**[HEURÍSTICA]**.

Antes el plan añadía además **+2 de RIR**. Se quitó: apilar las dos palancas deja la carga real muy
por debajo de la banda respaldada y acerca la semana al cese total, que es justo donde Coleman
encontró la pérdida de fuerza.

**Mesociclo**: `Mesocycle` es un CONTENEDOR, no una periodización. Se crea una vez
(`status: "PLANNED"`, `weeksPlanned: 6`, `currentWeek: 0`) y **nadie lo actualiza jamás**: no avanza,
no se cierra al llegar a las 6 semanas, no genera el siguiente y no hay periodización automática
(eso es F3.4, aplazada). Por eso la UI habla de «bloque de entrenamiento · referencia inicial N
semanas» y no de una cuenta atrás. `currentWeek` no se lee en ningún sitio.

Las semanas de acumulación se **derivan** de las fechas reales de las sesiones, sin migración y sin
inventar estructura. El ancla es la más reciente
de tres fechas: última sesión `DELOAD`, primera sesión del programa activo, y **primera sesión tras
un hueco de ≥`ACCUMULATION_RESET_GAP_DAYS` (10 d)**.

Desde el micro-hardening posterior a la QA, `weekKind: "DELOAD"` **sí se escribe**: al finalizar una
sesión se marca así cuando el motor recomendaba descarga en esa fecha Y las series registradas
quedan por debajo del `COMPLETION_LOW` de lo que prescribe la plantilla (se compara con la
plantilla, no con las series previstas de la sesión, porque «− Quitar serie» baja estas últimas). Si
ya hay una sesión DELOAD en la misma semana ISO, el resto de la semana también cuenta. Esas
sesiones **no cuentan como acortadas** en `SESSION_COMPLETION_DROP` y **anclan el contador**: hacer
la descarga que el motor pide deja de penalizar y reinicia `LONG_ACCUMULATION`. [HEURÍSTICA] el
umbral del 70 % reutiliza `COMPLETION_LOW`.

El tercer caso (el hueco de días) sigue siendo necesario para quien simplemente para: Diría «llevas 85 semanas seguidas acumulando» a quien paró tres
meses y seguiría diciéndolo la semana después de hacer la descarga que el propio coach recomendó —
además de restar 1 punto efectivo al umbral de forma permanente. Un parón real **es** la semana suave
que la señal busca.

**Ámbito de lectura**: `getTrainingContext` lee el **perfil entero, incluidos los programas
archivados** — igual que `workout.repo`, para que las dos pantallas vean los mismos hechos. Acotar
al programa activo se consideró y se descartó: cambiar de programa es una operación normal (F3.1b) y
el filtro dejaría al motor ciego tres semanas después de cada cambio, justo al terminar un bloque.
Una sesión que entrenaste no deja de contar porque cambies la fila del programa a la que cuelga.

Las EXPOSICIONES de cada ejercicio se acotan por número (`HISTORY_WINDOW`), no por días, para que el
motor cuente lo mismo en la pantalla de sesión y en la tarjeta de recuperación; las SESIONES sí se
acotan a la ventana, porque ahí lo que se mide es el periodo reciente.

**Meseta**: `PLATEAU_SIGNAL` sigue siendo solo evidencia. F3.3 la contextualiza (varias mesetas a la
vez suman a la fatiga) pero **jamás** deriva en añadir o quitar series.

> ## ⚠️ Las secciones 2 a 6 están SUPERSEDED
>
> Describen el diseño ORIGINAL de F3, que no es lo que se construyó. Se
> conservan como registro de por dónde se empezó, no como especificación.
> **Lo implementado está en §1b–§1e y es lo que manda.**
>
> Contradicciones concretas, para que nadie las reintroduzca por leer la mitad
> equivocada del documento: §4 prescribe una descarga con **−10 % de carga y
> RIR 3–4**, cuando la receta real mantiene carga y RIR y solo baja un 10 % si
> hay dolor articular (§1e); §2 imputa `RIR = objetivo` cuando falta, y la
> regla desde F3.2c es que **el RIR ausente no se imputa jamás** (§1c); §2
> describe modos `CALIBRACION`/`RECONSTRUCCION` y un `BAJAR_CARGA −7,5 %` fijo
> que no existen (la bajada se dimensiona por equivalencia, §1b); §4 habla de
> una ventana de 2 semanas (real: 21 días) y de que el dolor puntúa 2 (real:
> **el dolor no puntúa**, va por su vía y veta subidas).

## 2. Progressive overload — double progression (F3, SUPERSEDED por §1b)

### Inputs

Historial de `SetLog` por `exerciseVariantId` (peso, reps, RIR, técnica 1–5, completado), metadatos de sesión (duración, fracción completada, feedback pre-sesión), estado del ejercicio (`NORMAL | CALIBRACION | RECONSTRUCCION`), prescripción vigente.

### e1RM

`e1RM(w, reps, rir) = w × (1 + (reps + min(rir,4)) / 30)` (Epley con reps efectivas). Válida solo si `reps + rir ≤ 12`; siempre presentada con "~". Aislamientos de rango alto: usar tonelaje de la mejor serie (`w × reps`) en lugar de e1RM.

### Sesión anómala (D0)

Anómala si: sueño reportado ≤2/5, o energía ≤1/5, o duración <0,6× / >1,8× la mediana de las últimas 6, o <70 % de series completadas, o marcada manualmente, o solapa un `PersonalEvent` de tipo ILLNESS. No alimenta decisiones. Máximo 2 anómalas consecutivas descartables; la tercera cuenta y dispara señal de recuperación.

### Tabla de decisión (evaluar en orden; la primera que aplica gana)

| #   | Condición                                                                                 | Acción                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D0  | Sesión anómala                                                                            | MANTENER (descartada, explicando el motivo)                                                                                                                   |
| D1  | Modo CALIBRACION (variante nueva, 2 sesiones)                                             | CALIBRAR — peso inicial: e1RM de variante "hermana" ×0,85 resuelto a reps objetivo con RIR 3, redondeado ABAJO al incremento; sin hermana, lo fija el usuario |
| D2  | Dolor articular ≥4/5 en la última sesión o ≥3/5 en 3 consecutivas (asociado al ejercicio) | SUSTITUIR (alternativas sin esa contraindicación)                                                                                                             |
| D3  | Técnica media <3/5                                                                        | MANTENER + aviso técnica (nunca subir con técnica <3)                                                                                                         |
| D4  | 2 sesiones válidas consecutivas con caída e1RM >5 % cada una, con RIR ≤ objetivo          | BAJAR_CARGA −7,5 % (redondeo al incremento; modo RECONSTRUCCION 2 sesiones, sin nuevas bajadas)                                                               |
| D5  | Estancamiento: 4 sesiones válidas con Δe1RM acumulado <1 % y RIR medio ≤ objetivo         | 1ª vez: BAJAR_CARGA −5 % y reconstruir; 2ª vez en el mismo mesociclo: SUSTITUIR                                                                               |
| D6  | ≥N−1 series en tope del rango con RIR ≥ objetivo y técnica ≥3, y ninguna serie < repMax−1 | SUBIR_CARGA un incremento (`loadStepKg`) — nunca más de uno                                                                                                   |
| D6a | …pero incremento/carga >10 %                                                              | ANADIR_REP con tope extendido repMax+3; al lograrlo → SUBIR_CARGA y restaurar rango                                                                           |
| D7  | Todas ≥ repMin, alguna sin llegar al tope                                                 | ANADIR_REP (+1 en la primera serie que no llegó)                                                                                                              |
| D8  | 1–2 sesiones tras una subida, reps ≥ repMin                                               | MANTENER (progresión intra-rango esperada)                                                                                                                    |
| D9  | Alguna serie < repMin, sin cumplir D4                                                     | MANTENER + vigilancia (una sesión floja no baja la carga)                                                                                                     |
| D10 | Resto                                                                                     | MANTENER                                                                                                                                                      |

Confianza: ALTA = ≥3 sesiones válidas y RIR completo; MEDIA = 2 sesiones o ≤50 % de RIR faltante (se imputa RIR = objetivo); BAJA = 0–1 sesiones, calibración o >50 % de RIR faltante.

Cambio de variante: historial por `exerciseVariantId`, jamás comparar cargas entre variantes. Volver a una variante con historial <8 semanas → se reutiliza; >8 semanas → última carga −5 % y 1 sesión de calibración.

### Casos de test canónicos (suite de aceptación, 12)

Los 12 casos numéricos del plan aprobado (subida limpia, progresión por reps, post-subida, primera caída, segunda caída −7,5 %, anómala descartada, salto relativo >10 % → reps extendidas, técnica 2/5, estancamiento largo, dolor articular → sustituir, calibración desde hermana 107×0,85 → 60 kg en máquina de 5 kg, RIR faltante → confianza MEDIA). Ver TEST_PLAN.md.

## 3. Volumen (F3, SUPERSEDED por §1)

Serie efectiva: `completed && rir ≤ 4 && !warmup`, contada fraccionalmente vía `ExerciseMuscleContribution` (press inclinado: PECHO_SUPERIOR 1.0, PECHO_MI 0.5, DELT_ANT 0.5, TRICEPS 0.5 — tabla completa en el seed; aproximaciones operativas editables).

Defaults semanales (config): Tier A inicio 8–10 (mín 6–8, máx 16–20); B 4–8; C 0–6. En pérdida de grasa: inicio −20 %, máx −15 %.

Cambios (evaluación semanal): **+1 serie/grupo/sem** solo si ≥2 sesiones válidas del grupo + tendencia de rendimiento estable/positiva + recuperación GOOD + sin dolor MM3 ≥3 + bajo el máx. **−2 series** si 2 semanas de tendencia negativa con esfuerzo presente, o dolor sostenido. Límites: máx 4 grupos modificados/sem, cambio neto ±4 series/sem. Prioridad de cupo: Tier A > B > C.

## 4. Deload (F3, SUPERSEDED por §1e)

Score multi-señal (ventana 2 semanas): caída de rendimiento ≥2 grupos ×2 sem (3 pts) · fatiga alta sostenida (2) · dolor ≥2 articulaciones (2) · ≥50 % ejercicios clave estancados (2) · sueño malo (1) · motivación baja (1) · ≥6 sem sin deload (1; ≥8 sem: 2). **Score ≥5 → recomendar deload** (jamás automático), listando cada señal con números; 3–4 → aviso. Posponer suma +1 la semana siguiente (cap +2).

Prescripción: 1 semana, −50 % series (mín 1/ejercicio), −10 % carga, RIR 3–4, mismos ejercicios. No alimenta tendencias; al acabar se restauran las prescripciones previas y el contador se resetea.

## 5. Mesociclos (F3, no implementado)

4–8 semanas (default 6, deload final opcional). Estados PLANNED|ACTIVE|COMPLETED|ABORTED. Al terminar: resumen (Δe1RM por clave, volúmenes, adherencia, estancados/sustituidos) y transición: grupo que terminó bien → siguiente meso arranca en `min(volFinal−2, inicioDefault+2)`; mal → `inicioDefault`. Nada se borra; historial global por variante.

## 6. Estancamiento y caída (F3, SUPERSEDED por §1b)

Por ejercicio: regresión lineal de e1RM sobre las últimas 4 sesiones válidas. PROGRESANDO > +0,5 %/sesión · ESTANCADO |Δ acumulado| <1 % con RIR ≤ objetivo · EN_CAIDA ≤ −1,5 %/sesión (3 sesiones) o ≤ −5 % acumulado · <4 sesiones = SIN_DATOS (nunca dispara nada).

Por grupo: media ponderada por volumen fraccional; negativa si < −2 % dos semanas seguidas; un solo ejercicio no define al grupo si aporta <40 % del volumen.

## 7. Límites de la evidencia (comunicación)

Series efectivas y factores fraccionales = convenciones contables. Landmarks de volumen = puntos de partida, no verdades. RIR ±1–2 reps de error. e1RM solo tendencia intra-variante. Ver COACH_PHILOSOPHY.md §7.
