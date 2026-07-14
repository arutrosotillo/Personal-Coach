/*
  Warnings:

  - You are about to drop the column `tier` on the `MuscleGroup` table. All the data in the column will be lost.
  - Added the required column `startWeightKg` to the `Goal` table without a default value. This is not possible if the table is not empty.
  - Added the required column `strategy` to the `Goal` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TEXT NOT NULL,
    "startWeightKg" REAL NOT NULL,
    "weeklyRatePct" REAL NOT NULL,
    "targetWeightKg" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Goal_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Goal" ("createdAt", "id", "notes", "profileId", "startDate", "status", "targetWeightKg", "type", "updatedAt", "weeklyRatePct") SELECT "createdAt", "id", "notes", "profileId", "startDate", "status", "targetWeightKg", "type", "updatedAt", "weeklyRatePct" FROM "Goal";
DROP TABLE "Goal";
ALTER TABLE "new_Goal" RENAME TO "Goal";
CREATE INDEX "Goal_profileId_status_idx" ON "Goal"("profileId", "status");
CREATE TABLE "new_MuscleGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "nameEs" TEXT NOT NULL,
    "region" TEXT NOT NULL
);
INSERT INTO "new_MuscleGroup" ("code", "id", "nameEs", "region") SELECT "code", "id", "nameEs", "region" FROM "MuscleGroup";
DROP TABLE "MuscleGroup";
ALTER TABLE "new_MuscleGroup" RENAME TO "MuscleGroup";
CREATE UNIQUE INDEX "MuscleGroup_code_key" ON "MuscleGroup"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
