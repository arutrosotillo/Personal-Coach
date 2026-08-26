import { dropAllTestDatabases } from "../tests/integration/helpers/test-db";

/**
 * Borra las bases de datos de test huérfanas del PostgreSQL local (las que
 * empiezan por `personal_coach_test_`, plantilla incluida). Útil si una suite
 * se interrumpe a media ejecución.
 *
 * Es seguro por construcción: el helper solo acepta un servidor local y solo
 * destruye bases con ese prefijo.
 */
dropAllTestDatabases()
  .then((count) => {
    console.log(`Bases de datos de test eliminadas: ${count}`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
