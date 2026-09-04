# Arquitectura

## Stack

Next.js 16 (App Router) · TypeScript estricto · Tailwind CSS 4 · shadcn/ui · Prisma 7 + PostgreSQL (Neon) · Zod 4 · React Hook Form · Vitest · Playwright · pnpm. Futuro (fases 5–7): Recharts. Sin librería de estado ni de fetching en cliente: la capa offline de la sesión de entrenamiento es propia y cabe en `src/lib/offline/` (ver ADR #2).

Explícitamente evitado: microservicios, Redux, GraphQL, event sourcing, buses de eventos, login en MVP, analítica de terceros, dependencias sin consumidor real.

## Capas y regla de dependencias

```
┌──────────────────────────────────────────────────────────┐
│ UI — src/app/**, src/components/**                       │  presentación y formularios
├──────────────────────────────────────────────────────────┤
│ Boundary — src/server/actions/** ("use server")          │  parse Zod → service → revalidate
├──────────────────────────────────────────────────────────┤
│ Aplicación — src/server/services/**                      │  lee repos → motor puro → persiste
├──────────────────────────────────────────────────────────┤
│ Dominio puro — src/core/**                               │  motores, cálculos, schemas, enums
├──────────────────────────────────────────────────────────┤
│ Persistencia — src/server/db.ts, src/server/repositories │  único lugar con @prisma/client
└──────────────────────────────────────────────────────────┘
```

Reglas: `core` no importa de ninguna otra capa (ni next, ni react, ni prisma, ni fs); `services` importa `core` + `repositories`; `actions` importa `services` + `core/schemas`. Las **mutaciones** de la UI van siempre por server actions → services (nunca la UI escribe en la DB). Las **lecturas** de los Server Components pueden llamar a funciones de `repositories` directamente (patrón idiomático de RSC; evita una capa de servicio ceremonial sin lógica); lo que la UI **nunca** hace es importar `db.ts`/`prisma` ni construir queries a mano. En Fase 6 se añade `src/ai/` (solo servidor): puede leer tipos/salidas de `core`, pero `core` jamás importa de `ai`.

## Motores puros deterministas

Cinco motores en `src/core/engines/`: **training**, **nutrition**, **recovery**, **safety**, **recommendation** (los tres últimos operativos a partir de F3–F5). Contrato:

- Firma `evaluate(input, config) → output`. Todo lo necesario entra por parámetro, incluida la fecha "hoy" como `localDate`. Prohibido `Date.now()`, `Math.random()`, env, I/O.
- Salida con `reasonCode` estable (catálogo por motor), explicación humana no vacía, y confianza `LOW|MEDIUM|HIGH`.
- Cada motor exporta su versión (`TRAINING_ENGINE_VERSION`); cambiar comportamiento obliga a subir versión.
- Trazabilidad (desde F5): el servicio persiste `Recommendation` + `AlgorithmDecision` (snapshot JSON de inputs, ruleId, versión) en una única transacción.
- Precedencia ante conflicto: **salud > deload > calorías > carga > volumen** (las suprimidas se persisten con motivo).

## Validación

Un solo schema Zod por operación, en `src/core/schemas/`. Se usa dos veces: en el cliente (`zodResolver` de RHF, UX inmediata) y SIEMPRE de nuevo en la server action (frontera de confianza). Prohibido definir schemas inline en componentes.

## Fechas y unidades

- Timestamps `DateTime` (UTC, `@default(now())`) solo para auditoría/eventos.
- Días del usuario: `String` `YYYY-MM-DD` (`localDate`), calculados exclusivamente en `src/core/dates.ts` con la timezone del perfil (`Europe/Madrid` por defecto). Registrar a las 00:30 cuenta para el día correcto según la zona.
- DB siempre en métrico (kg/cm/kcal). Imperial solo en presentación (F futura), conversión y redondeo a incrementos una única vez.

## Estrategia offline

La app está desplegada en Vercel, así que el gimnasio con mala cobertura es el caso real, no uno hipotético. **Solo la sesión de entrenamiento activa es local-first**; el resto de la app necesita servidor y así se queda.

Durante una sesión, lo que el usuario ve en pantalla no depende de que ninguna escritura haya llegado:

- **Snapshot local** (`localStorage`, síncrono para sobrevivir a que iOS mate la PWA) con las filas, el ejercicio actual y el descanso. Es lo que permite recargar.
- **Outbox coalescente por clave** (`SET:<ejercicio>:<nº>`, `PLANNED:<ejercicio>`, `NOTE:<variante>`, `FINISH`). No es un log de eventos porque no hace falta: las mutaciones de una sesión son absolutas e idempotentes, así que una operación pendiente queda descrita por su último payload.
- **Un lote por viaje** (`syncWorkoutOpsAction`), aplicado en orden y parándose en el primer fallo. La conectividad se deduce de que el servidor responda, nunca de `navigator.onLine`.
- **Conflictos**: si el servidor tiene confirmada una serie y no hay nada pendiente sobre ella, manda el servidor; en cualquier otro caso, manda lo local. Un dato pendiente no lo pisa nadie.
- **Idempotencia**: `logSet` es un upsert por `(workoutExerciseId, setNumber)`, `setPlannedSets` escribe un valor absoluto, `saveExerciseNote` es un upsert por `(perfil, variante)` que manda el texto completo (vacío = borrar), y el cierre lleva `WorkoutSession.finishToken`, generado por el cliente y repetido en cada reintento.
- **Notas de ejercicio**: van por la misma cola desde la SESIÓN (donde se leen y se escriben, en el gimnasio). Se guardan en `localStorage` al instante y sin `startTransition` —una transición es baja prioridad y podía diferir la escritura más allá de que iOS matara la app— y viajan al servidor cuando haya cobertura. Guardar una nota NO exige que la sesión siga en curso: la nota es del banco de ejercicios, así que un lote que llegue después del cierre la aplica igual. Desde la BIBLIOTECA se guardan online y punto: esa pantalla sin cobertura no carga.
- **Service worker** (`public/sw.js`, escrito a mano) solo para poder recargar o reabrir la app sin cobertura: cache-first de `/_next/static`, network-first del documento de `/train` y `/train/session/<id>`, y nada más. Se borra al cerrar sesión.

**Los objetivos de la próxima sesión están en `/train` antes de empezarla.** `previewTemplateSession` construye la sesión que saldría de una plantilla sin crearla, y `/train` imprime peso, repeticiones y RIR de cada ejercicio. Como el service worker cachea ese documento, entrar al gimnasio sin cobertura y saber qué toca ya no depende de la red. La prescripción sigue calculándose al vuelo y sin persistirse: no hay dos fuentes de verdad que puedan divergir, y el test de integración comprueba que lo que se ve antes de empezar es lo mismo que sale al empezar.

Sigue necesitando conexión: empezar una sesión, sustituir un ejercicio y descartarla (las dos últimas borran `SetLog` sin vuelta atrás).

El servidor no se relaja en nada: cada operación del lote vuelve a pasar por los mismos servicios y las mismas cláusulas `where` que la ruta online. Lo que el cliente guardó en el móvil es una petición, no una autorización.

## Migración futura a Postgres/Vercel — qué se evita hoy

1. Sin SQL crudo salvo la introspección de índices en tests; agregados complejos en `core` sobre filas leídas o `groupBy` de Prisma.
2. Enums como `String` + Zod (promovibles a enums nativos en Postgres).
3. IDs `cuid()` portables.
4. Fotos tras interfaz `PhotoStorage` (filesystem hoy, blob storage mañana) — F4.
5. `src/server/db.ts` único punto de conexión; cambiar provider = 1 línea + baseline de migraciones.
6. Columnas `Json` (preferencias, snapshots de decisiones, contraindicaciones) son `jsonb`. El filtrado por contenido JSON se hace en memoria en `core`, nunca con operadores JSON de SQL: mantiene la lógica en el dominio y el motor testeable sin base de datos.

## Decisiones registradas (ADR abreviado)

| #   | Decisión                                                                                                                                  | Motivo                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Server Actions para mutaciones; route handlers solo para binarios (fotos, export)                                                         | Un usuario, sin API pública; tipado end-to-end sin boilerplate                                                                                                                                                                                                   |
| 2   | RSC + revalidate en casi toda la app; en la ejecución de entrenamiento, capa local-first propia (`src/lib/offline/`) sin librería externa | Un solo sistema de caché salvo donde el optimismo es imprescindible. TanStack Query se descartó al implementarlo: el problema real no era cachear lecturas sino no perder escrituras sin cobertura, y eso pedía un snapshot y una outbox, no un cliente de datos |
| 3   | Prisma 7: `prisma.config.ts` + client generado en `src/generated/prisma` (excluido de git)                                                | Convención actual de Prisma 7; el generator `prisma-client` ya no escribe en node_modules                                                                                                                                                                        |
| 4   | **Tablas de IA pospuestas a la migración de F6**                                                                                          | No tocan entidades centrales (solo `AIMessage→AIConversation` entre sí y `profileId` como referencia); crear 6 tablas vacías hoy sería complejidad especulativa. Revisado y decidido en F1                                                                       |
| 5   | `PersonalEvent` sí se crea en F1                                                                                                          | Lo consumen los motores deterministas (anomalías D0, espera R4b) desde F3–F4                                                                                                                                                                                     |
| 6   | Playwright con DB separada (`data/e2e.db`) y perfil móvil Pixel 7                                                                         | E2E reproducible sin tocar datos reales; la app es mobile-first                                                                                                                                                                                                  |
| 7   | Dark mode único en v1                                                                                                                     | Uso en gimnasio; dos temas duplican QA visual sin beneficio para un usuario                                                                                                                                                                                      |
| 8   | Package `personal-coach` (el directorio `Personal-Coach` no es nombre npm válido)                                                         | Restricción de npm sobre mayúsculas                                                                                                                                                                                                                              |

## Estructura de carpetas (estado F1; las marcadas ⏳ llegan en fases posteriores)

```
prisma/            schema.prisma, migrations/, seed/
data/              ⚠ gitignored: app.db, e2e.db, photos/ (F4)
docs/              especificaciones (este directorio)
src/
├── app/           layout, (dashboard), onboarding/, program/, settings/
├── components/    ui/ (shadcn), onboarding/, layout/
├── core/          enums.ts, dates.ts, types.ts, config/, schemas/, program/ (generador inicial)
│   └── engines/   ⏳ training/ nutrition/ recovery/ safety/ recommendation/ (F3–F5)
├── server/        db.ts, repositories/, services/, actions/
└── ai/            ⏳ F6
tests/
├── integration/   server actions + Prisma sobre DB temporal
└── e2e/           Playwright + global-setup (migra y siembra data/e2e.db)
```
