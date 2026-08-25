import { AlertTriangle, Activity } from "lucide-react";

import type { FatigueAssessment } from "@/core/training/fatigue";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Estado de recuperación y, si procede, recomendación de descarga (F3.3).
 *
 * Es ADVISORY: no hay ningún botón que aplique nada al programa. Muestra la
 * decisión, las señales que la disparan con sus números, y el plan sugerido.
 */

const LEVEL_LABEL: Record<FatigueAssessment["level"], string> = {
  LOW: "Recuperación correcta",
  MODERATE: "Fatiga moderada",
  HIGH: "Fatiga acumulada",
  INSUFFICIENT_DATA: "Sin datos suficientes",
};

const CONFIDENCE_LABEL = {
  LOW: "confianza baja",
  MEDIUM: "confianza media",
  HIGH: "confianza alta",
} as const;

export function RecoveryCard({ fatigue }: { fatigue: FatigueAssessment }) {
  const recommended = fatigue.decision === "DELOAD_RECOMMENDED";
  const painAction = fatigue.jointPain.level === "ACTION";

  return (
    <Card
      className={cn(
        "mb-4",
        recommended && "border-amber-500/50",
        painAction && "border-destructive/50",
      )}
    >
      <CardContent className="pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="text-muted-foreground size-4" aria-hidden />
            <h2 className="font-medium">{LEVEL_LABEL[fatigue.level]}</h2>
          </div>
          <Badge variant={recommended ? "default" : "outline"}>
            {recommended
              ? "Descarga recomendada"
              : fatigue.decision === "DELOAD_WATCH"
                ? "En vigilancia"
                : fatigue.decision === "INSUFFICIENT_DATA"
                  ? "Sin datos"
                  : "Todo en orden"}
          </Badge>
        </div>

        {painAction ? (
          <p className="text-destructive mb-3 flex gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{fatigue.jointPain.message}</span>
          </p>
        ) : null}

        <p className="text-muted-foreground text-sm">{fatigue.explanation}</p>

        {fatigue.signals.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {fatigue.signals.map((s) => (
              <li
                key={s.code}
                className="text-muted-foreground flex gap-2 text-xs"
              >
                <span aria-hidden>·</span>
                <span>{s.message}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {fatigue.plan ? (
          <div className="border-border mt-3 rounded-lg border p-3">
            <p className="text-sm font-medium">Descarga sugerida</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {fatigue.plan.summary}
            </p>
            <p className="text-muted-foreground mt-2 text-xs italic">
              No cambio nada por mi cuenta: aplícala si la ves bien, o sigue con
              el plan y lo volvemos a mirar la semana que viene.
            </p>
          </div>
        ) : null}

        {fatigue.decision !== "INSUFFICIENT_DATA" ? (
          <p className="text-muted-foreground mt-3 text-xs">
            {fatigue.numbers.sessionsInWindow} sesiones en{" "}
            {fatigue.numbers.windowDays} días ·{" "}
            {CONFIDENCE_LABEL[fatigue.confidence]}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
