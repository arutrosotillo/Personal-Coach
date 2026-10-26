# Ciclos físicos y nutrición adaptativa a largo plazo

Cómo la app acompaña fases de definición, mantenimiento, recomposición y volumen
limpio durante años: qué es un ciclo, cómo se cierra y se abre, cómo aprende el
mantenimiento calórico real y cómo ajusta las calorías sin oscilar.

## Principios (no negociables)

1. **La persona decide.** Nada cierra un ciclo, abre otro ni cambia de estrategia
   solo. Llegar al peso objetivo se informa, no cierra nada. El motor propone y
   explica; la persona acepta o no.
2. **El historial es permanente.** Cerrar un ciclo cambia su estado y congela su
   resumen. No se borran ni reescriben pesajes, sesiones, series, objetivos ni
   decisiones.
3. **Adaptativo.** El mantenimiento sale de los datos de la persona (báscula +
   objetivo o ingesta registrada), no solo de una fórmula.
4. **Conservador y explicable.** Tendencias con márgenes honestos, nunca un
   pesaje aislado; agua y glucógeno fuera; pasos pequeños; toda propuesta lleva
   sus números y su porqué; confianza en tres niveles.

## 1. Modelo

Un ciclo **es una fila de `Goal`** (ya era el historial de fases desde B4): se
reutiliza en vez de duplicarlo. Migración `20261026120000_cycles_and_energy_estimates`,
100 % aditiva:

| Cambio                                       | Para qué                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Goal.endDate`, `closedAt`                   | Fin del ciclo. Los cerrados antes de esta versión no la tienen: su fin se deduce del inicio del siguiente.                                             |
| `Goal.closingSummary` (JSON)                 | Resumen congelado al cerrar: lo que la persona vio. Recalcularlo años después con motores nuevos daría otros números.                                  |
| `Goal.openRequestId` (único)                 | Idempotencia de "Empezar ciclo": repetir el envío devuelve el mismo ciclo.                                                                             |
| Índice parcial `Goal_one_active_per_profile` | La base impide dos ciclos activos por perfil. SQL a mano (Prisma no soporta `WHERE` en índices): revisa cualquier migración generada que toque `Goal`. |
| Tabla `EnergyEstimate`                       | Estimaciones de mantenimiento congeladas (memoria metabólica).                                                                                         |
| `DailyCheckIn.kcal` / `proteinG`             | Ya existían y estaban vacías: son el registro de ingesta. Sin migración.                                                                               |

Estados de un ciclo: `ACTIVE`, `COMPLETED` (lo doy por completado),
`ABANDONED` (sin completar: una decisión, no un fallo), `SUPERSEDED` (cambio de
fase por el camino antiguo; ya no lo usa la UI). Enums nuevos sin migración:
`CycleOutcome`, `InterimNutrition`, `EnergyEstimateKind`, `TargetSource.CYCLE_START`,
`RecommendationType.CYCLE_TARGETS`.

**Sin ciclo activo** es un estado de primera clase y seguro: el ajuste calórico
devuelve `NOT_APPLICABLE_GOAL`, el contador de volumen usa el listón de
mantenimiento, y las calorías vigentes son las que la persona eligió al cerrar
(mantenimiento estimado, recomendado, o las que tenía).

## 2. Flujo (`/progress/cycle`)

```
Finalizar ciclo ─ resumen ─ ¿completado / sin completar?
   ├─ Solo finalizar ─ calorías mientras decides (mantenimiento | las actuales) ─ confirmar
   └─ Empezar otro ─ datos de hoy ─ objetivo y ritmo ─ propuesta explicada ─ confirmar
