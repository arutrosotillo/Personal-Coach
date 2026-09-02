"use client";

import { useMemo, useState } from "react";

import type { SmoothedPoint } from "@/core/body";
import { diffDays } from "@/core/dates";
import { formatNumber, formatShortDate } from "@/lib/body-labels";

/**
 * Curva de peso: pesajes crudos como puntos, EMA como línea.
 *
 * SVG a mano, sin librería. Dos series y una escala de tiempo no justifican
 * meter una dependencia de charting en un proyecto que no tiene ninguna, y el
 * componente entero cabe en lo que ocuparía su configuración.
 *
 * DECISIONES QUE IMPORTAN:
 *
 *   · El eje X es TIEMPO REAL, no el índice del pesaje. Dos pesajes separados
 *     por tres semanas se dibujan separados por tres semanas. Usar el índice
 *     comprimiría los huecos y haría parecer constante una serie con parones.
 *   · No se inventan puntos. Un día sin pesaje no existe en el gráfico.
 *   · La línea suavizada se PARTE en los huecos largos: unir dos puntos
 *     separados por semanas con una recta continua insinúa datos que no hay.
 *   · La línea es la EMA, NO la regresión. La recta de regresión es lo que
 *     sostiene la afirmación numérica, pero pintarla como línea principal daría
 *     una sensación de trayectoria limpia que el dato no tiene.
 *   · Un pesaje winsorizado (fuera de la escala) se dibuja en el borde con
 *     forma distinta y su valor REAL sigue siendo el que se lee al señalarlo.
 *     Nunca se oculta ni se sustituye por el valor acotado.
 */

const VIEW = { w: 720, h: 260 };
const PAD = { top: 16, right: 12, bottom: 28, left: 44 };
const PLOT = {
  w: VIEW.w - PAD.left - PAD.right,
  h: VIEW.h - PAD.top - PAD.bottom,
};

/** Días de hueco a partir de los cuales la línea suavizada se corta. */
const GAP_BREAK_DAYS = 10;

interface Plotted {
  point: SmoothedPoint;
  x: number;
  /** `y` del pesaje crudo, ya acotada al área visible. */
  yRaw: number;
  /** `true` si el crudo se salía de la escala y se dibuja en el borde. */
  clipped: boolean;
  yEma: number;
  gapDays: number;
}

