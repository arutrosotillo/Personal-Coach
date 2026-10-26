"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { Equipment } from "@/core/enums";
import {
  deleteGymChangeAction,
  registerGymChangeAction,
  updateGymChangeAction,
} from "@/server/actions/gym-change.action";
import type { GymChangeFormDay } from "@/server/repositories/equipment-change.repo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Material en singular: aquí se habla de LA máquina de un ejercicio. */
const EQUIPMENT_LABEL: Record<Equipment, string> = {
  BARBELL: "Barra",
  EZ_BAR: "Barra EZ",
  DUMBBELL: "Mancuernas",
  MACHINE: "Máquina",
  SMITH_MACHINE: "Multipower",
  CABLE: "Polea",
  BODYWEIGHT: "Peso corporal",
  BAND: "Banda",
};

/**
 * "Prensa 45° · Máquina", pero "Polea" y no "Polea · Polea": el material solo
 * se añade si el nombre de la variante no lo dice ya.
 */
function variantLine(variantName: string, equipment: string): string {
  const label = EQUIPMENT_LABEL[equipment as Equipment] ?? equipment;
  return variantName.toLowerCase().includes(label.toLowerCase())
    ? variantName
    : `${variantName} · ${label}`;
}

/**
 * Registrar (o corregir) un cambio de gimnasio.
 *
 * Una sola pantalla y tres decisiones: la fecha, un nombre opcional y QUÉ
 * ejercicios cambian de equipamiento. Las máquinas y poleas llegan marcadas
 * (su carga depende del aparato) y lo demás no; es un punto de partida, no
 * una suposición: cada fila se marca o desmarca con un toque.
 */
