"use client";

import { Sparkles, TrendingDown, TrendingUp, Minus, Info } from "lucide-react";
import { useState, useTransition } from "react";

import type { CoachHighlight, CoachResult } from "@/ai/types";
import type { CoachRequestInput } from "@/core/schemas/coach";
import { askCoachAction } from "@/server/actions/coach.action";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Panel de Coach AI. Se pide BAJO DEMANDA (un tap = una llamada): nada se
 * genera solo, para no gastar tokens sin que nadie lo lea.
 *
 * Si la IA falla o no está configurada, se muestra el mensaje controlado y, si
 * existe, la explicación DETERMINISTA de respaldo. La app nunca se rompe.
 */

const DIRECTION_ICON = {
  UP: TrendingUp,
  DOWN: TrendingDown,
  FLAT: Minus,
  INFO: Info,
} as const;

const DIRECTION_CLASS = {
  UP: "text-emerald-400",
  DOWN: "text-amber-400",
  FLAT: "text-muted-foreground",
  INFO: "text-muted-foreground",
} as const;

function HighlightRow({ highlight }: { highlight: CoachHighlight }) {
  const Icon = DIRECTION_ICON[highlight.direction];
  return (
    <li className="flex gap-2">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          DIRECTION_CLASS[highlight.direction],
        )}
        aria-hidden
      />
      <span className="text-sm">
        <span className="font-medium">{highlight.label}</span>{" "}
        <span className="text-muted-foreground">{highlight.detail}</span>
      </span>
    </li>
  );
}

export function CoachPanel({
  request,
  label,
  emptyHint,
}: {
  request: CoachRequestInput;
  label: string;
  emptyHint?: string;
}) {
  const [result, setResult] = useState<CoachResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      setResult(await askCoachAction(request));
    });
  }

  return (
    <div>
      <Button
        type="button"
        onClick={run}
        disabled={pending}
        variant="secondary"
        className="min-h-11 w-full"
      >
        <Sparkles className="mr-2 size-4" aria-hidden />
        {pending ? "Pensando…" : result ? `${label} otra vez` : label}
      </Button>

      {emptyHint && !result && !pending ? (
        <p className="text-muted-foreground mt-2 text-xs">{emptyHint}</p>
      ) : null}

      {result ? (
        <div
          className="border-border bg-card mt-3 rounded-lg border p-3"
          aria-live="polite"
        >
          {result.ok ? (
            <>
              <p className="font-medium">{result.response.headline}</p>

              {result.response.highlights.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {result.response.highlights.map((h, i) => (
                    <HighlightRow key={i} highlight={h} />
                  ))}
                </ul>
              ) : null}

              {result.response.fatigue ? (
                <p className="text-muted-foreground mt-3 text-sm">
                  {result.response.fatigue}
                </p>
              ) : null}

              <div className="border-border mt-3 border-t pt-3">
                <p className="text-sm">{result.response.recommendation}</p>
              </div>

              {result.response.hypotheses.length > 0 ? (
                <div className="mt-3">
                  <p className="text-muted-foreground text-xs font-medium">
                    Hipótesis (no confirmadas por tus datos)
                  </p>
                  <ul className="mt-1 space-y-1">
                    {result.response.hypotheses.map((h, i) => (
                      <li
                        key={i}
                        className="text-muted-foreground text-xs italic"
                      >
                        · {h}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.warnings.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="text-xs text-amber-400/80">
                      ⚠ {w}
                    </li>
                  ))}
                </ul>
              ) : null}

              {result.usage ? (
                <p className="text-muted-foreground mt-3 text-[11px]">
                  {result.usage.model} · {result.usage.inputTokens} +{" "}
                  {result.usage.outputTokens} tokens
                  {result.usage.estimatedCostUsd !== null
                    ? ` · ~${(result.usage.estimatedCostUsd * 100).toFixed(2)} ¢`
                    : ""}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-sm">{result.message}</p>
              {result.fallback ? (
                <div className="border-border mt-3 border-t pt-3">
                  <p className="text-muted-foreground text-xs font-medium">
                    Lo que dice el motor
                  </p>
                  <p className="mt-1 text-sm">{result.fallback}</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
