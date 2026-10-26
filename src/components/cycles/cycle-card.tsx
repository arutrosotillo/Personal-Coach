import Link from "next/link";

import { MaintenanceDetails } from "@/components/cycles/maintenance-details";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CompositionAdvisory } from "@/core/cycles";
import { formatShortDate } from "@/lib/body-labels";
import {
  cycleName,
  CYCLE_STATUS_LABEL,
  formatDuration,
  formatKcal,
  rateText,
} from "@/lib/cycle-labels";
import type { CycleOverview } from "@/server/services/cycle.service";

/**
 * El ciclo de un vistazo: en qué fase estás, cuánto llevas, tu objetivo, tus
 * calorías y macros, y tu mantenimiento estimado con su procedencia. Desde
 * aquí se finaliza el ciclo y se consultan los anteriores.
 *
 * Sin ciclo activo dice exactamente eso, con las calorías que siguen vigentes,
 * y ofrece empezar uno. No hay nada automático que "se dispare" al llegar a
 * una fecha o a un peso.
 */
export function CycleCard({ overview }: { overview: CycleOverview }) {
  const { active, target, maintenance, todayLocalDate, lastClosed } = overview;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>
            {active ? cycleName(active.strategy) : "Sin ciclo activo"}
          </span>
          {active ? (
            <Badge variant="secondary">Semana {active.week}</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {active ? (
          <div>
            <p className="tnum">
              Desde el {formatShortDate(active.startDate, todayLocalDate)} ·{" "}
              {formatDuration(active.daysIn)}
            </p>
            <p className="text-muted-foreground tnum mt-0.5 text-xs">
              {rateText(active.strategy, active.weeklyRatePct)}
              {active.targetWeightKg !== null
                ? ` · peso objetivo ${active.targetWeightKg.toLocaleString("es-ES")} kg (orienta; no cierra el ciclo)`
                : ""}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">
            {lastClosed
              ? `Tu último ciclo (${cycleName(lastClosed.strategy).toLowerCase()}, ${CYCLE_STATUS_LABEL[lastClosed.status].toLowerCase()}) terminó el ${formatShortDate(lastClosed.endDate, todayLocalDate)}. `
              : ""}
            Mientras no empieces otro, la app no ajusta tus calorías ni compara
            tu peso con ningún ritmo. Tu entrenamiento sigue igual.
          </p>
        )}

        {target ? (
          <div className="border-border rounded-md border p-3">
            <p className="text-muted-foreground text-xs">
              Tus calorías y macros
            </p>
            <p className="tnum text-2xl font-semibold">
              {formatKcal(target.kcal)}
              <span className="text-muted-foreground ml-1 text-base font-normal">
                kcal/día
              </span>
            </p>
            <p className="text-muted-foreground tnum mt-0.5 text-xs">
              {target.proteinG} g proteína · {target.fatG} g grasa ·{" "}
              {target.carbsG} g carbohidratos
            </p>
          </div>
        ) : null}

        <MaintenanceDetails maintenance={maintenance} />

        <div className="grid grid-cols-2 gap-2">
          <Button
            nativeButton={false}
            render={<Link href="/progress/cycle" />}
            variant={active ? "secondary" : "default"}
            className="min-h-11"
          >
            {active ? "Finalizar ciclo" : "Empezar un ciclo"}
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/progress/cycles" />}
            variant="outline"
            className="min-h-11"
          >
            Ciclos anteriores
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Aviso de composición en una fase de ganancia. Solo aparece si hay algo que
 * vigilar, y nunca hace nada: las opciones se eligen finalizando el ciclo.
 */
export function CompositionCard({
  advisory,
}: {
  advisory: CompositionAdvisory | null;
}) {
  if (!advisory || advisory.level === "NONE") return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{advisory.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground leading-relaxed">
          {advisory.explanation}
        </p>
        {advisory.options.length > 0 ? (
          <>
            <ul className="list-disc space-y-1 pl-5">
              {advisory.options.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
            <Button
              nativeButton={false}
              render={<Link href="/progress/cycle" />}
              variant="secondary"
              className="min-h-11 w-full"
            >
              Revisar mi fase
            </Button>
          </>
        ) : null}
        {advisory.notes.map((n) => (
          <p key={n} className="text-muted-foreground text-xs">
            {n}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
