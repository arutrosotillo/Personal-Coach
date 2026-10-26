-- Cambio de gimnasio: tramos de cargas comparables por variante
-- (docs/TRAINING_ENGINE.md § Cambio de equipamiento).
--
-- 100 % ADITIVA: una columna anulable en `PersonalEvent` y una tabla nueva.
-- El código anterior no lee ni escribe nada de esto, así que volver a la
-- versión anterior de la app no exige deshacer la migración. Ninguna fila
-- existente se borra ni se reescribe: el historial de series no cambia.

-- ── PersonalEvent: idempotencia del alta ───────────────────────────────────
ALTER TABLE "PersonalEvent" ADD COLUMN IF NOT EXISTS "requestId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PersonalEvent_requestId_key" ON "PersonalEvent"("requestId");

-- ── EquipmentChange: desde qué día una variante usa otro equipamiento ──────
CREATE TABLE IF NOT EXISTS "EquipmentChange" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "exerciseVariantId" TEXT NOT NULL,
    "personalEventId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EquipmentChange_personalEventId_idx" ON "EquipmentChange"("personalEventId");

CREATE UNIQUE INDEX IF NOT EXISTS "EquipmentChange_profileId_exerciseVariantId_localDate_key" ON "EquipmentChange"("profileId", "exerciseVariantId", "localDate");

ALTER TABLE "EquipmentChange" ADD CONSTRAINT "EquipmentChange_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EquipmentChange" ADD CONSTRAINT "EquipmentChange_exerciseVariantId_fkey" FOREIGN KEY ("exerciseVariantId") REFERENCES "ExerciseVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EquipmentChange" ADD CONSTRAINT "EquipmentChange_personalEventId_fkey" FOREIGN KEY ("personalEventId") REFERENCES "PersonalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
