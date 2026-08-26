# Personal Coach

Aplicación **personal** (un único usuario, sin registro) de entrenamiento de hipertrofia, nutrición y seguimiento corporal. Se usa desde el iPhone como PWA; los datos viven en una base PostgreSQL propia.

Estado: **Fase 1** — onboarding, catálogo de ejercicios y programa inicial funcionando. Fases siguientes en `docs/IMPLEMENTATION_PLAN.md`.

## Requisitos

- Node.js ≥ 20 (probado con 24)
- pnpm ≥ 10
- PostgreSQL 17 en local, para desarrollo y para los tests:
  `brew install postgresql@17 && brew services start postgresql@17`

## Puesta en marcha

```bash
pnpm install
createdb personal_coach_dev # base de datos local de desarrollo
cp .env.example .env        # y pon tu usuario de macOS en DATABASE_URL
pnpm db:deploy              # aplica las migraciones
pnpm db:seed                # catálogo: 16 grupos, 42 ejercicios (idempotente)
pnpm dev                    # http://localhost:3000
```

Producción local:

```bash
pnpm build
pnpm start                  # http://localhost:3000
```

## Uso desde el móvil

La app se despliega en la nube y se instala en el iPhone como PWA, sin
depender de que el ordenador esté encendido. Plan y arquitectura:
`docs/IPHONE_DEPLOYMENT_PLAN.md`.

## Tus datos

- Todo se guarda en **PostgreSQL** (`DATABASE_URL`). En desarrollo, un Postgres local; en producción, Neon. Las fotos de progreso (Fase 4) necesitarán almacenamiento aparte.
- `data/` y `exports/` están excluidos de git: **nunca** se suben datos personales.
- Empezar de cero en local: `dropdb personal_coach_dev && createdb personal_coach_dev`
  y repite `pnpm db:deploy && pnpm db:seed`.

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
