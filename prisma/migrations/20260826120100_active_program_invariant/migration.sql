-- Invariante: como máximo UN programa activo y no borrado por perfil.
--
-- Vive en SQL a mano, no en schema.prisma, porque Prisma no soporta índices
-- parciales (`WHERE`) para PostgreSQL en el schema. Esto tiene una
-- consecuencia importante: `prisma migrate dev` no conoce este índice y
-- podría intentar eliminarlo al generar migraciones futuras.
--
-- REVISA CUALQUIER MIGRACIÓN GENERADA que mencione TrainingProgram antes de
-- aplicarla. Si el índice desapareciera, el test de integración
-- "no permite dos programas activos" (tests/integration/active-program-invariant.test.ts)
-- falla: esa es la red de seguridad.
CREATE UNIQUE INDEX "TrainingProgram_one_live_active_per_profile"
ON "TrainingProgram"("profileId")
WHERE "isActive" = true AND "deletedAt" IS NULL;
