# Personal Coach en el iPhone — auditoría, decisión y plan

> **Estado**: SUPERSEDIDO en parte. El requisito cambió el 2026-08-26: la app
> NO puede depender del Mac, así que Mac + Tailscale deja de ser arquitectura
> del producto y queda solo como herramienta de desarrollo. La fase IPHONE.0
> de este documento no se ejecuta.
>
> La arquitectura elegida (Vercel + Neon + contraseña única + PWA) se mantiene
> y ya está implementada en su mayor parte. El runbook operativo vivo es
> **`docs/CLOUD_DEPLOYMENT.md`**; este documento se conserva por el análisis y
> las alternativas descartadas.
> **Motor de entrenamiento CONGELADO**: ninguna fase de este documento toca
> `src/core/training/**`, `src/core/program/**`, `src/core/science/**` ni la
> filosofía. Si una fase parece necesitar tocarlos, está mal planteada.
>
> Fecha de la investigación: 2026-08-26. Los precios y límites de proveedores se
> verificaron contra su documentación ese día y **caducan**: reverificar antes de
> ejecutar si pasan semanas.

---

## 1. Estado actual (auditado, no asumido)

| Qué                   | Valor real                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework             | Next.js **16.2.10**, React 19.2.4, App Router                                                                                                      |
| Runtime               | Node. **Ninguna ruta declara `runtime`**; 10 páginas declaran `dynamic = "force-dynamic"`                                                          |
| Mutaciones            | 4 ficheros `"use server"` (coach, workout, onboarding, program). **Cero route handlers** (`app/**/route.ts` no existe)                             |
| Componentes cliente   | 23 ficheros con `"use client"`                                                                                                                     |
| ORM                   | Prisma **7.8.0**, cliente generado en `src/generated/prisma`                                                                                       |
| Driver                | `@prisma/adapter-better-sqlite3` → **`better_sqlite3.node`, binario NATIVO compilado**                                                             |
| Base de datos         | SQLite. `datasource db { provider = "sqlite" }` (sin `url` en el schema; llega de `prisma.config.ts`)                                              |
| Ruta de la DB         | `DATABASE_URL="file:./data/app.db"` — **ruta relativa al cwd del proceso**                                                                         |
| ¿Existe la DB real?   | **NO.** `data/` solo contiene `e2e.db` (540 KB, datos de tests)                                                                                    |
| Migraciones           | 4, en `prisma/migrations/`. Una usa `PRAGMA` (SQLite puro); otra crea un **índice único parcial escrito a mano en SQL**, no declarado en el schema |
| Seed                  | `prisma/seed/run-seed.ts`, idempotente (upserts del catálogo)                                                                                      |
| Backups               | **No existen.** No hay script, ni cron, ni `exports/`                                                                                              |
| Variables de entorno  | `DATABASE_URL`, `OPENAI_API_KEY` (+ `AI_COACH_*` opcionales)                                                                                       |
| OpenAI                | SDK oficial `openai@7.5.0`, Responses API, timeout 25 s, 1 reintento, `store: false`                                                               |
| Sistema de ficheros   | **Cero uso.** Ni `fs`, ni `path`, ni subida de fotos. Nada que escribir en disco salvo la propia SQLite                                            |
| Middleware            | No existe                                                                                                                                          |
| Manifest / iconos PWA | **No existen.** `public/` solo tiene los SVG por defecto de Next                                                                                   |
| Viewport              | Ya correcto: `viewportFit: "cover"`, `themeColor: "#0a0a0a"`, y la bottom nav usa `env(safe-area-inset-bottom)`                                    |
| Tablas                | 26 modelos                                                                                                                                         |
| Suite                 | 401 tests (26 ficheros) + 10 E2E Playwright (perfil móvil)                                                                                         |

**Acoplamiento real a SQLite** (medido, no supuesto):

