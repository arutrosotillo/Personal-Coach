# Training Engine — especificación v1.0

Motor puro determinista (`src/core/engines/training/`, F3; el generador de programa inicial en `src/core/program/` desde F1). Todos los umbrales viven en `src/core/config/`. Ninguna decisión con datos aislados. Señales de recuperación: las produce el Recovery Engine (RECOVERY_ENGINE.md); este motor solo las consume.

## 0. Grupos musculares y prioridades

16 grupos (códigos en seed): PECHO_SUPERIOR, PECHO_MEDIO_INFERIOR, DELT_ANTERIOR, DELT_LATERAL, DELT_POSTERIOR, DORSAL, ESPALDA_ALTA, TRAPECIO_SUPERIOR, BICEPS, TRICEPS, ANTEBRAZO, CUADRICEPS, ISQUIOS, GLUTEO, GEMELO, CORE.

Tiers por defecto (configurables desde onboarding):
- **Tier A** (prioridad estética): DELT_LATERAL, DELT_POSTERIOR, DORSAL, PECHO_SUPERIOR — frecuencia ≥2×/sem siempre, ≥3× con ≥4 días.
- **Tier B**: BICEPS, TRICEPS, ESPALDA_ALTA, CUADRICEPS, ISQUIOS, GLUTEO.
- **Tier C**: resto.

"Cintura estrecha" = V-taper + nutrición. Por defecto sin oblicuos con carga pesada progresiva (`avoidWeightedObliques: true`); CORE 0–4 series/sem de anti-extensión/anti-rotación. Piernas: nunca <2 sesiones/sem con ≥4 días.

## 1. Generación de programa

División por días disponibles: 2 → Full Body A/B · 3 → Full Body A/B/C · 4 → Torso/Pierna sesgado · 5 → Torso/Pierna + día de especialización hombro/espalda · 6 → PPL×2 sesgado.

Presupuesto de tiempo por sesión: overhead 10 min + coste por serie (compuesto pesado 4 min, compuesto secundario 3, aislamiento 2). Si no cabe: recortar Tier C → aislamiento redundante de Tier B → nunca <2 series de un grupo Tier A planificado ese día.

Selección de ejercicios: filtrar por equipamiento, contraindicaciones (lesiones declaradas) y lista de excluidos → 1 compuesto + 1–2 aislamientos por grupo/día → desempate por preferencia del usuario, menor fatiga sistémica, orden alfabético de id (determinismo). Orden en sesión: compuestos Tier A → compuestos resto → aislamientos Tier A → resto.

**Fase 1 implementa una versión simple de esto** (`src/core/program/generate-initial-program.ts`): reglas de división + sesgo Tier A + filtros duros + presupuesto de tiempo, sin progresión de volumen dinámica. Los targets de volumen dinámicos llegan con F3.

## 2. Progressive overload — double progression (F3)

### Inputs
Historial de `SetLog` por `exerciseVariantId` (peso, reps, RIR, técnica 1–5, completado), metadatos de sesión (duración, fracción completada, feedback pre-sesión), estado del ejercicio (`NORMAL | CALIBRACION | RECONSTRUCCION`), prescripción vigente.

### e1RM
`e1RM(w, reps, rir) = w × (1 + (reps + min(rir,4)) / 30)` (Epley con reps efectivas). Válida solo si `reps + rir ≤ 12`; siempre presentada con "~". Aislamientos de rango alto: usar tonelaje de la mejor serie (`w × reps`) en lugar de e1RM.

### Sesión anómala (D0)
Anómala si: sueño reportado ≤2/5, o energía ≤1/5, o duración <0,6× / >1,8× la mediana de las últimas 6, o <70 % de series completadas, o marcada manualmente, o solapa un `PersonalEvent` de tipo ILLNESS. No alimenta decisiones. Máximo 2 anómalas consecutivas descartables; la tercera cuenta y dispara señal de recuperación.

### Tabla de decisión (evaluar en orden; la primera que aplica gana)

| # | Condición | Acción |
|---|---|---|
| D0 | Sesión anómala | MANTENER (descartada, explicando el motivo) |
| D1 | Modo CALIBRACION (variante nueva, 2 sesiones) | CALIBRAR — peso inicial: e1RM de variante "hermana" ×0,85 resuelto a reps objetivo con RIR 3, redondeado ABAJO al incremento; sin hermana, lo fija el usuario |
| D2 | Dolor articular ≥4/5 en la última sesión o ≥3/5 en 3 consecutivas (asociado al ejercicio) | SUSTITUIR (alternativas sin esa contraindicación) |
| D3 | Técnica media <3/5 | MANTENER + aviso técnica (nunca subir con técnica <3) |
| D4 | 2 sesiones válidas consecutivas con caída e1RM >5 % cada una, con RIR ≤ objetivo | BAJAR_CARGA −7,5 % (redondeo al incremento; modo RECONSTRUCCION 2 sesiones, sin nuevas bajadas) |
| D5 | Estancamiento: 4 sesiones válidas con Δe1RM acumulado <1 % y RIR medio ≤ objetivo | 1ª vez: BAJAR_CARGA −5 % y reconstruir; 2ª vez en el mismo mesociclo: SUSTITUIR |
| D6 | ≥N−1 series en tope del rango con RIR ≥ objetivo y técnica ≥3, y ninguna serie < repMax−1 | SUBIR_CARGA un incremento (`loadStepKg`) — nunca más de uno |
| D6a | …pero incremento/carga >10 % | ANADIR_REP con tope extendido repMax+3; al lograrlo → SUBIR_CARGA y restaurar rango |
| D7 | Todas ≥ repMin, alguna sin llegar al tope | ANADIR_REP (+1 en la primera serie que no llegó) |
| D8 | 1–2 sesiones tras una subida, reps ≥ repMin | MANTENER (progresión intra-rango esperada) |
| D9 | Alguna serie < repMin, sin cumplir D4 | MANTENER + vigilancia (una sesión floja no baja la carga) |
| D10 | Resto | MANTENER |

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
