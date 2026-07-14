import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { PhaseNote } from "@/components/layout/phase-note";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { strategyLabel } from "@/lib/labels";
import { getProfileOverview } from "@/server/repositories/profile.repo";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const overview = await getProfileOverview();

  if (!overview) {
    return (
      <AppShell>
        <div className="flex flex-col items-center gap-6 pt-16 text-center">
          <div>
            <h1 className="text-3xl font-semibold">Personal Coach</h1>
            <p className="text-muted-foreground mt-2">
              Entrenamiento, nutrición y seguimiento corporal. Todo local, todo
              tuyo.
            </p>
          </div>
          <Button
            nativeButton={false}
            render={<Link href="/onboarding" />}
            size="lg"
            className="min-h-12 w-full max-w-xs"
          >
            Empezar — crear mi plan
          </Button>
          <p className="text-muted-foreground text-xs">
            ~4 minutos. Tus datos no salen de tu ordenador.
          </p>
        </div>
      </AppShell>
    );
  }

  const { goal, nutritionTarget, program } = overview;
  const mesocycle = program?.mesocycles[0];

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Hoy</h1>
      <div className="space-y-4">
        {goal ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Objetivo</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{strategyLabel(goal.strategy)}</p>
              <p className="tnum text-muted-foreground text-sm">
                Ritmo {goal.weeklyRatePct.toLocaleString("es-ES")} % del
                peso/semana
                {goal.targetWeightKg
                  ? ` · objetivo ~${goal.targetWeightKg} kg`
                  : ""}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {nutritionTarget ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nutrición diaria</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="tnum text-3xl font-semibold">
                {nutritionTarget.kcal.toLocaleString("es-ES")}{" "}
                <span className="text-muted-foreground text-base font-normal">
                  kcal
                </span>
              </p>
              <p className="tnum text-muted-foreground mt-1 text-sm">
                {nutritionTarget.proteinG} g proteína · {nutritionTarget.fatG} g
                grasa · {nutritionTarget.carbsG} g carbohidratos
              </p>
              {nutritionTarget.notes ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  {nutritionTarget.notes}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {program ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tu programa</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium">{program.name}</p>
              <p className="text-muted-foreground text-sm">
                <span className="tnum">{program.daysPerWeek}</span> días/semana
                · {mesocycle?.templates.map((t) => t.name).join(" · ")}
              </p>
              <Button
                nativeButton={false}
                render={<Link href="/program" />}
                variant="secondary"
                className="mt-3 min-h-11 w-full"
              >
                Ver programa completo
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <PhaseNote phase="Fase 2">
          Registro de entrenamientos con recomendaciones de carga, check-in
          diario de peso y calorías, e historial. Esta versión deja creado tu
          plan inicial; el registro llega en la siguiente fase.
        </PhaseNote>
      </div>
    </AppShell>
  );
}
