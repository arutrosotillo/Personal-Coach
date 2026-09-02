-- B4 — Protocolo con el que se midió la cintura.
--
-- El error de medida de una automedición doméstica depende de cuántas tomas se
-- promediaron: con una sola, el error técnico llega a 1,93 cm y el cambio
-- mínimo detectable a ~5,4 cm; con la media de tres baja a ~1,11 cm y ~3,1 cm
-- (Barrios 2016, doi:10.1186/s12874-016-0150-2).
--
-- Sin esta columna solo caben dos opciones, y las dos son malas: seguir
-- aplicando 5,4 cm a mediciones que merecen 3,1 (y callar cambios reales), o
-- bajar la constante global a 3,1 y aplicar a las mediciones de una sola toma
-- —onboarding incluido— una precisión que no tienen.
--
-- NULL = desconocido, y el motor lo trata como SINGLE. Es deliberado: todo lo
-- registrado antes de esta migración se midió de una sola vez, y el umbral
-- conservador es el único honesto para ello. Por eso la columna NO tiene
-- DEFAULT: rellenar el pasado con un valor inventado sería justo el problema.
--
-- Valores: enum WaistProtocol en src/core/enums.ts. TEXT y no enum nativo, por
-- la convención del proyecto.
--
-- Re-aplicable, aditiva y anulable: no toca datos ni bloquea la tabla.

ALTER TABLE "BodyMeasurement"
  ADD COLUMN IF NOT EXISTS "waistProtocol" TEXT;
