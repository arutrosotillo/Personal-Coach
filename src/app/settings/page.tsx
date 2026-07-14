import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProfileOverview } from "@/server/repositories/profile.repo";

export const dynamic = "force-dynamic";

const WORK_LABELS: Record<string, string> = {
  SEDENTARY: "Sedentaria",
  LIGHT: "Ligera",
  MODERATE: "Moderada",
  HIGH: "Alta",
};

export default async function SettingsPage() {
  const overview = await getProfileOverview();

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Ajustes</h1>

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
                {WORK_LABELS[overview.profile.workActivity ?? ""] ?? "—"}
              </p>
              <Button
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