export function WeightChart({
  series,
  todayLocalDate,
}: {
  series: readonly SmoothedPoint[];
  todayLocalDate: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  const model = useMemo(() => {
    if (series.length < 2) return null;

    const first = series[0].localDate;
    const totalDays = Math.max(
      1,
      diffDays(first, series[series.length - 1].localDate),
    );

    // Escala vertical: se calcula con la EMA y con los pesajes NO atípicos.
    // Un error de tecleo de 8,4 kg no puede decidir la escala de todo el
    // gráfico; se dibuja igualmente, pero en el borde.
    const enEscala = series.filter((p) => !p.winsorized);
    const valores = [
      ...enEscala.map((p) => p.rawKg as number),
      ...series.map((p) => p.emaKg as number),
    ];
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    // Margen mínimo de 1 kg: una serie casi plana no debe verse como una
    // montaña rusa por culpa de un autoescalado agresivo.
    const margen = Math.max((max - min) * 0.15, 0.5);
    const yMin = min - margen;
    const yMax = max + margen;
    const span = yMax - yMin || 1;

    const x = (localDate: string) =>
      PAD.left + (diffDays(first, localDate) / totalDays) * PLOT.w;
    const y = (value: number) => PAD.top + ((yMax - value) / span) * PLOT.h;
    const yClamped = (value: number) =>
      Math.min(Math.max(y(value), PAD.top), PAD.top + PLOT.h);

    const points: Plotted[] = series.map((point) => {
      const raw = point.rawKg as number;
      const yExacta = y(raw);
      return {
        point,
        x: x(point.localDate),
        yRaw: yClamped(raw),
        clipped: yExacta < PAD.top || yExacta > PAD.top + PLOT.h,
        yEma: yClamped(point.emaKg as number),
        gapDays: point.gapDays,
      };
    });

    // Tramos de la línea suavizada, cortados en los huecos largos.
    const segments: Plotted[][] = [];
    let current: Plotted[] = [];
    for (const p of points) {
      if (current.length > 0 && p.gapDays > GAP_BREAK_DAYS) {
        segments.push(current);
        current = [];
      }
      current.push(p);
    }
    if (current.length > 0) segments.push(current);

    // Cuatro marcas horizontales, en kilos redondos si caben.
    const ticks = [0, 1, 2, 3].map((i) => {
      const value = yMax - (span * i) / 3;
      return { value, y: y(value) };
    });

    return { points, segments, ticks, first, last: series[series.length - 1] };
  }, [series]);

  if (!model) return null;

  const activo = selected === null ? null : model.points[selected];
  const leido = activo ?? model.points[model.points.length - 1];

  const resumen = `Curva de peso de ${series.length} pesajes, del ${formatShortDate(model.first, todayLocalDate)} al ${formatShortDate(model.last.localDate, todayLocalDate)}. Último pesaje ${formatNumber(model.last.rawKg as number)} kilos.`;

  return (
    <div>
      {/* Lectura del punto señalado. Ocupa sitio siempre para que el gráfico
          no dé un salto al pasar el dedo por encima. */}
      <p className="text-muted-foreground mb-1 text-xs" aria-live="polite">
        <span className="tnum">
          {formatShortDate(leido.point.localDate, todayLocalDate)}
        </span>{" "}
        ·{" "}
        <span className="tnum text-foreground font-medium">
          {formatNumber(leido.point.rawKg as number)} kg
        </span>
        {leido.point.winsorized ? (
          <span className="text-muted-foreground">
            {" "}
            · pesaje atípico, suavizado para la tendencia
          </span>
        ) : null}
        {activo === null ? (
          <span className="text-muted-foreground"> · último</span>
        ) : null}
      </p>

      <svg
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        className="h-auto w-full touch-pan-y"
        role="img"
        aria-label={resumen}
        onPointerLeave={() => setSelected(null)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const svgX = ((e.clientX - rect.left) / rect.width) * VIEW.w;
          let best = 0;
          for (let i = 1; i < model.points.length; i++) {
            if (
              Math.abs(model.points[i].x - svgX) <
              Math.abs(model.points[best].x - svgX)
            ) {
              best = i;
            }
          }
          setSelected(best);
        }}
      >
        <g stroke="var(--border)" strokeWidth="1">
          {model.ticks.map((t) => (
            <line
              key={t.value}
              x1={PAD.left}
              y1={t.y}
              x2={VIEW.w - PAD.right}
              y2={t.y}
            />
          ))}
        </g>
        <g
          fill="var(--muted-foreground)"
          fontSize="11"
          textAnchor="end"
          className="tnum"
        >
          {model.ticks.map((t) => (
            <text key={t.value} x={PAD.left - 8} y={t.y + 4}>
              {formatNumber(t.value)}
            </text>
          ))}
        </g>
        {/* Anclados a los extremos: centrados, la mitad de la última fecha
            se salía del viewBox y se veía cortada. */}
        <g fill="var(--muted-foreground)" fontSize="11">
          <text x={PAD.left} y={VIEW.h - 8} textAnchor="start">
            {formatShortDate(model.first, todayLocalDate)}
          </text>
          <text x={VIEW.w - PAD.right} y={VIEW.h - 8} textAnchor="end">
            {formatShortDate(model.last.localDate, todayLocalDate)}
          </text>
        </g>

        {/* Línea suavizada (EMA), partida en los huecos largos. */}
        {model.segments.map((seg, i) => (
          <polyline
            key={i}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={seg.map((p) => `${p.x},${p.yEma}`).join(" ")}
          />
        ))}

        {/* Pesajes crudos. */}
        {model.points.map((p, i) =>
          p.clipped ? (
            // Fuera de escala: rombo en el borde, para que no se confunda con
            // un pesaje normal y se vea que el valor real está más allá.
            <path
              key={p.point.localDate}
              d={`M ${p.x} ${p.yRaw - 5} L ${p.x + 5} ${p.yRaw} L ${p.x} ${p.yRaw + 5} L ${p.x - 5} ${p.yRaw} Z`}
              fill="var(--muted-foreground)"
              opacity={selected === i ? 1 : 0.75}
            >
              <title>{`${p.point.localDate}: ${formatNumber(p.point.rawKg as number)} kg (fuera de la escala)`}</title>
            </path>
          ) : (
            <circle
              key={p.point.localDate}
              cx={p.x}
              cy={p.yRaw}
              r={selected === i ? 5 : 3}
              fill={
                selected === i ? "var(--primary)" : "var(--muted-foreground)"
              }
            >
              <title>{`${p.point.localDate}: ${formatNumber(p.point.rawKg as number)} kg`}</title>
            </circle>
          ),
        )}
      </svg>

      <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="bg-muted-foreground inline-block size-1.5 rounded-full" />
          Pesajes
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-primary inline-block h-0.5 w-4 rounded-full" />
          Tendencia suavizada
        </span>
      </div>

      {/* La misma serie en tabla, para lectores de pantalla: un `role="img"`
          con etiqueta resume, pero no deja leer los datos uno a uno. */}
      <table className="sr-only">
        <caption>Pesajes registrados</caption>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Peso en kg</th>
          </tr>
        </thead>
        <tbody>
          {model.points.map((p) => (
            <tr key={p.point.localDate}>
              <th scope="row">{p.point.localDate}</th>
              <td>{formatNumber(p.point.rawKg as number)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
