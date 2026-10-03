import Link from "next/link";

import { QuickWeightCard } from "@/components/body/quick-weight-card";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { diffDays } from "@/core/dates";
import { strategyLabel } from "@/lib/labels";
import { getCurrentProfileOverview } from "@/server/auth/current-user";
import {
  getMeasurementForDate,
  todayForProfile,
} from "@/server/services/body.service";
import { getLatestMeasurement } from "@/server/repositories/profile.repo";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const overview = await getCurrentProfileOverview();

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
            ~4 minutos. Se guarda todo en tu ordenador.
          </p>
        </div>
      </AppShell>
    );
  }

  const { goal, nutritionTarget, program } = overview;
  const mesocycle = program?.mesocycles[0];

  // Peso de hoy y hueco desde el último: lo justo para que la tarjeta rápida
  // sepa si está creando o corrigiendo, y para ajustar su texto de ayuda.
  const todayLocalDate = todayForProfile();
  const [todayMeasurement, latestMeasurement] = await Promise.all([
    getMeasurementForDate(overview.profile.id, todayLocalDate),
    getLatestMeasurement(overview.profile.id),
  ]);
  const daysSinceLastWeight =
    latestMeasurement && latestMeasurement.weightKg !== null
      ? diffDays(latestMeasurement.localDate, todayLocalDate)
      : null;

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Hoy</h1>
      <div className="space-y-4">
        <QuickWeightCard
          todayLocalDate={todayLocalDate}
          initialWeightKg={todayMeasurement?.weightKg ?? null}
          daysSinceLastWeight={daysSinceLastWeight}
        />

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
      </div>
    </AppShell>
  );
}
