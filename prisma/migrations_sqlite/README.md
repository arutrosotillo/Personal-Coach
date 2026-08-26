# Migraciones históricas (SQLite)

Personal Coach nació sobre SQLite y se migró a PostgreSQL/Neon en CLOUD.1
(2026-08-26) para poder desplegarse en la nube sin depender de un Mac
encendido.

Estas migraciones **no se ejecutan**. Prisma solo lee `prisma/migrations/`.
Se conservan como registro de cómo evolucionó el schema, porque no se pueden
replicar en Postgres: usan el patrón de reconstrucción de tabla de SQLite
(`PRAGMA defer_foreign_keys`, `CREATE TABLE new_X` + copia + `RENAME`), que no
tiene equivalente ni sentido en Postgres.

La historia se rebaselinó en una única migración inicial de Postgres. No se
migró ningún dato: en el momento del cambio `data/app.db` no existía y no
había un solo entrenamiento registrado.

La invariante del programa activo único, que aquí vivía en
`20260824170000_unique_active_training_program`, se preservó explícitamente
en Postgres (ver `prisma/migrations/*_active_program_invariant`).
