-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sex" TEXT NOT NULL,
    "birthDate" TEXT NOT NULL,
    "heightCm" REAL NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "unitSystem" TEXT NOT NULL DEFAULT 'METRIC',
    "dailySteps" INTEGER,
    "workActivity" TEXT,
    "sleepHoursTypical" REAL,
    "trainingYears" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TEXT NOT NULL,
    "weeklyRatePct" REAL NOT NULL,
    "targetWeightKg" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Goal_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BodyMeasurement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "weightKg" REAL,
    "waistCm" REAL,
    "neckCm" REAL,
    "chestCm" REAL,
    "hipsCm" REAL,
    "bicepLeftCm" REAL,
    "bicepRightCm" REAL,
    "thighLeftCm" REAL,
    "thighRightCm" REAL,
    "calfCm" REAL,
    "bodyFatPct" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BodyMeasurement_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProgressPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "pose" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "notes" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgressPhoto_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyCheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "weightKg" REAL,
    "kcal" INTEGER,
    "proteinG" INTEGER,
    "steps" INTEGER,
    "hunger" INTEGER,
    "energy" INTEGER,
    "sleepHours" REAL,
    "trained" BOOLEAN,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyCheckIn_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyCheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "weekStartDate" TEXT NOT NULL,
    "avgWeightKg" REAL,
    "weightTrendKgPerWeek" REAL,
    "waistCm" REAL,
    "trainingAdherencePct" REAL,
    "nutritionAdherencePct" REAL,
    "avgSleepHours" REAL,
    "fatigue" INTEGER,
    "hunger" INTEGER,
    "motivation" INTEGER,
    "notes" TEXT,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyCheckIn_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PersonalEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "endDate" TEXT,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalEvent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MuscleGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "nameEs" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'C'
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "movementPattern" TEXT NOT NULL,
    "systemicFatigue" INTEGER NOT NULL DEFAULT 2,
    "instructions" TEXT,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExerciseMuscleContribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "exerciseId" TEXT NOT NULL,
    "muscleGroupId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "factor" REAL NOT NULL,
    CONSTRAINT "ExerciseMuscleContribution_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExerciseMuscleContribution_muscleGroupId_fkey" FOREIGN KEY ("muscleGroupId") REFERENCES "MuscleGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExerciseVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "exerciseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "equipment" TEXT NOT NULL,
    "loadStepKg" REAL NOT NULL DEFAULT 2.5,
    "repRangeMin" INTEGER NOT NULL DEFAULT 8,
    "repRangeMax" INTEGER NOT NULL DEFAULT 12,
    "defaultRestSeconds" INTEGER NOT NULL DEFAULT 120,
    "contraindications" JSONB NOT NULL DEFAULT [],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExerciseVariant_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingProgram" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysPerWeek" INTEGER NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingProgram_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Mesocycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "weeksPlanned" INTEGER NOT NULL DEFAULT 6,
    "currentWeek" INTEGER NOT NULL DEFAULT 0,
    "startDate" TEXT,
    "endDate" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Mesocycle_programId_fkey" FOREIGN KEY ("programId") REFERENCES "TrainingProgram" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkoutTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mesocycleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkoutTemplate_mesocycleId_fkey" FOREIGN KEY ("mesocycleId") REFERENCES "Mesocycle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplateExercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "exerciseVariantId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "baseSets" INTEGER NOT NULL,
    "repRangeMin" INTEGER NOT NULL,
    "repRangeMax" INTEGER NOT NULL,
    "targetRir" INTEGER NOT NULL DEFAULT 2,
    "restSeconds" INTEGER NOT NULL DEFAULT 120,
    "notes" TEXT,
    CONSTRAINT "TemplateExercise_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TemplateExercise_exerciseVariantId_fkey" FOREIGN KEY ("exerciseVariantId") REFERENCES "ExerciseVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mesocycleId" TEXT NOT NULL,
    "templateId" TEXT,
    "weekNumber" INTEGER NOT NULL,
    "weekKind" TEXT NOT NULL DEFAULT 'ACCUMULATION',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "localDate" TEXT NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "perceivedPerformance" INTEGER,
    "pump" INTEGER,
    "fatigue" INTEGER,
    "motivation" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkoutSession_mesocycleId_fkey" FOREIGN KEY ("mesocycleId") REFERENCES "Mesocycle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkoutSession_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkoutTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkoutExercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "exerciseVariantId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "plannedSets" INTEGER NOT NULL,
    "repRangeMin" INTEGER NOT NULL,
    "repRangeMax" INTEGER NOT NULL,
    "targetRir" INTEGER NOT NULL,
    "restSeconds" INTEGER NOT NULL,
    "notes" TEXT,
    CONSTRAINT "WorkoutExercise_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkoutExercise_exerciseVariantId_fkey" FOREIGN KEY ("exerciseVariantId") REFERENCES "ExerciseVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SetLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workoutExerciseId" TEXT NOT NULL,
    "exerciseVariantId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "setType" TEXT NOT NULL DEFAULT 'WORKING',
    "weightKg" REAL NOT NULL,
    "reps" INTEGER NOT NULL,
    "rir" INTEGER,
    "technique" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT true,
    "estimated1Rm" REAL,
    "notes" TEXT,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SetLog_workoutExerciseId_fkey" FOREIGN KEY ("workoutExerciseId") REFERENCES "WorkoutExercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SetLog_exerciseVariantId_fkey" FOREIGN KEY ("exerciseVariantId") REFERENCES "ExerciseVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecoveryCheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "muscleGroupId" TEXT NOT NULL,
    "soreness" INTEGER,
    "jointPain" INTEGER,
    "jointArea" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecoveryCheckIn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecoveryCheckIn_muscleGroupId_fkey" FOREIGN KEY ("muscleGroupId") REFERENCES "MuscleGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NutritionTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "kcal" INTEGER NOT NULL,
    "proteinG" INTEGER NOT NULL,
    "carbsG" INTEGER NOT NULL,
    "fatG" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "recommendationId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NutritionTarget_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NutritionTarget_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MealTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kcal" INTEGER NOT NULL,
    "proteinG" INTEGER NOT NULL,
    "carbsG" INTEGER NOT NULL DEFAULT 0,
    "fatG" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NutritionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "description" TEXT,
    "mealTemplateId" TEXT,
    "kcal" INTEGER NOT NULL,
    "proteinG" INTEGER NOT NULL DEFAULT 0,
    "carbsG" INTEGER NOT NULL DEFAULT 0,
    "fatG" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NutritionLog_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NutritionLog_mealTemplateId_fkey" FOREIGN KEY ("mealTemplateId") REFERENCES "MealTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlgorithmDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "engine" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "evaluationDate" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "suppressedBy" TEXT,
    "appliesToLocalDate" TEXT NOT NULL,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Recommendation_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Recommendation_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AlgorithmDecision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Goal_profileId_status_idx" ON "Goal"("profileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BodyMeasurement_profileId_localDate_key" ON "BodyMeasurement"("profileId", "localDate");