export function GymChangeForm({
  days,
  todayLocalDate,
  initial,
  preselectEquipment,
  eventId,
}: {
  days: GymChangeFormDay[];
  todayLocalDate: string;
  /** Valores de un cambio ya registrado (edición); `null` = alta. */
  initial: {
    localDate: string;
    label: string | null;
    variantIds: string[];
  } | null;
  /** Material que llega marcado en un alta. */
  preselectEquipment: readonly string[];
  eventId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Una clave por pantalla: un doble toque o un reintento crean UN evento.
  const [requestId] = useState(() => crypto.randomUUID());
  const [localDate, setLocalDate] = useState(
    initial?.localDate ?? todayLocalDate,
  );
  const [label, setLabel] = useState(initial?.label ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        initial
          ? initial.variantIds
          : days.flatMap((d) =>
              d.exercises
                .filter((e) => preselectEquipment.includes(e.equipment))
                .map((e) => e.variantId),
            ),
      ),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const total = days.reduce((a, d) => a + d.exercises.length, 0);

  function toggle(variantId: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(variantId);
      else next.delete(variantId);
      return next;
    });
  }

  function save() {
    setError(null);
    const payload = {
      localDate,
      label: label.trim() || null,
      variantIds: [...selected],
    };
    startTransition(async () => {
      const res = eventId
        ? await updateGymChangeAction(eventId, payload)
        : await registerGymChangeAction({ ...payload, requestId });
      if (!res.ok) {
        setError(res.error ?? "No se pudo guardar.");
        return;
      }
      toast.success(
        eventId
          ? "Cambio de gimnasio actualizado"
          : "Cambio de gimnasio registrado",
      );
      router.push("/program");
      router.refresh();
    });
  }

  function remove() {
    if (!eventId) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteGymChangeAction(eventId);
      if (!res.ok) {
        setError(res.error ?? "No se pudo deshacer.");
        return;
      }
      toast.success("Cambio de gimnasio deshecho");
      router.push("/program");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 pb-28">
      <Card>
        <CardContent className="space-y-1 pt-4 text-sm">
          <p>
            Tu objetivo, tu programa —series, rangos y RIR— y tu historial se
            quedan como están.
          </p>
          <p className="text-muted-foreground">
            Marca los ejercicios que vas a hacer con una máquina distinta. En
            esos, la referencia de cargas empieza de nuevo desde la fecha del
            cambio: lo de antes se sigue viendo, pero no se compara con la
            máquina nueva, así que cargar menos no contará como perder fuerza.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="gym-date" className="mb-1 block text-xs">
            Primer día en el gimnasio nuevo
          </Label>
          <Input
            id="gym-date"
            type="date"
            value={localDate}
            onChange={(e) => setLocalDate(e.target.value)}
            className="min-h-11"
          />
        </div>
        <div>
          <Label htmlFor="gym-label" className="mb-1 block text-xs">
            Nombre del gimnasio (opcional)
          </Label>
          <Input
            id="gym-label"
            value={label}
            maxLength={60}
            placeholder="p. ej. Gimnasio Valencia"
            onChange={(e) => setLabel(e.target.value)}
            className="min-h-11"
          />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h2 className="font-medium">¿Qué ejercicios cambian de máquina?</h2>
          <span className="text-muted-foreground tnum shrink-0 text-xs">
            {selected.size} de {total}
          </span>
        </div>
        <p className="text-muted-foreground mb-3 text-xs">
          {initial
            ? "Corrige la lista si en el gimnasio nuevo has visto que alguna máquina es distinta, o que alguna es igual."
            : "Llegan marcadas las máquinas y las poleas, porque su carga depende del aparato. Las mancuernas, las barras y el peso corporal suelen seguir siendo comparables: márcalos solo si de verdad cambian."}
        </p>
        {days.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No tienes ejercicios en tu programa activo. Puedes registrar el
            cambio igualmente: todas tus cargas seguirán siendo comparables.
          </p>
        ) : null}
        <div className="space-y-3">
          {days.map((day) => (
            <Card key={day.name}>
              <CardContent className="pt-3 pb-1">
                <p className="text-muted-foreground mb-1 text-xs font-medium">
                  {day.name}
                </p>
                <ul>
                  {day.exercises.map((e) => {
                    const id = `gym-ex-${e.variantId}`;
                    const on = selected.has(e.variantId);
                    return (
                      <li key={e.variantId}>
                        <label
                          htmlFor={id}
                          className="flex min-h-12 cursor-pointer items-center gap-3 py-1"
                        >
                          <Checkbox
                            id={id}
                            checked={on}
                            onCheckedChange={(v) =>
                              toggle(e.variantId, v === true)
                            }
                            aria-label={`${e.exerciseName} — ${e.variantName}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">
                              {e.exerciseName}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {variantLine(e.variantName, e.equipment)}
                            </span>
                          </span>
                          {on ? (
                            <span className="text-primary shrink-0 text-xs">
                              Máquina nueva
                            </span>
                          ) : (
                            <span className="text-muted-foreground shrink-0 text-xs">
                              Comparable
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {eventId ? (
        <div className="border-border rounded-lg border p-3">
          {confirmDelete ? (
            <div className="space-y-2">
              <p className="text-sm">
                ¿Deshacer este cambio? Tus series no se tocan: solo vuelve a
                compararse todo como si no hubieras cambiado de máquina.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  className="min-h-11"
                  disabled={pending}
                  onClick={remove}
                >
                  Sí, deshacer
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive min-h-11"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              Deshacer este cambio
            </Button>
          )}
        </div>
      ) : null}

      {/* Barra fija abajo, como el builder: el botón siempre a mano en el móvil. */}
      <div className="border-border bg-background fixed inset-x-0 bottom-0 z-40 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-lg">
          {error ? (
            <p role="alert" className="text-destructive mb-2 text-sm">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={pending || !localDate}
            onClick={save}
          >
            {pending
              ? "Guardando…"
              : eventId
                ? "Guardar cambios"
                : "Registrar cambio de gimnasio"}
          </Button>
        </div>
      </div>
    </div>
  );
}
