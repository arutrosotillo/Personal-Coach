# Fase 2B — Diario de entrenamiento útil (plan aprobado)

Cierra el loop **programa → sesión → registrar sets → completar → historial → contexto para
la siguiente**. Prioridad absoluta: registrar un entreno debe ser **extremadamente rápido**
y la UI **nunca** toma decisiones inesperadas por el usuario. Uso personal, móvil, una mano.

## Decisiones de producto (aprobadas)

- **Sugerencia efímera on-demand.** Se calcula al vuelo desde el historial; NO se persiste.
  No se crean `AlgorithmDecision`/`Recommendation` en 2B. La traza 1:1 se reserva para F3,
  cuando la sugerencia sea *accionable*. Test: generar la sugerencia no escribe en DB.
- **Solo mantener/subir.** El motor nunca baja el peso ni hace deload (D4/D5 → F3).
- **UI: aplazadas** la marca warmup/working por serie y la captura de técnica (evitar fricción).
  Sí se arregla el filtro `setType = WORKING` en las queries (la columna ya existe → sin migración).
  La regla de técnica queda **latente** en el motor (no dispara hasta que exista captura).
- **Aplazadas** (no sabemos aún si mejoran la UX real): colapso automático de series completadas
  y auto-avance automático al siguiente ejercicio. Se implementarán más adelante si se validan.
- **Sin migración de schema.** Todo on-demand sobre `SetLog @@index([exerciseVariantId, localDate])`.
- **Anclaje a `exerciseVariantId`** para el historial; la **prescripción** se lee del snapshot
  `WorkoutExercise` de la sesión en curso.

## Motor de progresión 2B (subconjunto honesto de F3)

Función pura `suggestProgression(input, config, today?) → Suggestion` en `src/core/training/progression.ts`.
`today` y los umbrales entran como parámetros/config; sin `Date.now`/`Math.random`/prisma.

Reglas **transparentes**, evaluadas en orden (la primera que aplica gana):

| reasonCode | Condición (sobre la última sesión válida de la variante) | Acción |
|---|---|---|
| `NO_HISTORY` | Sin sets de trabajo de una sesión previa válida (incluye variante recién sustituida) | `START` — sin peso sugerido; el usuario elige la carga |
| `SESSION_UNUSABLE` | Última sesión ABORTED/SKIPPED, o `n < ceil(plannedSets × 0.7)` series de trabajo | `HOLD` (confianza baja) |
| `INCREASE_LOAD` | `≥ max(n−1, 1)` series con `reps ≥ repMax` **y** `rirEff ≥ targetRir`, y ninguna con `reps < repMax−1` | `INCREASE_LOAD`: `pesoRef + loadStepKg`, reps → `repMin` |
| `NEAR_FAILURE_HOLD` | Alguna serie con `rirEff ≤ targetRir − 2` (fallo o casi) sin llegar al tope | `HOLD` |
| `BELOW_MIN_HOLD` | Alguna serie con `reps < repMin` | `HOLD` |
| `ADD_REP` | Todas `reps ≥ repMin` y alguna `< repMax` | `ADD_REP`: +1 rep en la primera que no llegó al tope |
| `HOLD_DEFAULT` | Resto | `HOLD` |

Definiciones deterministas:
- **Serie de trabajo contable**: `setType === "WORKING" && completed && reps > 0`. WARMUP y no
  completadas se ignoran.
- **`rirEff`**: RIR real o, si es `null`, imputado a `targetRir` (neutral).
- **`pesoRef`**: peso modal de las series contables; empate → el **menor** (conservador).
- **Redondeo**: la subida es `pesoRef + loadStepKg` (ya múltiplo del incremento). Nunca 81,3 kg.
- **Nunca sube más de un `loadStepKg`.**

**Confianza** (`Confidence` = LOW | MEDIUM | HIGH; se conserva porque evita sugerencias engañosas y
la UI la usa para el tono, nunca porcentajes):
- `START` / `SESSION_UNUSABLE` → LOW.
- `imputedRir > n/2` → LOW; `imputedRir > 0` o una sola sesión comparable o `n = 1` → MEDIUM.
- resto → HIGH.

