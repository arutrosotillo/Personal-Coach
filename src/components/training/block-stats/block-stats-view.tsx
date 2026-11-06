import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExerciseStatsList } from "@/components/training/block-stats/exercise-stats-list";
import { TrendChart } from "@/components/training/block-stats/trend-chart";
import { FATIGUE } from "@/core/config/training-config";
import type {
  BlockStats,
  BlockWeekAdherence,
  MuscleWeeklyStats,
  StartEndMetric,
} from "@/core/training/block-stats";
import type { DeloadDecision } from "@/core/training/fatigue";
import { formatTargetRir } from "@/core/training/rir-target";
import { formatNumber, formatShortDate, formatSigned } from "@/lib/body-labels";
import type { BlockProgram } from "@/server/repositories/block-stats.repo";
import type { BlockFatigueTimeline } from "@/server/services/block-stats.service";

/**
 * Estadísticas de un bloque de entrenamiento.
 *
 * La pantalla no interpreta: enseña lo que pasó y dice de dónde sale cada número.
 * Lo registrado, lo estimado con una fórmula y lo reconstruido con el motor de
 * hoy se etiquetan por separado, porque no pesan lo mismo. No hay verde ni rojo:
 * esos colores están reservados a los avisos, y bajar de RIR o de series no es
 * bueno ni malo sin contexto.
 */

type SourceKind = "REGISTERED" | "ESTIMATED" | "RECONSTRUCTED";

const SOURCE_LABEL: Record<SourceKind, string> = {
  REGISTERED: "Registrado",
  ESTIMATED: "Estimado",
  RECONSTRUCTED: "Reconstruido",
};

