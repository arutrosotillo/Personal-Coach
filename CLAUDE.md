<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Personal Coach

App personal (un único usuario, sin login, sin SaaS) de entrenamiento de hipertrofia, nutrición y seguimiento corporal. Local-first: Next.js + SQLite en la máquina del usuario, accesible desde el móvil vía LAN como PWA (fase futura).

## Comandos

```bash
pnpm dev                # desarrollo (http://localhost:3000)
pnpm build && pnpm start
pnpm lint               # ESLint
pnpm typecheck          # tsc --noEmit
pnpm test               # Vitest (unit + integration)
pnpm test:e2e           # Playwright (perfil móvil, DB e2e separada)
pnpm db:generate        # prisma generate
pnpm db:migrate         # prisma migrate dev
pnpm db:seed            # seed idempotente (catálogo)
pnpm check              # lint + typecheck + test + build
```

## Arquitectura (regla de dependencias)

```
app/, components/  →  server/actions/  →  server/services/  →  core/  +  server/repositories/ → server/db.ts
```

- `src/core/` — **dominio puro determinista**. Prohibido importar next/react/prisma/fs y usar `Date.now()`/`Math.random()`: la fecha entra siempre como parámetro. Los motores son funciones `(input, config) → output` con explicación y `reasonCode`.
- `src/server/` — I/O: Prisma (solo en `db.ts` + repositorios), services (orquestan motor + persistencia), actions (`"use server"`: validar Zod → service → revalidate).
- `src/ai/` — (Fase 6, no existe aún) capa Coach AI, solo servidor. `core` JAMÁS importa de `ai`.
- UI sin lógica de dominio. Mutaciones vía server actions → services. Lecturas de Server Components: pueden llamar a `repositories`, pero nunca importan `db.ts`/`prisma` ni escriben queries a mano.

## Convenciones duraderas

- **DB siempre métrica** (kg/cm/kcal). Conversión imperial solo en presentación.
- **Fechas**: timestamps `DateTime` (UTC) para auditoría; días del usuario como `String` `YYYY-MM-DD` (`localDate`) calculados SOLO en `src/core/dates.ts`. Los motores operan sobre `localDate`.
- **Enums**: SQLite no tiene enums → columnas `String` validadas por Zod. Fuente de verdad: `src/core/enums.ts`.
- **Umbrales y defaults de motores**: solo en `src/core/config/`, nunca hardcodeados en la lógica.
- **Trazabilidad**: toda `Recommendation` nace 1:1 de una `AlgorithmDecision` (inputs serializados + ruleId + versión del motor) en la misma transacción.
- **Toda recomendación explica su porqué** con los números usados; confianza en 3 niveles (nunca porcentajes).
- **Nunca ajustar por un dato aislado**: siempre tendencias/mínimos de muestras.
- Tests: doble aserción (valor numérico + explicación/reasonCode).
- UI en español, es-ES, dark mode único, mobile-first. Tono del coach: ver `docs/COACH_PHILOSOPHY.md`.
- Sin `any` (excepción puntual documentada). No desactivar reglas para que pasen los checks.

## Decisiones registradas (no re-litigar sin causa técnica real)

1. Plan aprobado: `docs/IMPLEMENTATION_PLAN.md` (fases 0–7). Estado actual: F0+F1 completadas.
2. **Tablas de Coach AI pospuestas a la migración de Fase 6** (no tocan entidades centrales; ver docs/DATA_MODEL.md). `PersonalEvent` SÍ existe desde F1 (lo consumen los motores).
3. Los motores deterministas son la ÚNICA fuente de números (kcal, cargas, volumen…). Coach AI (F6) solo interpreta.
4. Suelos de seguridad: kcal ≥ max(BMR×0.9, 1500 H / 1200 M) — inviolable.
5. Registro de comidas por totales + plantillas; sin base de datos de alimentos.
6. pnpm; Prisma 7 (config en `prisma.config.ts`, client generado en `src/generated/prisma`); Zod 4; shadcn/ui (base-ui); Tailwind 4.
7. `data/` (DB, fotos) y `exports/` NUNCA en git.

## Documentación

`docs/` contiene la especificación completa: PRODUCT_SPEC, ARCHITECTURE, DATA_MODEL, TRAINING_ENGINE, NUTRITION_ENGINE, RECOVERY_ENGINE, TEST_PLAN, IMPLEMENTATION_PLAN, AI_COACH, AI_PRIVACY, AI_EVALUATION, COACH_PHILOSOPHY. Ante duda de comportamiento de un motor, la spec del doc correspondiente manda.