-- CreateIndex
CREATE INDEX "ProgressPhoto_profileId_pose_localDate_idx" ON "ProgressPhoto"("profileId", "pose", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCheckIn_profileId_localDate_key" ON "DailyCheckIn"("profileId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyCheckIn_profileId_isoYear_isoWeek_key" ON "WeeklyCheckIn"("profileId", "isoYear", "isoWeek");

-- CreateIndex
CREATE INDEX "PersonalEvent_profileId_localDate_idx" ON "PersonalEvent"("profileId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "MuscleGroup_code_key" ON "MuscleGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_name_key" ON "Exercise"("name");

-- CreateIndex
CREATE INDEX "Exercise_movementPattern_idx" ON "Exercise"("movementPattern");

-- CreateIndex
CREATE INDEX "ExerciseMuscleContribution_muscleGroupId_idx" ON "ExerciseMuscleContribution"("muscleGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseMuscleContribution_exerciseId_muscleGroupId_key" ON "ExerciseMuscleContribution"("exerciseId", "muscleGroupId");

-- CreateIndex
CREATE INDEX "ExerciseVariant_equipment_idx" ON "ExerciseVariant"("equipment");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseVariant_exerciseId_name_key" ON "ExerciseVariant"("exerciseId", "name");

-- CreateIndex
CREATE INDEX "TrainingProgram_profileId_isActive_idx" ON "TrainingProgram"("profileId", "isActive");

-- CreateIndex
CREATE INDEX "Mesocycle_status_idx" ON "Mesocycle"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Mesocycle_programId_ordinal_key" ON "Mesocycle"("programId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutTemplate_mesocycleId_ordinal_key" ON "WorkoutTemplate"("mesocycleId", "ordinal");

-- CreateIndex
CREATE INDEX "TemplateExercise_exerciseVariantId_idx" ON "TemplateExercise"("exerciseVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateExercise_templateId_ordinal_key" ON "TemplateExercise"("templateId", "ordinal");

-- CreateIndex
CREATE INDEX "WorkoutSession_mesocycleId_weekNumber_idx" ON "WorkoutSession"("mesocycleId", "weekNumber");

-- CreateIndex
CREATE INDEX "WorkoutSession_templateId_idx" ON "WorkoutSession"("templateId");

-- CreateIndex
CREATE INDEX "WorkoutSession_localDate_idx" ON "WorkoutSession"("localDate");

-- CreateIndex
CREATE INDEX "WorkoutSession_status_idx" ON "WorkoutSession"("status");

-- CreateIndex
CREATE INDEX "WorkoutExercise_exerciseVariantId_idx" ON "WorkoutExercise"("exerciseVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutExercise_sessionId_ordinal_key" ON "WorkoutExercise"("sessionId", "ordinal");

-- CreateIndex
CREATE INDEX "SetLog_exerciseVariantId_localDate_idx" ON "SetLog"("exerciseVariantId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "SetLog_workoutExerciseId_setNumber_key" ON "SetLog"("workoutExerciseId", "setNumber");

-- CreateIndex
CREATE INDEX "RecoveryCheckIn_muscleGroupId_createdAt_idx" ON "RecoveryCheckIn"("muscleGroupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCheckIn_sessionId_muscleGroupId_key" ON "RecoveryCheckIn"("sessionId", "muscleGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionTarget_recommendationId_key" ON "NutritionTarget"("recommendationId");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionTarget_profileId_effectiveFrom_key" ON "NutritionTarget"("profileId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "MealTemplate_name_key" ON "MealTemplate"("name");

-- CreateIndex
CREATE INDEX "NutritionLog_profileId_localDate_idx" ON "NutritionLog"("profileId", "localDate");

-- CreateIndex
CREATE INDEX "NutritionLog_mealTemplateId_idx" ON "NutritionLog"("mealTemplateId");

-- CreateIndex
CREATE INDEX "AlgorithmDecision_engine_ruleId_idx" ON "AlgorithmDecision"("engine", "ruleId");

-- CreateIndex
CREATE INDEX "AlgorithmDecision_evaluationDate_idx" ON "AlgorithmDecision"("evaluationDate");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_decisionId_key" ON "Recommendation"("decisionId");

-- CreateIndex
CREATE INDEX "Recommendation_profileId_status_priority_idx" ON "Recommendation"("profileId", "status", "priority");

-- CreateIndex
CREATE INDEX "Recommendation_appliesToLocalDate_idx" ON "Recommendation"("appliesToLocalDate");
