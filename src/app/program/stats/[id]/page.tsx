import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import {
  blockPeriodLabel,
  BlockStatsSections,
  BlockStructure,
} from "@/components/training/block-stats/block-stats-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DEFAULT_TIMEZONE, toLocalDate } from "@/core/dates";
import { getCurrentProfile } from "@/server/auth/current-user";
import { getBlockStatsView } from "@/server/services/block-stats.service";

export const dynamic = "force-dynamic";

/**
 * Estadísticas de un bloque de entrenamiento, archivado o en curso. Solo lee: ni
 * archiva, ni reactiva, ni toca los datos de nadie.
 */
export default async function BlockStatsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/onboarding");

  const view = await getBlockStatsView(profile.id, id);
  if (!view) notFound();
  const { program, stats, fatigue } = view;
  const today = toLocalDate(new Date(), profile.timezone ?? DEFAULT_TIMEZONE);

  return (
    <AppShell>
      <div className="mb-1 flex items-start justify-between gap-2">
        <h1 className="min-w-0 text-2xl font-semibold">{program.name}</h1>
        <Button
          nativeButton={false}
          render={
            <Link href={program.isActive ? "/program" : "/program/history"} />
          }
          variant="ghost"
          size="sm"
          className="min-h-9 shrink-0"
        >
          Volver
        </Button>
      </div>
      <p className="text-muted-foreground mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">
          {program.isActive ? "En curso" : "Archivado"}
        </Badge>
        {stats ? (
          <span className="tnum">{blockPeriodLabel(stats, today)}</span>
        ) : null}
      </p>

      {stats ? (
        <BlockStatsSections
          stats={stats}
          fatigue={fatigue}
          todayLocalDate={today}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          Este bloque no se llegó a entrenar: todavía no hay nada que medir.
        </p>
      )}

      <Card className="mt-4">
        <CardContent className="pt-4">
          <details>
            <summary className="min-h-9 cursor-pointer font-medium">
              Estructura del programa
            </summary>
            <div className="mt-3">
              <BlockStructure program={program} />
            </div>
          </details>
        </CardContent>
      </Card>
    </AppShell>
  );
}