- **Cero SQL crudo** en la aplicación (`$queryRaw` / `$executeRaw`: ninguna ocurrencia).
- Tipos usados: solo `String`, `Int`, `Float`, `Boolean`, `DateTime`, `Json`. Todos existen en Postgres.
- **Cero `contains:`** en código de producción y **cero `mode: "insensitive"`** → la divergencia clásica (SQLite hace `LIKE` sin distinguir mayúsculas, Postgres sí) **no aplica aquí**.
- Lo que sí es específico: los `PRAGMA` de una migración y el índice único parcial en SQL manual.

---

## 2. Blockers para el iPhone

1. **`better-sqlite3` es un binario nativo.** No corre en runtimes edge y, en serverless Node, el sistema de ficheros es efímero: la DB se perdería en cada invocación. Es _el_ blocker de cualquier despliegue serverless con la arquitectura actual.
2. **La DB es un fichero local con ruta relativa.** No hay nada que la respalde ni que la mueva.
3. **No hay backups.** Hoy, un `rm -rf data/` es irreversible.
4. **No hay manifest ni iconos**, así que no hay "Añadir a pantalla de inicio" decente.
5. **No hay autenticación de ningún tipo.** Publicarla tal cual expondría el historial a Internet.
6. **La app depende del Mac encendido**, que es justo lo que quieres eliminar.

**Lo que NO es blocker** (verificado):

- Las PWA en pantalla de inicio **sí funcionan en la UE**. Apple anunció que las quitaría con iOS 17.4 por la DMA y **revirtió la decisión el 1 de marzo de 2024**; siguen construidas sobre WebKit. (Encontré resultados de 2026 que aún repiten la versión antigua: son incorrectos.)
- El viewport y las safe areas ya están bien resueltos.
- No hay estado en disco que migrar más allá de la propia base de datos.

---

## 3. Opciones consideradas

**A · Mac + LAN.** Sirves `next start` en la wifi de casa. Coste 0. Pero el Mac tiene que estar encendido y en la misma red — inútil en el gimnasio —, la IP local baila y sin HTTPS iOS no te da service workers.

