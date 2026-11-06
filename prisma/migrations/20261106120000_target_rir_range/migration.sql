-- Objetivo de RIR en rango ("RIR 1–2"). Aditiva y anulable: el código anterior
-- funciona contra este schema y ninguna fila existente cambia de significado.
ALTER TABLE "TemplateExercise" ADD COLUMN "targetRirMin" INTEGER;
ALTER TABLE "WorkoutExercise" ADD COLUMN "targetRirMin" INTEGER;
