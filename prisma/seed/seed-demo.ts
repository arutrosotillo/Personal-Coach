/**
 * Script OPT-IN para sembrar un historial de demo de 8 semanas.
 *
 *   SEED_DEMO=1 pnpm seed:demo          # sembrar
 *   SEED_DEMO=1 pnpm seed:demo --clear  # borrar solo lo sembrado
 *
 * Guardas deliberadas, porque esto escribe en tu base de datos real:
 *   · exige `SEED_DEMO=1`;
 *   · se niega si ya hay sesiones completadas que NO son de demo, salvo
 *     `SEED_DEMO_FORCE=1`;
 *   · imprime la base de datos sobre la que va a escribir antes de hacerlo.
 */
import { prisma } from "@/server/db";

import { clearDemoHistory, seedDemoHistory, DEMO_MARKER } from "./demo-history";

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "(sin DATABASE_URL)";
  const clear = process.argv.includes("--clear");

  if (process.env.SEED_DEMO !== "1") {
    console.error(
      "Este script no se ejecuta solo. Vuelve a lanzarlo con SEED_DEMO=1 si de verdad quieres escribir datos de demo.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Base de datos: ${dbUrl}`);

  if (clear) {
    const { sessionsDeleted } = await clearDemoHistory(prisma);
    console.log(`Borradas ${sessionsDeleted} sesiones de demo.`);
    return;
  }

  // Ojo con la lógica de tres valores de SQL: `NOT (notes LIKE '[demo]%')`
  // vale NULL —no TRUE— cuando `notes` es NULL, y la fila NO se cuenta. Como
  // la app nunca rellena `notes` sola, casi todas las sesiones reales la tienen
  // a NULL: el guardarraíl veía cero siempre y no protegía nada.
  const realSessions = await prisma.workoutSession.count({
    where: {
      status: "COMPLETED",
      OR: [{ notes: null }, { NOT: { notes: { startsWith: DEMO_MARKER } } }],
    },
  });
  if (realSessions > 0 && process.env.SEED_DEMO_FORCE !== "1") {
    console.error(
      `Hay ${realSessions} sesiones reales en esta base de datos. No voy a mezclarlas con datos ficticios.\n` +
        "Si de verdad quieres hacerlo, repite con SEED_DEMO_FORCE=1 (y considera hacer copia de data/app.db antes).",
    );
    process.exitCode = 1;
    return;
  }

  const result = await seedDemoHistory(prisma);
  console.log(
    `Sembradas ${result.sessionsCreated} sesiones y ${result.setsCreated} series de demo (${result.fromLocalDate} → ${result.toLocalDate}).`,
  );
  const sh = result.shape;
  console.log(
    `Forma: ${sh.variantesProgresando} ejercicios progresando · ${sh.variantesEstancadas} estancado(s) · ${sh.variantesEnCaida} en caída · ${sh.setsSinRir} series sin RIR.`,
  );
  console.log(
    `Todas llevan "${DEMO_MARKER}" en las notas. Para borrarlas: SEED_DEMO=1 pnpm seed:demo --clear`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
