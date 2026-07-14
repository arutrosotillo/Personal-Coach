# Personal Coach

Aplicación **personal** (un único usuario, sin login, sin nube) de entrenamiento de hipertrofia, nutrición y seguimiento corporal. Local-first: todos los datos viven en tu ordenador.

Estado: **Fase 1** — onboarding, catálogo de ejercicios y programa inicial funcionando. Fases siguientes en `docs/IMPLEMENTATION_PLAN.md`.

## Requisitos

- Node.js ≥ 20 (probado con 24)
- pnpm ≥ 10

## Puesta en marcha

```bash
pnpm install
cp .env.example .env        # DATABASE_URL apunta a data/app.db
pnpm db:deploy              # aplica las migraciones (crea data/app.db)
pnpm db:seed                # catálogo: 16 grupos, 42 ejercicios (idempotente)
pnpm dev                    # http://localhost:3000
```

Producción local:

```bash
pnpm build
pnpm start                  # http://localhost:3000
```

## Uso desde el móvil (misma red Wi-Fi)

1. Arranca escuchando en la red local: `pnpm start -- -H 0.0.0.0`
2. Averigua la IP del ordenador: `ipconfig getifaddr en0` (macOS)
3. En el móvil abre `http://<esa-ip>:3000`

Fuera de tu red local no funciona (decisión del MVP; ver `docs/ARCHITECTURE.md` — offline).

## Tus datos

- Todo se guarda en **`data/app.db`** (SQLite). Las fotos de progreso (Fase 4) irán a `data/photos/`.
- `data/` y `exports/` están excluidos de git: **nunca** se suben datos personales.
- Copia de seguridad manual: copia la carpeta `data/` con la app cerrada.
- Empezar de cero: borra `data/app.db` y repite `pnpm db:deploy && pnpm db:seed`.

## Comandos

| Comando                                  | Qué hace                                         |
| ---------------------------------------- | ------------------------------------------------ |
| `pnpm dev` / `pnpm build` / `pnpm start` | desarrollo / build / producción                  |
| `pnpm check`                             | lint + typecheck + tests + build (gate completo) |
| `pnpm test` / `pnpm test:watch`          | Vitest (unit + integración)                      |
| `pnpm test:e2e`                          | Playwright (usa `data/e2e.db`, nunca tus datos)  |
| `pnpm db:migrate`                        | nueva migración en desarrollo                    |
| `pnpm db:deploy`                         | aplicar migraciones                              |
| `pnpm db:seed`                           | seed idempotente del catálogo                    |

## Documentación

La especificación completa del producto, motores y fases vive en [`docs/`](docs/): producto, arquitectura, modelo de datos, motores de entrenamiento/nutrición/recuperación, plan de tests, plan de implementación, Coach AI (fase 6) y filosofía del coach.