function SectionCard({
  title,
  source,
  children,
}: {
  title: string;
  source: SourceKind | SourceKind[];
  children: ReactNode;
}) {
  const sources = Array.isArray(source) ? source : [source];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <span className="flex shrink-0 gap-1">
            {sources.map((s) => (
              <Badge key={s} variant="outline">
                {SOURCE_LABEL[s]}
              </Badge>
            ))}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/** Una columna por semana, una casilla por sesión prevista. */
function AdherenceWeeks({ weeks }: { weeks: BlockWeekAdherence[] }) {
  return (
    <div>
      <div
        className="flex flex-wrap gap-2"
        role="img"
        aria-label={weeks
          .map((w) => `Semana ${w.week}: ${w.completed} de ${w.expected}`)
          .join(". ")}
      >
        {weeks.map((w) => {
          const slots = Math.max(w.completed, w.expected);
          return (
            <div
              key={w.week}
              className="flex w-5 flex-col items-center gap-0.5"
              title={`Semana ${w.week}: ${w.completed} de ${w.expected} sesiones`}
            >
              {Array.from({ length: slots }, (_, i) => (
                <span
                  key={i}
                  className="border-border block size-3.5 rounded-sm border"
                  style={
                    i < w.completed
                      ? {
                          background: "var(--viz-1)",
                          borderColor: "transparent",
                        }
                      : undefined
                  }
                />
              ))}
              <span className="text-muted-foreground tnum mt-0.5 text-[10px]">
                {w.week}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        Cada columna es una semana; cada casilla llena, una sesión hecha.
      </p>
    </div>
  );
}

/** Clases de intensidad: pocas, para que se distingan de verdad. */
function heatOpacity(sets: number): number {
  if (sets <= 0) return 0;
  if (sets <= 2) return 0.25;
  if (sets <= 4) return 0.45;
  if (sets <= 6) return 0.65;
  if (sets <= 8) return 0.85;
  return 1;
}

function MuscleRow({ m }: { m: MuscleWeeklyStats }) {
  return (
    <details className="group">
      <summary className="grid min-h-9 cursor-pointer list-none grid-cols-[6.5rem_2rem_1fr] items-center gap-2 text-xs">
        <span className="truncate">{m.nameEs}</span>
        <span className="tnum text-right font-medium">
          {formatNumber(m.avgEffectiveSets)}
        </span>
        <span className="flex gap-0.5" aria-hidden="true">
          {m.weeks.map((sets, i) => (
            <span
              key={i}
              className="border-border h-4 flex-1 rounded-[2px] border"
              style={
                sets === null || sets === 0
                  ? undefined
                  : {
                      background: "var(--viz-1)",
                      opacity: heatOpacity(sets),
                      borderColor: "transparent",
                    }
              }
            />
          ))}
        </span>
      </summary>
      <p className="text-muted-foreground tnum pb-2 text-xs">
        {formatNumber(m.avgDirectSets)} directas/semana.{" "}
        {m.weeks
          .map((s, i) => `S${i + 1}: ${s === null ? "—" : formatNumber(s)}`)
          .join(" · ")}
      </p>
    </details>
  );
}

const START_END_LABEL: Record<StartEndMetric["key"], string> = {
  SESSIONS_PER_WEEK: "Sesiones por semana",
  SETS_PER_WEEK: "Series por semana",
  AVG_RIR: "RIR medio anotado",
  FATIGUE: "Fatiga (1–5)",
  PERCEIVED_PERFORMANCE: "Rendimiento percibido (1–5)",
  JOINT_PAIN: "Dolor articular (1–5)",
  MOTIVATION: "Motivación (1–5)",
  DURATION: "Duración mediana (min)",
};

const DECISION_LABEL: Record<DeloadDecision, string> = {
  NO_DELOAD: "sin señales suficientes para descargar",
  DELOAD_WATCH: "en vigilancia, sin recomendar descarga",
  DELOAD_RECOMMENDED: "habría recomendado una descarga",
  INSUFFICIENT_DATA: "sin datos suficientes",
};

export function BlockStructure({ program }: { program: BlockProgram }) {
  return (
    <div className="space-y-3">
      {program.days.map((day) => (
        <div key={day.ordinal}>
          <p className="text-sm font-medium">{day.name}</p>
          <ul className="mt-1 space-y-1">
            {day.exercises.map((e) => (
              <li
                key={e.ordinal}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="min-w-0 truncate">
                  {e.exerciseName}
                  <span className="text-muted-foreground">
                    {" "}
                    · {e.variantName}
                  </span>
                </span>
                <span className="text-muted-foreground tnum shrink-0">
                  {e.baseSets} × {e.repRangeMin}–{e.repRangeMax} · RIR{" "}
                  {formatTargetRir(e.targetRir, e.targetRirMin)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function BlockStatsSections({
  stats,
  fatigue,
  todayLocalDate,
}: {
  stats: BlockStats;
  fatigue: BlockFatigueTimeline | null;
  todayLocalDate: string;
}) {
  const weekLabels = stats.adherence.weeks.map((w) => `S${w.week}`);
  const { adherence, comparison, volume, startEnd } = stats;
  const lastEffort = stats.effort.filter((e) => e.setsWithRir > 0);
  const setsWithoutRir = stats.effort.reduce((a, e) => a + e.setsWithoutRir, 0);
  const lastFatigue = fatigue?.points[fatigue.points.length - 1] ?? null;
  const painWeeks = (fatigue?.points ?? [])
    .filter((p) => p.jointPainLevel === "ACTION")
    .map((p) => `S${p.week}`);
  const recoveryCharts = [
    { key: "fatigue", label: "Fatiga", pick: "fatigue" },
    {
      key: "perf",
      label: "Rendimiento percibido",
      pick: "perceivedPerformance",
    },
    { key: "pain", label: "Dolor articular", pick: "jointPain" },
    { key: "motivation", label: "Motivación", pick: "motivation" },
  ] as const;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        <strong className="text-foreground font-medium">Registrado</strong> es
        lo que anotaste.{" "}
        <strong className="text-foreground font-medium">Estimado</strong> sale
        de una fórmula.{" "}
        <strong className="text-foreground font-medium">Reconstruido</strong> es
        lo que dice hoy el motor con los datos de entonces.
      </p>

      <SectionCard title="Adherencia" source="REGISTERED">
        <div className="grid grid-cols-2 gap-4">
          <Kpi
            label="Sesiones"
            value={`${adherence.completed} de ${adherence.expected}`}
            hint={`${adherence.pct} % · ${adherence.weeks[0]?.expected ?? 0} por semana`}
          />
          <Kpi
            label="Series de trabajo"
            value={`${adherence.setsLogged} de ${adherence.setsPlanned}`}
            hint={
              adherence.setCompletionPct === null
                ? undefined
                : `${adherence.setCompletionPct} % de lo previsto`
            }
          />
        </div>
        <AdherenceWeeks weeks={adherence.weeks} />
        {adherence.medianDurationMin !== null ? (
          <p className="text-muted-foreground tnum text-xs">
            Duración mediana: {adherence.medianDurationMin} min ·{" "}
            {stats.totalReps} repeticiones en total
            {stats.deloadSessions > 0
              ? ` · ${stats.deloadSessions} de descarga`
              : ""}
            .
          </p>
        ) : null}
      </SectionCard>

      {startEnd ? (
        <SectionCard title="Inicio y final del bloque" source="REGISTERED">
          <table className="w-full text-sm">
            <caption className="text-muted-foreground mb-2 text-left text-xs">
              Primeras {startEnd.windowWeeks} semanas frente a las últimas{" "}
              {startEnd.windowWeeks}.
            </caption>
            <thead>
              <tr className="text-muted-foreground text-xs">
                <th scope="col" className="pb-1 text-left font-normal">
                  Medida
                </th>
                <th scope="col" className="pb-1 text-right font-normal">
                  Inicio
                </th>
                <th scope="col" className="pb-1 text-right font-normal">
                  Final
                </th>
              </tr>
            </thead>
            <tbody>
              {startEnd.metrics.map((m) => (
                <tr key={m.key} className="border-border border-t">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    {START_END_LABEL[m.key]}
                  </th>
                  <td className="tnum text-muted-foreground py-1.5 text-right">
                    {m.start === null ? "—" : formatNumber(m.start)}
                  </td>
                  <td className="tnum py-1.5 pl-3 text-right font-medium">
                    {m.end === null ? "—" : formatNumber(m.end)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      ) : null}

      <SectionCard title="Ejercicios" source={["REGISTERED", "ESTIMATED"]}>
        {comparison.compared > 0 ? (
          <p className="text-sm">
            De <span className="tnum">{comparison.compared}</span> ejercicios
            comparables:{" "}
            <span className="tnum font-medium">{comparison.up}</span>{" "}
            {comparison.up === 1 ? "sube" : "suben"},{" "}
            <span className="tnum font-medium">{comparison.flat}</span>{" "}
            {comparison.flat === 1 ? "estable" : "estables"} y{" "}
            <span className="tnum font-medium">{comparison.down}</span>{" "}
            {comparison.down === 1 ? "baja" : "bajan"}
            {comparison.medianChangePct !== null ? (
              <>
                {" "}
                (mediana{" "}
                <span className="tnum">
                  {formatSigned(comparison.medianChangePct, 1)} %
                </span>
                )
              </>
            ) : null}
            .
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Cada ejercicio se compara consigo mismo: sus primeras sesiones contra
          las últimas, en rendimiento estimado. Toca uno para ver su evolución.
        </p>
        <ExerciseStatsList
          exercises={stats.exercises}
          todayLocalDate={todayLocalDate}
        />
      </SectionCard>

      <SectionCard title="Volumen semanal por músculo" source="REGISTERED">
        <p className="text-muted-foreground text-xs">
          Series efectivas: las directas cuentan entero y las indirectas por su
          factor. El número es la media por semana; cada casilla, una semana.
          Toca un músculo para ver el detalle.
        </p>
        <div className="grid grid-cols-[6.5rem_2rem_1fr] gap-2 text-[11px]">
          <span className="text-muted-foreground">Músculo</span>
          <span className="text-muted-foreground text-right">Media</span>
          <span className="text-muted-foreground tnum flex justify-between">
            <span>{weekLabels[0]}</span>
            <span>{weekLabels[weekLabels.length - 1]}</span>
          </span>
        </div>
        <div>
          {volume.muscles.map((m) => (
            <MuscleRow key={m.code} m={m} />
          ))}
        </div>
        <div className="text-muted-foreground tnum flex items-center gap-1.5 text-[11px]">
          <span>Series:</span>
          {[
            ["1–2", 0.25],
            ["3–4", 0.45],
            ["5–6", 0.65],
            ["7–8", 0.85],
            ["9+", 1],
          ].map(([label, opacity]) => (
            <span key={label} className="flex items-center gap-1">
              <span
                className="inline-block size-3 rounded-[2px]"
                style={{
                  background: "var(--viz-1)",
                  opacity: opacity as number,
                }}
              />
              {label}
            </span>
          ))}
        </div>
        {volume.unattributedSets > 0 ? (
          <p className="text-muted-foreground text-xs">
            {volume.unattributedSets} series no se pueden atribuir a ningún
            músculo porque su ejercicio ya no existe en el banco.
          </p>
        ) : null}
      </SectionCard>

      {lastEffort.length > 0 ? (
        <SectionCard title="RIR y proximidad al fallo" source="REGISTERED">
          <p className="-mb-2 text-xs font-medium">RIR medio por semana</p>
          <TrendChart
            title="RIR medio anotado por semana, en básicos y en aislamientos"
            xLabels={weekLabels}
            series={[
              {
                key: "compound",
                label: "Básicos",
                color: "var(--viz-1)",
                values: stats.effort.map((e) => e.avgRirCompound),
              },
              {
                key: "isolation",
                label: "Aislamientos",
                color: "var(--viz-2)",
                values: stats.effort.map((e) => e.avgRirIsolation),
              },
            ]}
            yDomain={[0, 4]}
            yTicks={[0, 2, 4]}
          />
          <p className="-mb-2 text-xs font-medium">Series al fallo (RIR 0)</p>
          <TrendChart
            title="Porcentaje de series al fallo (RIR 0) por semana"
            xLabels={weekLabels}
            series={[
              {
                key: "failure",
                label: "Series al fallo",
                color: "var(--viz-1)",
                values: stats.effort.map((e) => e.failurePct),
              },
            ]}
            yDomain={[0, 100]}
            yTicks={[0, 50, 100]}
            unit="%"
            digits={0}
            height={110}
          />
          {setsWithoutRir > 0 ? (
            <p className="text-muted-foreground text-xs">
              {setsWithoutRir} series sin RIR anotado no entran en estas medias:
              no se imputan.
            </p>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="Fatiga y recuperación" source="REGISTERED">
        <p className="text-muted-foreground text-xs">
          Lo que valoraste al terminar cada sesión, media por semana, de 1 a 5.
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {recoveryCharts.map((c) => (
            <div key={c.key}>
              <p className="mb-0.5 text-xs font-medium">{c.label}</p>
              <TrendChart
                title={`${c.label} por semana`}
                xLabels={weekLabels}
                series={[
                  {
                    key: c.key,
                    label: c.label,
                    color: "var(--viz-1)",
                    values: stats.recovery.map((r) => r[c.pick]),
                  },
                ]}
                yDomain={[1, 5]}
                yTicks={[1, 3, 5]}
                width={170}
                height={96}
              />
            </div>
          ))}
        </div>
      </SectionCard>

      {fatigue && lastFatigue ? (
        <SectionCard title="Fatiga según el motor" source="RECONSTRUCTED">
          <p className="text-sm">
            Al cerrar el bloque:{" "}
            <span className="font-medium">
              {DECISION_LABEL[lastFatigue.decision]}
            </span>{" "}
            (<span className="tnum">{lastFatigue.score}</span>{" "}
            {lastFatigue.score === 1 ? "punto" : "puntos"},{" "}
            <span className="tnum">{lastFatigue.objectiveScore}</span> de
            rendimiento medido).
          </p>
          <TrendChart
            title="Puntuación de fatiga del motor al final de cada semana"
            xLabels={fatigue.points.map((p) => `S${p.week}`)}
            series={[
              {
                key: "score",
                label: "Puntos de fatiga",
                color: "var(--viz-1)",
                values: fatigue.points.map((p) => p.score),
              },
            ]}
            yDomain={[
              0,
              Math.max(
                FATIGUE.RECOMMEND_SCORE + 1,
                ...fatigue.points.map((p) => p.score),
              ),
            ]}
            yTicks={[0]}
            referenceLines={[
              { value: FATIGUE.WATCH_SCORE, label: "vigilar" },
              { value: FATIGUE.RECOMMEND_SCORE, label: "descarga" },
            ]}
            digits={0}
          />
          {painWeeks.length > 0 ? (
            <p className="text-sm">
              Aviso de dolor articular repetido en{" "}
              <span className="tnum font-medium">{painWeeks.join(", ")}</span>.
              Va por su propia vía: no suma puntos.
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Estas evaluaciones no se guardaron en su momento: es lo que dice hoy
            el motor (v{fatigue.engineVersion}) con los datos que había cada
            semana. Para recomendar una descarga también hacen falta señales de
            rendimiento medido, no solo puntos.
          </p>
        </SectionCard>
      ) : null}
    </div>
  );
}

export function blockPeriodLabel(
  stats: BlockStats,
  todayLocalDate: string,
): string {
  return `${formatShortDate(stats.startLocalDate, todayLocalDate)} – ${formatShortDate(stats.endLocalDate, todayLocalDate)} · ${stats.weeks} ${stats.weeks === 1 ? "semana" : "semanas"}`;
}
