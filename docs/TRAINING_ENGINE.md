# Training Engine — especificación v1.0

Motor puro determinista (`src/core/engines/training/`, F3; el generador de programa inicial en `src/core/program/` desde F1). Todos los umbrales viven en `src/core/config/`. Ninguna decisión con datos aislados. Señales de recuperación: las produce el Recovery Engine (RECOVERY_ENGINE.md); este motor solo las consume.

## 0. Grupos musculares y prioridades

16 grupos (códigos en seed): PECHO_SUPERIOR, PECHO_MEDIO_INFERIOR, DELT_ANTERIOR, DELT_LATERAL, DELT_POSTERIOR, DORSAL, ESPALDA_ALTA, TRAPECIO_SUPERIOR, BICEPS, TRICEPS, ANTEBRAZO, CUADRICEPS, ISQUIOS, GLUTEO, GEMELO, CORE.

**Sin prioridad estética por defecto.** No existe ningún "tier" oculto: el programa es equilibrado salvo que el usuario elija en el onboarding entre 1 y 6 grupos a priorizar (o "programa equilibrado, sin prioridad"). La única palanca de prioridad es esa selección explícita. "Cintura estrecha" es objetivo de nutrición + V-taper, no un sesgo del generador.

## 1. Generación de programa inicial (F1)

Implementada en `src/core/program/generate-initial-program.ts` (versión **3.0.0**, modelo de **volumen efectivo** de Fase 3.2; ver `docs/PHASE_3_2_VOLUME_PLAN.md`). Reparte un **objetivo de volumen efectivo semanal por grupo** sobre los menús de la división elegida. Determinista, sin progresión ni ajuste adaptativo (eso es F3.3/F3.4).

**Volumen efectivo** = `series directas × 1.0 + Σ(series indirectas × factor)`. El conteo fraccional directo/indirecto está respaldado por la literatura (Pelland 2025 lo modela) **[EVIDENCIA RAZONABLE]**; los NÚMEROS concretos son un **punto de partida conservador de PRODUCTO**, no óptimos universales.

**Objetivos de partida** (`training-config.ts`, `EFFECTIVE_TARGET`): banda inicial conservadora (~6–10 efectivas/músculo) con margen para progresar — **[HEURÍSTICA DE PRODUCTO]**, no un "óptimo científico" (la evidencia indica dosis-respuesta con rendimientos decrecientes y sin techo claro). Se escala por **experiencia** (`EXPERIENCE_MULT`: 0.75/1.0/1.15 según `trainingYears`) **[heurística conservadora]** y por **días** (`DAY_MULT`: 5d +8 %, 6d +12 %) **[heurística de generación; más días REPARTEN, no una dosis-respuesta demostrada]**. En déficit se reduce un 15 % (`FAT_LOSS_VOLUME_FACTOR`).

**Prioridad**: sube el **objetivo efectivo semanal** del grupo (`PRIORITY_BONUS_EFFECTIVE` +5), **nunca** las series por ejercicio. Su efecto real es más **frecuencia** (más días con el grupo) y algo más de volumen efectivo. El aviso de "desatendido" usa el objetivo BASE (sin el bonus), para no encender avisos engañosos al priorizar. Límite honesto: un músculo con pocos ejercicios primarios en el catálogo (p.ej. deltoide lateral) no puede absorber toda la prioridad — se comunica, no se inventa volumen imposible.

**División por días** (`splits.ts`): 2 → Full Body A/B · 3 → Full Body A/B/C · 4 → Torso/Pierna · 5 → Push/Pull/Pierna + Torso/Pierna · 6 → PPL×2.

