# Despliegue en la nube

Cómo Personal Coach llega al iPhone sin que el Mac participe, y cómo se
mantiene una vez allí.

```
   iPhone (PWA en la pantalla de inicio)
        │  HTTPS
        ▼
   Vercel · proxy.ts  ─── ¿cookie de sesión firmada?
        │                    └── no → /login
        ▼
   Next.js 16 · Server Actions · runtime Node
        │                    │
        │                    └──────────► OpenAI (la clave nunca sale del servidor)
        ▼
   Prisma 7 + @prisma/adapter-pg
        ▼
   Neon PostgreSQL      ← independiente del despliegue: un deploy no puede borrarla
        │
        └── pnpm db:backup → exports/ (copia propia, no dependemos del proveedor)
```

---

## 1. Lo que tienes que crear tú

No puedo crear cuentas ni secretos en tu nombre. Son cinco cosas.

### 1.1 Proyecto en Neon

1. Entra en <https://console.neon.tech> y crea una cuenta (el plan gratuito
   basta y es permanente).
2. **Create project**:
   - Nombre: `personal-coach`
   - PostgreSQL **17** (es el que usamos en local, mismo motor)
   - Región: **AWS eu-central-1 (Frankfurt)** — la más cercana a España.
3. Al terminar sale el modal **Connect to your database**. Necesitas **dos**
   cadenas de ese modal:
   - **Con pooling** (por defecto): el host lleva `-pooler`. Es la que usa la
     app.
   - **Directa**: apaga el interruptor **Connection pooling**. El host es el
     mismo pero **sin** `-pooler`. Es la que usan las migraciones, porque el
     pooler no soporta los bloqueos que necesita el motor de migraciones.

   Las dos acaban en `?sslmode=require&channel_binding=require`. Déjalo.

Guárdalas en un sitio seguro y **no me las pegues en el chat**: las pondrás
directamente en Vercel.

### 1.2 Proyecto en Vercel

1. Entra en <https://vercel.com> con tu cuenta de GitHub.
2. **Add New → Project** e importa este repositorio.
3. Framework: Next.js (lo detecta solo). **No despliegues todavía**: primero
   las variables de entorno del punto 1.4.

> El plan **Hobby** es gratuito y vale para uso personal no comercial, que es
> este caso.

### 1.3 Dos secretos

En tu Mac, en una terminal:

```bash
openssl rand -base64 32
```

Eso es tu `AUTH_SECRET`: firma las cookies de sesión y nunca lo teclearás.
Guárdalo en tu gestor de contraseñas.

Tu contraseña de acceso NO es una variable de entorno: se guarda hasheada en la
base de datos y se fija con `pnpm user:create`. Ver §9.

### 1.4 Variables de entorno en Vercel

**Settings → Environment Variables**. Las marcadas como secretas no deben
aparecer nunca en el cliente: ninguna lleva el prefijo `NEXT_PUBLIC_`, y por
eso Next no las expone.

| Variable              | Valor                            | Entornos            |
| --------------------- | -------------------------------- | ------------------- |
| `DATABASE_URL`        | cadena de Neon **con** `-pooler` | Production          |
| `DIRECT_DATABASE_URL` | cadena de Neon **sin** `-pooler` | Production          |
| `AUTH_SECRET`         | el `openssl rand -base64 32`     | Production, Preview |
| `OPENAI_API_KEY`      | tu clave de OpenAI               | Production          |
| `AI_COACH_MODEL`      | `gpt-5.6-luna`                   | Production          |

> Con la integración de Neon instalada, `DIRECT_DATABASE_URL` es opcional: la
> integración inyecta `DATABASE_URL_UNPOOLED`, que `prisma.config.ts` también
> reconoce. Y no definas `DATABASE_URL` a mano si la integración ya la
> gestiona: tendrías dos fuentes para la misma variable.

Sin `OPENAI_API_KEY` la app funciona entera: la sección Coach dice
"AI Coach no configurado" y el resto del tracker no se entera.

### 1.5 Separar preview de producción

Tú pediste que una preview no pueda tocar producción, y es evitable.

**Opción recomendada** — instala la integración **Neon** desde el marketplace
de Vercel y conéctala a tu proyecto. Crea una _rama_ de la base de datos por
cada despliegue de preview y define ahí `DATABASE_URL` automáticamente, así
que las previews escriben en una copia y jamás en tus entrenamientos.

