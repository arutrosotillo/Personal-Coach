-- Multi-usuario ligero y privado: cuentas creadas a mano, sin registro público.
--
-- Escrita a mano porque la generada por Prisma añade columnas NOT NULL sin
-- rellenarlas y falla en cualquier base con datos. Esta conserva el historial:
-- crea una cuenta para cada perfil que ya exista y se la asocia.
--
-- Es re-aplicable: todo lleva IF NOT EXISTS, DROP ... IF EXISTS o un WHERE que
-- solo toca filas sin rellenar. Prisma no reejecuta una migración ya
-- registrada, pero durante una recuperación manual conviene que no explote.

-- ── 1. Cuentas ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "User" (
    "id"           TEXT NOT NULL,
    "username"     TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

-- ── 2. Dueño del perfil ──────────────────────────────────────────────────────
-- Nullable primero: hay que rellenarlo antes de poder exigirlo.
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "userId" TEXT;

-- Una cuenta por cada perfil ya existente. La contraseña queda BLOQUEADA: '!'
-- no es un hash válido en ningún formato que el verificador acepte, así que
-- nadie puede entrar hasta fijarla con `pnpm user:password <usuario>`.
-- Ese es el comportamiento correcto: una migración no debe inventar una
-- credencial que permita el acceso.
DO $$
DECLARE
  perfil    RECORD;
  n         INT := 0;
  cuenta_id TEXT;
  nombre    TEXT;
BEGIN
  FOR perfil IN
    SELECT "id" FROM "UserProfile" WHERE "userId" IS NULL ORDER BY "createdAt"
  LOOP
    n := n + 1;
    cuenta_id := 'usr_' || replace(gen_random_uuid()::text, '-', '');
    -- El primero (el tuyo) se llama "owner"; si hubiera más, se numeran.
    nombre := CASE WHEN n = 1 THEN 'owner' ELSE 'owner-' || n END;
    INSERT INTO "User" ("id", "username", "passwordHash", "isActive", "createdAt", "updatedAt")
    VALUES (cuenta_id, nombre, '!', true, now(), now());
    UPDATE "UserProfile" SET "userId" = cuenta_id WHERE "id" = perfil."id";
  END LOOP;
END $$;

ALTER TABLE "UserProfile" ALTER COLUMN "userId" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UserProfile_userId_key" ON "UserProfile"("userId");
ALTER TABLE "UserProfile" DROP CONSTRAINT IF EXISTS "UserProfile_userId_fkey";
ALTER TABLE "UserProfile"
  ADD CONSTRAINT "UserProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. Preferencias por perfil ───────────────────────────────────────────────
-- Antes la clave era global: el segundo usuario en completar el onboarding
-- pisaba las del primero y todos leían las mismas, contraindicaciones —un dato
-- de salud— incluidas.
ALTER TABLE "UserPreference" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "UserPreference" ADD COLUMN IF NOT EXISTS "profileId" TEXT;

UPDATE "UserPreference"
   SET "id" = 'upr_' || replace(gen_random_uuid()::text, '-', '')
 WHERE "id" IS NULL;

-- Antes de esta migración solo podía haber un perfil, así que las preferencias
-- existentes son suyas.
UPDATE "UserPreference"
   SET "profileId" = (SELECT "id" FROM "UserProfile" ORDER BY "createdAt" LIMIT 1)
 WHERE "profileId" IS NULL;

-- Si no hay ningún perfil, esas filas no son atribuibles a nadie. El onboarding
-- las vuelve a escribir.
DELETE FROM "UserPreference" WHERE "profileId" IS NULL;

ALTER TABLE "UserPreference" DROP CONSTRAINT IF EXISTS "UserPreference_pkey";
ALTER TABLE "UserPreference" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "UserPreference" ALTER COLUMN "profileId" SET NOT NULL;
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id");
CREATE INDEX IF NOT EXISTS "UserPreference_profileId_idx" ON "UserPreference"("profileId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserPreference_profileId_key_key" ON "UserPreference"("profileId", "key");
ALTER TABLE "UserPreference" DROP CONSTRAINT IF EXISTS "UserPreference_profileId_fkey";
ALTER TABLE "UserPreference"
  ADD CONSTRAINT "UserPreference_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
