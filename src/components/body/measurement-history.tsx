"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { BodyFatReliability } from "@/core/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNumber, formatShortDate } from "@/lib/body-labels";
import { parseDecimalInput } from "@/lib/decimal-input";
import {
  deleteBodyMeasurementAction,
  saveBodyMeasurementAction,
} from "@/server/actions/body.action";

/**
 * Historial editable. Lista simple, lo más reciente arriba.
 *
 * Editar y borrar ocurren EN SITIO, sin diálogo: la fila se convierte en el
 * formulario y vuelve a ser fila. Borrar pide confirmación en dos pasos por la
 * misma razón — un modal para quitar un pesaje es desproporcionado, pero
 * borrar a la primera con el pulgar en el móvil también.
 *
 * El formulario de edición SÍ enseña los tres campos, porque guardar declara el
 * día entero: si solo se viera el peso, guardar borraría en silencio la cintura
 * de ese día. La entrada rápida de "Hoy" resuelve el mismo problema por el otro
 * lado, con una acción que solo toca el peso.
 */

export interface HistoryRow {
  id: string;
  localDate: string;
  weightKg: number | null;
  waistCm: number | null;
  bodyFatPct: number | null;
  bodyFatReliability: BodyFatReliability | null;
}

const RELIABILITY_LABEL: Record<BodyFatReliability, string> = {
  MEASURED: "DEXA o plicómetro",
  ESTIMATED: "báscula o estimación",
};

function toInput(value: number | null): string {
  return value === null ? "" : String(value).replace(".", ",");
}

/** Fila vacía de hoy, para poder anotar cintura o % graso sin salir de aquí. */
const NUEVA: HistoryRow = {
  id: "nueva",
  localDate: "",
  weightKg: null,
  waistCm: null,
  bodyFatPct: null,
  bodyFatReliability: null,
};

