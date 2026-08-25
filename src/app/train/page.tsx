import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { RecoveryCard } from "@/components/training/recovery-card";
import { StartSessionButton } from "@/components/training/start-session-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProfile } from "@/server/repositories/profile.repo";
import { getTodayOverview } from "@/server/repositories/workout.repo";
import { getTrainingAnalysis } from "@/server/services/fatigue.service";

export const dynamic = "force-dynamic";

export default async function TrainPage() {
  const profile = await getProfile();
  const overview = profile ? await getTodayOverview(profile.id) : null;
  const analysis = profile ? await getTrainingAnalysis(profile.id) : null;

  if (!overview) {
    return (
      <AppShell>
        <h1 className="mb-4 text-2xl font-semibold">Entrenar</h1>
        <p className="text-muted-foreground">
          Aún no hay programa. Crea tu plan para empezar a entrenar.
        </p>
        <Button
          nativeButton={false}
          render={<Link href="/onboarding" />}
          className="mt-4 min-h-11"
        >
          Crear mi plan
        </Button>
      </AppShell>
    );
  }

  const nextTemplate = overview.templates.find((t) => !t.done);

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-semibold">Entrenar</h1>
      <p className="text-muted-foreground mb-4 text-sm">
        {overview.programName} · Semana{" "}
        <span className="tnum">{overview.weekNumber}</span> de{" "}
        <span className="tnum">{overview.weeksPlanned}</span>
      </p>

      {analysis ? <RecoveryCard fatigue={analysis.fatigue} /> : null}

      {overview.active ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Sesión en curso</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{overview.active.templateName}</p>
            <p className="tnum text-muted-foreground text-sm">
              {overview.active.doneSets} de {overview.active.totalSets} series
            </p>
            <Button
              nativeButton={false}
              render={<Link href={`/train/session/${overview.active.id}`} />}
              className="mt-3 min-h-11 w-full"
            >
              Reanudar sesión
            </Button>
          </CardContent>
        </Card>
      ) : nextTemplate ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Hoy toca</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{nextTemplate.name}</p>
            <p className="tnum text-muted-foreground text-sm">
              {nextTemplate.exerciseCount} ejercicios
            </p>
            <div className="mt-3">
              <StartSessionButton
                templateId={nextTemplate.id}
                label="Empezar entrenamiento"
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4">
          <CardContent className="pt-4">
            <p className="font-medium">¡Semana completada! 💪</p>
            <p className="text-muted-foreground text-sm">
              Has hecho todas las sesiones de esta semana. Puedes repetir
              cualquiera si quieres.
            </p>
          </CardContent>
        </Card>
      )}

      <h2 className="text-muted-foreground mb-2 text-sm font-medium">
        Sesiones de la semana
      </h2>
      <ul className="space-y-2">
        {overview.templates.map((t) => (
          <li
            key={t.id}
            className="border-border bg-card flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
          >
            <div>
              <p className="font-medium">
                Día {t.ordinal} — {t.name}
              </p>
              <p className="tnum text-muted-foreground text-xs">
                {t.exerciseCount} ejercicios
              </p>
            </div>
            {t.done ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline">Hecha ✓</Badge>
                {!overview.active ? (
                  <div className="w-24">
                    <StartSessionButton
                      templateId={t.id}
                      label="Repetir"
                      variant="secondary"
                    />
                  </div>
                ) : null}
              </div>
            ) : overview.active ? (
              <span className="text-muted-foreground text-xs">Pendiente</span>
            ) : (
              <div className="w-32">
                <StartSessionButton
                  templateId={t.id}
                  label="Empezar"
                  variant="secondary"
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-6 flex gap-2">
        <Button
          nativeButton={false}
          render={<Link href="/train/history" />}
          variant="secondary"
          className="min-h-11 flex-1"
        >
          Historial
        </Button>
        <Button
          nativeButton={false}
          render={<Link href="/train/exercises" />}
          variant="secondary"
          className="min-h-11 flex-1"
        >
          Biblioteca
        </Button>
      </div>
      <div className="mt-2">
        <Button
          nativeButton={false}
          render={<Link href="/program" />}
          variant="secondary"
          className="min-h-11 w-full"
        >
          Ver / editar programa
        </Button>
      </div>
    </AppShell>
  );
}
