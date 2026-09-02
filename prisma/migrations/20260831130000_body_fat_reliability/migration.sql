-- B0 — Fuente única de verdad del seguimiento corporal.
--
-- Rescata el % graso del onboarding, que hasta ahora se preguntaba y se perdía:
-- solo quedaba enterrado en el JSON de `AlgorithmDecision.inputSnapshot`, que es
-- una tabla de auditoría y no se puede consultar como serie temporal. La columna
-- `BodyMeasurement.bodyFatPct` ya existía desde F1 y estaba vacía.
--
-- Lo único que falta es la PROCEDENCIA de esa cifra. Una báscula de
-- bioimpedancia doméstica tiene un error estándar de 3,1 a 7,5 puntos
-- porcentuales frente a un modelo de 4 compartimentos; el cambio entre dos
-- lecturas del MISMO aparato es mucho más fiable (1,7–2,6 pp) porque el sesgo
-- constante se cancela. Guardar el número sin saber de dónde sale hace
-- imposible distinguir un caso del otro.
--
-- Valores: enum BodyFatReliability en src/core/enums.ts (MEASURED | ESTIMATED).
-- Columna TEXT y no enum nativo, por la convención del proyecto: afinar los
-- valores no debe exigir una migración.
--
-- Re-aplicable: IF NOT EXISTS. Aditiva y anulable, así que no toca datos
-- existentes ni bloquea la tabla.

ALTER TABLE "BodyMeasurement"
  ADD COLUMN IF NOT EXISTS "bodyFatReliability" TEXT;