```

- **Resumen** (`core/cycles/summary.ts`): fechas y duración; peso de inicio y de
  cierre como media de los primeros/últimos 7 días; cambio total; ritmo por
  regresión sobre todo el ciclo; cintura y % graso solo por encima de su error
  de medida; objetivos calóricos del periodo y su media; ingesta registrada;
  mantenimiento estimado con su margen; rendimiento (mejor e1RM por variante en
  las primeras vs. las últimas 3 semanas).
- **Datos de hoy**: peso (vacío por defecto: se usa la media reciente para
  calcular y solo se guarda un pesaje si la persona escribe el de hoy), cintura
  opcional, pasos y actividad laboral. No hay que repetir el onboarding ni
  regenerar el programa.
- **Plan** (`core/cycles/plan.ts`): `kcal = mantenimiento estimado + peso × ritmo % × 7.700 / 7`,
  con las reglas de siempre (déficit ≤ 25 % del gasto, suelo inviolable) y los
  mismos macros que el onboarding (`core/nutrition/macros.ts`, extraído sin
  cambiar su resultado). Explica de dónde sale cada número, qué esperar (el
  salto de glucógeno al salir de una definición, que un volumen al 0,15 %
  apenas se ve en la báscula, que no hay fecha de fin) y una nota OPCIONAL de
  volumen de entrenamiento.
- **Confirmación** (`startCycle`): una transacción que cierra el ciclo activo
  (con resumen y estimación congelados), actualiza pasos/actividad, guarda el
  peso de hoy si se escribió, crea el ciclo nuevo y su objetivo calórico con
  `AlgorithmDecision` + `Recommendation` 1:1, y congela la estimación de
  arranque. Guardas: idempotencia (`requestId`), el activo debe ser el que la
  persona vio (`expectedActiveGoalId`), el plan se recalcula en el servidor y
  debe coincidir con el que vio (`expectedKcal`), y el índice parcial. Cerrar un
  ciclo ya cerrado es idempotente; el cierre usa compare-and-set.

El formulario rápido "Revisar objetivo" del check-in ya **solo** corrige ritmo y
peso objetivo de la fase en curso; para cambiar de objetivo enlaza a este flujo.
`updateGoal` (servicio) conserva el camino `NEW_PHASE` por compatibilidad.

## 3. Memoria metabólica: el mantenimiento real (`core/nutrition/energy-balance.ts`)

```
gasto observado = ingesta media − pendiente (kg/día) × 7.700
```

Ejemplo de la spec: 2.150 kcal y −0,40 kg/semana → 2.150 + 440 ≈ **2.590 kcal**
(el test lo comprueba: sale 2.595 con ruido realista).

**Ingesta**: con registro suficiente (≥ 60 % de los días y ≥ 14 días) se usa lo
COMIDO; los días por debajo de la mitad de la mediana se descartan como registro
incompleto. Sin registro se usa el objetivo vigente día a día y se declara
("se asume que lo cumpliste") con más error. Nunca se confunden.

**Pendiente**: tendencia sobre **medias semanales** de la ventana más larga
disponible del régimen (56 → 42 → 28 días; nunca menos de 28, Hall & Chow 2011).

**Régimen**: el ciclo actual a partir de su inicio + **14 días** de
estabilización, **21** si viene justo de un déficit (glucógeno, agua y contenido
intestinal: 1–2 kg al salir de una definición). Nada de ciclos anteriores entra
como dato crudo.

**Incertidumbre**: error típico = √(ingesta² + pendiente² + densidad²), con
ingesta = 7 % (registrada) o 10 % (objetivo); densidad ±20 % (un cambio mixto de
grasa y masa magra tiene menos de 7.700 kcal/kg); nunca menos de ±150 kcal.

**Combinación por precisión** (cada fuente pesa 1/error²): observado + memoria
del ciclo anterior (escalada al peso de hoy con el cociente de la fórmula, +30
kcal de error por mes de antigüedad, +100 al pasar de déficit a no-déficit) +
fórmula (error 15 %). Con pocos datos manda la fórmula; con semanas de báscula,
lo observado.

**La memoria no lleva fórmula**: lo que se hereda entre ciclos es la parte que
sale de DATOS (`MaintenanceEstimate.memory`). Si se heredara la combinación
entera, la fórmula contaría dos, tres, cuatro veces a lo largo de los ciclos.

**Persistencia** (`EnergyEstimate`): leer nunca escribe; la estimación se
congela cuando la persona decide algo con ella delante: al cerrar un ciclo
(`CYCLE_CLOSE`, que es la memoria del siguiente), al empezar uno (`CYCLE_START`)
y al responder a un ajuste (`ADJUSTMENT`). `/progress/cycles` enseña la serie.

## 4. Motor adaptativo (`core/nutrition/calorie-adjustment.ts` → v2)

Despacha por **tipo** de objetivo. La **definición conserva R0–R8 sin cambios**
(más R2 de adherencia cuando hay registro suficiente). Ganancia, mantenimiento y
recomposición usan `adaptive-calories.ts`, pensado para fases de meses o años:

| Mecanismo        | Valor                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tendencia        | Medias semanales (anula el pico del lunes) con el margen más ancho de: mínimos cuadrados × corrección AR(1), jackknife por semanas y un suelo físico (una media semanal nunca es más precisa que 0,25 kg) — `core/body/weekly-trend.ts`.                     |
| Ventanas         | 84 → 70 → 56 → 42 → 28 → 21 días, desde `max(inicio + estabilización, último cambio + 7 días)`: largas para distinguir +0,10 %/sem de 0, y sin mezclar nunca dos objetivos calóricos. Una lectura reciente (42 → 28 días) detecta antes los desvíos fuertes. |
| Banda (ganancia) | ±50 % del objetivo, nunca menos de ±0,05 %/sem. Dentro: "vas al ritmo".                                                                                                                                                                                      |
| Confirmación     | El margen entero del mismo lado del objetivo, y la lectura de hace 14 días diciendo lo mismo (7 si el desvío es fuerte: ganancia > 2× objetivo o perder peso en un volumen).                                                                                 |
| Paso             | min(60 % del desvío, parte cierta del desvío) acotado a 50–150 kcal, solo de carbohidratos.                                                                                                                                                                  |
| Antioscilación   | ≥ 28 días entre cambios; durante 91 días tras un cambio, ir en sentido contrario exige 1,5× el desvío.                                                                                                                                                       |
| Adherencia (R2)  | Con registro suficiente, si lo comido se aparta > 10 % del objetivo en la dirección que explica el desvío, no se toca el objetivo.                                                                                                                           |
| Mantenimiento    | Banda ±1 % sobre el peso de la primera semana; fuera dos lecturas seguidas y sin volver → paso hacia el centro (spec §10).                                                                                                                                   |
| Recomposición    | Sube > 0,25 %/sem sin bajar cintura → −100; baja > 0,35 %/sem y el rendimiento cae → +100 (spec §10).                                                                                                                                                        |

**Aviso de composición** (`core/cycles/composition.ts`, solo ganancia): cruza
cintura por encima de su error, ritmo confirmado por encima del objetivo, % graso
subiendo entre lecturas comparables, % graso por encima de la preferencia de la
persona (una lectura estimada pesa la mitad: nunca es un límite rígido) y
rendimiento cayendo. Con varias señales sugiere revisar la fase (bajar el ritmo,
mantenimiento, minidefinición); nunca cierra nada. No calcula "músculo ganado".

## 5. Continuidad del entrenamiento

Cambiar de ciclo no toca el programa, las plantillas, las marcas ni la
progresión por variante. El contador de volumen ya usaba el objetivo activo; la
restauración del plan inicial (`restoreInitialProgram`) ahora también (antes
usaba la estrategia del onboarding). Sin ciclo activo, ambos usan mantenimiento.

## 6. Validación

- Unitarios: estimador (ejemplo de la spec, registro vs. objetivo, incompletos,
  datos insuficientes, glucógeno, memoria entre ciclos), políticas adaptativas
  (ritmos de 0,10 %, agua ±1 kg, estabilización post-definición, confirmación,
  enfriamientos, antioscilación, adherencia, mantenimiento, recomposición,
  suelo), plan, resumen, rendimiento, composición.
- Simulaciones longitudinales (`core/cycles/longitudinal.sim.test.ts`): cuerpo
  simulado que NO comparte los supuestos del motor (densidad real de 5.500
  kcal/kg, agua AR(1) con picos de fin de semana, deriva estacional del gasto,
  ruido de ingesta), 6/12/24 meses, aceptando cada propuesta. Ver el informe de
  la entrega para los números.
- Integración contra Postgres (`tests/integration/cycle-flow.test.ts`): el flujo
  completo de la spec más doble envío, petición obsoleta, carrera de dos envíos,
  aislamiento entre usuarios, índice parcial y usuarios antiguos.
- E2E (`tests/e2e/body-progress.spec.ts`): finalizar → volumen limpio → confirmar.

## 7. Limitaciones conocidas

- **La definición (v1) usa la regresión diaria** y su intervalo ignora la
  autocorrelación: en la simulación multiciclo propone recortes por ruido. No se
  ha cambiado aquí porque es un motor aceptado y en uso; portarlo a la tendencia
  semanal lo haría bastante más lento. Revisión pendiente, aparte.
- 7.700 kcal/kg es la densidad de la grasa; la de una ganancia mixta es menor.
  El bucle lo corrige (y el paso amortiguado lo absorbe), pero el superávit
  inicial de un volumen puede quedarse algo alto.
- La adaptación metabólica tras una definición no se modela: se refleja como
  más incertidumbre en la memoria, y los datos del ciclo nuevo la corrigen.
- `PersonalEvent` (viajes, enfermedad) sigue sin consumirse: la retención por
  eventos (R4b) no existe.
- El rendimiento en el resumen compara e1RM por variante; no ajusta por cambios
  de rango de repeticiones.

## 8. Despliegue y marcha atrás

La migración es aditiva: el código anterior funciona contra el schema nuevo, así
que la marcha atrás es volver a desplegar el commit anterior (Vercel → Instant
Rollback, o `git revert` + push) sin tocar la base. Si alguna vez hiciera falta
deshacer el schema (no es necesario para volver atrás):

```sql
DROP INDEX IF EXISTS "Goal_one_active_per_profile";
DROP TABLE IF EXISTS "EnergyEstimate";
-- Las columnas nuevas de "Goal" pueden quedarse: son anulables y el código
-- anterior no las lee. Quitarlas borraría resúmenes congelados.
```
