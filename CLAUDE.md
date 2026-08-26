<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Personal Coach

App personal (un único usuario, sin registro, sin SaaS) de entrenamiento de hipertrofia, nutrición y seguimiento corporal. Next.js + PostgreSQL, desplegada en la nube y usada desde el iPhone como PWA. Un solo perfil: `completeOnboarding` reutiliza siempre el existente.

## Comandos

```bash
pnpm dev                # desarrollo (http://localhost:3000)
pnpm build && pnpm start
pnpm lint               # ESLint
pnpm typecheck          # tsc --noEmit
pnpm test               # Vitest (unit + integration; necesita Postgres local)
pnpm test:e2e           # Playwright (perfil móvil, DB e2e Postgres separada)
pnpm db:test:clean      # borra bases de test huérfanas del Postgres local
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
- **Enums**: no se usan enums nativos de la base de datos → columnas `String` validadas por Zod, para que cambiarlos no exija migración. Fuente de verdad: `src/core/enums.ts`.
- **Umbrales y defaults de motores**: solo en `src/core/config/`, nunca hardcodeados en la lógica.
- **Trazabilidad**: toda `Recommendation` nace 1:1 de una `AlgorithmDecision` (inputs serializados + ruleId + versión del motor) en la misma transacción.
- **Toda recomendación explica su porqué** con los números usados; confianza en 3 niveles (nunca porcentajes).
- **Nunca ajustar por un dato aislado**: siempre tendencias/mínimos de muestras.
- Tests: doble aserción (valor numérico + explicación/reasonCode).
- UI en español, es-ES, dark mode único, mobile-first. Tono del coach: ver `docs/COACH_PHILOSOPHY.md`.
- Sin `any` (excepción puntual documentada). No desactivar reglas para que pasen los checks.

## Decisiones registradas (no re-litigar sin causa técnica real)

1. Plan aprobado: `docs/IMPLEMENTATION_PLAN.md` (fases 0–7). Estado: F0–F2 completas; F3.1/3.1b (programa manual + reactivación); F3.2 (volumen efectivo); **F3.2b/3.2c** (motor de progresión v2 + integridad del RIR, ver `docs/TRAINING_ENGINE_FINAL_AUDIT.md`); **F3.3** (recencia, fatiga y deload reactivo, siempre advisory); **Coach AI v1** y **sección Ciencia** (`/science`). Aplazado: F3.4 (`ADD_SET`/`REMOVE_SET` a límite de mesociclo), F4, F5, F7.

   - **El motor determinista es la única autoridad.** Coach AI (`src/ai/`) es READ-ONLY: interpreta y explica lo que los motores ya decidieron. No puede modificar programa, series, cargas, RIR, volumen ni deload; los guardrails bloquean cualquier respuesta que invente una cifra o contradiga al motor. Sin `OPENAI_API_KEY` la app funciona entera.
   - **`/science` y los prompts leen de `src/core/science/`**, fuente única de filosofía, explicación de reasonCodes y bibliografía. Cada regla lleva etiqueta de evidencia (fuerte / razonable / heurística) y ninguna heurística se presenta como ciencia. Las referencias solo se muestran si su DOI/PMID está verificado.

2. **Tablas de persistencia de Coach AI pospuestas** (la v1 no persiste nada: las respuestas son efímeras; ver docs/DATA_MODEL.md). `PersonalEvent` SÍ existe desde F1 (lo consumen los motores).
3. Los motores deterministas son la ÚNICA fuente de números (kcal, cargas, volumen…). Coach AI solo interpreta.
4. Suelos de seguridad: kcal ≥ max(BMR×0.9, 1500 H / 1200 M) — inviolable.
5. Registro de comidas por totales + plantillas; sin base de datos de alimentos.
6. pnpm; Prisma 7 (config en `prisma.config.ts`, client generado en `src/generated/prisma`); Zod 4; shadcn/ui (base-ui); Tailwind 4.
7. `data/` (fotos) y `exports/` NUNCA en git. La DB es PostgreSQL: local en desarrollo, Neon en producción; `DATABASE_URL` solo server-side.
8. Los tests de integración y E2E crean y DESTRUYEN bases de datos. Sus helpers solo aceptan hosts locales a propósito: nunca apuntes `TEST_DATABASE_URL` a Neon.

## Documentación

`docs/` contiene la especificación completa: PRODUCT_SPEC, ARCHITECTURE, DATA_MODEL, TRAINING_ENGINE, NUTRITION_ENGINE, RECOVERY_ENGINE, TEST_PLAN, IMPLEMENTATION_PLAN, AI_COACH, AI_PRIVACY, AI_EVALUATION, COACH_PHILOSOPHY. Ante duda de comportamiento de un motor, la spec del doc correspondiente manda.
