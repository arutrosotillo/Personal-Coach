# Nutrition Engine — especificación (estimación inicial v2.0, motor semanal F4)

Motor puro determinista (`src/core/engines/nutrition/`, F4; la **estimación inicial** ya se usa en el onboarding de F1 vía `src/core/nutrition/initial-estimate.ts`). Unidad mínima de decisión: la semana. Redondeos: kcal a múltiplos de 25, macros a gramos enteros.

## 1. Estimación inicial de gasto (TDEE) — modelo aditivo v2.0

Implementación: `src/core/nutrition/initial-estimate.ts`, versión 2.0.0. Devuelve además una traza tipada `InitialNutritionEstimateTrace` que la UI muestra en el bloque expandible "Cómo se ha calculado".

**BMR — Mifflin-St Jeor por defecto** (mejor validación en población general):

- Hombre: `10·peso + 6.25·altura − 5·edad + 5`
- Mujer: `10·peso + 6.25·altura − 5·edad − 161`

**Katch-McArdle SOLO con % graso medido de forma fiable** (DEXA/plicómetro, marcado como `bodyFatMeasured`): `370 + 21.6·MLG`. Un % graso estimado (visual o báscula doméstica) NO activa Katch-McArdle — se usa Mifflin y se anota en la traza. Evita amplificar el error con un dato poco fiable.

**Modelo TDEE ADITIVO** (evita el doble conteo entre pasos, trabajo y ejercicio; cada componente cubre una fuente distinta):

```
TDEE = BMR × factorNEAT(trabajo) + kcalPasos + kcalEntrenamiento
```

- `factorNEAT(trabajo)`: vida diaria + esfuerzo del trabajo SIN los pasos ni el gimnasio. Sedentario 1.15 · ligero 1.20 · moderado 1.30 · alto 1.40. (Antes se usaba un factor por pasos de hasta 1.7 y ADEMÁS se sumaba el entrenamiento: eso duplicaba parte del gasto — corregido.)
- `kcalPasos = pasos × 0.0005 × peso` (locomoción neta medida por el podómetro; ~0,04 kcal/paso a 80 kg).
- `kcalEntrenamiento = 0.05 · peso · minutos · sesiones / 7` (coste neto de la fuerza).

Ejemplo (perfil de auditoría 83,5 kg/178 cm/34 años/10.000 pasos/sedentario/4×60 min): BMR 1.783 → base 1.783×1,15 = 2.050 · pasos 418 · entreno 143 → **TDEE 2.600** (rango ±12 %: 2.288–2.912). El modelo anterior daba ~3.000 para el mismo perfil por doble conteo. Se muestra SIEMPRE como estimación con rango; se calibra con datos reales en 2–4 semanas.

**Separación explícita** en la traza: `TDEE estimado` → `ajuste por objetivo` → `target calórico`. El ajuste (déficit/superávit) se acota al 25 % del TDEE y el target nunca baja del suelo de seguridad (§2).

## 2. Objetivo semanal

| Objetivo      | Default           | Rango           |
| ------------- | ----------------- | --------------- |
| Déficit       | −0,5 % peso/sem   | −0,25 a −1,0 %  |
| Superávit     | +0,15 %/sem       | +0,10 a +0,25 % |
| Recomposición | 0 % (kcal = TDEE) | —               |
| Mantenimiento | banda ±1 %        | —               |

Conversión: 7.700 kcal/kg (imprecisión reconocida; el bucle corrige). `kcalObjetivo = round25(TDEE − peso × ritmo% × 7700/7)`.

**Suelos duros (no configurables hacia abajo)**: `kcal ≥ max(BMR × 0.90, 1500 H / 1200 M)`; déficit ≤ min(25 % TDEE, 1 %/sem). Si un ajuste tocaría el suelo: se recorta hasta el suelo y se activa alerta (§9).