**Reparto**: cada día se llena al grupo más necesitado (**prioridad primero**, luego mayor déficit de volumen efectivo restante). Guardrails **[HEURÍSTICA]**: **máx 3 series por ejercicio** (`SETS_PER_EXERCISE.max` — no un límite fisiológico; 4+ requeriría una razón que hoy no existe), máx por grupo/sesión (`MAX_SETS_PER_GROUP_PER_SESSION` 3/4), y **tope de densidad ≤18 series de trabajo/sesión** (`SESSION_SET_CAP`, guardrail de fatiga/UX). El volumen indirecto cuenta fraccionalmente, nunca como serie directa completa.

**Suelo directo** (`DIRECT_MIN`): asegura estímulo **directo** mínimo (que un músculo no viva solo de indirecto); `0` = puede cubrirse con indirecto. **Aviso** de músculo desatendido solo si `DIRECT_MIN[g] > 0` **y** su volumen **efectivo** `< WARN_FRACTION (0.6) × objetivo`: así nunca se avisa por pocas series directas cuando el indirecto ya cubre al músculo (p.ej. el glúteo, ~10 efectivas de piernas, no genera aviso).

**Frecuencia** ≥2×/semana para músculos grandes es una **preferencia de distribución cuando la división lo permite**, no una restricción dura: si la estructura del programa la hace inviable para algún músculo, se degrada con elegancia (no se rompe la rutina por forzarla) **[FUERTE que ≥2× es buen default; el no forzarlo es de producto]**.

**Selección de ejercicio**: filtra por equipamiento, contraindicaciones (lesiones) y exclusiones — **las restricciones prevalecen sobre la prioridad**. Prefiere compuesto si el grupo necesita mucho volumen y aún no tiene compuesto ese día; desempata por variedad (no repetir ejercicio en el programa), menor fatiga sistémica y orden alfabético (determinismo). No repite el mismo ejercicio dos veces el mismo día.

**RIR y rango** (`TARGET_RIR`): compuestos pesados RIR 3, compuestos RIR 2, aislamientos RIR 1. El rango de repeticiones lo aporta cada variante del catálogo (rol-apropiado). **Presupuesto de tiempo**: overhead 10 min + coste por serie (compuesto pesado 4, compuesto 3, aislamiento 2); al pasarse, se recorta o se cierra la sesión sin añadir ejercicios de una sola serie.

**Salida**: `volumeByGroup` (directo, fraccional, frecuencia, objetivo, prioridad) alimenta el bloque "Por qué este programa" y la trazabilidad (`AlgorithmDecision`).

### Base científica (referencias)

Volumen inicial conservador con margen de progresión y rendimientos decrecientes del volumen: Schoenfeld et al. 2017 (meta-análisis dosis-respuesta), Baz-Valle et al. 2022 (revisión de volumen). Rangos amplios de repeticiones válidos para hipertrofia (~5–30 con proximidad al fallo): Schoenfeld et al. 2021. Cercanía al fallo sin fallo sistemático (RIR 1–3): Refalo et al. 2023. Frecuencia como vehículo para distribuir volumen, sin efecto independiente grande a volumen igualado: Schoenfeld et al. 2019. Series indirectas cuentan pero menos que las directas: base para la contabilidad fraccional. Los números concretos son puntos de partida operativos, no verdades fisiológicas (ver COACH_PHILOSOPHY.md §7).

## 1b. Motor de progresión

Lo siguiente (§2–§9) especifica el motor de entrenamiento adaptativo **completo de Fase 3** (D0–D10,
modos, deload, mesociclos). La **Fase 2B implementa un subconjunto honesto y solo-sugerencia** de la
cola de double progression, sin persistir ni modificar el programa. Ver `docs/PHASE_2B_PLAN.md`.

**Implementado en 2B** (`src/core/training/progression.ts`, puro y determinista, sugerencia efímera):
`INCREASE_LOAD` (≈D6, subir un `loadStepKg` al completar el tope del rango con RIR ≥ objetivo),
`ADD_REP` (≈D7, dentro del rango), `HOLD` (≈D9/D10 + fallo/cerca del fallo/sesión inutilizable),
`START` (primera vez: no inventa peso). Reglas transparentes, ancladas a `exerciseVariantId`,
prescripción del snapshot vigente, filtrando WARMUP y sesiones no válidas, con RIR imputado a objetivo
cuando falta y confianza en 3 niveles (nunca porcentajes). El historial por ejercicio (mejor set,
e1RM~, tendencia) se calcula on-demand en `src/core/training/history.ts`.