**B · Mac + Tailscale.** VPN de malla privada. `tailscale serve --bg localhost:3000` termina **HTTPS con certificado válido automático** (Let's Encrypt vía MagicDNS) y **persiste tras reiniciar**. Accesible desde el iPhone en cualquier red. Autenticación = pertenecer a tu tailnet, sin construir nada. Coste 0. Sigue dependiendo del Mac encendido.

**C · Despliegue remoto MANTENIENDO SQLite.** Fly.io con volumen persistente. Cero cambios en la capa de datos: el schema, las 4 migraciones y `better-sqlite3` siguen igual. Pero los volúmenes de Fly **no tienen redundancia**: su propia documentación dice que si el host falla "tu app se cae y no hay forma de evitarlo", y que los snapshots diarios (5 días de retención por defecto) "pueden no tener tus datos más recientes". Para cerrar ese agujero hace falta Litestream replicando a un bucket S3 — un componente más.

**D · Despliegue remoto + base de datos gestionada.** Vercel (o Fly) + Neon Postgres. Al desaparecer el módulo nativo, serverless deja de ser un problema. Almacenamiento gestionado y redundante. Coste único: cambiar el provider, rebaselinar migraciones y rehacer el arranque de los tests de integración.

**E · Alternativas evaluadas y descartadas**

- **Turso / libSQL** (`@prisma/adapter-libsql`). Tentador: mantendría `provider = "sqlite"` y las 4 migraciones intactas, con 5 GB gratis. **Descartado** porque Prisma documenta que los cambios de schema van por `prisma migrate diff` + CLI de Turso, no por `prisma migrate deploy`. Eso no es un coste único: es fricción en **cada** migración futura, para siempre. Cambiar una vez de motor es más barato que cambiar el flujo de trabajo de por vida.
- **Cloudflare Workers + D1.** Next.js sobre Workers exige OpenNext y el runtime impone límites. Muchas piezas móviles para un usuario.
- **VPS propio (Hetzner, ~4 €/mes).** Control total y coste bajo, pero pasas a administrar un servidor: parches, systemd, certificados, cortafuegos. Es exactamente el mantenimiento que no quieres.
- **Prisma Postgres** (500 MB, 200k operaciones/mes gratis; primer plan de pago 10 $/mes). Válido, pero su plan gratuito no documenta retención de backups y Neon está mejor documentado.

---

## 4. Tabla comparativa

|                         | **A** Mac+LAN        | **B** Mac+Tailscale             | **C** Fly + SQLite                            | **D** Vercel + Neon                             |
| ----------------------- | -------------------- | ------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Complejidad de montaje  | Muy baja             | Baja                            | Media-alta                                    | Media (una vez)                                 |
| Complejidad de mantener | Baja                 | Baja                            | **Alta** (volumen, snapshots, Litestream)     | **Muy baja** (git push)                         |
| Coste/mes               | 0 €                  | 0 €                             | ~2,02–3,32 $ VM + 0,15 $/GB                   | **0 €**                                         |
| ¿Depende del Mac?       | **Sí, y de la wifi** | **Sí**                          | No                                            | No                                              |
| HTTPS                   | No                   | **Sí, automático**              | Sí                                            | **Sí, automático**                              |
| Seguridad               | Red local            | **Tailnet (excelente)**         | Hay que añadirla                              | Hay que añadirla                                |
| Persistencia            | Fichero local        | Fichero local                   | Volumen **sin redundancia**                   | **Gestionada y redundante**                     |
| Backups                 | Ninguno              | Ninguno                         | Snapshots 5 días, "pueden no tener lo último" | `pg_dump` + restore instantáneo (6 h en gratis) |
| ¿Un deploy borra datos? | N/A                  | N/A                             | No (el volumen persiste)                      | No (DB externa)                                 |
| Prisma                  | Igual que hoy        | Igual que hoy                   | **Igual que hoy**                             | Cambio de provider + adapter                    |
| OpenAI                  | Sin cambios          | Sin cambios                     | Sin cambios                                   | Sin cambios (300 s de límite ≫ 25 s)            |
| Experiencia iPhone      | Mala (misma red)     | **Buena** (requiere VPN activa) | Buena                                         | **Muy buena**                                   |

---

## 5. Arquitectura elegida

### Vercel (Hobby, gratis) + Neon Postgres (gratis) + contraseña única en middleware + PWA

Con una **fase 0 de dogfooding sobre Mac + Tailscale** antes de tocar nada de infraestructura.

```
   iPhone (PWA en la pantalla de inicio)
        │  HTTPS
        ▼
   Vercel Edge  ──── middleware: ¿cookie de sesión firmada?
        │                 └── no → /login (una contraseña)
        ▼
   Next.js 16 · Server Actions · Node runtime
        │                    │
        │                    └──────────► OpenAI (Responses API)
        │                                 la clave nunca sale del servidor
        ▼
   Prisma 7 + @prisma/adapter-pg
        │  TLS, cadena de conexión con pool
        ▼
   Neon Postgres (europe-west)
        │
        ├── instant restore (ventana de 6 h en el plan gratuito)
        └── pg_dump semanal → copia local en el Mac + iCloud/Drive
```

### Por qué gana

1. **Es lo que menos hay que mantener.** Desplegar es `git push`. No hay volumen que vigilar, ni snapshots que comprobar, ni sidecar de replicación, ni servidor que parchear. Tu prioridad número uno era simplicidad y esta opción es la única en la que, pasado el montaje, no hay _nada_ que administrar.
2. **La durabilidad no depende de ti.** Fly documenta explícitamente que sus volúmenes no son redundantes; Neon es almacenamiento gestionado con restauración puntual. Dijiste que no aceptas perder entrenamientos: esta es la opción que no te obliga a construir tú esa garantía.
3. **El coste de migrar está en su mínimo histórico, hoy.** `data/app.db` **no existe**: no hay ni una sesión real que migrar. Cada semana que entrenes de verdad, esta operación se encarece. Si alguna vez vamos a salir de SQLite, el momento es ahora.
4. **El código apenas se resiste.** Cero SQL crudo, cero `contains:`, cero `mode: insensitive`, solo tipos que Postgres tiene. El acoplamiento real se reduce a dos migraciones y al arranque de los tests.
5. **Serverless deja de ser un problema** en cuanto desaparece el módulo nativo, y el límite de 300 s de Vercel Hobby es doce veces nuestro timeout de OpenAI.

### Alternativa secundaria

**Fly.io + SQLite en volumen + Litestream.** Si en algún momento el cambio a Postgres se complica más de lo previsto, esta es la salida: mantiene la capa de datos intacta a cambio de ~3,5 $/mes y de administrar la durabilidad tú. La mantengo documentada como plan B real, no como cortesía.

---

## 6. Coste mensual real

| Componente           | Plan                                                     | Coste                                     |
| -------------------- | -------------------------------------------------------- | ----------------------------------------- |
| Hosting (Vercel)     | Hobby                                                    | **0 €** — proyecto personal, no comercial |
| Base de datos (Neon) | Free: 0,5 GB, 100 CU-hora/mes, escala a cero a los 5 min | **0 €**                                   |
| Backups              | `pg_dump` a disco propio                                 | **0 €**                                   |
| Dominio              | No hace falta: `personal-coach.vercel.app` sirve         | **0 €** (10–12 €/año si quieres uno)      |
| OpenAI               | Medido en la QA: 0,0010–0,0019 $ por consulta            | **~0,07 $/mes** con uso normal            |
| **Total**            |                                                          | **≈ 0,07 $/mes**                          |

Dimensionamiento: la DB de e2e con 24 sesiones y 364 series ocupa 540 KB _incluyendo_ basura de tests. Años de entrenamiento real caben de sobra en 0,5 GB. Las 100 CU-hora/mes con escalado a cero son inalcanzables para un usuario que entrena tres veces por semana.

---

## 7. Seguridad

**Decisión: una contraseña única + cookie firmada, en el middleware de Next.**

Por qué no las alternativas de plataforma, que sería lo primero que uno probaría:

- **Vercel Deployment Protection**: verificado en su documentación — en Hobby solo existe _Standard Protection_, que protege previews pero **deja el dominio de producción público**. Proteger producción exige Pro/Enterprise, y _Password Protection_ es Enterprise o un add-on de **150 $/mes** en Pro. Inviable.
- **Cloudflare Access**: gratis hasta 50 usuarios y sí funcionaría, pero obliga a poner Cloudflare delante y a cerrar el origen para que no se pueda esquivar el proxy llegando a la URL de Vercel. Dos cuentas y una capa más.
- **Tailscale**: excelente seguridad (es la de la fase 0), pero exige tener la VPN activa en el iPhone siempre. Perfecto para dogfooding, incómodo como estado final.

Lo que se construye es deliberadamente mínimo:

- Una variable `APP_PASSWORD` en el entorno de Vercel.
- `src/middleware.ts`: si no hay cookie válida y la ruta no es `/login`, redirige.
- `/login`: un formulario con un campo. Compara en tiempo constante y emite una cookie `httpOnly`, `secure`, `sameSite=lax`, con caducidad larga (un año) firmada con HMAC vía Web Crypto (el middleware corre en runtime edge: nada de `bcrypt`).
- El middleware intercepta **también los POST de las server actions**, así que no hay puerta trasera.

Esto **no** es un sistema de usuarios: no hay registro, ni recuperación, ni roles, ni tabla. Es una puerta con una llave.

**`OPENAI_API_KEY` sigue exclusivamente en el servidor.** Ya está protegida por construcción: `src/ai/config.ts` y `src/ai/provider.ts` importan `server-only`, y en la QA de aceptación se verificó que ni la clave ni los prompts aparecen en el bundle cliente. Vercel la guarda como variable de entorno de servidor. Nada de esto cambia.

---

## 8. Estrategia de datos

**Dónde vive**: en Neon, fuera del artefacto de despliegue. Esa es justamente la propiedad que buscas.

**Qué pasa en un deploy**: nada. Vercel publica código; la base de datos es un servicio externo con su propia vida. Un deploy no puede borrar entrenamientos porque no toca el almacenamiento. Es una diferencia estructural, no una promesa operativa.

**Migraciones**: `prisma migrate deploy` se ejecuta en el paso de build, contra la cadena **directa** (no la pooled). Las migraciones de Prisma son aditivas salvo que se escriba lo contrario; ninguna fase de este plan incluye un `DROP`.

**Riesgo asumido y declarado**: el plan gratuito de Neon tiene **6 horas** de ventana de restauración instantánea (los de pago, 1 día, ampliable). Seis horas no es una política de backup para un historial de años. Por eso el backup real es el `pg_dump` de abajo, no la ventana de Neon.

### Backups

| Cuándo                  | Qué                                              | Dónde                                      |
| ----------------------- | ------------------------------------------------ | ------------------------------------------ |
| Antes de cada migración | `pg_dump` completo                               | `exports/` local (ya está en `.gitignore`) |
| Semanal                 | `pnpm db:backup` — `pg_dump` con marca de tiempo | Mac + carpeta sincronizada (iCloud/Drive)  |
| Continuo                | Instant restore de Neon                          | Neon (6 h)                                 |

`exports/` ya existe en `.gitignore`, así que un dump nunca acabará en el repositorio por accidente.

**Restaurar** es el camino inverso y hay que **probarlo antes de necesitarlo**: `pg_restore` sobre una _branch_ de Neon (no sobre producción), verificar recuentos, y solo entonces promover. La fase IPHONE.5 incluye ensayar la restauración como criterio de aceptación, no como recomendación.

---

## 9. Migración

Procedimiento seguro y reversible. Hoy es barato porque **no hay datos reales**; el mismo procedimiento sirve dentro de seis meses, cuando sí los haya.

1. **Copia de seguridad primero.** `cp data/app.db exports/app-pre-migracion-<fecha>.db`. Si no existe (hoy), se anota que no había datos.
2. **Rama de git.** Toda la migración vive en una rama; `main` sigue funcionando con SQLite hasta el final.
3. **Cambiar el provider** a `postgresql` en `prisma/schema.prisma`.
4. **Rebaselinar migraciones.** Las 4 actuales llevan `PRAGMA` y sintaxis SQLite: no se replican. Se archivan en `prisma/migrations_sqlite/` (registro histórico) y se genera **una** migración inicial de Postgres.
5. **Reponer a mano el índice único parcial.** Es el paso con más riesgo de olvido: `TrainingProgram_one_live_active_per_profile` está escrito en SQL manual, **no** en el schema, así que la regeneración no lo recrea. Postgres soporta la misma sintaxis `CREATE UNIQUE INDEX ... WHERE`. Hay un test de integración que verifica que la base rechaza dos programas activos: **si ese test pasa, el índice está.**
6. **Cambiar el adapter**: `@prisma/adapter-better-sqlite3` → `@prisma/adapter-pg`, en `src/server/db.ts` y nada más (es el único punto de acceso a la DB, por convención del proyecto).
7. **Rehacer el arranque de los tests de integración.** `tests/integration/helpers/test-db.ts` crea hoy un fichero SQLite temporal. Necesita un Postgres. Dos caminos: contenedor local, o PGlite (Postgres embebido en WASM, sin Docker). Se decide en la fase, no aquí.
8. **Validar**: `pnpm check` + los 401 tests + los 10 E2E, todos en verde contra Postgres.
9. **Importar los datos** (cuando los haya): script de lectura de SQLite → escritura por Prisma, respetando el orden de las claves foráneas. Con la DB actual vacía, esto se reduce a `pnpm db:seed` (el catálogo) + el onboarding.
10. **Verificar**: recuentos por tabla antes/después, y el veredicto del motor de fatiga idéntico para la misma fecha. Es la comprobación más honesta: si los motores dicen lo mismo sobre los mismos datos, la migración fue fiel.

**Rollback**: no hacer merge de la rama. `main` sigue en SQLite con el fichero intacto. Después del merge, el rollback es `git revert` + restaurar el dump.

---

## 10. PWA

Lo que hace falta, y no hay:

- **`src/app/manifest.ts`** (Next lo sirve como `/manifest.webmanifest`): `name: "Personal Coach"`, `short_name: "Coach"`, `start_url: "/train"` (entras a entrenar, no a la portada), `scope: "/"`, `display: "standalone"`, `background_color` y `theme_color` a `#0a0a0a` para que el splash no dé un fogonazo blanco.
- **Iconos** 192×192 y 512×512 PNG, más un `maskable`.
- **`apple-touch-icon`** en el `<head>`. iOS **ignora el array `icons` del manifest** para el icono de la pantalla de inicio: sin esta etiqueta, el icono sale como una captura de la página.

Lo que ya está bien y no se toca: `viewportFit: "cover"`, `themeColor`, y la bottom nav con `env(safe-area-inset-bottom)`.

**Comportamiento al abrir desde el icono**: arranca en `start_url` sin barra de direcciones. La navegación interna es la del App Router, que se queda dentro de la PWA. El 404 propio ya lleva `AppShell` con la barra de navegación, así que no hay callejón sin salida (esto se arregló en la QA de aceptación). Refrescar dentro de una PWA en iOS es tirar hacia abajo.

**Actualización de versión**: hay un service worker, pero acotado a la pantalla de entrenamiento (`/train` y `/train/session/<id>`) y con network-first en la navegación, así que con cobertura siempre se sirve el HTML del último despliegue. La cache va versionada por nombre y **no** hace `skipWaiting`: una versión nueva releva a la anterior en el siguiente arranque limpio, nunca a mitad de un entrenamiento.

**Qué pasa si pierdo conexión a mitad de sesión** — resuelto. El primer entrenamiento real en un gimnasio con mala cobertura demostró que sí molestaba, y bastante más de lo previsto: la UI no solo fallaba, **revertía la fila**, así que la serie recién registrada se borraba sola delante del usuario.

Ahora la sesión activa es local-first: cada cambio se guarda en el móvil al instante y una cola de operaciones lo sincroniza cuando vuelve la cobertura. Se puede registrar, corregir, navegar entre ejercicios, recargar, cerrar la app y hasta **finalizar** el entrenamiento sin conexión. Detalles en `docs/ARCHITECTURE.md` § Estrategia offline.

---

## 11. OpenAI

Sigue funcionando sin cambios. El flujo es exactamente el que pides:

```
iPhone → Vercel (server action) → OpenAI → Vercel → iPhone
```

- La clave vive en las variables de entorno de Vercel, solo servidor. `src/ai/config.ts` importa `server-only`; verificado en la QA que no aparece en el bundle cliente.
- **Límites de runtime**: Vercel Hobby permite **300 s** por invocación (verificado hoy en su documentación). Nuestro timeout es de 25 s con 1 reintento — peor caso ~50 s. Sobra un factor de seis.
- El cuerpo máximo de 4,5 MB es irrelevante: el contexto más grande medido fue de ~15 KB.
- Arranque en frío: función Vercel (~1 s) + despertar de Neon (~0,5 s) en la primera petición tras 5 minutos de inactividad. Perceptible una vez por sesión, no en cada serie.
- El límite de 30/hora del rate limit en memoria pasa a ser por instancia. Para un usuario da igual; se anota como deuda menor.

---

## 12. Fases de implementación

### IPHONE.0 · Dogfooding sobre Tailscale _(recomendado, medio día)_

**Merece la pena, y bastante.** Compararlo contra desplegar directamente era parte del encargo, y la conclusión es que **no compiten: se encadenan**. IPHONE.1 (la PWA) hay que hacerlo igualmente y no depende de dónde viva la app; Tailscale te da HTTPS con certificado válido —requisito para probar la PWA de verdad— sin tocar la persistencia. Entrenas desde el iPhone **esta semana**, validas la UX real en el gimnasio, y las correcciones que salgan se hacen antes de que exista infraestructura que rehacer. El riesgo de saltárselo es hacer toda la migración y descubrir entonces que la pantalla de sesión no se usa bien con una mano.

- **Qué**: instalar Tailscale en Mac e iPhone, `tailscale serve --bg localhost:3000`, añadir a la pantalla de inicio.
- **Ficheros**: ninguno.
- **Riesgo**: el Mac tiene que estar encendido. Es temporal y consciente.
- **Aceptación**: entrenar una sesión completa desde el iPhone, en el gimnasio, con la app abierta desde el icono.

### IPHONE.1 · PWA shell

- **Ficheros**: `src/app/manifest.ts` (nuevo), `src/app/layout.tsx` (añadir `apple-touch-icon`), `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable.png`, `public/apple-touch-icon.png`.
- **Cambios**: solo metadatos y assets. Cero lógica.
- **Riesgo**: bajo. Un manifest mal formado degrada a "atajo web", no rompe la app.
- **Tests**: E2E que verifica que `/manifest.webmanifest` responde 200 con `display: standalone` y los iconos declarados; que el `<head>` lleva `apple-touch-icon`.
- **Aceptación**: desde el iPhone, "Añadir a pantalla de inicio" muestra el icono correcto y el nombre "Coach"; al abrirlo no hay barra de direcciones y entra directo a `/train`.

### IPHONE.2 · Datos: SQLite → Postgres

La fase con más riesgo. Va en su propia rama.

- **Ficheros**: `prisma/schema.prisma` (provider), `prisma/migrations/**` (rebaseline), `src/server/db.ts` (adapter), `tests/integration/helpers/test-db.ts` (arranque), `package.json` (dependencias), `.env.example`.
- **Riesgos**: (a) perder el índice único parcial — lo caza el test de integración existente; (b) el arranque de tests de integración es trabajo real, no un cambio de línea; (c) divergencia de collation en `orderBy: name` (orden de nombres acentuados). Cosmético, se anota.
- **Tests**: los 401 + 10 E2E **en verde contra Postgres**. Sin excepciones ni tests desactivados.
- **Aceptación**: `pnpm check` verde con `DATABASE_URL` apuntando a Neon, y el test que verifica que la base rechaza dos programas activos, pasando.

### IPHONE.3 · Puerta de entrada

- **Ficheros**: `src/middleware.ts` (nuevo), `src/app/login/page.tsx` (nuevo), `src/server/actions/auth.action.ts` (nuevo), `.env.example`.
- **Riesgos**: dejar rutas sin cubrir por el `matcher`; que la cookie caduque a media sesión de gimnasio (por eso, un año).
- **Tests**: E2E — sin cookie, cualquier ruta redirige a `/login`; con contraseña incorrecta no entra; con la correcta entra y **sigue dentro tras cerrar y reabrir**; una server action sin cookie es rechazada.
- **Aceptación**: la URL pública pide contraseña; tras introducirla una vez en el iPhone, no vuelve a pedirla.

### IPHONE.4 · Despliegue

- **Ficheros**: `.env.example` (documentar variables de Vercel), quizá `vercel.json` si hace falta fijar región (`fra1`/`cdg1`, cerca de Neon).
- **Riesgos**: el paso de build necesita la cadena **directa** de Neon, no la pooled, para `prisma migrate deploy`. Confundirlas es el error clásico.
- **Tests**: humo en producción — cargar `/train`, registrar una serie, generar un resumen del coach.
- **Aceptación**: la app responde por HTTPS desde el iPhone sin el Mac encendido.

### IPHONE.5 · Backup y restauración

Antes de meter un solo entrenamiento real.

- **Ficheros**: `scripts/backup.ts`, `scripts/restore.ts`, entradas en `package.json`, sección en `docs/`.
- **Riesgos**: un backup que nunca se ha restaurado no es un backup.
- **Tests**: dump → restaurar en una _branch_ de Neon → comparar recuentos por tabla → comprobar que el veredicto del motor de fatiga es idéntico.
- **Aceptación**: **restauración ensayada de verdad**, con los recuentos comparados. No vale "el script existe".

### IPHONE.6 · QA en dispositivo real

- **Ficheros**: solo correcciones que salgan.
- **Riesgos**: aparecen problemas de UX que las herramientas no ven (guantes, manos sudadas, pantalla al sol, el móvil apagándose entre series).
- **Aceptación**: dos sesiones completas registradas en el gimnasio desde la PWA, sin abrir el Mac.

---

## 13. Riesgos

| Riesgo                                          | Probabilidad                  | Impacto                               | Mitigación                                                    |
| ----------------------------------------------- | ----------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| Perder el índice único parcial en la migración  | Media                         | Alto (invariante del programa activo) | El test de integración que lo verifica ya existe              |
| El arranque de tests de integración se complica | Media                         | Medio (retrasa IPHONE.2)              | Plan B: PGlite en vez de Docker                               |
| Neon cambia su plan gratuito                    | Baja                          | Medio                                 | `pg_dump` semanal ya te deja migrar a cualquier Postgres      |
| Vercel Hobby y sus términos                     | Baja                          | Medio                                 | Uso personal y no comercial, que es lo que permite            |
| Perder conexión a mitad de sesión               | **Alta**                      | Bajo                                  | El fallo es visible, no silencioso; lo anterior está guardado |
| Arranque en frío molesto en el gimnasio         | Media                         | Bajo                                  | ~1,5 s en la primera petición; luego caliente                 |
| Que la contraseña se filtre                     | Baja                          | Alto                                  | Cookie firmada, HTTPS, y rotarla es cambiar una variable      |
| Descubrir problemas de UX tarde                 | **Alta si se salta IPHONE.0** | Medio                                 | Hacer IPHONE.0                                                |

---

## 14. Qué NO debemos construir

- **Modo offline COMPLETO de toda la app.** El service worker que hay cachea solo el shell de `/train` y `/train/session/<id>`, que es donde de verdad no hay cobertura. Progreso, ajustes, historial y coach siguen necesitando servidor, y así se quedan: cada ruta cacheada es HTML privado en el dispositivo y una fuente más de datos viejos que reconciliar.
- **Notificaciones push.** No aportan nada a un tracker que abres tú.
- **Sistema de usuarios.** Ni registro, ni roles, ni recuperación de contraseña. Una llave, una puerta.
- **App nativa o React Native.** La PWA cubre el objetivo entero.
- **Sincronización multi-dispositivo o resolución de conflictos.** Un usuario, un dispositivo a la vez.
- **CI/CD elaborado.** `git push` es el pipeline.
- **Réplicas, multi-región, pooling avanzado, monitorización, alertas.** Es una persona entrenando tres veces por semana.
- **Migrar a Turso "porque mantiene SQLite".** Ya evaluado y descartado por el flujo de migraciones.
- **Y sobre todo: nada dentro de `src/core/training/**`.** El motor está congelado.

---

## 15. Primer paso exacto tras aprobar

**IPHONE.1 · PWA shell**, con IPHONE.0 (Tailscale) en paralelo para poder probarlo en el iPhone el mismo día.

Concretamente, el primer commit:

1. Crear `src/app/manifest.ts` con nombre, `start_url: "/train"`, `display: "standalone"` y los colores que ya usa la app.
2. Generar los tres iconos PNG a partir de una marca simple y coherente con el dark mode.
3. Añadir `apple-touch-icon` al `<head>` de `src/app/layout.tsx`.
4. Un E2E que verifique el manifest y la etiqueta.
5. En el Mac: `tailscale serve --bg localhost:3000`, y añadir a la pantalla de inicio del iPhone.

Nada de esto toca la base de datos, ni el motor, ni el despliegue. Es reversible borrando cuatro ficheros.
