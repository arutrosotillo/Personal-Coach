import "dotenv/config";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { describeTarget, requireDatabaseUrl } from "./pg-tools";

/**
 * Comprobación de integridad. Ejecútala después de un despliegue, de una
 * migración o de una restauración: responde a "¿siguen estando mis datos y
 * siguen siendo coherentes?".
 *
 * Solo lee. Nunca modifica nada.
 */
interface Check {
  nombre: string;
  ok: boolean;
  detalle: string;
}

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  const checks: Check[] = [];

  console.log(`Base de datos: ${describeTarget(url)}\n`);

  try {
    // 1. Todas las migraciones del repositorio están aplicadas.
    const esperadas = readdirSync(join(process.cwd(), "prisma", "migrations"), {
      withFileTypes: true,
    })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const aplicadas = await prisma.$queryRaw<
      { migration_name: string; finished_at: Date | null }[]
    >`SELECT migration_name, finished_at FROM "_prisma_migrations"`;
    const nombresAplicados = new Set(
      aplicadas.filter((m) => m.finished_at).map((m) => m.migration_name),
    );
    const faltan = esperadas.filter((m) => !nombresAplicados.has(m));
    checks.push({
      nombre: "Migraciones aplicadas",
      ok: faltan.length === 0,
      detalle:
        faltan.length === 0
          ? `${esperadas.length} de ${esperadas.length}`
          : `faltan: ${faltan.join(", ")}`,
    });

    // 2. El índice parcial que impone un solo programa activo por perfil.
    //    No está en schema.prisma, así que una migración generada podría
    //    haberlo eliminado sin que nadie lo note.
    const indices = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'TrainingProgram_one_live_active_per_profile'
    `;
    checks.push({
      nombre: "Invariante de programa activo (índice)",
      ok: indices.length === 1,
      detalle: indices.length === 1 ? "presente" : "AUSENTE",
    });

    // 3. Y que además se cumpla en los datos.
    const duplicados = await prisma.$queryRaw<{ profileId: string }[]>`
      SELECT "profileId" FROM "TrainingProgram"
      WHERE "isActive" = true AND "deletedAt" IS NULL
      GROUP BY "profileId" HAVING COUNT(*) > 1
    `;
    checks.push({
      nombre: "Invariante de programa activo (datos)",
      ok: duplicados.length === 0,
      detalle:
        duplicados.length === 0
          ? "ningún perfil con dos programas activos"
          : `${duplicados.length} perfiles con más de uno`,
    });

    // 4. El catálogo está sembrado: sin él no se puede entrenar.
    const [gruposMusculares, ejercicios, variantes] = await Promise.all([
      prisma.muscleGroup.count(),
      prisma.exercise.count(),
      prisma.exerciseVariant.count(),
    ]);
    checks.push({
      nombre: "Catálogo sembrado",
      ok: gruposMusculares > 0 && ejercicios > 0 && variantes > 0,
      detalle: `${gruposMusculares} grupos, ${ejercicios} ejercicios, ${variantes} variantes`,
    });

    // 5. Recuento del historial. Aquí es donde se nota si un despliegue se
    //    ha llevado algo por delante: compáralo con la ejecución anterior.
    const [perfiles, programas, sesiones, series, mediciones] =
      await Promise.all([
        prisma.userProfile.count(),
        prisma.trainingProgram.count(),
        prisma.workoutSession.count(),
        prisma.setLog.count(),
        prisma.bodyMeasurement.count(),
      ]);
    checks.push({
      nombre: "Tu historial",
      ok: true,
      detalle: `${perfiles} perfil(es), ${programas} programas, ${sesiones} sesiones, ${series} series, ${mediciones} mediciones`,
    });

    // 6. Sesiones huérfanas a medio terminar.
    const enCurso = await prisma.workoutSession.count({
      where: { status: "IN_PROGRESS" },
    });
    checks.push({
      nombre: "Sesiones en curso",
      ok: enCurso <= 1,
      detalle:
        enCurso === 0
          ? "ninguna"
          : `${enCurso} (más de una indica un estado inconsistente)`,
    });
  } finally {
    await prisma.$disconnect();
  }

  let fallos = 0;
  for (const check of checks) {
    if (!check.ok) fallos += 1;
    console.log(
      `${check.ok ? "OK  " : "FALLO"}  ${check.nombre}: ${check.detalle}`,
    );
  }
  console.log("");
  if (fallos > 0) {
    console.error(`${fallos} comprobación(es) fallida(s).`);
    process.exit(1);
  }
  console.log("Todo correcto.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
