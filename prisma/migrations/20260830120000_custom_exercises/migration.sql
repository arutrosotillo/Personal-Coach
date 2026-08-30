-- Ejercicios propios: cualquiera puede añadir al banco un ejercicio que su
-- gimnasio tenga y el catálogo del seed no cubra.
--
-- Los del seed siguen siendo GLOBALES (`profileId IS NULL`) y los ve todo el
-- mundo. Los creados por una persona llevan su perfil y solo aparecen en su
-- biblioteca, su builder y su lista de sustitución.
--
-- `Exercise.name` sigue siendo único GLOBALMENTE, a propósito: el seed hace
-- `upsert({ where: { name } })` y lo necesita. Ver el comentario del modelo.
--
-- Re-aplicable: IF NOT EXISTS en todo, y la FK se recrea solo si falta.

ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "profileId" TEXT;

CREATE INDEX IF NOT EXISTS "Exercise_profileId_idx" ON "Exercise"("profileId");

-- ON DELETE CASCADE: borrar un perfil se lleva sus ejercicios propios. Los
-- globales tienen profileId NULL y la cascada no los toca.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Exercise_profileId_fkey'
  ) THEN
    ALTER TABLE "Exercise"
      ADD CONSTRAINT "Exercise_profileId_fkey"
      FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
