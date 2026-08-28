import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Config de Prisma 7. Solo la usan las herramientas de línea de comandos
 * (`migrate`, `db`, `studio`); la aplicación crea su cliente en
 * `src/server/db.ts` con el driver adapter.
 *
 * Las migraciones necesitan la conexión DIRECTA: el pooler de Neon (pgbouncer
 * en modo transacción) no soporta los advisory locks ni el estado de sesión
 * que usa el motor de migraciones.
 *
 * Se busca en tres sitios, en orden, para que funcione igual en local, con
 * variables puestas a mano en Vercel y con la integración de Neon:
 *   1. DIRECT_DATABASE_URL   — puesta a mano (ver .env.example).
 *   2. DATABASE_URL_UNPOOLED — la que inyecta la integración Neon-Vercel,
 *      también en las ramas de preview.
 *   3. DATABASE_URL          — último recurso; correcto en un Postgres local,
 *      donde no hay pooler.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      process.env["DIRECT_DATABASE_URL"] ??
      process.env["DATABASE_URL_UNPOOLED"] ??
      process.env["DATABASE_URL"],
  },
});
