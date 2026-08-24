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
          <p className="text-muted-foreground">Todavía no hay programa.</p>
          <Button
            nativeButton={false}
            render={<Link href="/onboarding" />}
            className="mt-4 min-h-11"
          >
            Crear mi plan
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-semibold">{program.name}</h1>
      <p className="text-muted-foreground mb-4 text-sm">
        <span className="tnum">{program.daysPerWeek}</span> días/semana ·
        Mesociclo 1 (<span className="tnum">{mesocycle.weeksPlanned}</span>{" "}
        semanas,{" "}
        {mesocycle.status === "PLANNED"
          ? "planificado"
          : mesocycle.status.toLowerCase()}
        )
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
