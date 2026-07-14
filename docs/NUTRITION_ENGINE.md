# Nutrition Engine — especificación v1.0

Motor puro determinista (`src/core/engines/nutrition/`, F4; la **estimación inicial** ya se usa en el onboarding de F1 vía `src/core/nutrition/initial-estimate.ts`). Unidad mínima de decisión: la semana. Redondeos: kcal a múltiplos de 25, macros a gramos enteros.

## 1. Estimación inicial de gasto (TDEE)

**BMR — Mifflin-St Jeor** (mejor validación en población general):

- Hombre: `10·peso + 6.25·altura − 5·edad + 5`
- Mujer: `10·peso + 6.25·altura − 5·edad − 161`

**Factor de actividad compuesto**:

- Base por pasos/día: <4k → 1.20 · 4–6k → 1.30 · 6–8k → 1.40 · 8–10k → 1.50 · 10–12k → 1.60 · ≥12k → 1.70.
- - ajuste laboral (esfuerzo no capturado por pasos): sedentario +0.00 · ligero +0.05 · moderado +0.10 · alto +0.15. Tope combinado 1.85.
- Entrenamiento aparte (no en el factor): `0.05 kcal · kg · min` por sesión de fuerza, repartido /7.

`TDEE = BMR × min(F_pasos + F_trabajo, 1.85) + nSesiones × kcalSesión / 7`

Ejemplo verificado: 84 kg/178 cm/34 años/8.500 pasos/sedentario/4×60 min → BMR 1.788, factor 1.50, entreno 144/día → **TDEE ≈ 2.825**. Se muestra SIEMPRE con rango ±12 % y el aviso de que es un punto de partida que el bucle semanal corregirá.

## 2. Objetivo semanal

| Objetivo      | Default           | Rango           |
| ------------- | ----------------- | --------------- |
| Déficit       | −0,5 % peso/sem   | −0,25 a −1,0 %  |
| Superávit     | +0,15 %/sem       | +0,10 a +0,25 % |
| Recomposición | 0 % (kcal = TDEE) | —               |
| Mantenimiento | banda ±1 %        | —               |

Conversión: 7.700 kcal/kg (imprecisión reconocida; el bucle corrige). `kcalObjetivo = round25(TDEE − peso × ritmo% × 7700/7)`.

**Suelos duros (no configurables hacia abajo)**: `kcal ≥ max(BMR × 0.90, 1500 H / 1200 M)`; déficit ≤ min(25 % TDEE, 1 %/sem). Si un ajuste tocaría el suelo: se recorta hasta el suelo y se activa alerta (§9).

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
