-- Ciclos físicos y memoria metabólica (docs/CYCLES.md).
--
-- 100 % ADITIVA y compatible con un despliegue gradual: columnas nuevas
-- anulables, una tabla nueva y dos índices. El código anterior no lee ni
-- escribe nada de esto y sigue funcionando contra el schema nuevo, así que
-- volver a la versión anterior de la app (rollback) no exige deshacer la
-- migración. Ninguna fila existente se borra ni se reescribe.

-- ── Goal: cierre de ciclo ──────────────────────────────────────────────────
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "endDate" TEXT;
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "closingSummary" JSONB;
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "openRequestId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Goal_openRequestId_key" ON "Goal"("openRequestId");

-- Invariante: como mucho UN ciclo activo por perfil.
--
-- Vive en SQL a mano porque Prisma no soporta índices parciales (`WHERE`) en
-- el schema: `prisma migrate dev` no lo conoce y podría proponer borrarlo al
-- generar migraciones futuras. REVISA cualquier migración generada que toque
-- "Goal". La red de seguridad es tests/integration/cycle-flow.test.ts.
--
-- Antes de crear el índice se comprueba (sin tocar nada) que ningún perfil
-- tenga ya dos objetivos activos: si los hubiera, la migración aborta con un
-- mensaje claro en vez de elegir por su cuenta cuál cerrar. En producción se
-- verificó en solo lectura el 2026-10-26: 3 perfiles, 1 activo cada uno.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Goal" WHERE "status" = 'ACTIVE'
    GROUP BY "profileId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay perfiles con más de un objetivo ACTIVE: revísalos a mano antes de migrar (docs/CYCLES.md).';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Goal_one_active_per_profile"
ON "Goal"("profileId")
WHERE "status" = 'ACTIVE';

-- ── EnergyEstimate: estimaciones de mantenimiento congeladas ───────────────
CREATE TABLE IF NOT EXISTS "EnergyEstimate" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "goalId" TEXT,
    "localDate" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tdeeKcal" INTEGER NOT NULL,
    "lowKcal" INTEGER NOT NULL,
    "highKcal" INTEGER NOT NULL,
    "seKcal" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "observedTdeeKcal" INTEGER,
    "memoryTdeeKcal" INTEGER,
    "memorySeKcal" INTEGER,
    "intakeSource" TEXT,
    "weightKg" DOUBLE PRECISION,
    "fromDeficit" BOOLEAN NOT NULL DEFAULT false,
    "engineVersion" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnergyEstimate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EnergyEstimate_profileId_localDate_idx" ON "EnergyEstimate"("profileId", "localDate");
CREATE INDEX IF NOT EXISTS "EnergyEstimate_goalId_idx" ON "EnergyEstimate"("goalId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EnergyEstimate_profileId_fkey') THEN
    ALTER TABLE "EnergyEstimate" ADD CONSTRAINT "EnergyEstimate_profileId_fkey"
      FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EnergyEstimate_goalId_fkey') THEN
    ALTER TABLE "EnergyEstimate" ADD CONSTRAINT "EnergyEstimate_goalId_fkey"
      FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
