-- Repair any pre-existing duplicates deterministically, keeping the newest
-- live active program for each profile before enforcing the invariant.
UPDATE "TrainingProgram" AS "program"
SET "isActive" = false
WHERE "program"."isActive" = true
  AND "program"."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "TrainingProgram" AS "newer"
    WHERE "newer"."profileId" = "program"."profileId"
      AND "newer"."isActive" = true
      AND "newer"."deletedAt" IS NULL
      AND (
        "newer"."createdAt" > "program"."createdAt"
        OR (
          "newer"."createdAt" = "program"."createdAt"
          AND "newer"."id" > "program"."id"
        )
      )
  );

-- SQLite partial unique index: at most one non-deleted active program/profile.
CREATE UNIQUE INDEX "TrainingProgram_one_live_active_per_profile"
ON "TrainingProgram"("profileId")
WHERE "isActive" = true AND "deletedAt" IS NULL;
