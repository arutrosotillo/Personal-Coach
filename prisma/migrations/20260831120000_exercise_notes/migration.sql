-- Notas personales por ejercicio: la señal técnica que cada uno se apunta para
-- sí ("piernas encogidas en el press banca").
--
-- Tabla propia en vez de una columna en `Exercise`: el catálogo del seed es
-- compartido, así que una columna ahí la vería todo el mundo. La nota es del
-- perfil y solo la ve quien la escribe.
--
-- Cuelga del EJERCICIO, no de la variante: la señal es del movimiento y debe
-- seguir apareciendo al cambiar de barra a mancuernas.
--
-- Re-aplicable: IF NOT EXISTS en todo, y las FK se recrean solo si faltan.

CREATE TABLE IF NOT EXISTS "ExerciseNote" (
  "id"         TEXT NOT NULL,
  "profileId"  TEXT NOT NULL,
  "exerciseId" TEXT NOT NULL,
  "text"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExerciseNote_pkey" PRIMARY KEY ("id")
);

-- Una nota por persona y ejercicio: el guardado es un upsert contra esta clave.
CREATE UNIQUE INDEX IF NOT EXISTS "ExerciseNote_profileId_exerciseId_key"
  ON "ExerciseNote"("profileId", "exerciseId");

CREATE INDEX IF NOT EXISTS "ExerciseNote_exerciseId_idx"
  ON "ExerciseNote"("exerciseId");

-- ON DELETE CASCADE en ambas: borrar un perfil se lleva sus notas, y borrar un
-- ejercicio propio (borrado real, solo si no está en uso) se lleva la suya.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseNote_profileId_fkey'
  ) THEN
    ALTER TABLE "ExerciseNote"
      ADD CONSTRAINT "ExerciseNote_profileId_fkey"
      FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ExerciseNote_exerciseId_fkey'
  ) THEN
    ALTER TABLE "ExerciseNote"
      ADD CONSTRAINT "ExerciseNote_exerciseId_fkey"
      FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
