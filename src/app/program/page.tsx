import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { ProgramRationaleCard } from "@/components/training/program-rationale-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProgramRationale } from "@/server/repositories/program.repo";
import { getProfileOverview } from "@/server/repositories/profile.repo";

export const dynamic = "force-dynamic";

export default async function ProgramPage() {
  const overview = await getProfileOverview();
  const program = overview?.program;
  const mesocycle = program?.mesocycles[0];
  const rationale = program ? await getProgramRationale(program.id) : null;

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

      <div className="space-y-4">
        {mesocycle.templates.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <CardTitle className="text-base">
                Día {template.ordinal} — {template.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-border divide-y">
                {template.exercises.map((te) => (
                  <li
                    key={te.id}
                    className="flex items-baseline justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {te.exerciseVariant.exercise.name}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {te.exerciseVariant.name}
                      </p>
                    </div>
                    <p className="tnum text-muted-foreground shrink-0 text-sm">
                      {te.baseSets} × {te.repRangeMin}–{te.repRangeMax} · RIR{" "}
                      {te.targetRir}
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
