# Plan de testing

Principio: los motores son funciones puras `(inputs) → { valor, explicación, reasonCode, confianza }`. **Regla de doble aserción**: cada caso verifica el número Y la explicación (aserción estricta sobre `reasonCode`, laxa con `toMatch` sobre el texto).

## Pirámide

- **Unit (~70 %, Vitest)** — motores y cálculos, colocados junto al código (`src/**/*.test.ts`). Objetivo desde F3: ≥90 % líneas y ramas en `src/core/**` (en F1 se priorizan tests que protegen decisiones reales, sin perseguir cobertura arbitraria).
- **Integración (~20 %, Vitest, proyecto `integration`)** — server actions completas contra SQLite en archivo temporal por suite (no `:memory:`: Prisma abre varias conexiones). `tests/integration/helpers/test-db.ts` crea la DB, aplica migraciones y la borra.
- **E2E (~10 %, Playwright, perfil móvil Pixel 7)** — flujos felices en `tests/e2e/`, con `global-setup.ts` que migra y siembra `data/e2e.db`.

## Cobertura por fase

### F1 (actual)

- Unit: schemas Zod del onboarding (válidos/inválidos, límites), `core/dates.ts` (medianoche, DST Europe/Madrid, timezone del perfil), generador de programa inicial (división correcta por días 2–6, respeto de equipamiento, exclusiones y molestias, sesgo Tier A presente, piernas no ignoradas, presupuesto de tiempo, determinismo: mismo input → mismo output).
- Integración: seed idempotente (2 ejecuciones → mismos conteos, sin duplicados); onboarding transaccional (crea perfil+objetivo+preferencias+programa de una vez; input inválido → 0 escrituras; re-ejecutar onboarding no crea segundo perfil activo; datos incompletos válidos aceptados).
- E2E: usuario nuevo → onboarding completo → dashboard con objetivo y programa → recarga → persiste.

### F3–F5 (comprometido)

- Los 12 casos canónicos de progresión (TRAINING_ENGINE.md §2) y T1–T11 de ajuste calórico (NUTRITION_ENGINE.md §5) como suites de aceptación TDD.
- **10 perfiles sintéticos** deterministas (PRNG mulberry32, seed fija 20260714): principiante con progreso rápido · avanzado estancado · retención + whoosh · baja adherencia (verifica que NO recorta y la explicación menciona adherencia) · pérdida demasiado rápida (sube kcal + aviso) · fuerza↑ peso↓ (sin falsas alarmas) · mala recuperación (deload por fatiga antes que por rendimiento) · dolor articular repetido (congela progresión) · pocos pesajes (confianza degradada / INSUFFICIENT_DATA) · cambia-ejercicios (jamás compara historiales entre variantes).
- **Property-based (fast-check)**: |ΔkcaI| ≤ paso máximo · target ≥ suelo calórico SIEMPRE (la propiedad más importante de la suite) · cooldown respetado · carga recomendada alcanzable con los incrementos reales · media móvil acotada por min/max · explicación no vacía + inputs serializables y re-ejecutables (trazabilidad).
- **Golden files**: decisiones semanales completas de los 10 perfiles vs JSON versionado (`toMatchFileSnapshot`); cambiar comportamiento exige subir `ENGINE_VERSION` (test dedicado).

## Casos límite críticos (transversales)

- Fechas: pesaje 23:59 vs 00:01 (día local correcto), cambio DST marzo/octubre, timezone del perfil ≠ del sistema.
- Unidades: round-trip kg↔lb sin drift; redondeo a incremento una sola vez.
- Datos incompletos: semanas con 0–3 pesajes, series sin RIR → nunca NaN, nunca throw, siempre `INSUFFICIENT_DATA` o confianza degradada con explicación.
- Sesiones abortadas: series guardadas cuentan para volumen; sesión cuenta 0,5 para adherencia si ≥50 % de series.
- Incrementos no disponibles: salto >10 % → progresar por reps.
- Recomendaciones contradictorias: precedencia salud > deload > calorías > carga > volumen; las suprimidas se persisten con `suppressedBy`.
- Estancamiento falso por baja adherencia: la adherencia se evalúa SIEMPRE antes que el estancamiento.

## Seguridad y privacidad (F4–F7)

- Test `git check-ignore` sobre `data/app.db`, `data/photos/x.jpg`, `exports/backup.json`.
- E2E `no-external-requests`: falla ante cualquier request no-localhost (con IA off; el dominio del proveedor solo se permite en specs de IA con fake).
- Sanitización de nombres de foto (UUID, extensión allowlist, path confinado), EXIF eliminado.
- Export→wipe→import round-trip deep-equal; import corrupto → transacción abortada, DB intacta.
- Suelo calórico: unit + property — el sistema JAMÁS emite un target por debajo.

## Testing de IA (F6) — sin API real

`FakeCoachAIProvider` con fixtures válidas/inválidas/maliciosas/lentas. Tests de: schemas · context builder (packs correctos por intención, presupuesto de tokens, truncado de notas) · fuga de datos (el payload jamás contiene nombre/email/paths de fotos) · budget-guard (bloqueos; con `AI_ENABLED=false` cero llamadas) · caché por contextHash · falta de API key · fallo/timeout del proveedor · JSON inválido (1 retry + fallback) · filtro POST (respuesta que contradice guardrails → rechazada) · preguntas médicas → derivación · prompt injection en notas/eventos → no obedecida · conversaciones largas (resumen a los 12 mensajes) · borrado de memoria · read-only estricto del chat. Llamadas reales: `test:ai:live`, excluida de los quality gates.

## Quality gates

`pnpm check` = lint + typecheck + test (unit+integration) + build. E2E aparte (`pnpm test:e2e`). No se desactivan reglas ni se ignoran errores para pasar los checks.
