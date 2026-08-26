import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Config de Prisma 7. Solo la usan las herramientas de línea de comandos
 * (`migrate`, `db`, `studio`); la aplicación crea su cliente en
 * `src/server/db.ts` con el driver adapter.
 *
 * Las migraciones van por la conexión DIRECTA cuando existe: el pooler de
 * Neon (pgbouncer, modo transacción) no soporta los advisory locks ni el
 * estado de sesión que necesita el motor de migraciones.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"],
  },
});