> ### ⚠︎ Revisión pendiente (abierta 2026-08-31, sin implementar)
>
> **El techo del déficit no tiene componente absoluto, y debería tenerlo.**
>
> Hoy `NUTRITION_CONFIG.maxDeficitPctOfTdee = 0.25` acota el déficit solo en términos relativos. Para un TDEE de 2.800 kcal eso permite 700 kcal/día. La meta-regresión de **Murphy & Koehler 2022** (`doi:10.1111/sms.14075`, `PMID 34623696`) sobre ECAs de entrenamiento de fuerza en déficit sitúa en **~500 kcal/día** el punto donde se anulan las ganancias de masa magra (ES = −0,57, p = 0,02 para masa magra; la fuerza no se deteriora significativamente, ES = −0,31, p = 0,28). Su recomendación explícita es evitar déficits > 500 kcal/día si se quiere preservar masa magra entrenando fuerza.
>
> El límite porcentual y el absoluto se cruzan según el peso, y hoy solo se aplica uno:
>
> | Peso   | 0,7 %/sem   | Déficit implicado | ¿Coherente con ≤500 kcal/d? |
> | ------ | ----------- | ----------------- | --------------------------- |
> | 60 kg  | 0,42 kg/sem | ~460 kcal/d       | Sí                          |
> | 80 kg  | 0,56 kg/sem | ~615 kcal/d       | No                          |
> | 100 kg | 0,70 kg/sem | ~770 kcal/d       | No                          |
>
> **Cambio propuesto** (revisión independiente, pequeña, con sus propios tests): añadir `maxDeficitKcalAbsolute: 500` a `nutrition-config.ts` y aplicar el **mínimo** de las dos restricciones, no solo el porcentaje. La traza ya tiene `boundedByMaxDeficit`; haría falta distinguir cuál de los dos topes mordió, para que la explicación al usuario diga la verdad.
>
> **Casos límite a cubrir con test**: persona ligera donde manda el % (sin cambio de comportamiento respecto a hoy); persona pesada donde manda el tope absoluto; interacción con el suelo de kcal de §9 cuando ambos se activan; y que `effectiveWeeklyRatePct` siga reflejando el ritmo REAL tras aplicar el nuevo tope.
>
> **Asunto aparte, misma revisión**: el rango de déficit llega a −1,0 %/sem y el wizard ofrece el preset "Decidido" (−0,75 %) sin condicionarlo al % graso. La evidencia (**Garthe 2011**, `doi:10.1123/ijsnem.21.2.97` — 0,7 %/sem preservó masa magra, +2,1 %, frente a 1,4 %/sem, −0,2 %) respalda 0,5–0,7 % para personas magras y entrenadas; el extremo superior solo es defendible con grasa basal alta (ISSN position stand 2017, `doi:10.1186/s12970-017-0174-y`). O se condiciona el preset, o se etiqueta honestamente lo que cuesta.
>
> Detectado durante la auditoría de seguimiento corporal. **Deliberadamente NO se corrigió ahí**: es un cambio al motor nutricional en producción y merece su propia revisión con su propia evidencia, no colarse en una feature que apareció por casualidad a su lado.

## 3. Macronutrientes

| Objetivo                  | Proteína (g/kg)   | Grasa (g/kg)      |
| ------------------------- | ----------------- | ----------------- |
| Déficit / Recomposición   | **2.2** (1.8–2.6) | **0.8** (0.6–1.2) |
| Mantenimiento / Superávit | **1.8** (1.6–2.2) | **0.9** (0.6–1.3) |

Peso de referencia: actual; si BF% conocido >30 % (H) / 40 % (M) → peso objetivo. Mínimos duros: grasa ≥0.6 g/kg y ≥45 g; carbohidratos ≥100 g. Si no caben: bajar grasa al mínimo → proteína a 1.8 → si aún no cabe, las kcal son demasiado bajas → alerta. Carbohidratos = resto. Cada macro con explicación plantillada (por qué ese número).

## 4. Peso: EMA y tendencia (F4)