**Reservado a F3** (NO en 2B): D0 completo (sueño/energía/duración/eventos), D1 CALIBRACION,
D2 sustituir por dolor, D4/D5 **bajar carga**/estancamiento por regresión, D6a rango extendido,
modos NORMAL/CALIBRACION/RECONSTRUCCION, deload y mesociclos. **2B nunca baja el peso.**

## 2. Progressive overload — double progression (F3)

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

## 3. Volumen (F3)

Serie efectiva: `completed && rir ≤ 4 && !warmup`, contada fraccionalmente vía `ExerciseMuscleContribution` (press inclinado: PECHO_SUPERIOR 1.0, PECHO_MI 0.5, DELT_ANT 0.5, TRICEPS 0.5 — tabla completa en el seed; aproximaciones operativas editables).

Defaults semanales (config): Tier A inicio 8–10 (mín 6–8, máx 16–20); B 4–8; C 0–6. En pérdida de grasa: inicio −20 %, máx −15 %.

Cambios (evaluación semanal): **+1 serie/grupo/sem** solo si ≥2 sesiones válidas del grupo + tendencia de rendimiento estable/positiva + recuperación GOOD + sin dolor MM3 ≥3 + bajo el máx. **−2 series** si 2 semanas de tendencia negativa con esfuerzo presente, o dolor sostenido. Límites: máx 4 grupos modificados/sem, cambio neto ±4 series/sem. Prioridad de cupo: Tier A > B > C.

## 4. Deload (F3)

Score multi-señal (ventana 2 semanas): caída de rendimiento ≥2 grupos ×2 sem (3 pts) · fatiga alta sostenida (2) · dolor ≥2 articulaciones (2) · ≥50 % ejercicios clave estancados (2) · sueño malo (1) · motivación baja (1) · ≥6 sem sin deload (1; ≥8 sem: 2). **Score ≥5 → recomendar deload** (jamás automático), listando cada señal con números; 3–4 → aviso. Posponer suma +1 la semana siguiente (cap +2).

Prescripción: 1 semana, −50 % series (mín 1/ejercicio), −10 % carga, RIR 3–4, mismos ejercicios. No alimenta tendencias; al acabar se restauran las prescripciones previas y el contador se resetea.

## 5. Mesociclos (F3)

4–8 semanas (default 6, deload final opcional). Estados PLANNED|ACTIVE|COMPLETED|ABORTED. Al terminar: resumen (Δe1RM por clave, volúmenes, adherencia, estancados/sustituidos) y transición: grupo que terminó bien → siguiente meso arranca en `min(volFinal−2, inicioDefault+2)`; mal → `inicioDefault`. Nada se borra; historial global por variante.

## 6. Estancamiento y caída (F3)

Por ejercicio: regresión lineal de e1RM sobre las últimas 4 sesiones válidas. PROGRESANDO > +0,5 %/sesión · ESTANCADO |Δ acumulado| <1 % con RIR ≤ objetivo · EN_CAIDA ≤ −1,5 %/sesión (3 sesiones) o ≤ −5 % acumulado · <4 sesiones = SIN_DATOS (nunca dispara nada).

Por grupo: media ponderada por volumen fraccional; negativa si < −2 % dos semanas seguidas; un solo ejercicio no define al grupo si aporta <40 % del volumen.

## 7. Límites de la evidencia (comunicación)

Series efectivas y factores fraccionales = convenciones contables. Landmarks de volumen = puntos de partida, no verdades. RIR ±1–2 reps de error. e1RM solo tendencia intra-variante. Ver COACH_PHILOSOPHY.md §7.
