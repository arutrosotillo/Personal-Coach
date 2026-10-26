import Link from "next/link";

import { CycleSummaryView } from "@/components/cycles/cycle-summary-view";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatShortDate, formatSigned } from "@/lib/body-labels";
import {
  cycleName,
  cycleStatusLabel,
  formatKcal,
  MAINTENANCE_BASIS_LABEL,
} from "@/lib/cycle-labels";
import { getCurrentProfile } from "@/server/auth/current-user";
import { getCycleHistory } from "@/server/services/cycle.service";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  CYCLE_CLOSE: "Al cerrar un ciclo",
  CYCLE_START: "Al empezar un ciclo",
  ADJUSTMENT: "Al responder a un ajuste",
};

/**
 * Historial de ciclos: cada fase con su resumen —el congelado al cerrarla, o
 * calculado ahora para las anteriores a esta versión— y cómo ha evolucionado
 * la estimación de tu mantenimiento. Nada de esto se reescribe.
 */
export default async function CyclesPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    return (
      <AppShell>
        <p className="text-muted-foreground text-sm">Aún no hay perfil.</p>
      </AppShell>
    );
  }
  const { items, estimates, todayLocalDate } = await getCycleHistory(
    profile.id,
  );

  return (
    <AppShell>
      <div className="mb-4">
        <Link
          href="/progress"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← Progreso
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Tus ciclos</h1>
      </div>

      <div className="space-y-4">
        {items.map((item) => (
          <Card key={item.goalId}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span>{cycleName(item.strategy)}</span>
                <Badge variant={item.active ? "default" : "secondary"}>
                  {cycleStatusLabel(item.status)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {item.summary ? (
                <details open={item.active}>
                  <summary className="text-muted-foreground tnum min-h-9 cursor-pointer py-2 text-sm">
                    {formatShortDate(item.startDate, todayLocalDate)} →{" "}
                    {item.active
                      ? "hoy"
                      : formatShortDate(item.endDate, todayLocalDate)}
                    {item.summary.weight.changeKg !== null
                      ? ` · ${formatSigned(item.summary.weight.changeKg, 1)} kg`
                      : ""}
                  </summary>
                  <div className="pt-2">
                    <CycleSummaryView
                      summary={item.summary}
                      todayLocalDate={todayLocalDate}
                    />
                    {item.computedNow ? (
                      <p className="text-muted-foreground mt-3 text-xs">
                        {item.active
                          ? "Ciclo en curso: el resumen se actualiza con cada dato."
                          : "Este ciclo es anterior a los resúmenes guardados: se ha calculado ahora con tus datos."}
                      </p>
                    ) : null}
                  </div>
                </details>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Sin datos suficientes para resumir este ciclo.
                </p>
              )}
            </CardContent>
          </Card>
        ))}

        {estimates.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Cómo ha evolucionado tu mantenimiento
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {[...estimates].reverse().map((e, i) => (
                  <li
                    key={`${e.localDate}-${e.kind}-${i}`}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="text-muted-foreground text-xs">
                      {formatShortDate(e.localDate, todayLocalDate)} ·{" "}
                      {KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                    <span className="tnum text-right">
                      ~{formatKcal(e.tdeeKcal)} kcal
                      <span className="text-muted-foreground block text-xs">
                        {formatKcal(e.lowKcal)}–{formatKcal(e.highKcal)} ·{" "}
                        {MAINTENANCE_BASIS_LABEL[
                          e.basis as keyof typeof MAINTENANCE_BASIS_LABEL
                        ] ?? e.basis}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-3 text-xs">
                Cada estimación se guarda cuando decides algo con ella delante.
                La de cada ciclo cerrado es el punto de partida del siguiente.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
