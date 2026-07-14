import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { getProfileOverview } from "@/server/repositories/profile.repo";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const overview = await getProfileOverview();
  const lastMeasurement = overview
    ? await prisma.bodyMeasurement.findFirst({
        where: { profileId: overview.profile.id },
        orderBy: { localDate: "desc" },
      })
    : null;

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Progreso</h1>

      {lastMeasurement ? (
        <div className="border-border bg-card mb-4 rounded-lg border p-4">
          <p className="text-muted-foreground text-sm">
            Última medición ({lastMeasurement.localDate})
          </p>
          <p className="tnum mt-1 text-2xl font-semibold">
            {lastMeasurement.weightKg?.toLocaleString("es-ES")} kg
            {lastMeasurement.waistCm ? (
              <span className="text-muted-foreground ml-3 text-base font-normal">
                cintura {lastMeasurement.waistCm.toLocaleString("es-ES")} cm
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="border-border rounded-lg border border-dashed p-6 text-center">
        <Badge variant="outline">Fases 4–5</Badge>
        <p className="text-muted-foreground mt-3 text-sm">
          Aquí llegarán la tendencia de peso con media móvil, la evolución de
          cintura y fuerza, las fotos comparables y el panel de adherencia por
          componentes. Con 7+ pesajes ya se podrá calcular tu primera tendencia.
        </p>
      </div>
    </AppShell>
  );
}
