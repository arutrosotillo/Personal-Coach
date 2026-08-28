import Link from "next/link";

import { isCoachConfigured } from "@/ai/config";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/server/actions/auth.action";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { workActivityLabel } from "@/lib/labels";
import { getCurrentProfileOverview } from "@/server/auth/current-user";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const overview = await getCurrentProfileOverview();
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
                Todo se guarda en tu propia base de datos PostgreSQL, a la que
                solo accedes tú. Sin cuentas de terceros, sin analítica, sin
                rastreadores.
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
                      tus datos no salen hacia ningún tercero
                    </span>
                    . Si lo activas, tu entrenamiento reciente viajará a OpenAI
                    cuando pulses un botón del coach.
                  </>
                )}
              </p>
              <p>
                Copia de seguridad manual: <code>pnpm db:backup</code> guarda un
                volcado completo en <code>exports/</code>.
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

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Sesión</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Estás dentro en este dispositivo. La sesión se renueva sola mientras
            uses la app y caduca a los 90 días sin usarla.
          </p>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" className="min-h-11">
              Cerrar sesión
            </Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
