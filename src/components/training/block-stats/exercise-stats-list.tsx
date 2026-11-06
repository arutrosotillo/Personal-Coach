"use client";

import { useState } from "react";

import { diffDays } from "@/core/dates";
import type {
  ExerciseStats,
  ExerciseVerdict,
  ExerciseWindow,
} from "@/core/training/block-stats";
import { formatNumber, formatShortDate, formatSigned } from "@/lib/body-labels";
import { Button } from "@/components/ui/button";
import {
  Sparkline,
  TrendChart,
} from "@/components/training/block-stats/trend-chart";

const VERDICT_LABEL: Record<ExerciseVerdict, string> = {
  UP: "Sube",
  FLAT: "Estable",
  DOWN: "Baja",
};

type Metric = "LOAD" | "REPS" | "EQUIVALENT" | "E1RM";

const METRIC_LABEL: Record<Metric, string> = {
  LOAD: "Carga",
  REPS: "Reps",
  EQUIVALENT: "Rendimiento~",
  E1RM: "e1RM~",
};

function metricValues(e: ExerciseStats, metric: Metric): Array<number | null> {
  switch (metric) {
    case "LOAD":
      return e.points.map((p) => p.workWeightKg);
    case "REPS":
      return e.points.map((p) => p.bestReps);
    case "EQUIVALENT":
      return e.points.map((p) => p.equivalentLoadKg);
    case "E1RM":
      return e.points.map((p) => p.e1rmKg);
  }
}

function WindowRow({
  label,
  w,
  today,
}: {
  label: string;
  w: ExerciseWindow;
  today: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">
        {label} ·{" "}
        <span className="tnum">
          {formatShortDate(w.fromDate, today)} –{" "}
          {formatShortDate(w.toDate, today)}
        </span>
      </p>
      <p className="tnum text-sm font-medium">
        {formatNumber(w.workWeightKg)} kg × {formatNumber(w.avgReps)} reps
      </p>
      <p className="text-muted-foreground tnum text-xs">
        {w.avgRir !== null ? `RIR ${formatNumber(w.avgRir)}` : "Sin RIR"}
        {w.equivalentLoadKg !== null
          ? ` · ≈${formatNumber(w.equivalentLoadKg)} kg a 10 reps`
          : ""}
        {w.e1rmKg !== null ? ` · e1RM~ ${formatNumber(w.e1rmKg)} kg` : ""}
      </p>
    </div>
  );
}

function ExerciseDetail({ e, today }: { e: ExerciseStats; today: string }) {
  const available = (["LOAD", "REPS", "EQUIVALENT", "E1RM"] as Metric[]).filter(
    (m) => metricValues(e, m).some((v) => v !== null),
  );
  const [metric, setMetric] = useState<Metric>("LOAD");
  const values = metricValues(e, metric);
  const start = e.points[0].localDate;

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Qué ver">
        {available.map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={m === metric ? "default" : "secondary"}
            aria-pressed={m === metric}
            className="min-h-9"
            onClick={() => setMetric(m)}
          >
            {METRIC_LABEL[m]}
          </Button>
        ))}
      </div>

      <TrendChart
        title={`${METRIC_LABEL[metric]} de ${e.exerciseName} (${e.variantName}) por sesión`}
        xLabels={e.points.map((p) => formatShortDate(p.localDate, today))}
        xPositions={e.points.map((p) => diffDays(start, p.localDate))}
        series={[
          {
            key: metric,
            label: METRIC_LABEL[metric],
            color: "var(--viz-1)",
            values,
          },
        ]}
        unit={metric === "REPS" ? "reps" : "kg"}
        digits={metric === "REPS" ? 0 : 1}
      />

      <p className="text-muted-foreground text-xs">
        {metric === "LOAD"
          ? "Registrado: el peso de la mayoría de las series."
          : metric === "REPS"
            ? "Registrado: la mejor serie al peso de trabajo."
            : metric === "EQUIVALENT"
              ? "Estimación: el peso con el que harías 10 repeticiones, según tu mejor serie. Sirve para comparar el ejercicio consigo mismo aunque cambien kilos y repeticiones a la vez."
              : "Estimación: solo existe cuando reps + RIR no pasan de 12. Es una referencia, no tu 1RM real."}
      </p>

      {e.comparison ? (
        <div className="border-border grid grid-cols-1 gap-3 border-t pt-3">
          <WindowRow label="Inicio" w={e.comparison.start} today={today} />
          <WindowRow label="Final" w={e.comparison.end} today={today} />
          {e.comparison.basis === "VOLUME_LOAD" ? (
            <p className="text-muted-foreground text-xs">
              Con peso corporal la carga anotada es solo el lastre: se compara
              lastre × repeticiones, sin estimar nada.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground border-border border-t pt-3 text-xs">
          {e.sessions} {e.sessions === 1 ? "sesión" : "sesiones"}: pocas para
          comparar el inicio con el final sin que sean dos días sueltos.
        </p>
      )}
      {e.comparableSince ? (
        <p className="text-muted-foreground text-xs">
          Cambió de máquina el {formatShortDate(e.comparableSince, today)}: solo
          se compara desde entonces.
        </p>
      ) : null}
    </div>
  );
}

export function ExerciseStatsList({
  exercises,
  todayLocalDate,
}: {
  exercises: ExerciseStats[];
  todayLocalDate: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ul className="divide-border divide-y">
      {exercises.map((e) => {
        const isOpen = open === e.variantId;
        return (
          <li key={e.variantId} className="py-2 first:pt-0 last:pb-0">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : e.variantId)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {e.exerciseName}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {e.variantName} ·{" "}
                  <span className="tnum">
                    {e.sessions} {e.sessions === 1 ? "sesión" : "sesiones"}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Sparkline values={e.points.map((p) => p.trendValue)} />
                <span className="w-14 text-right text-xs">
                  {e.comparison ? (
                    <>
                      <span className="block font-medium">
                        {VERDICT_LABEL[e.comparison.verdict]}
                      </span>
                      <span className="text-muted-foreground tnum block">
                        {formatSigned(e.comparison.changePct, 1)} %
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Pocos datos</span>
                  )}
                </span>
              </span>
            </button>
            {isOpen ? <ExerciseDetail e={e} today={todayLocalDate} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