export function MeasurementHistory({
  rows,
  todayLocalDate,
  hasTodayRow,
}: {
  rows: readonly HistoryRow[];
  todayLocalDate: string;
  /** Si hoy ya tiene fila, se edita desde la lista y no se ofrece añadir. */
  hasTodayRow: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [addingToday, setAddingToday] = useState(false);

  return (
    <ul className="divide-border divide-y">
      {!hasTodayRow ? (
        <li className="py-3">
          {addingToday ? (
            <EditRow
              row={{ ...NUEVA, localDate: todayLocalDate }}
              todayLocalDate={todayLocalDate}
              onDone={() => setAddingToday(false)}
            />
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full"
              onClick={() => setAddingToday(true)}
            >
              Añadir medición de hoy
            </Button>
          )}
        </li>
      ) : null}
      {rows.map((row) => (
        <li key={row.id} className="py-3">
          {editingId === row.id ? (
            <EditRow
              row={row}
              todayLocalDate={todayLocalDate}
              onDone={() => setEditingId(null)}
            />
          ) : (
            <ReadRow
              row={row}
              todayLocalDate={todayLocalDate}
              confirming={confirmingId === row.id}
              onEdit={() => {
                setConfirmingId(null);
                setEditingId(row.id);
              }}
              onAskDelete={() => setConfirmingId(row.id)}
              onCancelDelete={() => setConfirmingId(null)}
            />
          )}
        </li>
      ))}
      {rows.length === 0 ? (
        <li className="text-muted-foreground py-3 text-sm">
          Todavía no has registrado ninguna medición.
        </li>
      ) : null}
    </ul>
  );
}

function ReadRow({
  row,
  todayLocalDate,
  confirming,
  onEdit,
  onAskDelete,
  onCancelDelete,
}: {
  row: HistoryRow;
  todayLocalDate: string;
  confirming: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const fecha = formatShortDate(row.localDate, todayLocalDate);

  function remove() {
    startTransition(async () => {
      const result = await deleteBodyMeasurementAction(row.id);
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo borrar la medición.");
        onCancelDelete();
        return;
      }
      toast.success(`Medición del ${fecha} borrada.`);
    });
  }

  if (confirming) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">
          ¿Borrar la medición del <span className="tnum">{fecha}</span>?
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-9"
            disabled={pending}
            onClick={onCancelDelete}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="min-h-9"
            disabled={pending}
            onClick={remove}
          >
            Borrar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="tnum text-muted-foreground text-xs">{fecha}</p>
        <p className="tnum mt-0.5 truncate">
          {row.weightKg !== null ? (
            <span className="font-medium">{formatNumber(row.weightKg)} kg</span>
          ) : (
            <span className="text-muted-foreground">Sin peso</span>
          )}
          {row.waistCm !== null ? (
            <span className="text-muted-foreground">
              {" · "}cintura {formatNumber(row.waistCm)} cm
            </span>
          ) : null}
          {row.bodyFatPct !== null ? (
            <span className="text-muted-foreground">
              {" · "}
              {formatNumber(row.bodyFatPct)} % graso estimado
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-9"
          onClick={onEdit}
          aria-label={`Editar la medición del ${fecha}`}
        >
          Editar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground min-h-9"
          onClick={onAskDelete}
          aria-label={`Borrar la medición del ${fecha}`}
        >
          Borrar
        </Button>
      </div>
    </div>
  );
}

function EditRow({
  row,
  todayLocalDate,
  onDone,
}: {
  row: HistoryRow;
  todayLocalDate: string;
  onDone: () => void;
}) {
  const [weight, setWeight] = useState(toInput(row.weightKg));
  const [waist, setWaist] = useState(toInput(row.waistCm));
  const [fat, setFat] = useState(toInput(row.bodyFatPct));
  const [reliability, setReliability] = useState<BodyFatReliability>(
    row.bodyFatReliability ?? "ESTIMATED",
  );
  const [pending, startTransition] = useTransition();
  const fecha = formatShortDate(row.localDate, todayLocalDate);
  const fatValue = parseDecimalInput(fat);

  function save() {
    startTransition(async () => {
      const result = await saveBodyMeasurementAction({
        localDate: row.localDate,
        weightKg: parseDecimalInput(weight),
        waistCm: parseDecimalInput(waist),
        bodyFatPct: fatValue,
        // La procedencia solo viaja si hay porcentaje: el schema rechaza una
        // sin la otra, en los dos sentidos.
        bodyFatReliability: fatValue === null ? null : reliability,
      });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo guardar la medición.");
        return;
      }
      toast.success(`Medición del ${fecha} guardada.`);
      onDone();
    });
  }

  return (
    <div className="space-y-3">
      <p className="tnum text-muted-foreground text-xs">Editando {fecha}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`w-${row.id}`} className="mb-1 block text-xs">
            Peso (kg)
          </Label>
          <Input
            id={`w-${row.id}`}
            inputMode="decimal"
            type="text"
            value={weight}
            disabled={pending}
            onChange={(e) => setWeight(e.target.value)}
            className="tnum min-h-11"
          />
        </div>
        <div>
          <Label htmlFor={`c-${row.id}`} className="mb-1 block text-xs">
            Cintura (cm)
          </Label>
          <Input
            id={`c-${row.id}`}
            inputMode="decimal"
            type="text"
            value={waist}
            disabled={pending}
            onChange={(e) => setWaist(e.target.value)}
            className="tnum min-h-11"
          />
        </div>
        <div>
          <Label htmlFor={`g-${row.id}`} className="mb-1 block text-xs">
            % graso
          </Label>
          <Input
            id={`g-${row.id}`}
            inputMode="decimal"
            type="text"
            value={fat}
            disabled={pending}
            onChange={(e) => setFat(e.target.value)}
            className="tnum min-h-11"
          />
        </div>
        {fatValue !== null ? (
          <div>
            <Label htmlFor={`m-${row.id}`} className="mb-1 block text-xs">
              Cómo lo mediste
            </Label>
            <select
              id={`m-${row.id}`}
              value={reliability}
              disabled={pending}
              onChange={(e) =>
                setReliability(e.target.value as BodyFatReliability)
              }
              className="border-input bg-background min-h-11 w-full rounded-md border px-3 text-sm"
            >
              <option value="ESTIMATED">{RELIABILITY_LABEL.ESTIMATED}</option>
              <option value="MEASURED">{RELIABILITY_LABEL.MEASURED}</option>
            </select>
          </div>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-9"
          disabled={pending}
          onClick={onDone}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          className="min-h-9"
          disabled={pending}
          onClick={save}
        >
          Guardar
        </Button>
      </div>
    </div>
  );
}