**Si no la instalas**: no definas `DATABASE_URL` en el entorno _Preview_. Las
previews fallarán al arrancar, que es exactamente lo que quieres — mejor una
preview rota que una preview escribiendo en producción.

---

## 2. Primer despliegue

1. Con las variables puestas, **Deploy**.
2. Vercel ejecuta el script `vercel-build`:
   `prisma generate && prisma migrate deploy && next build`.
   Las migraciones se aplican **antes** de construir y usan
   `DIRECT_DATABASE_URL`. Si fallan, el despliegue falla y no se publica: es
   lo correcto, no queremos código nuevo sobre un schema viejo.
3. Cuando termine, abre la URL. Debe pedirte la contraseña.
4. Siembra el catálogo (16 grupos, 45 ejercicios) una única vez, desde tu Mac
   apuntando a producción:

   ```bash
   DATABASE_URL="<cadena directa de Neon>" pnpm db:seed
   ```

5. Comprueba que todo está en su sitio:

   ```bash
   DATABASE_URL="<cadena directa de Neon>" pnpm db:verify
   ```

6. Entra en la app y completa el onboarding desde el iPhone.

---

## 3. Instalar en el iPhone

1. Abre la URL de Vercel en **Safari** (tiene que ser Safari: Chrome en iOS no
   instala apps en la pantalla de inicio).
2. Introduce la contraseña. No volverá a pedírtela: la sesión dura 90 días y
   se renueva sola cada vez que entras.
3. Botón **Compartir** → **Añadir a pantalla de inicio** → **Añadir**.
4. Cierra Safari y abre la app desde el icono. No debe haber barra de
   direcciones.

---

## 4. Despliegues posteriores

`git push` a `main`. Vercel construye, aplica las migraciones pendientes y
publica.

Un despliegue **no puede borrar tus entrenamientos**: la base de datos vive en
Neon, fuera del artefacto que se despliega. Publicar código no toca el
almacenamiento. Y las migraciones de Prisma son aditivas salvo que se escriba
explícitamente lo contrario.

Antes de un despliegue que incluya migraciones:

```bash
DATABASE_URL="<cadena directa de Neon>" pnpm db:backup
```

Después:

```bash
DATABASE_URL="<cadena directa de Neon>" pnpm db:verify
```

Compara el recuento del historial con el de la vez anterior. Si baja, algo
ha ido mal y tienes la copia de hace cinco minutos.

### Si el despliegue añade ejercicios al catálogo

Las migraciones se aplican solas; **el seed NO**. Un ejercicio nuevo en
`src/core/catalog/exercises.ts` no aparece en producción hasta que se siembra a
mano:

```bash
DATABASE_URL="<cadena directa de Neon>" pnpm db:seed
```

Es idempotente (`upsert` por nombre de ejercicio y por `(exerciseId, name)` de
variante): no duplica nada ni toca los ejercicios propios de nadie, así que se
puede repetir sin miedo. Si se olvida, el único síntoma es que el ejercicio
nuevo no sale en el buscador — nada se rompe.

---

## 5. Copias de seguridad

| Cuándo                  | Qué                       | Dónde                                      |
| ----------------------- | ------------------------- | ------------------------------------------ |
| Antes de cada migración | `pnpm db:backup`          | `exports/` (gitignored)                    |
| Cada semana             | `pnpm db:backup`          | `exports/` + carpeta sincronizada (iCloud) |
| Continuo                | _Instant restore_ de Neon | Neon                                       |

**La ventana de restauración instantánea del plan gratuito de Neon es de
horas, no de años.** Para un historial de entrenamiento que quieres conservar
indefinidamente eso no es una política de copias: por eso la copia real es el
volcado de `pnpm db:backup`, que es tuyo y restaurable en cualquier
PostgreSQL.

Si en algún momento quieres más margen, el primer plan de pago de Neon amplía
la ventana. No es urgente mientras hagas el volcado semanal.

### Restaurar

```bash
pnpm db:restore exports/personal-coach-AAAA-MM-DD_HH-MM.dump --to "<URL destino>"
```

Pide confirmación escrita antes de tocar nada, y si el destino no es local te
obliga a teclear el nombre de la base de datos.

