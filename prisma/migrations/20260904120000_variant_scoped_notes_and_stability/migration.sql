-- F3.2d — La identidad de un ejercicio, para todo lo que el usuario ve y para
-- todo lo que deciden los motores, es la VARIANTE (lo que de verdad haces), no
-- el Exercise (el movimiento).
--
-- Dos consecuencias en una sola migración, porque son la misma causa:
--
--  1. `ExerciseNote` pasa a colgar de `ExerciseVariant`. Antes colgaba del
--     ejercicio, así que una nota escrita en "Press inclinado — Máquina"
--     aparecía tal cual en "Press inclinado — Mancuernas". Las notas reales son
--     del montaje ("con el bloque azul en la espalda", "2 discos son 40 kg"):
--     en la otra variante son falsas. Es además la identidad que ya usaban el
--     historial, el e1RM, la progresión y el volumen efectivo; la nota era el
--     único dato del dominio con una clave de ejercicio distinta.
--
--  2. `ExerciseVariant.stability` permite declarar cuánto sostiene la máquina
--     la trayectoria, que es lo que decide el RIR objetivo por defecto junto al
--     rol y la fatiga sistémica. NULL = la que predice el material.
--
-- BACKFILL SIN PÉRDIDA: cada nota existente se copia a TODAS las variantes
-- vivas de su ejercicio. Nadie pierde una nota y nadie ve una nota nueva donde
-- no la veía; a partir de aquí, editar la de una variante ya no toca las otras.

ALTER TABLE "ExerciseVariant" ADD COLUMN "stability" TEXT;

ALTER TABLE "ExerciseNote" ADD COLUMN "exerciseVariantId" TEXT;

-- La unicidad vieja se suelta ANTES del backfill: una nota de un ejercicio con
-- cuatro variantes se convierte en cuatro filas con el mismo `exerciseId`, que
-- el índice `(profileId, exerciseId)` rechazaría. Era un índice, no una
-- constraint (ver 20260831120000_exercise_notes), así que se suelta como tal.
DROP INDEX IF EXISTS "ExerciseNote_profileId_exerciseId_key";

-- Primera variante de cada ejercicio: reutiliza la fila original.
WITH pares AS (
  SELECT
    n."id" AS "noteId",
    v."id" AS "variantId",
    row_number() OVER (PARTITION BY n."id" ORDER BY v."isDefault" DESC, v."createdAt", v."id") AS rn
  FROM "ExerciseNote" n
  JOIN "ExerciseVariant" v
    ON v."exerciseId" = n."exerciseId"
   AND v."deletedAt" IS NULL
)
UPDATE "ExerciseNote" n
SET "exerciseVariantId" = p."variantId"
FROM pares p
WHERE p."noteId" = n."id" AND p.rn = 1;

-- El resto de variantes vivas: filas nuevas con el mismo texto y las mismas
-- marcas de tiempo. `exerciseId` sigue siendo NOT NULL aquí (la columna se
-- suelta más abajo), así que se rellena igual que en las filas viejas.
INSERT INTO "ExerciseNote" ("id", "profileId", "exerciseId", "exerciseVariantId", "text", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."profileId",
  p."exerciseId",
  p."variantId",
  p."text",
  p."createdAt",
  p."updatedAt"
FROM (
  SELECT
    n."profileId", n."exerciseId", n."text", n."createdAt", n."updatedAt", v."id" AS "variantId",
    row_number() OVER (PARTITION BY n."id" ORDER BY v."isDefault" DESC, v."createdAt", v."id") AS rn
  FROM "ExerciseNote" n
  JOIN "ExerciseVariant" v
    ON v."exerciseId" = n."exerciseId"
   AND v."deletedAt" IS NULL
) p
WHERE p.rn > 1;

-- Una nota de un ejercicio SIN ninguna variante viva no tiene dónde ir: no se
-- puede leer ni editar desde ninguna pantalla, así que se descarta con el
-- ejercicio en vez de arrastrar una fila huérfana.
DELETE FROM "ExerciseNote" WHERE "exerciseVariantId" IS NULL;

DROP INDEX IF EXISTS "ExerciseNote_exerciseId_idx";
ALTER TABLE "ExerciseNote" DROP CONSTRAINT IF EXISTS "ExerciseNote_exerciseId_fkey";
ALTER TABLE "ExerciseNote" DROP COLUMN "exerciseId";

ALTER TABLE "ExerciseNote" ALTER COLUMN "exerciseVariantId" SET NOT NULL;

CREATE UNIQUE INDEX "ExerciseNote_profileId_exerciseVariantId_key"
  ON "ExerciseNote"("profileId", "exerciseVariantId");
CREATE INDEX "ExerciseNote_exerciseVariantId_idx"
  ON "ExerciseNote"("exerciseVariantId");

ALTER TABLE "ExerciseNote"
  ADD CONSTRAINT "ExerciseNote_exerciseVariantId_fkey"
  FOREIGN KEY ("exerciseVariantId") REFERENCES "ExerciseVariant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
