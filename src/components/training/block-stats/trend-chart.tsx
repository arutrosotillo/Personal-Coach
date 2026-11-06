"use client";

import { useMemo, useState } from "react";

import { formatNumber } from "@/lib/body-labels";

/**
 * Línea de tendencia de las estadísticas del bloque. SVG a mano, como la curva de
 * peso: el proyecto no tiene librería de gráficos y esto no la justifica.
 *
 *   · Un solo eje. Dos medidas de escala distinta son dos gráficos.
 *   · Sin dato no hay punto: una semana sin sesiones parte la línea en vez de unir
 *     los extremos con una recta que insinúa datos que no existen.
 *   · La lectura va encima y no en un globo: en el móvil el dedo taparía un globo.
 *     Enseña TODAS las series del punto señalado, y ocupa sitio siempre para que
 *     el gráfico no salte al pasar el dedo.
 *   · Los mismos datos, en tabla, para lectores de pantalla.
 */

export interface TrendSeries {
  key: string;
  label: string;
  /** Color de la MARCA. El texto nunca lo lleva. */
  color: string;
  values: Array<number | null>;
}

export function TrendChart({
  title,
  xLabels,
  xPositions,
  series,
  yDomain,
  yTicks,
  referenceLines = [],
  unit = "",
  digits = 1,
  width = 360,
  height = 150,
}: {
  /** Nombre accesible; también encabeza la tabla equivalente. */
  title: string;
  /** Etiqueta de cada punto ("S3", "12 oct"). */
  xLabels: string[];
  /** Posición real de cada punto (días). Sin ella, equidistantes. */
  xPositions?: number[];
  series: TrendSeries[];
  yDomain?: [number, number];
  yTicks?: number[];
  referenceLines?: Array<{ value: number; label: string }>;
  unit?: string;
  digits?: number;
  width?: number;
  height?: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  const model = useMemo(() => {
    const n = xLabels.length;
    const pad = { top: 10, right: 12, bottom: 20, left: 30 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const all = series
      .flatMap((s) => s.values)
      .filter((v): v is number => v !== null);
    if (all.length === 0) return null;

    const rawMin = yDomain?.[0] ?? Math.min(...all);
    const rawMax = yDomain?.[1] ?? Math.max(...all);
    const margin = yDomain ? 0 : Math.max((rawMax - rawMin) * 0.15, 0.5);
    const yMin = rawMin - margin;
    const yMax = rawMax + margin;
    const span = yMax - yMin || 1;

    const positions = xPositions ?? xLabels.map((_, i) => i);
    const first = positions[0] ?? 0;
    const last = positions[n - 1] ?? 1;
    const xSpan = last - first || 1;
    const x = (i: number) =>
      n === 1
        ? pad.left + plotW / 2
        : pad.left + ((positions[i] - first) / xSpan) * plotW;
    const y = (v: number) => pad.top + ((yMax - v) / span) * plotH;

    const ticks =
      yTicks ??
      [0, 1, 2].map((i) => Number((yMax - (span * i) / 2).toFixed(1)));

    const lines = series.map((s) => {
      const segments: Array<Array<{ x: number; y: number }>> = [];
      let current: Array<{ x: number; y: number }> = [];
      s.values.forEach((v, i) => {
        if (v === null) {
          if (current.length > 0) segments.push(current);
          current = [];
          return;
        }
        current.push({ x: x(i), y: y(v) });
      });
      if (current.length > 0) segments.push(current);
      return { ...s, segments };
    });

    return { pad, plotH, x, y, ticks, lines, n };
  }, [xLabels, xPositions, series, yDomain, yTicks, width, height]);

  if (!model) return null;
  const { pad, plotH, x, y, ticks, lines, n } = model;

  const activo = selected ?? n - 1;
  const seriesCount = series.length;

  function nearest(svgX: number): number {
    let best = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(x(i) - svgX) < Math.abs(x(best) - svgX)) best = i;
    }
    return best;
  }

  const fmt = (v: number | null) =>
    v === null ? "—" : `${formatNumber(v, digits)}${unit ? ` ${unit}` : ""}`;

  return (
    <figure className="m-0">
      <figcaption className="sr-only">{title}</figcaption>
      <p
        className="text-muted-foreground mb-1 min-h-4 text-xs"
        aria-live="polite"
      >
        <span className="tnum">{xLabels[activo]}</span>
        {series.map((s) => (
          <span key={s.key}>
            {" · "}
            <span className="tnum text-foreground font-medium">
              {fmt(s.values[activo])}
            </span>
            {seriesCount > 1 ? ` ${s.label.toLowerCase()}` : ""}
          </span>
        ))}
      </p>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full touch-pan-y outline-none"
        role="img"
        aria-label={title}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            setSelected(Math.max(0, activo - 1));
          } else if (e.key === "ArrowRight") {
            setSelected(Math.min(n - 1, activo + 1));
          }
        }}
        onPointerLeave={() => setSelected(null)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setSelected(nearest(((e.clientX - rect.left) / rect.width) * width));
        }}
      >
        <g stroke="var(--border)" strokeWidth="1">
          {ticks.map((t) => (
            <line
              key={t}
              x1={pad.left}
              x2={width - pad.right}
              y1={y(t)}
              y2={y(t)}
            />
          ))}
        </g>
        <g
          fill="var(--muted-foreground)"
          fontSize="10"
          textAnchor="end"
          className="tnum"
        >
          {ticks.map((t) => (
            <text key={t} x={pad.left - 6} y={y(t) + 3}>
              {formatNumber(t, Number.isInteger(t) ? 0 : 1)}
            </text>
          ))}
        </g>

        {/* Umbrales del motor: hairline continua, nunca discontinua. */}
        {referenceLines.map((r) => (
          <g key={r.label}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(r.value)}
              y2={y(r.value)}
              stroke="var(--muted-foreground)"
              strokeWidth="1"
              opacity={0.6}
            />
            <text
              x={width - pad.right}
              y={y(r.value) - 3}
              fontSize="9"
              textAnchor="end"
              fill="var(--muted-foreground)"
            >
              {r.label}
            </text>
          </g>
        ))}

        {/* Fechas de los extremos, ancladas para que no se corten. */}
        <g fill="var(--muted-foreground)" fontSize="10">
          <text x={pad.left} y={height - 5} textAnchor="start">
            {xLabels[0]}
          </text>
          {n > 1 ? (
            <text x={width - pad.right} y={height - 5} textAnchor="end">
              {xLabels[n - 1]}
            </text>
          ) : null}
        </g>

        {selected !== null ? (
          <line
            x1={x(selected)}
            x2={x(selected)}
            y1={pad.top}
            y2={pad.top + plotH}
            stroke="var(--muted-foreground)"
            strokeWidth="1"
          />
        ) : null}

        {lines.map((s) => (
          <g key={s.key}>
            {s.segments.map((seg, i) =>
              seg.length === 1 ? (
                <circle
                  key={i}
                  cx={seg[0].x}
                  cy={seg[0].y}
                  r={3}
                  fill={s.color}
                />
              ) : (
                <polyline
                  key={i}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
                />
              ),
            )}
            {s.values[activo] !== null ? (
              <circle
                cx={x(activo)}
                cy={y(s.values[activo] as number)}
                r={4}
                fill={s.color}
                stroke="var(--card)"
                strokeWidth="2"
              />
            ) : null}
          </g>
        ))}
      </svg>

      {seriesCount > 1 ? (
        <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* El envoltorio hace falta: una tabla ignora `width: 1px` y `overflow`, así
          que `sr-only` directamente sobre ella ensancha la página en el móvil. */}
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Punto</th>
              {series.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {xLabels.map((label, i) => (
              <tr key={`${label}-${i}`}>
                <th scope="row">{label}</th>
                {series.map((s) => (
                  <td key={s.key}>{fmt(s.values[i])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** Miniatura de la evolución de un ejercicio. La cifra exacta está al abrirlo. */
export function Sparkline({ values }: { values: Array<number | null> }) {
  const w = 72;
  const h = 22;
  const known = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);
  if (known.length < 2) return null;
  const min = Math.min(...known.map((p) => p.v));
  const max = Math.max(...known.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => 2 + (i / (values.length - 1)) * (w - 6);
  const y = (v: number) => 3 + ((max - v) / span) * (h - 6);
  const last = known[known.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      className="shrink-0"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={known.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
      />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.5} fill="var(--viz-1)" />
    </svg>
  );
}
