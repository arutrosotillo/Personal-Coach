import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import { describeTarget, findPgTool, isLocal } from "./pg-tools";

/**
 * Restaura una copia sobre una base de datos. DESTRUCTIVO: sobrescribe lo que
 * haya en el destino.
 *
 * Uso:
 *   pnpm db:restore <fichero.dump> [--to <DATABASE_URL>]
 *
 * Sin `--to` restaura sobre DATABASE_URL. Antes de tocar nada dice a dónde va
 * y pide confirmación escrita; si el destino no es local, exige escribir el
 * nombre de la base de datos, porque ahí es donde se pierden los datos de
 * verdad.
 *
 * Ensaya la restauración en una rama de Neon ANTES de necesitarla. Una copia
 * que nunca se ha restaurado no es una copia de seguridad, es un fichero.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    throw new Error(
      "Falta el fichero. Uso: pnpm db:restore <fichero.dump> [--to <URL>]",
    );
  }
  if (!existsSync(file)) {
    throw new Error(`No existe el fichero: ${file}`);
  }

  const toIndex = args.indexOf("--to");
  const target = toIndex >= 0 ? args[toIndex + 1] : process.env.DATABASE_URL;
  if (!target) {
    throw new Error("No hay destino: define DATABASE_URL o pasa --to <URL>.");
  }

  const descripcion = describeTarget(target);
  console.log(`Fichero: ${file}`);
  console.log(`Destino: ${descripcion}`);
  console.log("");
  console.log(
    "Esto SOBRESCRIBE el contenido del destino. No se puede deshacer.",
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (isLocal(target)) {
      const answer = await rl.question('Escribe "restaurar" para continuar: ');
      if (answer.trim() !== "restaurar") {
        console.log("Cancelado.");
        return;
      }
    } else {
      // Destino remoto: puede ser producción. Que haya que teclear su nombre.
      const dbName = new URL(target).pathname.replace("/", "");
      console.log("El destino NO es local. Puede ser producción.");
      const answer = await rl.question(
        `Escribe el nombre de la base de datos ("${dbName}") para continuar: `,
      );
      if (answer.trim() !== dbName) {
        console.log("Cancelado.");
        return;
      }
    }
  } finally {
    rl.close();
  }

  const pgRestore = findPgTool("pg_restore");
  execFileSync(
    pgRestore,
    [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      // Sin --exit-on-error: --clean se queja de objetos que aún no existen al
      // restaurar sobre una base vacía, y eso no es un fallo real.
      "--dbname",
      target,
      file,
    ],
    { stdio: "inherit" },
  );

  console.log("");
  console.log("Restauración terminada. Comprueba la integridad:");
  console.log("  pnpm db:verify");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