Salida:
```
Suggestion = {
  action: "INCREASE_LOAD" | "ADD_REP" | "HOLD" | "START",
  reasonCode: string,
  suggestedWeightKg: number | null,   // múltiplo de loadStepKg, o null
  suggestedReps: number | null,       // objetivo de la próxima
  confidence: "LOW" | "MEDIUM" | "HIGH",
  explanation: string,                // cita los números reales usados
  numbers: { pesoRef, loadStepKg, repRange:[min,max], targetRir, n, plannedSets, imputedRir }
}
```

### Ejemplos (rango 8–12, RIR objetivo 2, step 2,5)
- `80×12@2, 80×12@2, 80×11@2` → `INCREASE_LOAD` **82,5 kg → 8 reps**, HIGH.
- `80×10@2, 80×10@2, 80×9@2` → `ADD_REP` **80 kg**, "+1 en la serie 3".
- `80×10@0, 80×9@0` → `NEAR_FAILURE_HOLD` **80 kg**.
- `80×8, 80×7, 80×6` → `BELOW_MIN_HOLD` **80 kg** (nunca baja).
- `80,80,77.5` todas 12@2 → sube desde `pesoRef=80` → **82,5**.
- 3 series sin RIR, todas 12 → imputa RIR 2 → `INCREASE_LOAD` pero **LOW**.
- Variante sustituida → `NO_HISTORY`. Sesión 2/4 → `SESSION_UNUSABLE`.

### Historial por ejercicio (`src/core/training/history.ts`, puro)
- **mejor set**: máximo `estimated1Rm`; si todos `null` (reps altas) → máximo tonelaje `w×reps`.
- **e1RM~ actual**: mejor e1RM de la última sesión (o `null`).
- **tendencia**: ↑ / → / ↓ comparando e1RM (o tonelaje) de la sesión más reciente vs la más antigua
  dentro de la ventana (≈6 semanas); `< 2` sesiones → sin datos (nunca concluye por un dato aislado).

## Arquitectura / queries (sin migración)
- Fix: `lastComparableSets` filtra `setType:"WORKING"` (además de `status:"COMPLETED"`).
- Elimina N+1: `lastWorkingSetsForVariants(ids, excludeSessionId)` (1 query + agrupación en JS).
- `variantHistory(variantId, sinceLocalDate)` para mejor set / e1RM~ / tendencia.
- `isCompound` se resuelve en repo/servicio desde `COMPOUND_PATTERNS`; el motor lo recibe resuelto.
- Servicio arma el input (prescripción del snapshot + historial por variante) → motor → DTO. No persiste.

## UX in-session (lo que SÍ entra en 2B)
- **"Última vez" alineada por serie** dentro de cada fila (`últ 80×8@2` a la izquierda).
- **Prefill inteligente** (ya existe; se conserva y se hace visible con el ghost por serie).
- **Repetir/copiar set anterior** en 1 tap (chip en filas no hechas).
- **Badge de sugerencia discreto** en la cabecera del ejercicio + **"aplicar"** (solo prefill del
  primer set working; no persiste, no toca el programa). Tono según confianza; "por qué" desplegable.
- **Mini-historial** del ejercicio (drawer al tocar el título): última vez, mejor set, e1RM~, tendencia.

## Fuera de 2B
Deload, mesociclos, CALIBRACION/RECONSTRUCCION, sustitución automática por dolor, bajada de carga,
regresión lineal de estancamiento, IA, gráficas grandes, gamificación, y cualquier modificación
automática del programa. Auto-colapso y auto-avance quedan aplazados hasta validarlos.

## Orden de implementación
1. Fix `WORKING` + eliminar N+1 + queries de historial.
2. Tests de regresión.
3. `progression.ts` + `history.ts` puros.
4. Unit tests exhaustivos del motor.
5. Integration tests de historial/progresión.
6. UI "última vez" por serie.
7. Prefill / repetir / aplicar sugerencia.
8. Badge discreto + mini-historial.
9. E2E del flujo real.
10. Verificación final + documentación.
