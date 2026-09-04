-- F3.2e — Ampliación del catálogo: renombres previos al seed.
--
-- Cinco ejercicios del catálogo original llevaban el MATERIAL metido en el
-- nombre del MOVIMIENTO ("Pullover en polea", "Curl en máquina predicador"…).
-- Eso no es cosmético: `Exercise.name` es la clave natural del seed, así que
-- mientras la fila se llame "Pullover en polea" no hay dónde meter la variante
-- de máquina ni la de mancuerna del MISMO movimiento — y la única salida es
-- crear un ejercicio duplicado, que es justo lo que la ampliación venía a
-- evitar.
--
-- Se renombra la fila EXISTENTE en vez de crear una nueva: el historial, los
-- programas y las notas cuelgan del `id`, así que no se enteran. Si el seed
-- corriera antes que esto, insertaría los nombres nuevos como ejercicios
-- nuevos y dejaría los viejos huérfanos con todo el historial dentro.
--
-- Idempotente: el `WHERE` por nombre viejo no encuentra nada la segunda vez, y
-- el `NOT EXISTS` evita chocar con el índice único si alguien ya tenía un
-- ejercicio con el nombre nuevo.

DO $$
DECLARE
  renames CONSTANT text[][] := ARRAY[
    ARRAY['Pullover en polea', 'Pullover'],
    ARRAY['Curl en máquina predicador', 'Curl predicador'],
    ARRAY['Remo sentado en polea', 'Remo sentado'],
    ARRAY['Jalón unilateral en polea', 'Jalón unilateral'],
    ARRAY['Crunch en polea', 'Crunch abdominal']
  ];
  r text[];
BEGIN
  FOREACH r SLICE 1 IN ARRAY renames LOOP
    UPDATE "Exercise"
       SET name = r[2]
     WHERE name = r[1]
       AND "profileId" IS NULL
       AND NOT EXISTS (SELECT 1 FROM "Exercise" x WHERE x.name = r[2]);
  END LOOP;
END $$;
