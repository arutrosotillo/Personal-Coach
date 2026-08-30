"use client";

import { useState } from "react";

import { MUSCLE_GROUP_BY_CODE } from "@/core/catalog/muscle-groups";
import type { GroupVolume } from "@/core/program/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WeeklyVolumeOverview } from "@/server/repositories/weekly-volume.repo";
import { cn } from "@/lib/utils";

/**
 * Contador de volumen semanal por músculo.
 *
 * Es el número que faltaba: el motor progresa carga y repeticiones solo, pero
 * las series las decides tú y hasta ahora no había dónde verlas. Esto NO
 * recomienda nada ni cambia el programa — enseña lo que hay.
 *
 * "Efectivo" = series directas + las indirectas ponderadas por su factor. Es
 * una convención contable, no fisiología medida, y así se dice en la nota.
 */

/** Estado de un músculo frente a su objetivo. Tres cubos, sin porcentajes. */
type Estado = "bajo" | "en-rango" | "alto";

function estadoDe(v: GroupVolume): Estado {
  if (v.targetSets <= 0) return "en-rango";
  const ratio = v.fractionalSets / v.targetSets;
  if (ratio < 0.6) return "bajo";
  if (ratio > 1.35) return "alto";
  return "en-rango";
}

const ESTADO_COLOR: Record<Estado, string> = {
  bajo: "bg-amber-500/70",
  "en-rango": "bg-emerald-500/70",
  alto: "bg-sky-500/70",
};

export function WeeklyVolumeCard({ data }: { data: WeeklyVolumeOverview }) {
  const [vista, setVista] = useState<"planned" | "actual">("planned");
  const resultado = vista === "planned" ? data.planned : data.actual;

  // Solo los músculos con algo que contar: 16 filas a cero no informan.
  const filas = resultado.byGroup
    .filter((v) => v.fractionalSets > 0 || v.targetSets > 0)
    .sort((a, b) => b.fractionalSets - a.fractionalSets);

  const desatendidos = filas.filter((v) => estadoDe(v) === "bajo");

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle>Volumen semanal por músculo</CardTitle>
        <div className="flex gap-1.5">
          <Tab active={vista === "planned"} onClick={() => setVista("planned")}>
            Tu programa
          </Tab>
          <Tab active={vista === "actual"} onClick={() => setVista("actual")}>
            Últimos {data.windowDays} días
          </Tab>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs">
          {vista === "planned"
            ? `Lo que prescriben tus ${data.daysPerWeek} días si cumples la semana entera.`
            : data.actualSessions > 0
              ? `Lo que registraste de verdad: ${data.actualSessions} ${
                  data.actualSessions === 1 ? "sesión" : "sesiones"
                } completadas.`
              : "Sin sesiones completadas en esta ventana: nada que contar todavía."}
        </p>

        {filas.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Todavía no hay series que contar.
          </p>
        ) : (
          <ul className="space-y-2">
            {filas.map((v) => {
              const estado = estadoDe(v);
              const pct =
                v.targetSets > 0
                  ? Math.min((v.fractionalSets / v.targetSets) * 100, 100)
                  : 0;
              return (
                <li key={v.group} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>
                      {MUSCLE_GROUP_BY_CODE[v.group].nameEs}
                      {v.isPriority ? (
                        <span className="text-muted-foreground ml-1.5 text-[10px]">
                          prioritario
                        </span>
                      ) : null}
                    </span>
                    <span className="tnum text-muted-foreground text-xs">
                      {v.fractionalSets} / {v.targetSets}
                      {v.frequency > 0 ? ` · ${v.frequency}×` : ""}
                    </span>
                  </div>
                  <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      className={cn("h-full rounded-full", ESTADO_COLOR[estado])}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {desatendidos.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Por debajo de su objetivo:{" "}
            {desatendidos
              .map((v) => MUSCLE_GROUP_BY_CODE[v.group].nameEs)
              .join(", ")}
            .
          </p>
        ) : null}

        {resultado.unattributedSets > 0 ? (
          <p className="text-muted-foreground text-xs">
            {resultado.unattributedSets} series no se han podido atribuir a
            ningún músculo (ejercicio borrado del banco).
          </p>
        ) : null}

        <p className="text-muted-foreground border-border border-t pt-2 text-xs">
          &quot;Efectivo&quot; suma las series directas más las indirectas
          ponderadas (un press cuenta parcialmente para el tríceps). Es una
          convención para contar, no fisiología medida, y el objetivo es un
          punto de partida conservador — no un mínimo que haya que cumplir.
          Nada de esto cambia tu programa: las series las decides tú.
        </p>
      </CardContent>
    </Card>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring/50 min-h-8 rounded-full border px-2.5 py-1 text-xs focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border bg-card text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
