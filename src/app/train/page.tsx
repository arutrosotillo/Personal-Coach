import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { RegisterServiceWorker } from "@/components/offline/register-sw";
import { RecoveryCard } from "@/components/training/recovery-card";
import { StartSessionButton } from "@/components/training/start-session-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatLocalDate } from "@/core/dates";
import { getCurrentProfile } from "@/server/auth/current-user";
import {
  getTodayOverview,
  previewTemplateSession,
} from "@/server/repositories/workout.repo";
import {
  getRecoveryVeto,
  getTrainingAnalysis,
} from "@/server/services/fatigue.service";
import { buildSuggestions } from "@/server/services/progression.service";

export const dynamic = "force-dynamic";

export default async function TrainPage() {
  const profile = await getCurrentProfile();
  const overview = profile ? await getTodayOverview(profile.id) : null;

  if (!profile || !overview) {
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

  // Después del early-return: sin programa, este análisis (8 consultas) se
  // calculaba solo para tirarlo.
  const analysis = await getTrainingAnalysis(profile.id);
  // Qué toca: el primer día pendiente de esta semana o, si ya están todos, el
  // primero de la semana que viene. Nunca "nada".
  const pendiente = overview.templates.find((t) => !t.done);
  const nextTemplate = pendiente ?? overview.nextWeekTemplate;
  const semanaCompleta = !pendiente;

  // Objetivos del próximo entrenamiento CALCULADOS AQUÍ, antes de empezarlo.
  // Es lo que hace que entrar al gimnasio sin cobertura siga sabiendo qué toca:
  // este HTML lo cachea el service worker, así que los pesos y las reps ya
  // están escritos cuando `startSessionAction` todavía no ha podido correr.
  const preview =
    !overview.active && nextTemplate
      ? await previewTemplateSession(
          profile.id,
          nextTemplate.id,
          analysis.context.todayLocalDate,
        )
      : null;
  const previewTargets = preview
    ? buildSuggestions(
        preview,
        await getRecoveryVeto(profile.id, analysis.context.todayLocalDate),
      )
    : null;

  return (
    <AppShell>
      {/* `/train` es el `start_url` de la PWA: si iOS mata la app y la vuelves a
          abrir, aterrizas aquí. Cacheada, "Reanudar sesión" sigue existiendo
          aunque no haya cobertura. */}
      <RegisterServiceWorker />
      <h1 className="mb-1 text-2xl font-semibold">Entrenar</h1>
      {/* Sin "de 6": nada ocurre al llegar a la semana 6 —el mesociclo no
          avanza ni se cierra solo—, así que un contador con final implicaba una
          periodización que no existe. La referencia del bloque vive en
          /program, que es donde hay sitio para explicarla. */}
      <p className="text-muted-foreground mb-4 text-sm">
        {overview.programName} · Semana{" "}
        <span className="tnum">{overview.weekNumber}</span>
      </p>

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
            <CardTitle className="text-base">
              {semanaCompleta ? "Siguiente entrenamiento" : "Hoy toca"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Al terminar la semana esto decía "¡Semana completada!" y ofrecía
                "repetir", que suena a rehacer el entrenamiento viejo. No lo es:
                el programa es un microciclo que se repite y cada exposición
                trae objetivos nuevos calculados con lo que hiciste. Lo que
                faltaba era decirlo. */}
            {semanaCompleta ? (
              <p className="text-muted-foreground mb-2 text-sm">
                Semana <span className="tnum">{overview.weekNumber}</span>{" "}
                completada 💪 — has hecho los{" "}
                <span className="tnum">{overview.templates.length}</span> días.
                La semana <span className="tnum">{overview.nextWeekNumber}</span>{" "}
                empieza el {formatLocalDate(overview.nextWeekStartDate)}. Puedes
                adelantarla hoy: no repites el entrenamiento anterior, los
                objetivos de abajo ya están recalculados con lo que hiciste.
              </p>
            ) : null}
            <p className="font-medium">{nextTemplate.name}</p>
            <p className="tnum text-muted-foreground text-sm">
              {nextTemplate.exerciseCount} ejercicios
            </p>
            {preview && previewTargets ? (
              <ul className="tnum mt-3 space-y-1 text-sm">
                {preview.exercises.map((e) => {
                  const t = previewTargets[e.id];
                  const peso =
                    t?.suggestedWeightKg !== null &&
                    t?.suggestedWeightKg !== undefined
                      ? `${t.suggestedWeightKg} kg`
                      : "carga a elegir";
                  const reps =
                    t?.setTargets && t.setTargets.length > 0
                      ? t.setTargets.join("/")
                      : `${e.repRangeMin}–${e.repRangeMax}`;
                  return (
                    <li
                      key={e.id}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="truncate">
                        {e.exerciseName}
                        <span className="text-muted-foreground">
                          {" "}
                          · {e.variantName}
                        </span>
                      </span>
                      <span className="text-muted-foreground shrink-0">
                        {peso} × {reps} @ RIR {e.targetRir}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="mt-3">
              <StartSessionButton
                templateId={nextTemplate.id}
                label={
                  semanaCompleta
                    ? `Empezar semana ${overview.nextWeekNumber}`
                    : "Empezar entrenamiento"
                }
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* El estado de recuperación es contexto, no la tarea del día: con la
          tarjeta arriba, "Empezar entrenamiento" caía por debajo de la nav. */}
      {analysis.context.sessions.length > 0 ? (
        <RecoveryCard fatigue={analysis.fatigue} />
      ) : null}

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
                      label="Otra vez"
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
