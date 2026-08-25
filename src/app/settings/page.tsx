import Link from "next/link";

import { isCoachConfigured } from "@/ai/config";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { workActivityLabel } from "@/lib/labels";
import { getProfileOverview } from "@/server/repositories/profile.repo";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const overview = await getProfileOverview();
  const coachReady = isCoachConfigured();

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Ajustes</h1>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Ciencia y coach</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-muted-foreground text-sm">
            AI Coach:{" "}
            {coachReady ? (
              <span>configurado</span>
            ) : (
              <span>
                no configurado — añade <code>OPENAI_API_KEY</code> a tu{" "}
                <code>.env</code>
              </span>
            )}
            .
          </p>
          <Button
            nativeButton={false}
            render={<Link href="/science" />}
            variant="secondary"
            className="min-h-11 w-full"
          >
            Filosofía, evidencia y bibliografía
          </Button>
        </CardContent>
      </Card>

      {overview ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Perfil</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Nacimiento:</span>{" "}
                <span className="tnum">{overview.profile.birthDate}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Altura:</span>{" "}
                <span className="tnum">{overview.profile.heightCm} cm</span>
              </p>
              <p>
                <span className="text-muted-foreground">Pasos/día:</span>{" "}
                <span className="tnum">
                  {overview.profile.dailySteps?.toLocaleString("es-ES") ?? "—"}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">
                  Actividad laboral:
                </span>{" "}
                {workActivityLabel(overview.profile.workActivity)}
              </p>
              <Button
                nativeButton={false}
                render={<Link href="/onboarding" />}
                variant="secondary"
                className="mt-3 min-h-11 w-full"
              >
                Repetir onboarding (actualiza tu plan)
              </Button>
              <p className="text-muted-foreground pt-1 text-xs">
                Repetirlo no borra tu historial: actualiza el perfil, cierra el
                objetivo anterior y genera un programa nuevo.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tus datos</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground space-y-2 text-sm">
              <p>
                Todo se guarda localmente en{" "}
                <code className="text-foreground">data/app.db</code> (SQLite)
                dentro de la carpeta del proyecto. Sin cuentas, sin nube, sin
                analítica.
              </p>
              <p>
                {coachReady ? (
                  <>
                    <span className="text-foreground">
                      El AI Coach está activo
                    </span>
                    , así que es la única salida de datos de la app: cuando
                    pulsas un botón del coach, tu entrenamiento reciente
                    (sesiones, cargas, repeticiones, RIR y las notas que
                    escribas) viaja a OpenAI. No se envían tu nombre, tu edad,
                    tu peso ni tus medidas, y nada se guarda allí. Para
                    desactivarlo, quita <code>OPENAI_API_KEY</code> de tu
                    fichero <code>.env</code> y reinicia.
                  </>
                ) : (
                  <>
                    El AI Coach está desactivado (no hay{" "}
                    <code>OPENAI_API_KEY</code>), así que ahora mismo{" "}
                    <span className="text-foreground">
                      no sale ni un dato de tu máquina
                    </span>
                    . Si lo activas, tu entrenamiento reciente viajará a OpenAI
                    cuando pulses un botón del coach.
                  </>
                )}
              </p>
              <p>
                Copia de seguridad manual: copia la carpeta <code>data/</code>{" "}
                con la app cerrada.
              </p>
              <p className="flex items-center gap-2">
                <Badge variant="outline">Fase 7</Badge> Exportación JSON/CSV,
                importación y borrado total desde esta pantalla.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="pt-8 text-center">
          <p className="text-muted-foreground">Aún no hay perfil.</p>
          <Button
            nativeButton={false}
            render={<Link href="/onboarding" />}
            className="mt-4 min-h-11"
          >
            Crear mi plan
          </Button>
        </div>
      )}
    </AppShell>
  );
}
