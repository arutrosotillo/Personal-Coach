import { AppShell } from "@/components/layout/app-shell";
import { PhaseNote } from "@/components/layout/phase-note";
import { Card, CardContent } from "@/components/ui/card";
import {
  getLatestMeasurement,
  getProfileOverview,
} from "@/server/repositories/profile.repo";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const overview = await getProfileOverview();
  const lastMeasurement = overview
    ? await getLatestMeasurement(overview.profile.id)
    : null;

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Progreso</h1>

      {lastMeasurement ? (
        <Card className="mb-4">
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Última medición (
              <span className="tnum">{lastMeasurement.localDate}</span>)
            </p>
            <p className="tnum mt-1 text-2xl font-semibold">
              {lastMeasurement.weightKg?.toLocaleString("es-ES")} kg
              {lastMeasurement.waistCm ? (
                <span className="text-muted-foreground ml-3 text-base font-normal">
                  cintura {lastMeasurement.waistCm.toLocaleString("es-ES")} cm
                </span>
              ) : null}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <PhaseNote phase="Fases 4–5">
        Aquí llegarán la tendencia de peso con media móvil, la evolución de
        cintura y fuerza, las fotos comparables y el panel de adherencia por
        componentes. Con 7+ pesajes ya se podrá calcular tu primera tendencia.
      </PhaseNote>
    </AppShell>
  );
}
