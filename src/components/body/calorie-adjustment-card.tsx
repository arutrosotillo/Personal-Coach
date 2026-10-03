"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { CalorieAdjustment } from "@/core/nutrition/calorie-adjustment";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatShortDate } from "@/lib/body-labels";
import { answerCalorieAdjustmentAction } from "@/server/actions/nutrition.action";

const CONFIDENCE_LABEL = {
  LOW: "Confianza baja",
  MEDIUM: "Confianza media",
  HIGH: "Confianza alta",
} as const;

const fmtKcal = (n: number) => n.toLocaleString("es-ES");

/**
 * Ajuste calórico por tendencia de peso.
 *
 * La tarjeta solo pinta lo que decidió el motor: título, explicación con sus
 * números y, si hay propuesta, dos botones. Aceptar crea un objetivo nuevo;
 * "Ahora no" no cambia nada y el motor no insiste en una semana.
 *
 * Cuando el motor no tiene nada que proponer la tarjeta sigue apareciendo,
 * plegada a una línea: saber que la app lo está vigilando —y por qué no
 * propone nada— es justo lo que evita bajar calorías a ojo.
 */
export function CalorieAdjustmentCard({
  adjustment,
  todayLocalDate,
}: {
  adjustment: CalorieAdjustment | null;
  todayLocalDate: string;
}) {
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);

  if (
    adjustment === null ||
    adjustment.reasonCode === "NOT_APPLICABLE_GOAL" ||
    adjustment.reasonCode === "NO_TARGET"
  ) {
    return null;
  }

  const { proposal } = adjustment;

  function answer(accept: boolean) {
    if (!proposal) return;
    startTransition(async () => {
      const result = await answerCalorieAdjustmentAction({
        accept,
        expectedKcal: proposal.kcal,
      });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo guardar.");
        return;
      }
      toast.success(
        accept
          ? `Nuevo objetivo: ${fmtKcal(proposal.kcal)} kcal/día`
          : "De acuerdo, seguimos como estás.",
      );
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Calorías</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="font-medium">{adjustment.title}</p>
          {adjustment.currentKcal !== null ? (
            <p className="text-muted-foreground tnum mt-1 text-xs">
              Objetivo actual: {fmtKcal(adjustment.currentKcal)} kcal/día
              {adjustment.daysOnPhase !== null
                ? ` · ${adjustment.daysOnPhase} días en esta fase`
                : ""}
            </p>
          ) : null}
        </div>

        {proposal ? (
          <div className="border-border rounded-md border p-3">
            <p className="tnum text-2xl font-semibold">
              {fmtKcal(proposal.kcal)}
              <span className="text-muted-foreground ml-1 text-base font-normal">
                kcal/día
              </span>
            </p>
            <p className="text-muted-foreground tnum mt-1 text-xs">
              {proposal.deltaKcal > 0 ? "+" : "−"}
              {fmtKcal(Math.abs(proposal.deltaKcal))} kcal · {proposal.proteinG}{" "}
              g proteína · {proposal.fatG} g grasa · {proposal.carbsG} g
              carbohidratos
            </p>
          </div>
        ) : null}

        {proposal || expanded ? (
          <p className="text-muted-foreground leading-relaxed">
            {adjustment.explanation}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-muted-foreground min-h-11 text-left text-xs underline underline-offset-4"
          >
            Ver por qué
          </button>
        )}

        {adjustment.nextEligibleLocalDate && !proposal ? (
          <p className="text-muted-foreground tnum text-xs">
            Próxima revisión:{" "}
            {formatShortDate(adjustment.nextEligibleLocalDate, todayLocalDate)}
          </p>
        ) : null}

        {proposal ? (
          <>
            <p className="text-muted-foreground text-xs">
              {CONFIDENCE_LABEL[adjustment.confidence]}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={pending}
                onClick={() => answer(false)}
              >
                Ahora no
              </Button>
              <Button
                className="min-h-11"
                disabled={pending}
                onClick={() => answer(true)}
              >
                Aplicar
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
