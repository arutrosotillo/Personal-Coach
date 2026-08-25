import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { ProgramEditor } from "@/components/training/program-editor";
import { ProgramRationaleCard } from "@/components/training/program-rationale-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getProgramRationale } from "@/server/repositories/program.repo";
import { getProfileOverview } from "@/server/repositories/profile.repo";
import { listSubstitutionOptions } from "@/server/repositories/substitution.repo";
import { canRestoreProgram } from "@/server/services/program-source.service";

export const dynamic = "force-dynamic";

export default async function ProgramPage() {
  const overview = await getProfileOverview();
  const program = overview?.program;
  const mesocycle = program?.mesocycles[0];
  const [rationale, substitutionOptions, canRestore] = program
    ? await Promise.all([
        getProgramRationale(program.id),
        listSubstitutionOptions(),
        canRestoreProgram(program.id),
      ])
    : [null, [], false];

  if (!overview || !program || !mesocycle) {
    return (
      <AppShell>
        <div className="pt-16 text-center">
          <p className="text-muted-foreground mb-1 text-lg font-medium">
            ¿Cómo quieres empezar?
          </p>
          <p className="text-muted-foreground mb-6 text-sm">
            {overview
              ? "Genera un plan a tu medida o crea el tuyo desde cero."
              : "Genera un plan a tu medida para empezar."}
          </p>
          <div className="mx-auto flex max-w-xs flex-col gap-2">
            <Button
              nativeButton={false}
              render={<Link href="/onboarding" />}
              className="min-h-11"
            >
              Generar mi plan
            </Button>
            {overview ? (
              <Button
                nativeButton={false}
                render={<Link href="/program/new" />}
                variant="secondary"
                className="min-h-11"
              >
                Crear mi programa
              </Button>
            ) : null}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-semibold">{program.name}</h1>
      {/* `Mesocycle` es hoy un contenedor, no una periodización: se crea una
          vez con `status: "PLANNED"` y `weeksPlanned: 6`, y NADIE lo actualiza
          jamás. Decía "planificado" para siempre y sugería que en la semana 6
          pasaba algo. No pasa nada: el bloque no se cierra solo, la semana 7
          es como la 6, y los ejercicios y series solo los cambias tú. */}
      <p className="text-muted-foreground mb-4 text-sm">
        <span className="tnum">{program.daysPerWeek}</span> días/semana · Bloque
        de entrenamiento · referencia inicial{" "}
        <span className="tnum">{mesocycle.weeksPlanned}</span> semanas
      </p>
      <p className="text-muted-foreground mb-4 text-xs">
        Esa referencia es orientativa: el bloque no se cierra solo al llegar a
        las <span className="tnum">{mesocycle.weeksPlanned}</span> semanas. Las
        cargas y repeticiones se ajustan sesión a sesión; los ejercicios, los
        días y las series solo cambian si los cambias tú.
      </p>

      {rationale ? (
        <div className="mb-4">
          <ProgramRationaleCard rationale={rationale} />
        </div>
      ) : program.description ? (
        <Card className="mb-4">
          <CardContent className="text-muted-foreground pt-4 text-sm">
            {program.description}
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          nativeButton={false}
          render={<Link href="/program/new" />}
          variant="secondary"
          size="sm"
          className="min-h-11 flex-1 basis-36"
        >
          Crear un programa nuevo
        </Button>
        <Button
          nativeButton={false}
          render={<Link href="/program/history" />}
          variant="secondary"
          size="sm"
          className="min-h-11 flex-1 basis-36"
        >
          Programas anteriores
        </Button>
      </div>

      <ProgramEditor
        templates={mesocycle.templates.map((template) => ({
          id: template.id,
          name: template.name,
          ordinal: template.ordinal,
          exercises: template.exercises.map((te) => ({
            id: te.id,
            exerciseName: te.exerciseVariant.exercise.name,
            variantName: te.exerciseVariant.name,
            baseSets: te.baseSets,
            repRangeMin: te.repRangeMin,
            repRangeMax: te.repRangeMax,
            targetRir: te.targetRir,
            restSeconds: te.restSeconds,
          })),
        }))}
        substitutionOptions={substitutionOptions}
        canRestore={canRestore}
      />
    </AppShell>
  );
}
