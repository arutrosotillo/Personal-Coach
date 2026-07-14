# Arquitectura

## Stack

Next.js 16 (App Router) · TypeScript estricto · Tailwind CSS 4 · shadcn/ui · Prisma 7 + SQLite · Zod 4 · React Hook Form · Vitest · Playwright · pnpm. Futuro (fases 5–7): Recharts, Serwist (PWA), TanStack Query (solo pantalla de ejecución).

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

Reglas: `core` no importa de ninguna otra capa (ni next, ni react, ni prisma, ni fs); `services` importa `core` + `repositories`; `actions` importa `services` + `core/schemas`; la UI importa `actions` y tipos de `core`, nunca repositorios ni `db.ts`. En Fase 6 se añade `src/ai/` (solo servidor): puede leer tipos/salidas de `core`, pero `core` jamás importa de `ai`.

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

## Estrategia offline (honesta)

El servidor corre en la máquina del usuario, así que "sin Internet" funciona por diseño. El caso real es el móvil en el gimnasio: `next start -H 0.0.0.0` + PWA vía IP de LAN (F7). Fuera de la LAN no funciona — limitación documentada del MVP (Tailscale como solución futura sin código). Escrituras del logging (F2): mutación optimista + reintentos + buffer efímero en localStorage; sin outbox compleja.

## Migración futura a Postgres/Vercel — qué se evita hoy

1. Sin SQL crudo específico de SQLite; agregados complejos en `core` sobre filas leídas o `groupBy` de Prisma.
2. Enums como `String` + Zod (promovibles a enums nativos en Postgres).
3. IDs `cuid()` portables.
4. Fotos tras interfaz `PhotoStorage` (filesystem hoy, blob storage mañana) — F4.
5. `src/server/db.ts` único punto de conexión; cambiar provider = 1 línea + baseline de migraciones.
6. Columnas `Json` (preferencias, snapshots de decisiones, contraindicaciones) se almacenan como TEXT en SQLite: la migración a Postgres requiere cast `TEXT→jsonb` explícito, y cualquier filtrado por contenido JSON se hace hoy en memoria en `core` (nunca con operadores JSON de SQL).

## Decisiones registradas (ADR abreviado)

| # | Decisión | Motivo |
|---|---|---|
| 1 | Server Actions para mutaciones; route handlers solo para binarios (fotos, export) | Un usuario, sin API pública; tipado end-to-end sin boilerplate |
| 2 | RSC + revalidate en casi toda la app; TanStack Query solo en ejecución de entrenamiento (F2) | Un solo sistema de caché salvo donde el optimismo es imprescindible |
| 3 | Prisma 7: `prisma.config.ts` + client generado en `src/generated/prisma` (excluido de git) | Convención actual de Prisma 7; el generator `prisma-client` ya no escribe en node_modules |
| 4 | **Tablas de IA pospuestas a la migración de F6** | No tocan entidades centrales (solo `AIMessage→AIConversation` entre sí y `profileId` como referencia); crear 6 tablas vacías hoy sería complejidad especulativa. Revisado y decidido en F1 |
| 5 | `PersonalEvent` sí se crea en F1 | Lo consumen los motores deterministas (anomalías D0, espera R4b) desde F3–F4 |
| 6 | Playwright con DB separada (`data/e2e.db`) y perfil móvil Pixel 7 | E2E reproducible sin tocar datos reales; la app es mobile-first |
| 7 | Dark mode único en v1 | Uso en gimnasio; dos temas duplican QA visual sin beneficio para un usuario |
| 8 | Package `personal-coach` (el directorio `Personal-Coach` no es nombre npm válido) | Restricción de npm sobre mayúsculas |

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
