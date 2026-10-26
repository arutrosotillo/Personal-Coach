"use client";

import Link from "next/link";
import { useState } from "react";

import { GoalReview, type CheckInGoal } from "@/components/body/check-in-card";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/body-labels";

/**
 * Lo que se puede hacer con el objetivo desde su propia tarjeta.
 *
 * AL LLEGAR al peso objetivo no cambia nada solo (ni calorías, ni fase): se
 * dice, con el peso de referencia y no con un pesaje suelto, y se ofrecen las
 * dos salidas. Seguir hacia un peso nuevo es la MISMA fase: se corrige el
 * objetivo en sitio y la tendencia, las calorías y el historial siguen igual.
 * Cambiar de fase (mantenimiento, volumen…) es finalizar el ciclo.
 *
 * Sin haber llegado, el mismo formulario queda a mano tras "Editar objetivo",
 * en vez de enterrado dentro del check-in.
 */
export function TargetWeightActions({
  goal,
  reached,
  referenceKg,
}: {
  goal: CheckInGoal | null;
  reached: boolean;
  /** Peso de referencia con el que se ha comparado. */
  referenceKg: number | null;
}) {
  const [editing, setEditing] = useState(false);
  if (!goal) return null;

  if (editing) {
    return (
      <div className="border-border border-t pt-3">
        <GoalReview goal={goal} onDone={() => setEditing(false)} />
      </div>
    );
  }

  if (reached) {
    return (
      <div className="border-primary/40 bg-primary/5 space-y-3 rounded-lg border p-3">
        <div>
          <p className="font-medium">Has llegado a tu peso objetivo</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            {referenceKg !== null
              ? `Tu peso de referencia (${formatNumber(referenceKg)} kg, la media de tus últimos pesajes) ya está en tu objetivo. `
              : ""}
            No cambia nada solo. Si quieres seguir, pon otro peso objetivo: es
            la misma fase, así que tus calorías, tu tendencia y tu historial
            siguen igual. Si quieres pasar a otra fase, finaliza el ciclo.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() => setEditing(true)}
          >
            Poner otro objetivo
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/progress/cycle" />}
            className="min-h-11"
          >
            Finalizar ciclo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-muted-foreground focus-visible:ring-ring/50 min-h-9 text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
    >
      Editar objetivo
    </button>
  );
}
