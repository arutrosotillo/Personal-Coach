"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/body-labels";
import { saveQuickWeightAction } from "@/server/actions/body.action";

/**
 * Entrada de peso del día, en la pantalla "Hoy".
 *
 * Un campo y un botón. Sin diálogo, sin pasos: pesarse y anotarlo tiene que
 * costar lo mismo que mirar el número de la báscula, o se deja de hacer.
 *
 * Solo pide PESO. La cintura y el % graso tienen otra cadencia (quincenal y
 * mensual) y meterlos aquí convertiría un gesto de cinco segundos en un
 * formulario. Se anotan desde `/progress`, y guardar el peso desde aquí NO los
 * borra: `saveQuickWeightAction` escribe únicamente la columna del peso.
 */
export function QuickWeightCard({
  todayLocalDate,
  initialWeightKg,
  daysSinceLastWeight,
}: {
  todayLocalDate: string;
  /** Peso ya registrado hoy, si lo hay. */
  initialWeightKg: number | null;
  /**
   * Días desde el último pesaje, o `null` si no hay ninguno. Solo cambia el
   * texto de ayuda: nunca se usa para regañar ni para pintar una racha rota.
   */
  daysSinceLastWeight: number | null;
}) {
  const [saved, setSaved] = useState<number | null>(initialWeightKg);
  const [draft, setDraft] = useState(
    initialWeightKg === null ? "" : String(initialWeightKg),
  );
  const [editing, setEditing] = useState(initialWeightKg === null);
  const [pending, startTransition] = useTransition();

  function save() {
    const weightKg = Number(draft.replace(",", "."));
    if (!Number.isFinite(weightKg)) {
      toast.error("Escribe tu peso en kg.");
      return;
    }
    startTransition(async () => {
      const result = await saveQuickWeightAction({
        localDate: todayLocalDate,
        weightKg,
      });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo guardar el peso.");
        return;
      }
      const value = result.weightKg ?? weightKg;
      setSaved(value);
      setDraft(String(value));
      setEditing(false);
      toast.success(`Peso de hoy guardado: ${formatNumber(value)} kg.`);
    });
  }

  // Ya hay peso hoy y no se está editando: se enseña y se puede corregir.
  if (!editing && saved !== null) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-sm">Tu peso de hoy</p>
            <p className="tnum mt-0.5 text-2xl font-semibold">
              {formatNumber(saved)}{" "}
              <span className="text-muted-foreground text-base font-normal">
                kg
              </span>
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            onClick={() => setEditing(true)}
          >
            Corregir
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Label htmlFor="quick-weight" className="mb-2 block">
          {saved === null ? "Anota tu peso de hoy" : "Corrige tu peso de hoy"}
        </Label>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              id="quick-weight"
              // `decimal` y no `numeric`: en iOS saca el teclado con coma.
              inputMode="decimal"
              type="text"
              autoComplete="off"
              enterKeyHint="done"
              placeholder="82,4"
              value={draft}
              disabled={pending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              aria-describedby="quick-weight-help"
              className="tnum min-h-11 text-lg"
            />
          </div>
          <span className="text-muted-foreground pb-3 text-sm">kg</span>
          <Button
            type="button"
            className="min-h-11"
            disabled={pending || draft.trim() === ""}
            onClick={save}
          >
            Guardar
          </Button>
          {saved !== null ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={pending}
              onClick={() => {
                setDraft(String(saved));
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
          ) : null}
        </div>
        <p
          id="quick-weight-help"
          className="text-muted-foreground mt-2 text-xs"
        >
          {daysSinceLastWeight === null
            ? "Mejor por la mañana, después de ir al baño y antes de desayunar: así comparas siempre lo mismo."
            : daysSinceLastWeight >= 10
              ? "Hace tiempo que no anotas tu peso. Con unos cuantos registros vuelvo a poder calcular tu tendencia."
              : "Un pesaje suelto no significa nada; la tendencia sí. Anótalo cuando puedas, sin agobios."}
        </p>
      </CardContent>
    </Card>
  );
}