- **EMA α = 0.10** (Hacker's Diet). Inicialización = primer pesaje. Huecos de n días: `α_eff = 1 − 0.9^n` (no se interpola).
- Outliers: `|peso − EMA| > 2.5 %` → winsorizar a EMA ±2.5 %, guardar el crudo, marcar "pesaje atípico, suavizado".
- **Tendencia semanal** = pendiente de regresión lineal sobre la EMA de los últimos 14 días con pesaje, ×7.
- Validez: ≥4 pesajes/semana en las 2 últimas semanas Y ≥14 días de datos. Si no → `INSUFFICIENT_DATA`, sin ajuste.

## 5. Ajuste calórico semanal (F4)

Se evalúa al cerrar el check-in semanal. `r = tendencia / objetivo`. Paso default 100 kcal (máx 150). Banda de tolerancia 0,6 ≤ r ≤ 1,4. Reglas en orden (la primera gana); toda decisión emite datos usados, regla, cambio, explicación y confianza:

| #   | Regla                    | Condición                                                                                                                        | Acción                                                     |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| R0  | Seguridad                | Alerta de §9 activa                                                                                                              | Pausar recortes; solo permitir subidas                     |
| R1  | Datos insuficientes      | Tendencia no válida                                                                                                              | No ajustar; pedir ≥4 pesajes/sem                           |
| R2  | Adherencia baja          | Nivel "mala" (§6)                                                                                                                | **NUNCA recortar**; señalar el registro primero, sin culpa |
| R3  | Cooldown                 | Ajuste <7 días (cualquier dirección) o <14 días (misma dirección)                                                                | No ajustar; nunca revertir a la semana siguiente           |
| R4a | Fase inicial             | ≤2 semanas de dieta                                                                                                              | No ajustar (agua/glucógeno)                                |
| R4b | Retención/whoosh         | Adherencia buena + ingesta ≤ objetivo+5 % + estancamiento de solo 1 sem, O evento marcado (sodio, viaje, DOMS fuertes) en 5 días | Esperar 1 semana                                           |
| R5  | Pérdida excesiva         | tendencia ≤ −max(1 %·peso, 1.5×objetivo) ×2 sem, O r ≥1.25 con energía ≤2/5 o rendimiento cayendo                                | **+100 kcal** (ignora cooldown contrario si >7 días)       |
| R6  | En banda                 | 0,6 ≤ r ≤ 1,4                                                                                                                    | Mantener                                                   |
| R6b | Progreso algo lento      | 0,5 ≤ r < 0,6, primera vez                                                                                                       | Mantener + vigilancia                                      |
| R7a | Estancado, palanca pasos | r <0,5 ×≥2 sem + adherencia ≥regular + pasos < objetivo−1000 + no sugerido en 2 sem                                              | **+1.500 pasos/día** en lugar de recortar                  |
| R7b | Estancado, recorte       | Igual con pasos ya en objetivo                                                                                                   | **−100 kcal** (respetando suelos)                          |
| R8  | Algo rápido              | 1,4 < r < 1,5, una semana                                                                                                        | Mantener + nota                                            |

Casos de test canónicos T1–T11 en TEST_PLAN.md.

## 6. Adherencia (F4)

Por semana: `loggingRate` (días con registro/7) · `desvioKcal` (media |real−objetivo|/objetivo — valor absoluto: pasarse y quedarse corto penalizan igual) · `weighRate` (pesajes/7).

**Buena** = ≥6/7 ∧ ≤10 % ∧ ≥4/7 · **Regular** = ≥5/7 ∧ ≤20 % ∧ ≥4/7 · **Mala** = resto. Los componentes SIEMPRE visibles por separado (panel de adherencia, PRODUCT_SPEC.md).

## 7. Check-ins (F4)

**Diario** (ningún campo obligatorio, 15 s): peso matutino, kcal, proteína, pasos, hambre 1–5, energía 1–5, horas de sueño, entrenó, notas. **Semanal**: automático (tendencia, adherencia, medias, decisión del motor) + preguntado (cintura en ayunas, fotos opcionales, sensaciones 1–5, nota).

## 8. Registro de comidas (F4)

Sin base de datos de alimentos: totales + `MealTemplate` (1 tap) + copiar día anterior + restantes del día (proteína destacada). Los logs copian los macros de la plantilla (snapshot).

## 9. Seguridad

Alertas (activan R0 y modo conservador global): pérdida >1,5 %/sem ×2 sem con adherencia buena · kcal en el suelo y el motor querría recortar · ingesta < suelo absoluto ≥5/7 días · patrón compuesto (ingesta <75 % de objetivo ya deficitario ≥5 días + hambre ≥4/5 + pérdida >1.5× objetivo). Comportamiento: detener recortes, resetear ritmo al conservador, mensaje neutro sin culpa sugiriendo profesional sanitario. Jamás diagnosticar ni usar la palabra "trastorno" dirigida al usuario. Ver COACH_PHILOSOPHY.md §12.

## 10. Recomposición y mantenimiento

**Recomposición**: kcal = TDEE dinámico; éxito mensual = cintura −0,5 cm+ + peso ±1 % + rendimiento estable/subiendo. Si EMA sube >0,25 %/sem ×3 sem sin bajar cintura → −100; si baja >0,35 %/sem y el rendimiento cae → +100. Mensaje clave: la báscula es el dato MENOS importante aquí.

**Mantenimiento**: ancla = EMA al entrar; banda ±1 %. Fuera de banda 2 semanas con adherencia ≥regular → ±100 hacia el centro, mismos cooldowns. Dentro de banda: no tocar y decirlo en positivo.
