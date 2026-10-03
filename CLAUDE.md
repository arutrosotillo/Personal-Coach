<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Personal Coach

App personal multi-usuario ligera (cuentas creadas a mano, sin registro público, sin SaaS) de entrenamiento de hipertrofia, nutrición y seguimiento corporal. Next.js + PostgreSQL, desplegada en la nube y usada desde el iPhone como PWA. Un usuario = un perfil (relación 1:1). `completeOnboarding` reutiliza el perfil DE ESE usuario.

## Comandos

```bash
pnpm dev                # desarrollo (http://localhost:3000)
pnpm build && pnpm start
pnpm lint               # ESLint
pnpm typecheck          # tsc --noEmit
pnpm test               # Vitest (unit + integration; necesita Postgres local)
pnpm test:e2e           # Playwright (perfil móvil, DB e2e Postgres separada)
pnpm db:test:clean      # borra bases de test huérfanas del Postgres local
pnpm user:create        # crear cuenta (list / password / disable / enable / rename)
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

1. Plan aprobado: `docs/IMPLEMENTATION_PLAN.md` (fases 0–7). Estado: F0–F2 completas; F3.1/3.1b (programa manual + reactivación); F3.2 (volumen efectivo); **F3.2b/3.2c** (motor de progresión v2 + integridad del RIR, ver `docs/TRAINING_ENGINE_FINAL_AUDIT.md`); **F3.3** (recencia, fatiga y deload reactivo, siempre advisory); **Coach AI v1** y **sección Ciencia** (`/science`); **ajuste calórico solo-báscula** (adelanto de F4 §5, propone y el usuario acepta; ver `docs/NUTRITION_ENGINE.md` §5.1). Aplazado: F3.4 (`ADD_SET`/`REMOVE_SET` a límite de mesociclo), resto de F4, F5, F7.

   - **La sesión de entrenamiento activa es local-first.** Durante una sesión, cada cambio se guarda en `localStorage` al instante y una outbox coalescente (`src/lib/offline/`) lo sincroniza con un solo lote (`syncWorkoutOpsAction`) cuando el servidor responde — nunca según `navigator.onLine`. Regla de conflictos: si el servidor tiene confirmada una serie y no hay nada pendiente sobre ella manda el servidor; en cualquier otro caso manda lo local. Un fallo de red JAMÁS descarta una operación. Se puede registrar, corregir, ANOTAR y finalizar sin cobertura; empezar sesión, sustituir ejercicio y descartar siguen necesitando conexión. Nada local-first va dentro de `startTransition`: es baja prioridad y difiere la escritura del cuaderno. `previewTemplateSession` deja los objetivos del próximo entrenamiento impresos en `/train` antes de empezarlo, así que la prescripción tampoco depende de la red. `public/sw.js` cachea solo el shell de `/train` y `/train/session/<id>`. Ver `docs/ARCHITECTURE.md` § Estrategia offline.
   - **El catálogo se despliega solo.** `vercel-build` ejecuta el seed después de `prisma migrate deploy`, así que nunca hay código nuevo sobre catálogo viejo. El seed es DIFERENCIAL: lee y solo escribe lo que cambia (`Filas escritas: 0` en un despliegue que no toca el catálogo). Los ejercicios nuevos se declaran en `src/core/catalog/exercises-expansion.ts` con los constructores de `exercise-builders.ts`; los 45 originales no se tocan. Renombrar un ejercicio del catálogo exige una migración de datos: `Exercise.name` es la clave natural del seed y sin renombrar la fila existente el seed crearía un duplicado y dejaría el historial huérfano.
   - **La identidad de un ejercicio es la VARIANTE, no el `Exercise`.** El historial, el e1RM, la progresión, las mesetas y el volumen efectivo ya colgaban de `exerciseVariantId`; desde F3.2d también las NOTAS personales y el RIR objetivo por defecto. `Exercise` (patrón + fatiga sistémica) describe el movimiento; `ExerciseVariant` (material + `stability`) describe lo que de verdad haces, y es ahí donde viven la estabilidad, el riesgo al fallo y las señales de montaje.
   - **El motor determinista es la única autoridad.** Coach AI (`src/ai/`) es READ-ONLY: interpreta y explica lo que los motores ya decidieron. No puede modificar programa, series, cargas, RIR, volumen ni deload; los guardrails bloquean cualquier respuesta que invente una cifra o contradiga al motor. Sin `OPENAI_API_KEY` la app funciona entera.
   - **`/science` y los prompts leen de `src/core/science/`**, fuente única de filosofía, explicación de reasonCodes y bibliografía. Cada regla lleva etiqueta de evidencia (fuerte / razonable / heurística) y ninguna heurística se presenta como ciencia. Las referencias solo se muestran si su DOI/PMID está verificado.

2. **Tablas de persistencia de Coach AI pospuestas** (la v1 no persiste nada: las respuestas son efímeras; ver docs/DATA_MODEL.md). `PersonalEvent` existe en el schema y su enum en `core/enums.ts` desde F1, pero **hoy no lo escribe, lee ni consume ningún motor**: la tabla está vacía y no hay UI. Su consumo (D0, R4b) está especificado, no implementado.
3. Los motores deterministas son la ÚNICA fuente de números (kcal, cargas, volumen…). Coach AI solo interpreta.
4. Suelos de seguridad: kcal ≥ max(BMR×0.9, 1500 H / 1200 M) — inviolable.
5. Registro de comidas por totales + plantillas; sin base de datos de alimentos.
6. pnpm; Prisma 7 (config en `prisma.config.ts`, client generado en `src/generated/prisma`); Zod 4; shadcn/ui (base-ui); Tailwind 4.
7. `data/` (fotos) y `exports/` NUNCA en git. La DB es PostgreSQL: local en desarrollo, Neon en producción; `DATABASE_URL` solo server-side.
8. Los tests de integración y E2E crean y DESTRUYEN bases de datos. Sus helpers solo aceptan hosts locales a propósito: nunca apuntes `TEST_DATABASE_URL` a Neon.

## Documentación

`docs/` contiene la especificación completa: PRODUCT_SPEC, ARCHITECTURE, DATA_MODEL, TRAINING_ENGINE, NUTRITION_ENGINE, RECOVERY_ENGINE, TEST_PLAN, IMPLEMENTATION_PLAN, AI_COACH, AI_PRIVACY, AI_EVALUATION, COACH_PHILOSOPHY. Ante duda de comportamiento de un motor, la spec del doc correspondiente manda.