**Ensáyalo antes de necesitarlo.** Crea una rama en Neon (Branches → Create
branch), restaura ahí y ejecuta `pnpm db:verify` contra ella. Una copia que
nunca se ha restaurado no es una copia de seguridad, es un fichero.

Este procedimiento se ha probado de principio a fin: volcado de una base con
32 sesiones y 413 series, restaurado sobre una base vacía, recuentos idénticos
en las 27 tablas y el índice único parcial intacto.

---

## 6. Desarrollo en local

Sigue funcionando sin nube:

```bash
brew services start postgresql@17
createdb personal_coach_dev
pnpm db:deploy && pnpm db:seed
pnpm dev
```

`.env` necesita `DATABASE_URL` y `AUTH_SECRET` (sin el secreto la app falla
cerrada, a propósito). Las cuentas se crean con `pnpm user:create`.

Los tests de integración y los E2E crean y **destruyen** bases de datos en el
Postgres local. Sus helpers rechazan cualquier host que no sea local: nunca
apuntes `TEST_DATABASE_URL` a Neon.

Tailscale sigue sirviendo para depurar contra el Mac desde el móvil, pero ya
no es parte del producto.

---

## 7. Seguridad

- `DATABASE_URL`, `OPENAI_API_KEY` y `AUTH_SECRET` son variables de servidor en
  Vercel. Ninguna lleva `NEXT_PUBLIC_`, así que Next no las incluye en el
  bundle del cliente. `src/ai/config.ts` importa además `server-only`.
- La cookie de sesión es `HttpOnly` (el JavaScript de la página no la ve),
  `Secure` en producción y `SameSite=Lax`. Hay un E2E que lo comprueba.
- La contraseña viaja por POST en el cuerpo del formulario. Nunca por query
  string, nunca a `localStorage`.
- Rotar `AUTH_SECRET` en Vercel cierra la sesión en todos los dispositivos.
  Es lo que hay que hacer si sospechas una fuga.
- La app entera está detrás del proxy, incluidas las server actions, y cada
  acción vuelve a comprobar la sesión por su cuenta.
- `robots: noindex` en toda la app: no tiene nada que hacer en un buscador.
- `.env` está en `.gitignore` y `exports/` también: ni secretos ni volcados
  pueden acabar en el repositorio.

---

## 8. Coste

| Componente | Plan                         | Coste       |
| ---------- | ---------------------------- | ----------- |
| Vercel     | Hobby                        | 0 €         |
| Neon       | Free (0,5 GB, escala a cero) | 0 €         |
| Copias     | volcado a disco propio       | 0 €         |
| Dominio    | `*.vercel.app`               | 0 €         |
| OpenAI     | ~0,0014 $ por consulta       | ~0,07 $/mes |

Dimensionamiento: una base con 32 sesiones y 413 series ocupa 88 KB
comprimida. Años de entrenamiento caben de sobra en 0,5 GB.

---

## 9. Cuentas de usuario

La app es multi-usuario ligera y privada: **no hay registro público**. Las
cuentas las creas tú desde tu Mac, apuntando a la base de datos que toque.

```bash
DATABASE_URL="<cadena directa de Neon>" pnpm user:create
```

Pide usuario y contraseña por teclado; la contraseña **no se muestra ni queda
en el historial del shell**, y se guarda hasheada con scrypt.

| Comando                            | Para qué                                         |
| ---------------------------------- | ------------------------------------------------ |
| `pnpm user:create [usuario]`       | crear una cuenta                                 |
| `pnpm user:list`                   | ver cuentas, si están activas y si tienen perfil |
| `pnpm user:password <usuario>`     | fijar o cambiar la contraseña                    |
| `pnpm user:disable <usuario>`      | dejar fuera **sin borrar** su historial          |
| `pnpm user:enable <usuario>`       | volver a dejar entrar                            |
| `pnpm user:rename <viejo> <nuevo>` | cambiar el nombre de usuario                     |

Cada usuario ve **exclusivamente** sus datos: su perfil, su programa, su
historial, su progresión, su fatiga y su coach. No hay forma de ver los de otro
ni pasando identificadores a mano; hay una suite de tests dedicada a demostrarlo
(`tests/integration/user-isolation.test.ts`).

Si alguien pierde su contraseña, se le fija otra: no hay recuperación por email
porque no hay email.
