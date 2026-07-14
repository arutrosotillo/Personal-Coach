# Plan de implementación

Fases pequeñas y verificables. Regla: la app es completamente utilizable al final de F5, sin depender de la IA (F6).

## Estado

- ✅ **F0 — Documentación** (este directorio).
- ✅ **F1 — Scaffold, DB, catálogo, onboarding** (esta ejecución).
- ⬜ F2 → F7 pendientes.

## F0 — Documentación

12 documentos en `docs/` + `CLAUDE.md` con decisiones duraderas. Aceptación: specs consistentes entre sí, sin contradicciones con el plan aprobado.

## F1 — Scaffold, base de datos, catálogo y onboarding

- Next.js 16 + TS estricto + Tailwind 4 + shadcn/ui + Prisma 7/SQLite + Zod + RHF + Vitest + Playwright + Prettier; scripts `dev/build/lint/typecheck/test/test:e2e/db:*/check`.
- Schema completo de entidades centrales (sin tablas de IA — decisión en DATA_MODEL.md), migración inicial, seed idempotente (16 grupos, ~50 ejercicios con variantes y contribuciones).
- Onboarding de 8 pasos con validación Zod cliente+servidor y creación transaccional (perfil, objetivo, preferencias, target nutricional inicial, programa inicial con su `AlgorithmDecision`).
- Generador de programa inicial determinista en `src/core/program/` (reglas simples: 3d full body, 4d torso/pierna, 5d T/P+especialización, 6d PPL×2; sesgo moderado Tier A; respeta equipamiento/tiempo/exclusiones/molestias).
- UI: layout mobile-first dark, bottom nav, dashboard (estados pendiente/completado), página de programa, ajustes básicos; futuras funciones marcadas sin botones muertos.
- Tests de F1 (TEST_PLAN.md §F1) + 1 E2E.

**Aceptación**: `pnpm check` verde; migración desde cero; seed ×2 idempotente; E2E onboarding→dashboard→persistencia verde. **Fuera**: registro de entrenos, motores, IA, PWA, export, gráficas.

## F2 — Entrenamientos y registro de series

Biblioteca con filtros y ficha; programa editable; pantalla de ejecución (<3 s/serie: filas pre-rellenadas, steppers con `loadStepKg`, RIR chips, completar=1 tap + temporizador con vibración, optimistic UI + TanStack Query, autosave/reanudar); feedback post-sesión (3 chips + 2 opcionales); historial. Aceptación: E2E de sesión completa; sesión interrumpida recuperable.

## F3 — Motores de entrenamiento y recuperación

e1RM, anomalías, progresión D0–D10 (TDD con los 12 casos), volumen fraccional, **Recovery Engine**, deload por score, mesociclos con transición. Aceptación: 12 casos + property de incrementos verdes; recomendación visible en sesión con su porqué.

## F4 — Nutrición y seguimiento corporal

TDEE dinámico, macros, EMA + tendencia, adherencia por componentes, ajuste R0–R8 (TDD con T1–T11), Safety Engine, check-ins diario/semanal, pantalla de nutrición (totales+plantillas), medidas, fotos con guía de captura y comparador. Aceptación: T1–T11 + property del suelo calórico verdes.

## F5 — Dashboard, recomendaciones y calendario

Dashboard completo, 7 gráficas con marcadores de eventos, panel de adherencia, calendario, UI de PersonalEvents, pantalla de recomendaciones (aceptar/editar/rechazar, precedencia y supresión persistida), golden files de los 10 perfiles sintéticos. Aceptación: golden verdes; E2E weekly-review. **Hito: app completamente utilizable sin IA.**

## F6 — Coach AI

Proveedor abstracto (OpenAI + Fake + stub Ollama), migración de las 6 tablas de IA, context builder + packs + intención, 13 tools read-only, chat UI, resumen semanal cacheado por contextHash, análisis mensual bajo demanda, memoria gestionable, presupuesto/límites/bloqueos, consentimiento + "Datos que se enviarán", filtros pre/post, suite completa de tests de IA (sin API real). El modelo concreto se elige al empezar esta fase consultando documentación y precios vigentes. Aceptación: banco de AI_EVALUATION.md respondido con Fake; regresión completa con `AI_ENABLED=false`.

## F7 — PWA, exportación y QA final

Serwist, wake lock/vibración/notificación de descanso, export JSON/CSV + import + borrado total (incluye datos de IA), test no-external-requests + cabeceras, accesibilidad (contraste, targets, reduced-motion, safe-areas, font ≥16 px), README de operación (arranque, ubicación DB, backups, acceso LAN), datos demo (`SEED_DEMO=1`). Aceptación: `pnpm check` + `pnpm test:e2e` completos verdes; instalable como PWA desde el móvil en LAN.

## Riesgos principales

Ver ARCHITECTURE.md (técnicos) y COACH_PHILOSOPHY.md §7 (científicos). Los tres que vigilar por fase: F2 — pulir la ejecución consume más de lo previsto (es EL criterio de calidad); F3/F4 — deriva de umbrales fuera de `core/config` (revisión en PR); F6 — coste/precios del proveedor (tabla en config, bloqueos duros).
