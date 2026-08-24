# Auditoría final del motor de entrenamiento

> **Estado: AUDITORÍA. Nada de este documento está implementado.** Es la especificación
> que debe quedar fijada ANTES de tocar código de F3.3 (mesociclos/deload), F3.4
> (extensión de progresión) o F6 (Coach AI).
>
> Método: (1) reconstrucción del comportamiento actual **ejecutando el código real**
> (`suggestProgression`, `generateInitialProgram`, `estimateOneRepMax`) sobre escenarios
> y simulaciones longitudinales; (2) revisión de evidencia con verificación personal de
> DOI/PMID; (3) propuesta de reglas deterministas y simulación comparada del motor actual
> vs. el propuesto. Fecha: 2026-08-24.

---

## Índice

1. [Comportamiento exacto actual](#1-comportamiento-exacto-actual)
2. [Problemas científicos y conceptuales encontrados](#2-problemas-encontrados)
3. [Evidencia](#3-evidencia)
4. [Filosofía propuesta](#4-filosofía-propuesta)
5. [Targets de RIR](#5-targets-de-rir)
6. [Reglas exactas de progressive overload](#6-progressive-overload-definición-exacta)
7. [Reglas reps → carga](#7-el-algoritmo-repscarga-propuesto)
8. [Uso de e1RM](#8-uso-de-e1rm)
9. [Relación con el volumen](#9-volumen)
10. [Fatiga y deload (futuro)](#10-fatiga-y-deload-diseño-no-implementar)
11. [Simulaciones 8–12 semanas](#11-simulaciones-longitudinales)
12. [Diferencias respecto al código actual](#12-diferencias-respecto-al-código-actual)
13. [Qué cambiaría AHORA](#13-qué-cambiaría-ahora)
14. [Qué dejaría para F3.3 / F3.4](#14-qué-dejaría-para-f33--f34)
15. [Diseño conceptual de Coach AI](#15-coach-ai--solo-diseño)
16. [Ruta mínima a iPhone / PWA](#16-ruta-mínima-a-iphone--pwa)
17. [Plan de implementación por fases](#17-plan-de-implementación-por-fases)
18. [Kinobody vs RP vs nosotros](#18-comparación-kinobody--renaissance-periodization)
19. [La regla final](#19-la-regla-final)

---

## 1. Comportamiento exacto actual

### 1.1 Qué entra y de dónde

El motor vive en [`src/core/training/progression.ts`](src/core/training/progression.ts) y recibe
exactamente dos cosas:

| Entrada        | Origen                                                           | Detalle                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prescription` | Snapshot `WorkoutExercise` de la sesión EN CURSO                 | `repRangeMin/Max`, `targetRir`, `plannedSets`, y `loadStepKg` que viene de la **variante del catálogo** ([`workout.repo.ts:172`](src/server/repositories/workout.repo.ts:172)) |
| `lastSession`  | **UNA** sesión: la última `COMPLETED` de esa `exerciseVariantId` | Solo sets `WORKING`, `completed`, `reps > 0` ([`workout.repo.ts:34-62`](src/server/repositories/workout.repo.ts:34))                                                           |

**Hecho crítico nº 1: el motor mira UNA sola sesión.** `comparableSessions` cuenta cuántas
sesiones hay en el historial, pero **solo se usa para degradar la confianza**; ninguna regla
compara la sesión actual con la anterior. Esto contradice literalmente la regla del proyecto
"nunca ajustar por un dato aislado: siempre tendencias/mínimos de muestras"
(CLAUDE.md) y §3/§6 de COACH_PHILOSOPHY.

**Hecho crítico nº 2: el RIR nunca falta en la práctica.** La UI inicializa cada fila con
`rir: logged?.rir ?? last?.rir ?? ex.targetRir` ([`session-runner.tsx:61`](src/components/training/session-runner.tsx:61))
y el tipo `RowState.rir` es `number`, no `number | null`. Es decir: **el valor por defecto del
RIR es el objetivo**, y no existe "no lo sé". La rama de imputación y la confianza `LOW` por
RIR ausente son código muerto con la UI actual, y el dato queda anclado al valor que el motor
quiere ver.

**Hecho crítico nº 3: `technique` y el feedback de sesión son datos de solo escritura.**
`technique` está en el schema Zod pero **ningún componente lo captura** (regla D3 de la spec
inalcanzable). `perceivedPerformance`, `pump`, `jointPain`, `fatigue`, `motivation` se guardan
en `finishSession` y **nadie los lee**.

### 1.2 Las 7 reglas, en orden

```
NO_HISTORY  → START            sets vacíos
SESSION_UNUSABLE → HOLD        n < ceil(plannedSets × 0.7)
INCREASE_LOAD                  ≥ n−1 series en repMax, ninguna < repMax−1, ninguna "cerca del fallo"
NEAR_FAILURE_HOLD → HOLD       alguna serie cerca del fallo Y con reps < repMax
BELOW_MIN_HOLD → HOLD          alguna serie < repMin
ADD_REP                        primera serie por debajo del techo → +1 rep
HOLD_DEFAULT → HOLD            resto
```

Definiciones que importan:

- **`pesoRef`** = peso **modal** de las series; **en empate, el MENOR** ([`progression.ts:64-77`](src/core/training/progression.ts:64)).
- **`rirEff[i]`** = `rir ?? targetRir` (RIR ausente ⇒ **se supone que cumpliste el objetivo**).
- **cerca del fallo** = `rirEff ≤ targetRir − 2` **o** (`rirEff === 0` y `targetRir ≥ 1`).
- `SESSION_UNUSABLE` con `plannedSets = 3` ⇒ `ceil(2.1) = 3`: **el "70 %" es en realidad 100 %**.
  Con 3 series previstas, registrar 2 invalida la sesión entera.

### 1.3 Bench Press 3×6–8 @2 RIR, paso 2,5 kg — trazas reales del código

Ejecutado contra `suggestProgression` real:

| Sesión | Registrado             | Salida del motor                              |
| ------ | ---------------------- | --------------------------------------------- |
| 1      | `80×6@2 80×6@2 80×6@2` | **ADD_REP** → 80 kg × **7** reps · conf. ALTA |
| 2      | `80×7@2 80×7@2 80×7@2` | **ADD_REP** → 80 kg × **8** reps              |
| 3      | `80×8@2 80×8@2 80×7@2` | **INCREASE_LOAD** → **82,5 kg × 6** reps      |
| 4      | `82,5×6@2 ×3`          | **ADD_REP** → 82,5 × 7                        |

Es decir: **de 80 a 82,5 kg hacen falta 3 sesiones**, y basta con que 2 de 3 series lleguen a 8
(la tercera puede quedarse en 7 = `repMax − 1`). Al subir, el motor **siempre devuelve `repMin`**
como objetivo, nunca un objetivo ajustado a la carga nueva.

### 1.4 Los casos que pediste — resultado del código, no de la teoría

| Caso                                     | Entrada                  | Salida REAL                                                                                                 | Comentario                                                                           |
| ---------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Llega a 8 pero @0 RIR                    | `80×8@0 ×3`              | **HOLD · `HOLD_DEFAULT`** · "Mantén 80 kg y consolida la técnica y las repeticiones" · reps sugeridas **6** | ⚠️ Callejón sin salida (§2.1). El mensaje no menciona el fallo.                      |
| Mejora reps, empeora RIR (7@2 → 8@1)     | `80×8@1 ×3`              | **HOLD · `HOLD_DEFAULT`** · mismo mensaje genérico                                                          | ⚠️ Mismo agujero                                                                     |
| Mismo rendimiento, mejor RIR (6@2 → 6@3) | `80×6@3 ×3`              | **ADD_REP** → 7 reps                                                                                        | El RIR mejor **no** se premia: el motor lo trata igual que 6@2                       |
| Pierde reps (8/8/8 → 7/6/6)              | `80×7@2 80×6@2 80×6@2`   | **ADD_REP** → 80 kg × **8** reps                                                                            | ⚠️ Retrocedes y te pide el techo del rango. No sabe que la sesión anterior fue mejor |
| Pierde por debajo del mínimo             | `80×6 80×5 80×5`         | **HOLD · `BELOW_MIN_HOLD`**                                                                                 | Correcto para una sesión; **nunca baja aunque se repita 12 semanas**                 |
| Falta RIR (todas)                        | `80×8@— ×3`              | **INCREASE_LOAD → 82,5 kg** · conf. BAJA                                                                    | ⚠️ La ausencia de dato **habilita** una subida                                       |
| Solo 2 de 3 series                       | `80×8@2 ×2`              | **HOLD · `SESSION_UNUSABLE`**                                                                               | El "70 %" es 100 % con 3 series                                                      |
| Pesos distintos 80/80/70                 |                          | **INCREASE_LOAD** desde `pesoRef = 80` → 82,5                                                               | OK                                                                                   |
| Pesos ascendentes 75/80/85               | todas 8@2                | **INCREASE_LOAD** desde `pesoRef = **75**` → **77,5 kg**                                                    | ⚠️ Empate modal → el MENOR. Te propone menos peso del que ya moviste                 |
| PR fuera de prescripción                 | `90×4@1 ×3` (rango 6–8)  | **HOLD · `BELOW_MIN_HOLD`** → "Repite **90 kg**" objetivo **6 reps**                                        | ⚠️ Te pide 90×6 cuando acabas de hacer 90×4 casi a fallo                             |
| Muy por encima del rango                 | `80×12@2 ×3` (rango 6–8) | **INCREASE_LOAD → 82,5 kg**                                                                                 | ⚠️ La carga está ~25 % por debajo de lo prescrito y corrige un 3 %                   |

### 1.5 Otros roles del catálogo

| Ejercicio                                  | Entrada      | Salida REAL                                                                            |
| ------------------------------------------ | ------------ | -------------------------------------------------------------------------------------- |
| Sentadilla 3×5–8 **@3 RIR**                | `100×8@2 ×3` | **HOLD · `HOLD_DEFAULT`** (RIR 2 < objetivo 3, pero no ≤1 ⇒ tampoco "cerca del fallo") |
| Sentadilla                                 | `100×8@3 ×3` | INCREASE_LOAD → 102,5 × 5                                                              |
| Elev. lateral 3×10–15 @1, paso **2 kg**    | `10×15@1 ×3` | INCREASE_LOAD → **12 kg × 10 reps** = salto de **+20 %**                               |
| Face pull **banda**, `loadStepKg = 0`      | `0×25@1 ×3`  | INCREASE_LOAD → **"sube a 0 kg"** 🐞 texto sin sentido                                 |
| Extensión cuádriceps máquina 12–20, paso 5 | `40×20@1 ×3` | INCREASE_LOAD → 45 kg × **12** reps (tonelaje por serie 800 → 540)                     |

### 1.6 e1RM tal y como se calcula hoy

`estimateOneRepMax(w, reps, rir) = w × (1 + min(reps + min(rir,4), 12)/30)`, y **`null` si
`reps + min(rir,4) > 12`** ([`e1rm.ts`](src/core/training/e1rm.ts)). Se calcula **en el momento
de registrar** y se persiste en `SetLog.estimated1Rm`.

```
e1RM(80, 6, 2) = 101.3     e1RM(80, 8, 2) = 106.7     e1RM(82.5, 6, 2) = 104.5
e1RM(80, 8, 0) = 101.3     e1RM(80, 12, 2) = null     e1RM(10, 15, 1) = null
```

Consecuencias verificadas:

- **Toda la mitad alta del catálogo (rangos 10–15 y 12–20) devuelve `null`**: los aislamientos
  no tienen e1RM jamás, y `bestSet`/`trend` caen a **tonelaje** (`peso × reps`), que compara mal
  entre rangos distintos.
- Al seguir la sugerencia del motor (80×8@2 → 82,5×6@2) el e1RM~ **baja** de 106,7 a 104,5. La
  app te propone un paso que, medido con su propia métrica, es un retroceso.
- `trend()` compara **la primera y la última** sesión de la ventana con umbral **±1 %**
  ([`history.ts:125-127`](src/core/training/history.ts:125)) — muy por debajo del error de
  medida del propio e1RM (§3.4). Dos puntos, no una tendencia.

### 1.7 El generador (F3.2), con el catálogo real

Programa generado para 4 días / 75 min / intermedio / sin prioridades:

```
Torso A  18 series (61 min)   Pierna A 15 series (52 min)
Torso B  17 series (61 min)   Pierna B  9 series (37 min)   ← 38 min sin usar
Total: 59 series/semana
```

| Grupo               | Directas | Efectivas | Frec. | Objetivo    |
| ------------------- | -------- | --------- | ----- | ----------- |
| Cuádriceps          | 6        | **6,0**   | 2     | 9,0         |
| Dorsal              | 6        | 8,5       | 2     | 9,0         |
| Delt. lateral       | 6        | 6,0       | 2     | 8,0         |
| Glúteo              | 3        | 10,5      | 1     | 8,0         |
| Antebrazo           | 0        | 0,0       | 0     | 3,0         |
| **Avisos emitidos** |          |           |       | **ninguno** |

Cuádriceps se queda en **67 % de su objetivo** y el sistema **no dice nada**, porque el aviso solo
salta bajo `0.6 × objetivo` (5,4). Causa: `MAX_SETS_PER_GROUP_PER_SESSION.standard = 3` topa cada
grupo a 3 series/día; cuando el menú del día tiene pocos grupos (Pierna B), el día se cierra con
9 series y 38 minutos sin usar. **El objetivo semanal es aspiracional; el generador no comprueba
si lo cumple.**

---

## 2. Problemas encontrados

Ordenados por gravedad real. Cada uno está verificado ejecutando el código.

### 2.1 🔴 Zona muerta: cerrar el rango con RIR justo por debajo del objetivo → HOLD para siempre

Para **subir** hace falta `rirEff ≥ targetRir`. Para que salte `NEAR_FAILURE_HOLD` hace falta
`rirEff ≤ targetRir − 2` **y** `reps < repMax`. El estado `rirEff = targetRir − 1` con las reps
en el techo **no lo cubre ninguna regla** y cae en `HOLD_DEFAULT` con el mensaje genérico
_"Mantén 80 kg y consolida la técnica y las repeticiones"_.

Es el caso más probable del mundo real: cierras 8 reps y te sientes a 1 de reserva en vez de 2.
Y como el error típico de estimación de RIR es de ±1–2 reps (§3.3), **el criterio de subida vive
dentro del ruido del propio dato**. El usuario puede quedarse ahí indefinidamente sin que la app
le diga qué falta.

Además el `HOLD_DEFAULT` sugiere volver a `repMin` (6) tras haber hecho 8: es una instrucción
regresiva sin explicación.

### 2.2 🔴 Estado absorbente: el motor nunca baja la carga, ni siquiera tras 12 semanas

`BELOW_MIN_HOLD` dice literalmente _"no bajo el peso por una sesión"_ — pero tampoco lo baja tras
doce. Simulación real (§11, persona B): un usuario que en `START` elige 80 kg cuando su e1RM real
es 100 (≈80 % 1RM, demasiado para 6–8 @2 RIR) recibe **8 semanas seguidas de `BELOW_MIN_HOLD`**
con el mismo mensaje. Y `START` solo dice _"elige un peso con el que cierres 6 repeticiones
dejando ~2 en reserva"_, sin anclaje numérico: la probabilidad de equivocarse es alta y el coste
de equivocarse es un bloqueo de semanas.

### 2.3 🔴 El motor decide con una sola sesión — viola su propia filosofía

Ninguna regla compara con la sesión previa. Consecuencias medidas:

- **Regresión invisible**: 8/8/8 → 7/6/6 produce `ADD_REP` pidiendo 8. El motor no sabe que has bajado.
- **Estancamiento invisible**: simulación persona C (§11) — el motor emite **`ADD_REP` idéntico
  7 semanas seguidas** mientras el usuario oscila 7/7/6 sin progresar. Nunca dice "estás en meseta".
- **Sobre-lectura de un buen día**: una sesión buena aislada basta para subir carga.

### 2.4 🟠 El paso de carga es absoluto y en ~40 % del catálogo es MAYOR que lo que el rango absorbe

Un rango de reps absorbe un porcentaje de carga acotado. Con la equivalencia de Epley:

```
span = (1 + repMax/30) / (1 + repMin/30) − 1
```

Si `loadStep / carga > span`, tras `INCREASE_LOAD` **el usuario no puede alcanzar `repMin`** → cae
en `BELOW_MIN_HOLD` → se queda atascado. Cálculo sobre el catálogo real con cargas típicas
(mancuerna 12 kg, barra 60, máquina 45, polea 30, EZ 30, lastre 10):

| Variante                       | Paso   | Rango | span   | paso %     |     |
| ------------------------------ | ------ | ----- | ------ | ---------- | --- |
| Elevación lateral / Mancuernas | 2 kg   | 10–15 | 12,5 % | **16,7 %** | ⚠️  |
| Press banca / Mancuernas       | 2 kg   | 8–12  | 10,5 % | **16,7 %** | ⚠️  |
| Jalón al pecho / Polea         | 5 kg   | 8–12  | 10,5 % | **16,7 %** | ⚠️  |
| Sentadilla hack / Máquina      | 5 kg   | 8–12  | 10,5 % | **11,1 %** | ⚠️  |
| Dominadas / lastre             | 2,5 kg | 5–10  | 14,3 % | **25 %**   | ⚠️  |
| Press banca / Barra            | 2,5 kg | 6–10  | 11,1 % | 4,2 %      | ✅  |
| Sentadilla / Barra             | 2,5 kg | 5–8   | 8,6 %  | 4,2 %      | ✅  |

**~30 de 74 variantes** están en la zona roja. El patrón es claro: **con barra el sistema funciona;
con mancuerna, máquina y polea el salto mínimo del material es demasiado grande para el rango**.
No es un defecto de `loadStepKg` (representa correctamente el hardware): es que **el motor no
comprueba si el salto cabe en el rango**.

Caso extremo: `loadStepKg = 0` (banda elástica, elevación de piernas) ⇒ `INCREASE_LOAD` emite
_"sube a 0 kg"_.

### 2.5 🟠 Volver siempre a `repMin` tras subir tira estímulo a la basura

Al pasar de `80×8@2` a 82,5 kg, las reps equivalentes son ~6,9 → 7. El motor pide 6. En máquina
(`40×20 → 45 kg`) las equivalentes son ~14,4 y el motor pide **12**: se pierden 2 reps × 3 series
y dos sesiones enteras de escalera. Cuanto más ancho el rango, peor.

### 2.6 🟠 El RIR ausente se imputa AL OBJETIVO — la falta de dato habilita subir

`rirEff = rir ?? targetRir` ([`progression.ts:111`](src/core/training/progression.ts:111)): no
registrar RIR equivale a declarar que cumpliste. Combinado con que **la UI ya rellena el RIR con
el objetivo**, el sistema tiene un sesgo estructural hacia "vas fino". Cualquier imputación debería
ser conservadora, nunca habilitante.

### 2.7 🟡 `pesoRef` modal con desempate al MENOR rompe con series ascendentes

`75/80/85` → `pesoRef = 75` → sugiere 77,5 kg, por debajo de dos de las tres series que ya hiciste.
La invariante P3 de los tests ("nunca reduce el peso") solo compara contra `pesoRef`, así que no lo
detecta. La mediana sería robusta y trivial.

### 2.8 🟡 `SESSION_UNUSABLE` es un 100 % disfrazado de 70 %

`ceil(3 × 0.7) = 3`. Con la configuración por defecto (3 series), no completar la tercera invalida
la sesión completa. Con 4 previstas, en cambio, bastan 3. Comportamiento inconsistente.

### 2.9 🟡 Confianza ALTA con una única sesión de evidencia

`comparableSessions ≥ 2` + RIR completo ⇒ `HIGH`, aunque la decisión use **una** sesión y la UI
convierta `HIGH` en el imperativo _"Sube 82,5 kg"_ frente al tentativo _"Prueba"_.

### 2.10 🟡 El generador no verifica que cumple su propio objetivo

Cuádriceps a 6,0 efectivas con objetivo 9,0 y **cero avisos**; Pierna B usa 37 de 75 minutos. El
tope `MAX_SETS_PER_GROUP_PER_SESSION = 3` y el catálogo estrecho de algunos menús cierran el día
antes de tiempo, y `WARN_FRACTION = 0.6` es demasiado permisivo para detectarlo.

### 2.11 🟡 Datos capturados y nunca usados; regla D3 inalcanzable

`technique` no se captura en ninguna pantalla ⇒ la regla "nunca subir con técnica < 3" de la spec
no puede existir. `jointPain`, `fatigue`, `motivation`, `pump`, `perceivedPerformance` se guardan y
nadie los lee. Es deuda barata de convertir en valor (§10).

### 2.12 🟡 Contradicción documental

`COACH_PHILOSOPHY.md §4` fija un ranking estético duro ("hombro lateral > dorsal > pecho superior

> …"), mientras `TRAINING_ENGINE.md §0` y `training-config.ts` declaran explícitamente **"sin
> prioridad estética por defecto"** y el generador implementa lo segundo. §4 está obsoleto.

### 2.13 Lo que está BIEN y no hay que tocar

- **No subir con series a fallo** cuando la prescripción pedía reserva: correcto y bien alineado.
- **No bajar la carga por una sesión mala**: correcto (validado en la simulación D, §11).
- **Nunca inventar un peso en la primera sesión** (`START` sin `suggestedWeightKg`): honesto.
- **Robustez ante ruido de RIR**: con ±1,5 reps de ruido la trayectoria a 12 semanas es
  prácticamente idéntica (§11). El RIR **como puerta** es más robusto de lo que parece.
- **Sugerencia efímera, nunca modifica el programa**, snapshots inmutables, historial anclado a
  `exerciseVariantId`: la arquitectura es correcta y no necesita cambios.
- **Conteo fraccional de volumen efectivo**: es exactamente lo que la mejor meta-regresión
  disponible modela (§3.5).

---

## 3. Evidencia

Convención de etiquetas usada en todo el documento:

- **[EVIDENCIA FUERTE]** — múltiples meta-análisis o ECAs concordantes, dirección estable, mecanismo plausible.
- **[EVIDENCIA RAZONABLE]** — un meta-análisis o pocos ECAs de calidad, o efecto pequeño/con incertidumbre.
- **[HEURÍSTICA]** — decisión de producto defendible pero sin demostración directa. **No se presenta como ciencia.**

Todas las referencias que siguen se han verificado contra PubMed/Crossref/texto del preprint. Al
final de cada bloque se indica lo que **no** se ha podido verificar.

### 3.1 Proximidad al fallo e hipertrofia

- **Refalo MC, Helms ER, Trexler ET, Hamilton DL, Fyfe JJ.** _Influence of Resistance Training
  Proximity-to-Failure on Skeletal Muscle Hypertrophy: A Systematic Review with Meta-analysis._
  **Sports Med. 2023;53(3):649-665.** DOI 10.1007/s40279-022-01784-y · PMID 36334240.
  15 estudios. Fallo (cualquier definición) vs. no-fallo: **ES 0,19 (IC95 % 0,00–0,37)**. Fallo
  muscular momentáneo vs. no-fallo: **ES 0,12 (IC95 % −0,13–0,37)**, no significativo.
  _(Verificado personalmente: la referencia es Sports Medicine, no J Sports Sci.)_
- **Robinson ZP, Pelland JC, Remmert JF, Refalo MC, Jukic I, Steele J, Zourdos MC.** _Exploring the
  Dose–Response Relationship Between Estimated Resistance Training Proximity to Failure, Strength
  Gain, and Muscle Hypertrophy: A Series of Meta-Regressions._ **Sports Med. 2024;54(9):2209-2231.**
  DOI 10.1007/s40279-024-02069-2 · PMID 38970765.
  Hipertrofia (140 efectos / 26 estudios): pendiente **negativa** con IC que **excluye** el nulo
  (≈ **−0,48 puntos porcentuales de crecimiento por cada RIR adicional**). Fuerza (243 efectos /
  55 estudios): **el IC contiene el nulo** ⇒ relación despreciable. Ajuste de modelo modesto.
  _(Verificado personalmente vía preprint SportRxiv 295 + abstract PubMed; los coeficientes exactos
  proceden del preprint, no de la versión de pago.)_
- **Grgic J, Schoenfeld BJ, Orazem J, Sabol F.** J Sport Health Sci. 2022;11(2):202-211.
  DOI 10.1016/j.jshs.2021.01.007 · PMID 33497853. Hipertrofia global n.s.; subgrupo de **sujetos
  entrenados ES 0,15 (IC95 % 0,03–0,26)** a favor del fallo.
- **Vieira AF et al.** J Strength Cond Res. 2021;35(4):1165-1175. PMID 33555822. El efecto a favor
  del fallo **desaparece al igualar volumen**.
- ECAs directos en entrenados con diseño intra-sujeto que **no** encuentran diferencia: Refalo 2024
  (J Sports Sci 42(1):85-101, PMID 38393985), Santanielo 2020 (Biol Sport, PMID 33343066),
  Lacerda 2020 (JSCR, PMID 31809457), Vasconcelos 2026 (JSCR, PMID 42617172).

> **Conclusión A [EVIDENCIA FUERTE]:** el fallo momentáneo **no es necesario** para maximizar
> hipertrofia. Entrenar a ~1–3 RIR es indistinguible del fallo con volumen igualado.
>
> **Conclusión B [EVIDENCIA RAZONABLE]:** existe una **dosis-respuesta continua pequeña** —
> más cerca del fallo, algo más de hipertrofia (~0,5 pp por RIR). El grueso del estímulo se
> captura ya dentro de 0–4 RIR; **la diferencia entre 3 y 0 RIR es trivial, la diferencia entre
> 8 y 2 RIR sí importa.** (Así se reconcilian Refalo "no lineal" y Robinson "pendiente continua":
> Refalo compara categorías, Robinson modela un continuo de 0 a 22 RIR.)

### 3.2 Proximidad al fallo y FUERZA

- **Robinson 2024** (arriba): pendiente **nula** para fuerza en todo el rango de RIR.
- **Davies T, Orr R, Halaki M, Hackett D.** Sports Med. 2016;46(4):487-502. PMID 26666744
  (erratum PMID 26893097). **ES 0,34 a favor del NO-fallo (p = 0,02)**; compuestos **ES 0,37–0,38**.
  Pero desaparece con volumen controlado y la diferencia absoluta es **0,6–1,3 %** de fuerza.
- **Jukic I et al.** Sports Med. 2023;53(1):177-214. PMID 36178597. El umbral de pérdida de
  velocidad **no influye** en fuerza; a mayor pérdida de velocidad, **más hipertrofia** pero **peor**
  CMJ, sprint y velocidad submáxima.
- **Pareja-Blanco 2017** (Scand J Med Sci Sports 27(7):724-735, PMID 27038416): VL20 igualó a VL40
  en fuerza **haciendo un 40 % menos de repeticiones** y superó en CMJ.
- **Izquierdo-Gabarren 2010** (MSSE 42(6):1191-1199, PMID 19997025): en remeros, el grupo sin fallo
  ganó más 1RM (+4,6 % vs +2,1 %) y potencia (+6,4 % vs **−1,2 %**).

> **Conclusión C [EVIDENCIA FUERTE]:** para **fuerza máxima la proximidad al fallo es irrelevante**;
> lo que manda es la **carga**. Llegar al fallo en compuestos pesados no compra fuerza.

### 3.3 Precisión de la estimación de RIR — el dato que más condiciona nuestro diseño

- **Halperin I, Malleron T, Har-Nir I, Androulakis-Korakakis P, Wolf M, Fisher J, Steele J.**
  _Accuracy in Predicting Repetitions to Task Failure in Resistance Exercise: A Scoping Review and
  Exploratory Meta-analysis._ **Sports Med. 2022;52(2):377-390.** DOI 10.1007/s40279-021-01559-x ·
  PMID 34542869. 12 estudios, 414 participantes, 262 efectos.
  **Infrapredicción media ≈ 1 repetición**, heterogeneidad enorme (**I² ≈ 98 %**), **DE
  interindividual ≈ 1,45 reps**. Moderadores: precisión mejor **cerca del fallo** y en **series
  posteriores**; el error **se dispara en series > 12 reps**; el **nivel de entrenamiento NO
  moderó**. Los autores subrayan que un error de 1 repetición es **5 % en una serie de 20 pero
  20 % en una serie de 5**. _(Cifra central verificada personalmente.)_
- **Refalo MC et al.** J Strength Cond Res. 2024;38(3):e78-e85. PMID 37967832. En entrenados, press
  banca 75 % 1RM, predicción intra-serie: **error absoluto 0,65 ± 0,78 reps**, y **equivalencia
  estadística entre 1-RIR y 3-RIR**.
- **Remmert JF, Laurson KR, Zourdos MC.** _Accuracy of Predicted Intraset Repetitions in Reserve
  (RIR) in Single- and Multi-Joint Resistance Exercises Among Trained and Untrained Men and Women._
  **Percept Mot Skills. 2023;130(3):1239-1254.** DOI 10.1177/00315125231169868 · PMID 37036795.
  Las predicciones son **más precisas cerca del fallo y en series posteriores**, y **NO hubo
  diferencia significativa por tipo de ejercicio (mono vs. multiarticular, p = 0,688)** ni por sexo
  ni por experiencia. _(Verificado personalmente.)_
- **Zourdos MC et al.** J Strength Cond Res. 2016;30(1):267-275. PMID 26049792. Validación de la
  escala RPE-RIR; los noveles **no reconocen que están al fallo** (RPE 8,96 en un 1RM real).
- **Steele J et al.** PeerJ. 2017;5:e4105. PMID 29204323. En población general, **SEM 2,6–3,4 reps**.

> **Conclusión D [EVIDENCIA FUERTE]:** el RIR autoinformado tiene un **error típico de ~1 rep en
> entrenados con series cortas y conocidas**, y de **2–3,5 reps** fuera de ese contexto, con sesgo
> a **infrapredecir** (dices 2, estás a 3).
>
> **Implicación de diseño (nuestra, [HEURÍSTICA derivada]):** cualquier regla que exija
> `RIR ≥ objetivo` **con igualdad estricta** está tomando decisiones dentro del ruido del propio
> dato. El RIR debe usarse con **banda de tolerancia de ±1**, y no como un umbral exacto. Además,
> como un error de 1 rep pesa relativamente **más** en series de 5–8 que en series de 15–20, la
> tolerancia debe aplicarse **especialmente en compuestos pesados**, justo donde hoy el objetivo
> es más exigente (RIR 3).

### 3.4 Coste de fatiga de acercarse al fallo

- **Vieira JG et al.** _Effects of Resistance Training to Muscle Failure on Acute Fatigue._
  Sports Med. 2022;52(5):1103-1125. PMID 34881412. Efecto **grande** sobre propiedades
  biomecánicas (**SMD −0,96**), daño muscular a 48 h (**SMD 0,86**) y RPE (**SMD 1,93**).
- **Refalo MC, Helms ER, Hamilton DL, Fyfe JJ.** Sports Med Open. 2023;9(1):10. PMID 36752989.
  Press banca 75 % 1RM, 6 series: pérdida de velocidad a los 4 min **−25 % (fallo) / −13 % (1 RIR)
  / −8 % (3 RIR)**; pérdida de la serie 1 a la 6 **−22 % / −9 % / −6 %**. A **24 h**, 3 RIR ya está
  recuperado; fallo y 1 RIR conservan residuo que se disipa a 48 h.
- **Refalo MC et al.** Eur J Sport Sci. 2025;25(3):e12266. PMID 39960821. Con fallo: más molestia,
  más RPE de sesión y **peor afecto general**, sostenido durante 8 semanas.
- **Sánchez-Medina L, González-Badillo JJ.** MSSE. 2011;43(9):1725-1734. PMID 21311352. La pérdida
  de velocidad correlaciona **r = 0,91–0,97** con lactato y pérdida de CMJ; el amonio se dispara de
  forma **curvilínea** solo al superar ~la mitad de las repeticiones máximas posibles.

> **Conclusión E [EVIDENCIA FUERTE]:** el fallo cuesta mucha más fatiga aguda y peor experiencia
> por un estímulo equivalente. **El fallo se autolimita**: lo que gana en la primera serie lo pierde
> en las siguientes (Refalo 2024: volumen acumulado a 8 semanas similar entre FAIL y 1–2 RIR).

### 3.5 Volumen y conteo fraccional

- **Pelland JC et al.** _The Resistance Training Dose Response: Meta-Regressions Exploring the
  Effects of Weekly Volume and Frequency on Muscle Hypertrophy and Strength Gains._ **Sports Med.**
  DOI 10.1007/s40279-025-02344-w · PMID 41343037. **67 estudios, 2 058 participantes.** Compararon
  tres formas de contar las series indirectas (**1,0 "total" / 0,5 "fraccional" / 0 "solo directas"**)
  y la **evidencia relativa fue más fuerte para el conteo FRACCIONAL**, que usaron en los modelos
  principales. Probabilidad posterior de pendiente positiva del volumen = **100 %** tanto para
  hipertrofia como para fuerza, con **rendimientos decrecientes**, **mucho más marcados en fuerza**.
  _(Verificado personalmente.)_
- **Schoenfeld BJ, Ogborn D, Krieger JW.** J Sports Sci. 2017;35(11):1073-1082. Dosis-respuesta
  positiva; ganancias apreciables ya a volúmenes bajos.

> **Conclusión F [EVIDENCIA RAZONABLE→FUERTE]:** contar el volumen **efectivo** con contribución
> fraccional del trabajo indirecto es exactamente lo que hace la mejor meta-regresión disponible.
> **Nuestro modelo de volumen de F3.2 es conceptualmente correcto.** Los **números concretos**
> (`EFFECTIVE_TARGET`, `DIRECT_MIN`) siguen siendo **[HEURÍSTICA de producto]**.

### 3.6 Progressive overload: carga vs. repeticiones

- **Plotkin D, Coleman M, Van Every D, Maldonado J, Oberlin D, Israetel M, Feather J, Alto A,
  Vigotsky AD, Schoenfeld BJ.** _Progressive overload without progressing load? The effects of load
  or repetition progression on muscular adaptations._ **PeerJ. 2022;10:e14142.**
  DOI 10.7717/peerj.14142 · PMID 36199287. 43 entrenados, 8 semanas: progresar **carga** o
  progresar **repeticiones** produjo hipertrofia equivalente (+6,7 % a +12,9 % de grosor muscular
  en ambos). _(Verificado personalmente.)_

> **Conclusión G [EVIDENCIA FUERTE]:** los dos brazos de la double progression son
> **intercambiables para hipertrofia**. No hace falta añadir peso para crecer; sí para fuerza
> específica (§3.2: la carga es lo que predice el 1RM).

### 3.7 e1RM: qué error tiene realmente

- Las ecuaciones clásicas (Epley, Brzycki, Wathen, Mayhew) tienen **SEE ≈ 2,4–3,2 kg (≈3,4 %)** en
  press banca en validaciones publicadas, y **el error crece con el número de repeticiones** y
  **depende mucho del ejercicio** (en ejercicios como extensión de tríceps o prensa los errores
  reportados en algunas poblaciones llegan a ser enormes). Epley se comporta mejor en ~6–10 reps;
  Brzycki en 1–6.
- Todo esto asume **una serie llevada al fallo**. Cuando el e1RM se calcula desde una serie con RIR
  autoinformado, el error del RIR (§3.3, ~1 rep, DE 1,45) se **suma** al error de la ecuación.

> **Conclusión H [EVIDENCIA RAZONABLE]:** un e1RM estimado desde una serie submáxima con RIR
> declarado tiene un error del orden de **±5 %**. **Cualquier decisión disparada por una variación
> de e1RM menor del 5 % está decidiendo sobre ruido.** Nuestro umbral actual de tendencia es
> **±1 %** ([`history.ts:127`](src/core/training/history.ts:127)): cinco veces por debajo del ruido.

### 3.8 Deload

- **Coleman M et al.** _Gaining more from doing less? The effects of a one-week deload period during
  supervised resistance training on muscular adaptations._ **PeerJ. 2024;12:e16777.**
  DOI 10.7717/peerj.16777. 9 semanas, deload de 1 semana en el punto medio: **sin diferencias** en
  hipertrofia, potencia ni resistencia local, y **el grupo SIN deload ganó MÁS fuerza** (isométrica
  y dinámica) del tren inferior. _(Verificado personalmente.)_

> **Conclusión I [EVIDENCIA RAZONABLE]:** el deload **no es un potenciador de ganancias**; es
> **gestión de fatiga**. Un deload de calendario innecesario puede incluso costar fuerza. Cualquier
> mensaje del tipo "descargar cada N semanas mejora tus resultados" sería **falso**.

### 3.9 RIR progresivo dentro del mesociclo (la "rampa 3→2→1→0")

- **Martikainen S, Niiranen R, Rytkönen T, Schoenfeld BJ, Ahtiainen JP, Hulmi JJ.** _Influence of
  Varying Proximity-to-Failure on Muscular Adaptations and Repetitions-in-Reserve Estimation
  Accuracy in Resistance-Trained Individuals._ **J Sci Sport Exerc. 2025.**
  DOI 10.1007/s42978-025-00338-8. Entrenados, 10 semanas, RIR 4→1 progresivo (n = 16) vs. RIR 1
  constante (n = 15): **sin diferencias en 1RM de banca ni sentadilla ni en CSA del vasto lateral**.
  El grupo con RIR progresivo entrenó con **menor RPE de sesión**. _(Existencia, diseño y DOI
  verificados personalmente; revista sin indexación en PubMed, sin réplica.)_

> **Conclusión J [HEURÍSTICA]:** la rampa de RIR **no tiene evidencia de superioridad adaptativa**.
> El único argumento defendible a su favor es de **gestión** (mismo resultado con menos RPE). No la
> implementamos como si mejorase la hipertrofia.

### 3.10 Position stand más reciente (2026)

- **American College of Sports Medicine Position Stand.** _Resistance Training Prescription for
  Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews._
  **Med Sci Sports Exerc. 2026.** DOI 10.1249/MSS.0000000000003897 · PMID 41843416. Primera
  actualización en 17 años; síntesis de **137 revisiones sistemáticas / >30 000 participantes**.
  Puntos relevantes para nosotros:
  - **El fallo absoluto es innecesario.** Para fuerza, **parar a 2–3 RIR produce los mismos
    resultados con menos fatiga**.
  - **Fuerza**: ≥80 % 1RM, ROM completo, **2–3 series**, los levantamientos clave al principio de
    la sesión, **≥2 sesiones/semana**.
  - **Hipertrofia**: **≥10 series por grupo muscular y semana**; cargas del **30 al 100 % de 1RM**
    funcionan siempre que la serie se lleve **cerca del fallo**.
  - Las palancas que mueven el resultado son **carga relativa, volumen semanal, ROM completo y
    esfuerzo suficiente por serie**. La periodización compleja y el tipo de material **no** están
    en la lista de imprescindibles.

  _(Cita, revista, DOI y PMID verificados personalmente. **Las cifras concretas proceden de
  resúmenes secundarios del position stand, no del texto completo** — está tras pago. Marcar como
  pendiente de confirmar contra el PDF antes de citarlas en la UI.)_

> **Conclusión K [EVIDENCIA FUERTE]:** el consenso institucional coincide con nuestra dirección
> (fallo innecesario, 2–3 RIR suficiente, ROM completo, ≥2×/semana, sin periodización compleja).
>
> **Tensión honesta que hay que anotar [para §9]:** el position stand sitúa la hipertrofia en
> **≥10 series/músculo/semana**, y nuestro `EFFECTIVE_TARGET` de partida es **6–10 efectivas**, es
> decir **en el borde inferior o por debajo**. Nuestra banda es defendible como **punto de partida
> con margen de progresión** (y Schoenfeld 2017 muestra ganancias ya a volúmenes bajos), pero
> **no** debe presentarse como "el volumen óptimo". Y sobre todo: **si el generador entrega solo el
> 67 % de su propio objetivo** (cuádriceps 6,0 vs 9,0, §1.7), el volumen real cae claramente por
> debajo de la recomendación institucional. Eso convierte el defecto §2.10 en prioritario.

### 3.11 Lo que NO se puede afirmar (y por tanto no afirmaremos)

| Afirmación frecuente                                         | Estado real                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Entrenar al fallo aumenta el riesgo de lesión"              | **Sin datos.** Ningún estudio prospectivo compara incidencia de lesión fallo vs. no-fallo. Es principio de precaución, no hallazgo.                                                                                                                                                                          |
| "El RIR objetivo debe variar por tipo de ejercicio"          | **[HEURÍSTICA].** Cero estudios de asignación directa. El subgrupo meta-analítico más pertinente (Grgic 2022, mono vs. multiarticular) sale **nulo**, y Remmert 2023 **no** encuentra diferencia de precisión por tipo de ejercicio. Se sostiene por coste de fatiga y riesgo, no por fisiología demostrada. |
| "Los compuestos fatigan más que los aislamientos, por serie" | **Parcialmente falso.** Sánchez-Medina 2011 y Vieira 2022 encuentran **más** pérdida de velocidad en press banca que en sentadilla. La fatiga _sistémica_ sí escala con la masa implicada; la fatiga _local por serie_ no.                                                                                   |
| "Los años de experiencia mejoran la precisión del RIR"       | **Contradictorio.** Halperin 2022 y Refalo 2024 no lo encuentran; Steele 2017 y Zourdos 2016 sí. Lo que parece mejorar es la **práctica específica en ese ejercicio**.                                                                                                                                       |
| "Añadir series semanalmente es necesario para progresar"     | **No demostrado** para hipertrofia (Enes 2024 mejora fuerza; hipertrofia pequeña e incierta).                                                                                                                                                                                                                |
| "Un deload planificado mejora las ganancias"                 | **Falso** según el único ECA directo (Coleman 2024).                                                                                                                                                                                                                                                         |

---

## 4. Filosofía propuesta

> **Personal Coach entrena por tendencia, no por sesión. Progresa primero en repeticiones y luego
> en carga, dentro de un rango, dejando margen al fallo en casi todo el trabajo, con un volumen
> moderado que solo cambia cuando hay evidencia acumulada. Nunca exige un PR. Una mala sesión no
> cambia nada. Dos sesiones malas seguidas sí.**

Los ocho principios, con su etiqueta:

1. **La unidad de decisión es el ejercicio a lo largo de ≥2 exposiciones, no la sesión.**
   Deriva directamente de que el RIR tiene DE interindividual de 1,45 reps y el e1RM ±5 %:
   una sola sesión no distingue señal de ruido. **[EVIDENCIA RAZONABLE + principio del proyecto]**
2. **Double progression: primero reps dentro del rango, después carga.** Los dos brazos son
   equivalentes para hipertrofia (Plotkin 2022) y la carga es lo que construye fuerza (Robinson
   2024). **[EVIDENCIA FUERTE para la equivalencia; HEURÍSTICA el orden concreto]**
3. **La mayoría del trabajo a 1–3 RIR. El fallo es opcional, no un objetivo.** **[EVIDENCIA FUERTE]**
4. **El fallo se tolera (no se persigue) en aislamientos y máquinas; se evita en compuestos
   pesados.** Justificación: fatiga sistémica y riesgo técnico, no superioridad fisiológica.
   **[HEURÍSTICA razonada]**
5. **La carga debe permitir siempre el rango prescrito.** Si no lo permite dos exposiciones
   seguidas, baja. Es una regla de coherencia interna, no de fisiología. **[DEFINICIONAL]**
6. **El volumen es una decisión de mesociclo, nunca una reacción a una sesión.** Progressive
   overload primario = reps/carga. **[EVIDENCIA RAZONABLE]**
7. **El deload es un seguro de fatiga, no un potenciador.** Reactivo por señales, con un aviso
   suave de calendario como red. Nunca automático. **[EVIDENCIA RAZONABLE]**
8. **Cada recomendación dice el número que la disparó y su confianza en 3 niveles.** Si no hay
   datos suficientes, se dice. **[Principio de producto, COACH_PHILOSOPHY §7–§8]**

Y una regla negativa explícita: **la app nunca dice "tienes que batir tu marca hoy"**. El objetivo
es que la tendencia de 4–8 semanas suba, no que cada sesión sea un récord.

---

## 5. Targets de RIR

### 5.1 Qué respondemos a tus preguntas

| Pregunta                                | Respuesta                                                                                                                                                                                                                                                               | Etiqueta              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| ¿RIR 3 es demasiado conservador?        | Para **hipertrofia**, sí es el borde bajo de lo productivo: la pendiente de Robinson implica ~1,5 pp menos de crecimiento vs. 0 RIR. Para **fuerza** no cuesta nada (pendiente nula). Y **a 3 RIR se está recuperado a 24 h** frente a 48 h con fallo.                  | [EVIDENCIA RAZONABLE] |
| ¿2 RIR?                                 | Es el punto dulce coste/beneficio para casi todo.                                                                                                                                                                                                                       | [EVIDENCIA RAZONABLE] |
| ¿1 RIR?                                 | Correcto y bien tolerado en aislamientos y máquinas; es donde el RIR además se estima mejor (cerca del fallo).                                                                                                                                                          | [EVIDENCIA RAZONABLE] |
| ¿Cuándo tiene sentido 0 RIR?            | Cuando el coste de fatiga es bajo y el riesgo técnico mínimo: **última serie de un aislamiento o de una máquina**, y en contextos de **volumen muy bajo** (con 1 serie por ejercicio, el fallo sí parece importar — Hermann 2025, MSSE 57(9):2021-2031, PMID 40249908). | [EVIDENCIA RAZONABLE] |
| ¿Fallo regularmente?                    | No como norma. No aporta hipertrofia con volumen igualado, no aporta fuerza, cuesta ~3× fatiga aguda y empeora el afecto de forma sostenida.                                                                                                                            | [EVIDENCIA FUERTE]    |
| ¿RIR variable dentro del mesociclo?     | **No lo implementamos como mejora de resultados.** El único ECA directo salió neutro. Como MUCHO, −1 punto en la última semana de acumulación, etiquetado como gestión de fatiga.                                                                                       | [HEURÍSTICA]          |
| ¿Coste de fatiga de acercarse al fallo? | Cuantificado: velocidad −25 % vs −8 % a los 4 min; CK elevada a 48 h; RPE SMD 1,93; caída intra-sesión −22 % vs −6 %.                                                                                                                                                   | [EVIDENCIA FUERTE]    |
| ¿Cómo de preciso es el RIR?             | ~1 rep de error en entrenados/series cortas/ejercicio conocido; 2–3,5 reps fuera de eso. Sesgo a infrapredecir. Se estima mejor **cerca del fallo**.                                                                                                                    | [EVIDENCIA FUERTE]    |

### 5.2 Targets que proponemos (cambio mínimo respecto a hoy)

| Rol                                                 | RIR objetivo                   | Cambio | Justificación                                                                                                                                              |
| --------------------------------------------------- | ------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compuesto pesado (sentadilla, PM, RDL, remo pesado) | **2** (hoy 3)                  | ⬇️     | 3 RIR es defendible pero deja estímulo sobre la mesa; a 2 RIR se sigue recuperando bien y la fuerza no depende de la proximidad al fallo. **[HEURÍSTICA]** |
| Compuesto                                           | **2**                          | =      | Punto dulce.                                                                                                                                               |
| Aislamiento / máquina                               | **1**                          | =      | Bien tolerado, RIR más preciso ahí.                                                                                                                        |
| Última serie de aislamiento/máquina                 | **0 permitido, nunca exigido** | nuevo  | Se acepta como cierre voluntario; el motor **no lo penaliza ni lo pide**. **[HEURÍSTICA]**                                                                 |

**Cambio conceptual más importante, y es el que de verdad arregla la zona muerta:** el RIR deja de
ser un **umbral exacto** y pasa a ser una **banda**.

```
Subir carga requiere:  RIR mínimo de la sesión ≥ objetivo − 1      (banda de tolerancia)
Bloquea la subida:     RIR mínimo ≤ objetivo − 2  ó  RIR 0 con objetivo ≥ 1
```

Justificación: el error típico de estimación es ~1 repetición (§3.3) y pesa relativamente más en
series cortas. Exigir `RIR ≥ objetivo` con igualdad estricta equivale a exigir precisión que el
dato no tiene. **[HEURÍSTICA derivada de EVIDENCIA FUERTE]**

Y una segunda regla que cierra el bucle: **si cierras el rango a fallo dos exposiciones seguidas,
se sube la carga igualmente**, explicándolo. Quedarse indefinidamente es peor que subir.

### 5.3 Nota sobre principiantes

Con < 1–2 años de práctica el error de RIR es de 2–4 reps (Steele 2017; Zourdos 2016: los noveles
ni siquiera reconocen el fallo). Para ese perfil, **la progresión debería guiarse solo por
repeticiones**, con el RIR registrado pero sin poder de veto. **[EVIDENCIA FUERTE la premisa;
HEURÍSTICA el corte por años]**

---

## 6. Progressive overload — definición exacta

### 6.1 Qué NO es

- **No es "hacer un PR cada sesión".** Con ganancias reales de ~0,5–1 %/semana en un intermedio, el
  incremento semanal esperado en press banca es de ~0,5–1 kg de e1RM: **por debajo del error de
  medida**. Exigir un récord semanal es exigir ruido.
- **No es "añadir series".** El volumen es una palanca de mesociclo (§9). Plotkin 2022 demuestra
  que reps o carga bastan.
- **No es "subir el peso pase lo que pase".** La simulación E (§11) muestra a dónde lleva.

### 6.2 Qué SÍ es — dos ejes separados

**A) Performance progression (el motor primario, por ejercicio, por sesión).**
Es cualquier mejora medible **a carga o rango comparable**, en este orden de prioridad:

| Prioridad | Señal                                                                | ¿Acción del motor?                                                                               |
| --------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1         | **Técnica** aceptable (requisito, no progresión)                     | Bloquea subir si es mala — hoy **imposible**: no se captura                                      |
| 2         | **Más repeticiones** al mismo peso, dentro del rango                 | `ADD_REP`                                                                                        |
| 3         | **Cerrar el techo del rango** con esfuerzo dentro de la banda de RIR | `INCREASE_LOAD`                                                                                  |
| 4         | **Mismo trabajo con más reserva** (6@2 → 6@3)                        | Reconocido como progreso: se **muestra**, y si se repite en 2 exposiciones **acelera la subida** |
| 5         | **e1RM / carga equivalente** al alza sobre ≥3 exposiciones           | Métrica de tendencia, **no** dispara acciones sola                                               |

**B) Volume progression (secundaria, a nivel de programa/mesociclo).**
Añadir o quitar series **nunca** es una respuesta a una sesión. Requisitos en §9.4.

### 6.3 Auditoría de la double progression actual

| Aspecto                              | Veredicto                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Elegir double progression como motor | ✅ **Correcto** [EVIDENCIA FUERTE, Plotkin 2022]                              |
| Priorizar reps antes que carga       | ✅ Correcto (permite el paso mínimo del material y da margen a rangos anchos) |
| Criterio "n−1 series al techo"       | ✅ Razonable — tolera que la última serie caiga 1 rep                         |
| Criterio "RIR ≥ objetivo" exacto     | ❌ **Dentro del ruido**; genera la zona muerta (§2.1)                         |
| Volver a `repMin` tras subir         | ❌ Tira estímulo; debe calcularse (§7.3)                                      |
| Sin `DECREASE_LOAD`                  | ❌ Estado absorbente (§2.2)                                                   |
| Sin detección de meseta              | ❌ Estancamiento invisible (§2.3)                                             |
| Paso de carga absoluto               | ❌ Incompatible con el rango en ~40 % del catálogo (§2.4)                     |

---

## 7. El algoritmo reps↔carga propuesto

Determinista, puro, explicable en una frase por regla. Se evalúa **en orden**; la primera regla que
aplica gana.

### 7.1 Definiciones

Sea la prescripción `(repMin, repMax, targetRir, plannedSets, inc)` donde `inc` = menor incremento
disponible del material (hoy `loadStepKg`), y la **última sesión válida** con series
`s₁..sₙ (peso, reps, rir)`:

```
pesoTrabajo   = MEDIANA de los pesos de las series      (hoy: modal, empate al menor)
repsMediana   = MEDIANA de las reps
repsMin       = mínimo de reps
repsTecho     = máximo de reps
rirEf(i)      = rir(i) si existe, si no: targetRir − 1  (imputación CONSERVADORA)
rirMin        = mínimo de rirEf
rangoCerrado  = (nº de series con reps ≥ repMax) ≥ n−1  Y  repsMin ≥ repMax − 1
aFallo        = rirMin == 0 y targetRir ≥ 1
muyDuro       = rirMin ≤ targetRir − 2
```

Y la **equivalencia carga↔reps** (Epley usado como modelo **relativo intra-variante**, nunca como
afirmación de 1RM):

```
repsEquivalentes(w, r, w') = 30 × ( w × (1 + r/30) / w' − 1 )
```

### 7.2 La escalera de decisión

| #       | Condición                                                                                       | Acción                                                                                                                                                                       | Confianza   |
| ------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **P0**  | Sin historial de la variante                                                                    | **`START`** — no inventa peso; marca las 2 primeras sesiones como **calibración** (P2 se relaja a 1 exposición)                                                              | LOW         |
| **P1**  | `n < ceil(plannedSets/2)`                                                                       | **`HOLD` · `SESSION_INCOMPLETE`** — media sesión no decide (sustituye al 70 % que era 100 %)                                                                                 | LOW         |
| **P2**  | **2 exposiciones consecutivas al mismo peso** con `repsMediana < repMin` y `rirMin ≤ targetRir` | **`DECREASE_LOAD`** −7 % redondeado al incremento (mínimo un incremento)                                                                                                     | según datos |
| **P3**  | Técnica media < 3/5 _(requiere capturar técnica)_                                               | **`HOLD` · `LOW_TECHNIQUE`** — nunca subir con técnica mala                                                                                                                  | —           |
| **P4**  | `rangoCerrado` y (`aFallo` o `muyDuro`) y **es la 1.ª vez** a este peso                         | **`HOLD` · `CLOSED_RANGE_AT_FAILURE`** — mensaje específico: "cerraste el rango pero al fallo; repítelo buscando reserva; **si vuelves a cerrarlo así, subimos igualmente**" | según datos |
| **P5**  | `rangoCerrado` y `rirMin ≥ targetRir − 1` (**o** 2.ª vez cerrando a fallo)                      | **`INCREASE_LOAD`** a `pesoTrabajo + inc`, **con objetivo de reps = `floor(repsEquivalentes(...))`** si ese valor ≥ `repMin`                                                 | según datos |
| **P5b** | Igual que P5 pero `repsEquivalentes < repMin` (el salto del material no cabe en el rango)       | **`ADD_REP` · `EXTEND_RANGE`** — se **extiende el techo** hasta `techoNecesario = ceil(30 × ((1+repMin/30) × (w+inc)/w − 1))`, con tope `repMax + 6`. Explica el porqué      | según datos |
| **P6**  | `aFallo` o `muyDuro` **sin** cerrar el rango                                                    | **`HOLD` · `NEAR_FAILURE`** — consolidar                                                                                                                                     | según datos |
| **P7**  | 3 exposiciones al mismo peso **sin batir** el mejor total de reps a ese peso                    | **`STALL`** — dos variantes: si `rirMin ≥ targetRir+1` ⇒ _"la carga se te quedó corta"_ → subir; si no ⇒ _"esto es una meseta, no una mala sesión"_ + palancas               | según datos |
| **P8**  | `repsMediana < repMin` (1.ª vez)                                                                | **`HOLD` · `BELOW_MIN_FIRST`** — "no cambio nada por una sesión; **si vuelve a pasar, bajo la carga**"                                                                       | según datos |
| **P9**  | `repsMin < repMax`                                                                              | **`ADD_REP`** → objetivo `repsMin + 1` (**la serie más floja**, que es la que bloquea la subida)                                                                             | según datos |
| **P10** | Resto                                                                                           | `HOLD` con motivo explícito (no debería alcanzarse)                                                                                                                          | —           |

### 7.3 Respuestas exactas a tus preguntas de la sección 4

**"¿Qué significa haber completado el rango?"**
`n−1` series en `repMax` y **ninguna** por debajo de `repMax − 1`. Con 3 series: **8/8/8 y 8/8/7 sí;
8/8/6 no.** No se usa el promedio (una serie de 10 no compensa una de 6).

**`80×8@2 · 80×8@2 · 80×7@1` (rango 6–8, objetivo 2 RIR)**
`rangoCerrado` ✅ (2 al techo, mínimo 7 = repMax−1). `rirMin = 1 = targetRir − 1` ⇒ dentro de la
banda ⇒ **`INCREASE_LOAD` → 82,5 kg, objetivo 7 reps** (equivalente de 80×8 a 82,5 = 6,85 → 7).
_Hoy el motor devuelve `HOLD_DEFAULT` con un mensaje genérico._

**`80×8@0 · 80×8@0 · 80×8@0`**
1.ª vez ⇒ **`HOLD · CLOSED_RANGE_AT_FAILURE`**: "cerraste 8 reps pero a fallo, con objetivo 2 de
reserva. Repite 80 kg buscando dejar 2; si vuelves a cerrarlo así, subimos igualmente."
2.ª vez ⇒ **`INCREASE_LOAD` → 82,5 × 7**. _Hoy: `HOLD_DEFAULT` para siempre._

**Mismo rendimiento con mejor RIR (6@2 → 6@3)**
`ADD_REP` a 7 reps (igual que hoy), pero el mensaje lo reconoce explícitamente: _"mismo peso y
mismas reps con 1 más en reserva: eso es progreso"_, y el excedente de RIR sostenido 2 exposiciones
alimenta P7-variante-ligera (subir).

**PR fuera de prescripción `90×4@1` con rango 6–8**
`repsMediana 4 < repMin 6` ⇒ P8 `HOLD` la 1.ª vez, **P2 `DECREASE_LOAD` la 2.ª** — y el mensaje
deja de pedir 90×6 (imposible): pide `repsEquivalentes` reales.

**Carga demasiado ligera `80×12@2` con rango 6–8**
`rangoCerrado` ✅ y `rirMin ≥ 1` ⇒ `INCREASE_LOAD`, pero **el salto se calcula con la
equivalencia**: `repsEquivalentes(80, 12, w') = 6` ⇒ `w' = 80 × 1,4 / 1,2 = 93,3` → redondeado a
**92,5 kg**, no 82,5. Regla: _el nuevo peso es el que deja las reps dentro del rango_, con un tope
de seguridad de **+10 % por sesión**.

### 7.4 Incrementos de carga (`loadStepKg`)

El catálogo ya tiene la información necesaria: `loadStepKg` por variante, derivado del equipamiento
(barra/EZ/Smith 2,5 · mancuerna 2 · polea 2,5–5 · máquina 5 · lastre 2,5 · banda 0).

**Diagnóstico:** `loadStepKg` no está mal — describe correctamente el hardware. Lo que falta es que
el motor **compruebe si ese salto cabe en el rango** (§2.4). Y hay dos casos que sí hay que tocar:

1. **`loadStepKg = 0`** (banda, elevación de piernas) produce _"sube a 0 kg"_. Estas variantes deben
   marcarse como **no cargables** y progresar solo por repeticiones (o por dificultad de banda),
   nunca emitir `INCREASE_LOAD`.
2. **Micro-incrementos opcionales.** Añadir al catálogo un `microIncrementKg` opcional (discos de
   0,5/1 kg, imanes de mancuerna) que el usuario habilita en ajustes. Con micro-incrementos, P5b
   deja de hacer falta en la mitad de los casos.

**Lo que NO hago: incrementos relativos puros.** Un "+2,5 %" produce números imposibles de cargar
(83,1 kg). El sistema correcto es el que ya está: **incrementos absolutos del material, con la
regla de equivalencia decidiendo CUÁNDO son aplicables**, más extensión del rango cuando no lo son.
Sin sobre-ingeniería. **[HEURÍSTICA]**

---

## 8. Uso de e1RM

### 8.1 Cuándo es informativo y cuándo engaña

| Uso                                                                                  | Veredicto                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **Comparar TU progreso en LA MISMA variante, con reps similares, sobre ≥3 sesiones** | ✅ Informativo. Es una carga normalizada por reps, y los errores sistemáticos se cancelan. |
| Comparar variantes o ejercicios distintos                                            | ❌ Engañoso (mecánica y estabilidad distintas).                                            |
| Series de más de ~10–12 reps                                                         | ❌ El error de la ecuación crece; hoy directamente devuelve `null`.                        |
| Series lejos del fallo                                                               | ❌ Depende por completo del RIR declarado, que tiene ~1 rep de error → ~3–4 % de e1RM.     |
| **Disparar una decisión por una variación pequeña**                                  | ❌ Nunca. El ruido es ±5 %.                                                                |

### 8.2 Reglas propuestas

1. **e1RM no decide nada por sí solo.** Ni sube, ni baja, ni deloadea. Es **métrica de tendencia**
   y **modelo de equivalencia**. **[EVIDENCIA RAZONABLE]**
2. **Umbral de señal: ±5 %** (hoy ±1 %). Por debajo se muestra "estable". **[derivado de §3.7]**
3. **Mínimo 3 sesiones** para hablar de tendencia, y regresión sobre esas ≥3, no primer-vs-último.
4. **Calcular en lectura, no en escritura.** Hoy `estimated1Rm` se persiste en `logSet`; cambiar la
   fórmula no recalcularía el histórico. Guardar `weightKg/reps/rir` (que ya se guardan) y derivar.
5. **Sustituir el "e1RM = null" de los rangos altos por _carga equivalente a `repMin` reps_**:
   `w × (1+r/30) / (1+repMin/30)`. Es la MISMA matemática, es válida como **interpolación corta
   dentro del rango del propio ejercicio**, y da una métrica de tendencia comparable para los
   aislamientos de 12–20 reps, que hoy no tienen ninguna (caen a tonelaje). Se presenta como
   _"carga equivalente a 12 reps"_, sin afirmar nada sobre el 1RM. **[HEURÍSTICA con base razonable]**
6. **Se sigue mostrando con "~"** y con la advertencia de que es estimación (ya se hace).
7. **El RIR entra como reps efectivas** (`reps + min(rir,4)`), que es lo correcto, pero la
   incertidumbre resultante debe reflejarse en la banda (±5 %), no en decimales.

---

## 9. Volumen

### 9.1 Coherencia de F3.2 con esta filosofía — verificado

| Principio                                               | ¿Se cumple hoy?                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Volumen inicial conservador                             | ✅ 6–10 efectivas/músculo de partida                                        |
| Series efectivas con contribución fraccional            | ✅ Y respaldado por Pelland (§3.5)                                          |
| Máx 3 series/ejercicio como guardrail **del generador** | ✅ `SETS_PER_EXERCISE.max = 3`                                              |
| Programas manuales pueden excederlo                     | ✅ `manual-program.ts` valida solo integridad estructural (hasta 10 series) |
| Overload primario = reps/carga                          | ✅ El motor nunca toca series                                               |
| No añadir series automáticamente                        | ✅ No existe `ADD_SET`                                                      |

**El modelo de volumen es coherente y no lo tocaría.** Pero sí hay dos defectos operativos (§2.10):

- El generador **no verifica que alcanza su propio objetivo** (cuádriceps 6,0 vs 9,0, cero avisos).
- Días con menú estrecho terminan a media capacidad (Pierna B: 9 series, 37 de 75 min).

Ambos son de generador, no de filosofía, y son baratos de arreglar (§13).

### 9.2 Sobre el conteo fraccional

Pelland 2025 compara explícitamente contar el trabajo indirecto como **1,0 / 0,5 / 0** y encuentra
que **el conteo fraccional (0,5) es el mejor soportado**. Nuestro catálogo usa cubos
{1,0 / 0,75 / 0,5 / 0,25}. El bucket 0,25 es más fino de lo que la evidencia distingue, pero es
inocuo y evita falsa precisión peor (contar 1,0 o 0). **[EVIDENCIA RAZONABLE para el enfoque;
HEURÍSTICA para los cubos concretos]**

### 9.3 Frecuencia

Con volumen igualado, la frecuencia no tiene efecto independiente relevante; es el **vehículo para
repartir volumen** y ≥2×/semana es un buen default. Lo que hoy hace el generador (preferencia, no
restricción dura) es correcto. **[EVIDENCIA FUERTE]**

- **Schoenfeld BJ, Grgic J, Krieger J.** _How many times per week should a muscle be trained to
  maximize muscle hypertrophy?_ **J Sports Sci. 2019;37(11):1286-1295.** PMID 30558493. Sin
  diferencia significativa entre frecuencias altas y bajas **con volumen igualado**.
  _(Verificado personalmente.)_ El ACSM 2026 (§3.10) recomienda igualmente **≥2 sesiones/semana**.

### 9.4 Qué señales harían falta EN EL FUTURO para justificar `ADD_SET` / `REMOVE_SET`

No implementar ahora. Cuando se implemente (F3.4), estas son las condiciones que propongo, todas
**a nivel de grupo muscular y de límite de mesociclo**, nunca por sesión:

**`ADD_SET` (+1 serie efectiva a un grupo, máx. 2 grupos por mesociclo)** requiere **todas**:

1. ≥4 exposiciones válidas del grupo en el mesociclo que termina.
2. Tendencia de rendimiento del grupo **estable o positiva** (media ponderada por volumen de la
   carga equivalente, ≥3 sesiones por ejercicio).
3. **Ninguna** señal de fatiga activa: `jointPain < 3`, `fatigue` medio < 4, sin `STALL` abierto.
4. Volumen efectivo actual **por debajo** de `MAX_WEEKLY_SETS`.
5. Cabe en el presupuesto de tiempo y en `SESSION_SET_CAP`.
6. Cooldown: no se ha añadido serie a ese grupo en el mesociclo anterior.

**`REMOVE_SET` (−1 a −2 series)** requiere **alguna**:

1. Tendencia negativa del grupo (2 mesociclos, o 2 semanas con caída > 5 % de carga equivalente).
2. `jointPain ≥ 3` sostenido en ≥3 sesiones asociadas al grupo.
3. Adherencia del grupo < 70 % (no se completan las series programadas) — es decir, **el volumen
   programado no es real**.

**Y una condición transversal:** `ADD_SET` **nunca** se propone si el usuario aún tiene margen de
progresión en reps/carga en los ejercicios del grupo. Añadir volumen es la última palanca, no la
primera. **[HEURÍSTICA]**.

Base de esa última decisión: **Enes A et al.** _Effects of Different Weekly Set Progressions on
Muscular Adaptations in Trained Males: Is There a Dose-Response Effect?_ **Med Sci Sports Exerc.
2024;56(3):553-563.** PMID 37796222. 31 entrenados (5,1 años de experiencia), 12 semanas: añadir 4 o
6 series por semana cada 2 semanas produjo **más fuerza** que el volumen constante (el grupo de 6
series por encima del de 4 y del constante en 1RM); para **hipertrofia**, los autores describen un
posible beneficio **pequeño** de los volúmenes altos pero con **certeza limitada** y piden cautela.
_(Verificado personalmente.)_ ⇒ **rampar volumen es una palanca de FUERZA con evidencia razonable, y
una palanca de hipertrofia sin demostrar.** Por eso no la hacemos automática ni la vendemos como
"más músculo".

---

## 10. Fatiga y deload (diseño, NO implementar)

### 10.1 Qué señales importan y cuáles son ruido

| Señal                                                            | ¿Ya la guardamos?         | Validez                                                                                                  | Etiqueta                                         |
| ---------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Caída de rendimiento** (reps al mismo peso, carga equivalente) | Sí (SetLog)               | La más objetiva de las que tenemos                                                                       | **[EVIDENCIA RAZONABLE]**                        |
| **Pérdida de velocidad intra-serie**                             | No (haría falta hardware) | El marcador de fatiga aguda mejor validado (r = 0,91–0,97 con lactato/CMJ)                               | **[EVIDENCIA FUERTE]** pero **fuera de alcance** |
| **RIR desplazándose** (mismo peso y reps se sienten más duros)   | Sí                        | Proxy razonable **agregado**; ±1 rep de ruido individual                                                 | **[EVIDENCIA RAZONABLE]** solo con ≥3 muestras   |
| **`fatigue` de sesión (RPE-like)**                               | Sí, sin usar              | Efecto grande y consistente en la literatura de fatiga aguda                                             | **[EVIDENCIA RAZONABLE]**                        |
| **`jointPain`**                                                  | Sí, sin usar              | Sin validación como marcador de fatiga, pero es una **señal de salud** y tiene precedencia por filosofía | **[HEURÍSTICA]**, precedencia máxima             |
| **DOMS / soreness**                                              | **No se captura**         | Mal marcador: correlaciona poco con daño y con adaptación                                                | **[HEURÍSTICA débil]** — no invertir en ello     |
| **`motivation`**                                                 | Sí, sin usar              | Válido como señal de **adherencia**, no de fatiga fisiológica                                            | **[HEURÍSTICA]**                                 |
| **Sueño**                                                        | No                        | Relevante, pero autoinformado y ruidoso                                                                  | **[HEURÍSTICA]**                                 |
| **Sesiones consecutivas / semanas sin deload**                   | Sí (derivable)            | Puro calendario                                                                                          | **[HEURÍSTICA]** — solo como red, peso bajo      |
| **HRV**                                                          | No                        | Requiere hardware y tiene mucho ruido intraindividual                                                    | Fuera de alcance                                 |

### 10.2 Reglas de diseño

1. **Nada de "semana 5 = deload".** Coleman 2024 muestra que un deload de calendario innecesario
   puede **costar fuerza**. **[EVIDENCIA RAZONABLE]**
2. **Score multi-señal reactivo → RECOMENDACIÓN, jamás automático.** El esquema de
   `TRAINING_ENGINE.md §4` es sensato; solo hay que reformular la comunicación: _seguro de fatiga_,
   nunca _potenciador de ganancias_.
3. **Precedencia**: `jointPain` alto veta subidas de carga y volumen **antes** que ninguna otra
   señal (COACH_PHILOSOPHY §2).
4. **Red de calendario suave**: aviso informativo a las ≥8 semanas sin descarga, subordinado a las
   señales reales, y con lenguaje que deje claro que no es obligatorio.
5. **Requisito previo bloqueante**: hoy las señales existen pero **nadie las lee**, y `technique`
   **ni siquiera se captura**. Antes de F3.3 hay que cerrar ese hueco (§13).

---

## 11. Simulaciones longitudinales

Método: atleta virtual determinista (LCG con semilla fija, sin `Math.random`). Modelo:
`repsHastaFallo(E, w) = floor(30 × (E/w − 1))`; fatiga intra-sesión −2 % de `E` por serie; ruido
diario ±2 %; el atleta **obedece la sugerencia** de la app; el RIR reportado incluye ruido. El
"motor actual" es **el código real** (`suggestProgression`); el "propuesto" es el prototipo de §7.
12 semanas, 1 exposición/semana. Scripts en el scratchpad de la sesión.

### 11.1 Persona A — progresa bien (e1RM real 100 → 110 kg, arranque correcto a 75 kg)

Ambos motores se comportan **igual de bien**: 3 subidas, 75 → 82,5 kg, sin sobrerreacciones.
El motor actual llega una sesión antes (su `ADD_REP` empuja la primera serie al techo; el propuesto
empuja la **serie más floja**, que es lo que realmente desbloquea la subida).
**Veredicto: el motor actual funciona bien en el caso feliz. No es un motor roto; es un motor con
huecos en los bordes.**

### 11.2 Persona B — arranque demasiado pesado (elige 80 kg con e1RM real 100)

|                | Motor ACTUAL                       | Motor PROPUESTO                              |
| -------------- | ---------------------------------- | -------------------------------------------- |
| Semanas 1–8    | **8 × `BELOW_MIN_HOLD`** idénticos | S1 `HOLD` → **S2 `DECREASE_LOAD` → 75 kg**   |
| Primera subida | nunca (12 semanas a 80 kg)         | S7 → 77,5 kg; S10 → 80 kg                    |
| Estado final   | 80 kg, atascado                    | 80 kg **con el rango cerrado** y progresando |

**Éste es el fallo más grave del motor actual.** Ocho semanas repitiendo el mismo mensaje.

### 11.3 Persona C — se estanca desde la semana 5

|                                      | Motor ACTUAL                                   | Motor PROPUESTO                                                                    |
| ------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Semanas 6–12                         | **7 × `ADD_REP` idénticos** ("intenta 8 reps") | Igual, **pero emite `STALL`** al no batir el mejor total en 3 exposiciones         |
| ¿El usuario sabe que está estancado? | **No**                                         | **Sí**, con los números: "3 exposiciones en 77,5 kg sin sumar reps (21 → 20 → 20)" |

### 11.4 Persona D — mala semana puntual (semana 6, −7 % de rendimiento)

**Ambos motores se comportan idénticamente**: 2 `HOLD`, recuperación en la semana 7, subida en la 9,
final en 80 kg. **Ningún motor sobrerreacciona.**

Este caso fue el que **calibró** la regla `DECREASE_LOAD`: una primera versión que exigía solo
"alguna serie por debajo del mínimo" **sí** bajaba la carga tras la mala semana y terminaba 2,5 kg
por detrás. Exigir que la **mediana** caiga por debajo de `repMin` **dos exposiciones seguidas**
elimina el falso positivo sin perder el verdadero (persona B). **La regla se calibró contra la
simulación, no contra la intuición.**

### 11.5 Persona E — fuerza PRs cada semana (sube 2,5 kg pase lo que pase)

Ambos motores dicen **`HOLD` 11 de 12 semanas** y el e1RM real solo sube un 2,3 % (vs. 10 % de la
persona A). ✅ El motor **no valida** la conducta. ⚠️ Pero tampoco dice _"baja el peso"_, porque el
usuario cambia de peso cada sesión y la regla P2 exige **mismo peso** en exposiciones consecutivas.
Es una limitación aceptada y documentada: si el usuario ignora sistemáticamente al coach, el coach
no puede hacer más que seguir diciendo que no.

### 11.6 Persona F — elevación lateral, salto de 2 kg sobre 10 kg (+20 %)

|          | Motor ACTUAL                                                                                | Motor PROPUESTO                                             |
| -------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Semana 6 | `INCREASE_LOAD` → **12 kg × 10 reps** (salto del 20 % con un rango que solo absorbe 12,5 %) | `ADD_REP` · `EXTEND_RANGE` → 10 kg × 16, luego 17, luego 18 |
| Semana 9 | —                                                                                           | `INCREASE_LOAD` → 12 kg × 10 (ahora **sí** es alcanzable)   |

Con un atleta cuya carga está calibrada, el salto del motor actual lo manda a `BELOW_MIN_HOLD`.

### 11.7 Persona G — máquina 12–20 reps, salto de 5 kg

Ambos suben en la semana 9 de 40 a 45 kg. El actual pide **12 reps**; el propuesto calcula la
equivalencia y pide **14**. Diferencia: 6 repeticiones de trabajo por sesión y **≈2 sesiones
ahorradas** en cada ciclo de carga.

### 11.8 Persona H — responde muy bien (1,5 %/semana)

Ambos motores suben 4 y 3 veces respectivamente, pero **el RIR reportado sube a 4 y ninguno de los
dos lo interpreta**: la carga se queda corta y el motor sigue con pasos de +2,5 kg cada 3 sesiones.
La regla P7-variante-ligera del propuesto (`STALL_LOAD_TOO_LIGHT`) cubre este caso cuando además
deja de haber progreso; una versión más agresiva ("RIR ≥ objetivo+2 dos exposiciones ⇒ doble paso")
queda como **opción futura**, no la propongo ahora (riesgo de sobrecorrección).

### 11.9 Resumen de la simulación

| Escenario                           | Actual                       | Propuesto               |
| ----------------------------------- | ---------------------------- | ----------------------- |
| Progresión normal                   | ✅                           | ✅                      |
| Arranque demasiado pesado           | ❌ 8 semanas bloqueado       | ✅ corrige en 2         |
| Estancamiento                       | ❌ invisible                 | ✅ señalado con números |
| Mala semana aislada                 | ✅ no sobrerreacciona        | ✅ no sobrerreacciona   |
| Forzar PRs                          | ✅ no lo valida              | ✅ no lo valida         |
| Salto > amplitud del rango          | ❌ manda a un peso imposible | ✅ extiende el rango    |
| Rango ancho (máquina)               | ⚠️ pierde 2 sesiones/ciclo   | ✅ objetivo calculado   |
| Robustez a ruido de RIR (±1,5 reps) | ✅ trayectoria casi idéntica | ✅                      |

---

## 12. Diferencias respecto al código actual

| #   | Hoy                                                                     | Propuesto                                                                                                            | Impacto                                              |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Decide con **1 sesión**                                                 | Decide con la última sesión **+ la racha al mismo peso**                                                             | Habilita `DECREASE_LOAD` y `STALL`                   |
| 2   | Subir exige `RIR ≥ objetivo`                                            | Subir exige `RIR ≥ objetivo − 1`; bloquea con `≤ objetivo − 2` o fallo                                               | **Elimina la zona muerta**                           |
| 3   | Cerrar el rango a fallo → `HOLD_DEFAULT` genérico, para siempre         | 1.ª vez: `HOLD` con mensaje específico. 2.ª vez: **sube igual**                                                      | Elimina el estado absorbente                         |
| 4   | Nunca baja la carga                                                     | `DECREASE_LOAD` −7 % si la **mediana** cae bajo `repMin` **2 exposiciones seguidas al mismo peso** con esfuerzo real | Arregla el arranque mal calibrado                    |
| 5   | No detecta meseta                                                       | `STALL` si 3 exposiciones al mismo peso sin batir el mejor total de reps                                             | Estancamiento visible                                |
| 6   | Tras subir, objetivo = `repMin`                                         | Objetivo = `repsEquivalentes` (Epley relativo)                                                                       | ~2 sesiones ganadas por ciclo en rangos anchos       |
| 7   | `INCREASE_LOAD` siempre `+loadStepKg`                                   | Si `loadStepKg` no cabe en el rango → **extiende el techo** hasta que quepa                                          | Arregla ~40 % del catálogo                           |
| 8   | `loadStepKg = 0` → _"sube a 0 kg"_                                      | Variante marcada **no cargable**: progresa solo por reps                                                             | Bug de texto eliminado                               |
| 9   | Carga muy por debajo de lo prescrito (`80×12` en rango 6–8) → +2,5 kg   | Salto calculado por equivalencia, tope +10 %/sesión                                                                  | Corrección proporcional                              |
| 10  | `pesoRef` = modal, empate al **menor**                                  | **Mediana**                                                                                                          | Series ascendentes/descendentes correctas            |
| 11  | RIR ausente ⇒ `= objetivo` (habilita subir)                             | RIR ausente ⇒ `= objetivo − 1` (conservador) + confianza ≤ MEDIA                                                     | Quita el sesgo optimista                             |
| 12  | UI prellena RIR con el objetivo, sin "no lo sé"                         | RIR **sin preseleccionar** + opción "no lo sé"                                                                       | Datos honestos                                       |
| 13  | `SESSION_UNUSABLE` = `ceil(n×0.7)` (100 % con 3 series)                 | `n < ceil(plannedSets/2)`; entre medias, confianza degradada                                                         | Menos sesiones tiradas                               |
| 14  | Confianza `HIGH` con 2 sesiones comparables                             | `HIGH` solo con **≥3 exposiciones válidas, RIR completo y sesión completa**                                          | La UI deja de decir "Sube" sobre poca evidencia      |
| 15  | `ADD_REP` = primera serie bajo el techo +1                              | `ADD_REP` = **serie más floja** +1                                                                                   | Coherente con el criterio de subida                  |
| 16  | `technique` no se captura                                               | Se captura (1 tap, opcional)                                                                                         | Desbloquea la regla D3                               |
| 17  | `jointPain`/`fatigue`/`motivation` no se leen                           | Se leen (primero solo se muestran; F3.3 los usa)                                                                     | Desbloquea el deload reactivo                        |
| 18  | RIR compuesto pesado = 3                                                | = **2**                                                                                                              | Alineado con ACSM 2026 (2–3 RIR)                     |
| 19  | `estimated1Rm` se persiste al registrar; `null` sobre 12 reps efectivas | Se deriva en lectura; para rangos altos, **"carga equivalente a `repMin` reps"**                                     | Los aislamientos por fin tienen métrica de tendencia |
| 20  | `trend()` = primero vs. último, umbral **±1 %**                         | ≥3 sesiones, umbral **±5 %**                                                                                         | Deja de reportar ruido como tendencia                |
| 21  | El generador no comprueba si cumple su objetivo                         | Aviso cuando el volumen efectivo entregado < 80 % del objetivo; el día no se cierra con presupuesto de tiempo libre  | Cuádriceps 6,0/9,0 deja de ser silencioso            |

**Lo que NO cambia** (y conviene decirlo): la arquitectura (`core` puro → services → actions), la
sugerencia **efímera** que nunca modifica el programa, los snapshots inmutables, el anclaje a
`exerciseVariantId`, el modelo de volumen efectivo con contribución fraccional, el guardrail de
3 series/ejercicio del generador, y la libertad total de los programas manuales.

---

## 13. Qué cambiaría AHORA

Ordenado por (valor ÷ riesgo). Todo cabe en `src/core/` + un par de retoques de UI, sin migración
de base de datos salvo el punto 5.

### Bloque 1 — Motor de progresión (`progression.ts` + `training-config.ts`)

1. **Banda de tolerancia de RIR (±1) para subir** y **regla de segunda ocurrencia** para el rango
   cerrado a fallo. → mata la zona muerta y el estado absorbente. _(§2.1, §5.2)_
2. **`pesoRef` = mediana.** Una línea. _(§2.7)_
3. **Imputación conservadora del RIR ausente** (`objetivo − 1`). _(§2.6)_
4. **`SESSION_INCOMPLETE` = `n < ceil(plannedSets/2)`**, con confianza degradada por debajo de
   `plannedSets`. _(§2.8)_
5. **Confianza `HIGH` solo con ≥3 exposiciones válidas + RIR completo + sesión completa.** _(§2.9)_
6. **Objetivo de reps tras subir = `repsEquivalentes`**, no `repMin`. _(§2.5)_
7. **Comprobación salto-vs-rango + `EXTEND_RANGE`**, y **variantes no cargables** (`loadStepKg = 0`).
   _(§2.4)_
8. **`ADD_REP` sobre la serie más floja.** _(§12.15)_
9. **Mensajes específicos en todos los `HOLD`** — ningún "Mantén X kg y consolida la técnica" genérico.

Estas 9 no necesitan historial: operan sobre la última sesión + la prescripción. **Riesgo bajo, valor
alto.**

### Bloque 2 — Historial en el motor (requiere pasar N sesiones, no una)

10. Ampliar `LastComparable` a **`recentSessions: Session[]`** (últimas 4 de la variante) en
    `workout.repo.ts` — la query ya trae todas las filas, solo hay que dejar de descartar las
    anteriores. Con eso:
11. **`DECREASE_LOAD`** por mediana bajo `repMin` en 2 exposiciones al mismo peso. _(§2.2)_
12. **`STALL`** por 3 exposiciones sin batir el mejor total de reps. _(§2.3)_

### Bloque 3 — Datos honestos (UI, muy barato)

13. **RIR sin preseleccionar** + chip "no lo sé". _(§2.6, §1.1)_
14. **Captura de técnica** con 1 tap opcional (3 estados: 🟢 limpia / 🟡 justa / 🔴 se rompió).
15. **Mostrar** el feedback de sesión ya capturado en el historial (aún sin usarlo para decidir).

### Bloque 4 — e1RM y tendencia

16. **Umbral de tendencia ±5 %** y **mínimo 3 sesiones** con regresión, no primero-vs-último. _(§8.2)_
17. **Derivar e1RM en lectura**; introducir **carga equivalente a `repMin` reps** para rangos altos.

### Bloque 5 — Generador (solo si molesta ya)

18. **Aviso cuando el volumen efectivo entregado < 80 % del objetivo** de un grupo. _(§2.10)_
19. **No cerrar el día con presupuesto de tiempo libre** si algún grupo del menú sigue necesitado
    (relajar `MAX_SETS_PER_GROUP_PER_SESSION` a 4 cuando quedan minutos y el grupo está bajo objetivo).
20. **RIR de compuesto pesado 3 → 2.** _(§5.2)_

### Bloque 6 — Documentación

21. Reescribir `COACH_PHILOSOPHY.md §4` (ranking estético) para que deje de contradecir al generador.
    _(§2.12)_
22. Actualizar `TRAINING_ENGINE.md §1b/§2` con la escalera nueva y retirar de la spec lo que
    decidimos no construir (modos `CALIBRACION`/`RECONSTRUCCION`, `D6a` como regla aparte —
    queda absorbido por `EXTEND_RANGE`).

### Cobertura de tests que exigiría

- Los **12 casos de §1.4 y §1.5 convertidos en tests** con doble aserción (acción + números del
  mensaje).
- **Invariantes** (property, rejilla determinista): (P1) el peso sugerido es siempre múltiplo del
  incremento; (P2) nunca `INCREASE_LOAD` con una serie a fallo y el rango sin cerrar; (P3) nunca
  `DECREASE_LOAD` con **una sola** exposición; (P4) el objetivo de reps sugerido tras subir es
  siempre ≥ `repMin` **o** la acción es `EXTEND_RANGE`; (P5) determinismo/idempotencia.
- **Tests de simulación longitudinal** (nuevos): las 8 personas de §11 como _golden files_. Es la
  única forma de que un cambio futuro de umbral no rompa el comportamiento a 12 semanas sin que nadie
  se entere. **Recomiendo encarecidamente incluirlos.**

---

## 14. Qué dejaría para F3.3 / F3.4

**F3.3 — Mesociclos y deload reactivo**

- Lectura y agregación de `fatigue`, `jointPain`, `motivation`, `perceivedPerformance`.
- Score multi-señal → **recomendación** de deload (nunca automático), con precedencia
  `salud > deload > carga > volumen`.
- Aviso suave de calendario a ≥8 semanas, subordinado a las señales.
- Mesociclo de 4–8 semanas con resumen de cierre.
- Comunicación reformulada: **seguro de fatiga, no potenciador**.

**F3.4 — Extensión del motor**

- `ADD_SET` / `REMOVE_SET` **solo a límite de mesociclo**, con las condiciones de §9.4.
- Sustitución por dolor articular sostenido (D2).
- Anclaje inicial de carga en `START` desde una variante hermana (e1RM × 0,85 resuelto a `repMin`)
  — reduce mucho la probabilidad del escenario "arranque demasiado pesado".
- Regla "carga demasiado ligera" agresiva (RIR ≥ objetivo+2 en 2 exposiciones ⇒ doble paso).

**Descartado explícitamente (no construir):** modos `CALIBRACION`/`RECONSTRUCCION` como máquina de
estados; rampa obligatoria de RIR 3→2→1→0; periodización ondulante/bloque; deload de calendario
obligatorio; cualquier techo duro de volumen presentado como fisiología; contribuciones musculares
con más precisión que los cubos actuales.

---

## 15. Coach AI — solo diseño

Complementa `docs/AI_COACH.md` (que ya define proveedor, packs, tools, presupuesto, privacidad y
prompt injection). Aquí solo la parte de **entrenamiento**.

### 15.1 Principio arquitectónico

```
Motores deterministas  →  HECHOS y RECOMENDACIONES BASE (números)
                              ↓  (solo lectura, JSON etiquetado)
Coach AI               →  INTERPRETA · EXPLICA · CONTEXTUALIZA · CONVERSA
```

**El LLM nunca puede modificar carga, programa, series, RIR, deload ni volumen.** No por prompt,
sino por construcción: no existe ninguna tool de escritura y el chat es read-only (ya está así
especificado en AI_COACH.md; el test de imports lo debe garantizar).

### 15.2 Qué datos estructurados recibe (pack de entrenamiento)

Agregados, nunca filas crudas masivas. Todo **ya calculado por los motores**:

```jsonc
{
  "ventana": {
    "desde": "2026-07-27",
    "hasta": "2026-08-24",
    "sesiones": 16,
    "adherencia": 0.89,
  },
  "porEjercicio": [
    {
      "variante": "Press banca / Barra",
      "prescripcion": {
        "series": 3,
        "reps": [6, 8],
        "targetRir": 2,
        "incrementoKg": 2.5,
      },
      "exposiciones": 4,
      "ultimaSesion": {
        "fecha": "2026-08-21",
        "sets": [
          [80, 8, 2],
          [80, 8, 2],
          [80, 7, 2],
        ],
      },
      "cargaEquivalente": {
        "serie": [101.3, 103.1, 104.0, 106.7],
        "tendencia": "UP",
        "deltaPct": 5.3,
        "umbralRuidoPct": 5,
      },
      "decision": {
        "action": "INCREASE_LOAD",
        "reasonCode": "RANGE_CLOSED",
        "pesoKg": 82.5,
        "reps": 7,
        "confianza": "HIGH",
        "explicacion": "…",
      },
      "rirMedio": 2.1,
      "rirCompleto": true,
    },
  ],
  "porGrupo": [
    {
      "grupo": "DORSAL",
      "seriesEfectivas": 8.5,
      "objetivo": 9.0,
      "frecuencia": 2,
      "tendencia": "FLAT",
    },
  ],
  "recuperacion": {
    "fatigaMedia": 3.2,
    "dolorArticularMax": 2,
    "motivacionMedia": 4,
    "n": 12,
    "sueno": null,
    "deloadScore": 2,
    "semanasSinDeload": 5,
  },
  "cuerpo": { "pesoEmaKg": 78.4, "tendencia4semPctSem": -0.4 },
  "limites": {
    "e1rmErrorPct": 5,
    "rirErrorReps": 1,
    "seriesEfectivas": "convención contable",
  },
}
```

Bloques equivalentes para 7 y 28 días. **El bloque `limites` no es decorativo**: es lo que le
permite al modelo decir "esa variación está dentro del ruido" en vez de inventar significado.

### 15.3 Las cuatro funciones

| Función            | Pregunta que responde             | Entrada                                                                                   | Salida                                                                                                                                                           |
| ------------------ | --------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Weekly Coach**   | _"¿Estoy progresando?"_           | Packs 7 + 28 días + recuperación + cuerpo                                                 | Estructura fija: qué mejoró / qué empeoró / tendencias con números / adherencia / **hipótesis etiquetadas** / prioridad de la semana. Cacheado por `contextHash` |
| **Exercise Coach** | _"¿Cómo voy en press inclinado?"_ | `exercisePack(variante)`: exposiciones, sets, carga equivalente, decisiones, `reasonCode` | Lectura de la trayectoria + qué haría falta para desbloquear el siguiente paso — **citando la regla del motor**, nunca proponiendo otra                          |
| **Explain**        | _"¿Por qué 3×6–8 @2?"_            | La prescripción + `ruleId`/`AlgorithmDecision` + el pack de límites                       | Traducción del porqué determinista + evidencia detrás (§3), con la etiqueta FUERTE/RAZONABLE/HEURÍSTICA **visible**                                              |
| **Ask Coach**      | Libre                             | Intención → packs mínimos necesarios                                                      | Respuesta con `evidence[]` y `hypotheses[]` separadas                                                                                                            |

### 15.4 Guardrails específicos de entrenamiento

Además de los de AI_COACH.md:

1. **Regla del número único.** Si la respuesta contiene un número de entrenamiento (kg, series,
   reps, RIR, %), **tiene que existir literalmente en el pack de entrada**. Filtro POST: extraer
   números de la respuesta y verificar pertenencia. Si aparece uno inventado → plantilla determinista.
2. **No contradicción de acción.** Si el motor dice `HOLD` y la respuesta sugiere subir/bajar carga,
   añadir series o saltarse un deload → **rechazo automático**. Se comprueba contra el `action` y el
   `reasonCode` del pack, no con análisis semántico libre.
3. **Prohibido re-derivar.** El modelo no calcula e1RM, ni volumen, ni "deberías poder hacer X".
   Solo cita.
4. **Umbral de ruido obligatorio.** Ante variaciones por debajo de `limites.e1rmErrorPct`, la única
   lectura permitida es "estable / dentro del margen de error".
5. **Hipótesis siempre etiquetadas y separadas visualmente**, y con caducidad (60 días, ya
   especificado). "Coincide con", nunca "fue causado por".
6. **Precedencia de salud.** `dolorArticularMax ≥ 4` o `safetyLevel = STOP` ⇒ modo conservador
   forzado en el system prompt, y ninguna sugerencia de intensificar.
7. **Los datos son datos, no instrucciones.** Las notas de sesión y los nombres de programa entran
   como `APPLICATION_DATA`, nunca concatenados al system prompt (ya especificado; fixtures de
   inyección en tests).
8. **Fallback determinista.** Si el proveedor falla, si el JSON no valida o si el filtro POST
   rechaza, la app muestra la **explicación del motor** tal cual. Coach AI es opcional siempre.

### 15.5 Qué NO haría

- No permitir que el LLM proponga una prescripción alternativa ("yo haría 5×5").
- No enviarle fotos (ya decidido).
- No RAG ni embeddings: la base de datos es pequeña y estructurada.
- No memoria escrita por el modelo como hecho: sus inferencias entran como `HYPOTHESIS/UNCONFIRMED`.

---

## 16. Ruta mínima a iPhone / PWA

### 16.1 Diagnóstico de la arquitectura actual

Favorable: Next.js 16 App Router con **Server Components + Server Actions**, sin API pública, sin
login, SQLite local vía `@prisma/adapter-better-sqlite3`, un único punto de conexión (`db.ts`), UI
ya **mobile-first y dark-only**, y `perfil móvil Pixel 7` en los E2E. **No hay nada que reescribir.**

Lo que falta es puramente de despliegue.

### 16.2 La ruta que recomiendo (por orden de esfuerzo)

**Paso 1 — Que funcione en el móvil, hoy mismo (10 minutos).**

```bash
pnpm build && pnpm start -H 0.0.0.0
```

Y abrir `http://<IP-del-Mac>:3000` desde el iPhone en la misma wifi. Ya es usable.
**Limitación honesta:** `http://` por IP **no es un secure context**, así que **el service worker
no se registra** ⇒ nada de PWA offline ni de notificaciones. "Añadir a pantalla de inicio" funciona
como acceso directo, pero no como PWA real.

**Paso 2 — HTTPS + acceso desde fuera de casa (la pieza clave).**
**Tailscale** en el Mac y en el iPhone, y luego:

```bash
tailscale serve --bg 3000
```

Esto da un hostname `https://<maquina>.<tailnet>.ts.net` con **certificado válido**, funciona
**dentro y fuera de la LAN**, y **la red es la autenticación**: solo tus dispositivos entran. Cero
código, cero puertos abiertos al exterior, y desbloquea el secure context (service worker, wake
lock, web push). _Ya está anticipado en `ARCHITECTURE.md` como "solución futura sin código"._

Alternativa sin Tailscale: `mkcert` + certificado de desarrollo instalado y confiado en el iPhone.
Funciona, pero solo en LAN y hay que renovar el certificado.

**Paso 3 — PWA (F7).** Con secure context resuelto, Serwist + manifest + iconos. Lo que sí y lo
que no en iOS, verificado:

| Capacidad                                               | Estado en iOS                                                                                                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instalar desde "Añadir a pantalla de inicio"            | ✅ (y desde iOS 26 los sitios añadidos abren como web app por defecto)                                                                                                                                               |
| Service worker / offline                                | ✅ **solo con HTTPS**                                                                                                                                                                                                |
| Screen Wake Lock (pantalla encendida durante la sesión) | ✅ Safari 16.4+; hubo un bug en PWA instaladas **corregido en iOS 18.4**                                                                                                                                             |
| Web Push (aviso de fin de descanso con la app cerrada)  | ✅ **solo en PWA instalada en pantalla de inicio**, iOS 16.4+; ❌ desde una pestaña de Safari                                                                                                                        |
| `navigator.vibrate`                                     | ⚠️ **Históricamente no soportado en iOS.** Hay informes recientes de que funciona, pero es inestable. **No diseñar el temporizador de descanso dependiendo de la vibración**: usar sonido + Wake Lock + notificación |

**Paso 4 — Autenticación: probablemente no la necesitas.**
Con Tailscale, el perímetro ya es la red privada. Si algún día expones fuera de la tailnet, lo
mínimo suficiente es un **middleware con una contraseña única de `.env` que emita una cookie
firmada `httpOnly` de larga duración** — 30 líneas, sin usuarios ni tablas. **No** montar
NextAuth/OAuth para un solo usuario.

**Paso 5 — Operación.**

- El Mac debe estar despierto: `caffeinate -s` o un LaunchAgent con `KeepAlive`.
- **Backups**: `data/app.db` es un único fichero → copia periódica (`sqlite3 .backup`) a iCloud/disco
  externo. Esto vale más que cualquier feature. Es lo primero que haría.
- **Secretos**: la clave de IA solo en `.env.local` del servidor, jamás en el cliente; ya está así
  especificado en AI_PRIVACY.md.

### 16.3 Por qué NO React Native / Expo

No hay ninguna capacidad nativa que necesites y la PWA no dé: cámara (F4) vía `<input capture>`,
pantalla encendida vía Wake Lock, avisos vía Web Push. A cambio, RN implicaría **duplicar toda la
UI**, perder Server Components/Server Actions y montar una API que hoy no existe. **Coste altísimo,
beneficio nulo.** Y no hay ninguna razón para migrar a Postgres/Vercel: `ARCHITECTURE.md` ya
documenta cómo se haría si algún día hiciera falta.

---

## 17. Plan de implementación por fases

Cada fase termina con `pnpm check` verde y commit pequeño, como 2A/2B/3.1/3.2.

| Fase                          | Alcance                                                                                                                                                                                      | Ficheros                                                                                          | Riesgo                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **F3.2b — Motor sin memoria** | §13 bloque 1 (puntos 1–9): banda de RIR, mediana, imputación conservadora, `SESSION_INCOMPLETE`, confianza, `repsEquivalentes`, `EXTEND_RANGE`, variantes no cargables, mensajes específicos | `progression.ts`, `training-config.ts`, tests                                                     | **Bajo** — función pura, sin DB           |
| **F3.2c — Datos honestos**    | §13 bloque 3: RIR sin preseleccionar + "no lo sé", captura de técnica, mostrar el feedback ya guardado                                                                                       | `session-runner.tsx`, `workout.ts` (schema), migración mínima si técnica pasa a `WorkoutExercise` | Bajo                                      |
| **F3.2d — Motor con memoria** | §13 bloque 2: `recentSessions` en el repo, `DECREASE_LOAD`, `STALL`                                                                                                                          | `workout.repo.ts`, `progression.service.ts`, `progression.ts`                                     | Medio — toca lectura                      |
| **F3.2e — e1RM y tendencia**  | §13 bloque 4: derivar en lectura, umbral ±5 %, ≥3 sesiones, carga equivalente para rangos altos                                                                                              | `e1rm.ts`, `history.ts`                                                                           | Bajo                                      |
| **F3.2f — Generador**         | §13 bloque 5: aviso < 80 % del objetivo, no cerrar días con tiempo libre, RIR pesado 3→2                                                                                                     | `generate-initial-program.ts`, `training-config.ts`                                               | Bajo (sube versión del generador a 3.1.0) |
| **F3.2g — Docs**              | §13 bloque 6                                                                                                                                                                                 | `COACH_PHILOSOPHY.md`, `TRAINING_ENGINE.md`                                                       | Nulo                                      |
| **F3.3 — Fatiga y deload**    | §14                                                                                                                                                                                          | nuevo motor en `core/training/` + servicio                                                        | Medio                                     |
| **F3.4 — Volumen adaptativo** | §14 (`ADD_SET`/`REMOVE_SET` a límite de mesociclo)                                                                                                                                           | motor + servicio                                                                                  | Medio-alto                                |
| **F7a — Móvil**               | §16 pasos 1–2 (Tailscale + HTTPS) y **backup de `data/app.db`**                                                                                                                              | ninguno (operación)                                                                               | Nulo                                      |
| **F6 — Coach AI**             | §15 sobre el motor ya estabilizado                                                                                                                                                           | `src/ai/`                                                                                         | Alto (coste, privacidad)                  |

**Orden recomendado:** `F3.2b → F3.2c → F7a → F3.2d → F3.2e → F3.2f → F3.2g → F3.3 → F3.4 → F6`.

Razones: **F3.2b** es el mayor valor por riesgo (arregla la zona muerta y el estado absorbente sin
tocar la base de datos). **F3.2c** debe ir pronto porque cada semana que pasa se acumulan datos de
RIR anclados al objetivo, que luego no se pueden corregir. **F7a** se cuela ahí arriba porque es
gratis, hace la app realmente usable en el gimnasio, y el backup de la DB es la protección más
barata que existe. **F6 va al final**: un Coach AI encima de un motor con zona muerta explicaría
muy bien decisiones equivocadas.

---

## 18. Comparación: Kinobody · Renaissance Periodization

### Kinobody (O'Gallagher)

| Qué conservamos                                                         | Por qué                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Foco en pocos movimientos importantes y progresarlos de verdad**      | Coincide con ACSM 2026 ("levantamientos clave al principio") y con que la carga es lo que construye fuerza |
| **Evitar junk volume**: si una serie no va a mover la aguja, no se hace | Coherente con rendimientos decrecientes (Pelland) y con el presupuesto de tiempo                           |
| **Progresión simple y memorable**                                       | Double progression es exactamente eso                                                                      |
| **Sesiones cortas y sostenibles**                                       | Adherencia = el multiplicador real a años vista                                                            |

| Qué NO copiamos                               | Por qué                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RPT al fallo en compuestos pesados**        | Maximiza justo la fatiga que la evidencia desaconseja: −25 % de velocidad, CK elevada a 48 h, peor afecto, **sin ganancia de fuerza** (Robinson 2024, Davies 2016) |
| **Volumen muy bajo como norma**               | Queda por debajo de la banda productiva para hipertrofia en entrenados (Pelland; ACSM 2026 ≥10 series/músculo/sem)                                                 |
| **Ayuno intermitente / estética como método** | Fuera del alcance de este motor y no respaldado como necesario                                                                                                     |

### Renaissance Periodization (Israetel et al.)

| Qué conservamos                                                | Por qué                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **RIR como lenguaje de esfuerzo**                              | Validado (Zourdos 2016) y es el mejor dato subjetivo barato que existe          |
| **Contabilidad de volumen por músculo, con trabajo indirecto** | **Es exactamente lo que hace Pelland 2025**, la mejor meta-regresión disponible |
| **Gestión de fatiga como variable de primer orden**            | Efectos grandes y consistentes (Vieira 2022)                                    |
| **Estructura de mesociclo como unidad de revisión**            | Buen marco organizativo (aunque no una necesidad fisiológica)                   |

| Qué simplificamos o descartamos           | Por qué                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MEV/MAV/MRV como constantes numéricas** | La dosis-respuesta es continua, con rendimientos decrecientes y **sin techo claro**; los landmarks son heurísticas presentadas como constantes. Nosotros los llamamos por su nombre: puntos de partida |
| **Rampa obligatoria de RIR 3→2→1→0**      | El único ECA directo (Martikainen 2025) no encuentra beneficio adaptativo                                                                                                                              |
| **Rampa obligatoria de volumen MEV→MRV**  | Enes 2024 la respalda para **fuerza**; para hipertrofia el beneficio es pequeño e incierto. No automática                                                                                              |
| **Deload de calendario cada 4–6 semanas** | Coleman 2024: sin beneficio hipertrófico y **peor fuerza**. Reactivo, no de calendario                                                                                                                 |
| **Complejidad de estados y fases**        | Coste cognitivo alto, beneficio no demostrado (ACSM 2026 deja la periodización compleja fuera de los imprescindibles)                                                                                  |

### El resultado

**No es "Kinobody engine" ni "RP engine".** Cogemos de Kinobody la **economía** (pocas cosas, bien
hechas, progresadas de verdad) y de RP la **contabilidad** (volumen efectivo por músculo, RIR,
fatiga como variable). Y donde ambos afirman más de lo que la evidencia sostiene —el fallo
sistemático de uno, los landmarks y las rampas obligatorias del otro— **nos quedamos con la
evidencia y lo etiquetamos como heurística cuando lo es.**

---

## 19. La regla final

> **"Hago 80 kg × X reps esta semana. ¿Qué tiene que pasar para que Personal Coach me diga
> exactamente qué hacer la semana que viene, y por qué?"**

Con la prescripción **3 × 6–8 @ 2 RIR, incremento 2,5 kg**, y una carga de trabajo de 80 kg:

| Lo que registras                                                    | Lo que te dirá                                                                                    | Por qué                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `8 / 8 / 8` con RIR **≥ 1** en todas                                | **Sube a 82,5 kg y busca 7 reps**                                                                 | Cerraste el rango dentro de la banda de esfuerzo. 7 = las reps que 80×8 equivale a 82,5 |
| `8 / 8 / 7` con RIR **≥ 1**                                         | **Sube a 82,5 kg y busca 7 reps**                                                                 | Rango cerrado: basta con `n−1` series en el techo y ninguna bajo `repMax−1`             |
| `8 / 8 / 8` a **RIR 0** (1.ª vez)                                   | **Mantén 80 kg**, buscando dejar 2 en reserva — _"si vuelves a cerrarlo así, subimos igualmente"_ | Fallo con reserva prescrita: primero se consolida                                       |
| `8 / 8 / 8` a **RIR 0** (2.ª vez)                                   | **Sube a 82,5 kg**                                                                                | Tu capacidad real está en el techo; quedarse es peor                                    |
| `8 / 8 / 6`                                                         | **Mantén 80 kg, sube la serie más floja a 7**                                                     | El rango no está cerrado: la serie que bloquea es la tercera                            |
| `7 / 7 / 6`                                                         | **Mantén 80 kg, busca 7 en la tercera**                                                           | Dentro del rango, aún hay recorrido en reps                                             |
| `6 / 5 / 5` (1.ª vez)                                               | **Mantén 80 kg** — _"no cambio nada por una sesión; si vuelve a pasar, bajo la carga"_            | Una sesión mala no es información suficiente                                            |
| `6 / 5 / 5` (2.ª vez seguida al mismo peso)                         | **Baja a 75 kg**                                                                                  | La carga no permite el rango prescrito. Dos exposiciones ya no es ruido                 |
| `7 / 7 / 6` **tres exposiciones seguidas sin batir tu mejor total** | **Meseta detectada** — con los números: _"21 → 20 → 20 reps en 80 kg"_                            | No es una mala sesión: es un estancamiento, y merece otra palanca                       |
| `8 / 8 / 8` con **RIR 4**                                           | Sube — y si además no progresas, _"la carga se te ha quedado corta"_                              | El excedente de esfuerzo es información                                                 |
| `12 / 12 / 12` @2 con rango 6–8                                     | **Sube a 92,5 kg** (tope +10 %/sesión)                                                            | La carga estaba mal calibrada; se corrige por equivalencia, no con +2,5 kg              |
| Solo registras **1 de 3 series**                                    | **Mantén 80 kg y complétala**                                                                     | Media sesión no decide                                                                  |
| No registras el RIR                                                 | La decisión sigue, con **confianza MEDIA** y con el RIR supuesto **por debajo** del objetivo      | La falta de dato nunca debe habilitar una subida                                        |

Y el porqué siempre viene con el número que lo disparó, con su nivel de confianza, y con la etiqueta
de si eso es evidencia o heurística.

---

## Anexo A — Estado de verificación de las fuentes

**Verificadas personalmente** (PubMed / Crossref / preprint / editor, en esta sesión):
Refalo 2023 (Sports Med, PMID 36334240) · Robinson 2024 (Sports Med, PMID 38970765, coeficientes vía
preprint SportRxiv 295) · Pelland 2025/2026 (Sports Med, DOI 10.1007/s40279-025-02344-w,
PMID 41343037) · Plotkin 2022 (PeerJ 10:e14142, PMID 36199287) · Remmert 2023 (Percept Mot Skills
130(3):1239-1254, PMID 37036795) · Halperin 2022 (Sports Med 52(2):377-390, PMID 34542869, cifra
central) · Coleman 2024 (PeerJ 12:e16777) · Martikainen 2025 (J Sci Sport Exerc,
DOI 10.1007/s42978-025-00338-8 — **sin PMID, revista no indexada, sin réplica**) · Enes 2024 (MSSE,
PMID 37796222) · Schoenfeld/Grgic/Krieger 2019 (J Sports Sci 37(11):1286-1295, PMID 30558493) ·
ACSM Position Stand 2026 (MSSE, DOI 10.1249/MSS.0000000000003897, PMID 41843416 — **cita verificada;
cifras concretas procedentes de resúmenes secundarios, pendientes de confirmar contra el PDF**) ·
validaciones de e1RM (SEE 2,4–3,2 kg en press banca).

**Aportadas por búsqueda asistida y NO verificadas una a una por mí** (identificador y sentido
comprobados en la búsqueda, pero sin lectura directa del abstract): Grgic 2022 (PMID 33497853) ·
Vieira AF 2021 (PMID 33555822) · Davies 2016 (PMID 26666744) · Jukic 2023 (PMID 36178597) ·
Pareja-Blanco 2017/2020 (PMID 27038416 / 32049887 / 32681665) · Izquierdo 2006 (PMID 16410373) ·
Izquierdo-Gabarren 2010 (PMID 19997025) · Vieira JG 2022 (PMID 34881412) · Refalo 2023 Sports Med
Open (PMID 36752989) · Refalo 2024 JSCR (PMID 37967832) y J Sports Sci (PMID 38393985) · Refalo 2025
EJSS (PMID 39960821) · Sánchez-Medina 2011 (PMID 21311352) · Zourdos 2016 (PMID 26049792) ·
Steele 2017 (PMID 29204323) · Hermann 2025 (PMID 40249908) · Santanielo 2020 · Lacerda 2020 ·
Vasconcelos 2026 · Wu 2026. **Antes de citar cualquiera de estas en la UI, verificar.**

**Buscado y NO encontrado:**

- Ningún estudio prospectivo sobre **incidencia de lesión** con entrenamiento al fallo vs. sin fallo.
  Cualquier afirmación cuantitativa al respecto sería inventada.
- Ningún estudio que asigne aleatoriamente **distintos RIR a distintas categorías de ejercicio**.
- Ninguna publicación revisada por pares que valide el esquema **RIR 3→2→1→0** como esquema.

## Anexo B — Reproducir las simulaciones

Los scripts de §1.3–§1.6, §1.7, §2.4 y §11 se ejecutaron con `tsx` contra el código real
(`suggestProgression`, `generateInitialProgram`, `estimateOneRepMax`, `EXERCISES`) y un atleta
virtual determinista (LCG con semilla fija; sin `Date.now()` ni `Math.random()`). Al implementar
F3.2b/F3.2d conviene **portar el arnés a `src/core/training/*.sim.test.ts`** con las 8 personas de
§11 como _golden files_, para que cualquier cambio futuro de umbral muestre su efecto a 12 semanas.
