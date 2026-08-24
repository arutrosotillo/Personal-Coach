"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { createManualProgramAction } from "@/server/actions/program.action";
import type { BuilderVariant } from "@/server/repositories/builder-catalog.repo";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Contador de keys de cliente (no en render: el compilador marca Math.random/Date.now).
let uid = 0;
const nextKey = () => `k${uid++}`;

interface DraftExercise {
  key: string;
  variantId: string;
  label: string;
  sets: number;
  repMin: number;
  repMax: number;
  rir: number;
  rest: number;
}
interface DraftDay {
  key: string;
  name: string;
  exercises: DraftExercise[];
}

const REST_STEP = 15;

function fromVariant(v: BuilderVariant): DraftExercise {
  return {
    key: nextKey(),
    variantId: v.variantId,
    label: v.label,
    sets: 3,
    repMin: v.repRangeMin,
    repMax: v.repRangeMax,
    rir: v.defaultTargetRir,
    rest: v.defaultRestSeconds,
  };
}

export function ProgramBuilder({ catalog }: { catalog: BuilderVariant[] }) {
  const router = useRouter();
  const [name, setName] = useState("Mi programa");
  const [days, setDays] = useState<DraftDay[]>(() => [
    { key: nextKey(), name: "Día 1", exercises: [] },
  ]);
  const [openDay, setOpenDay] = useState(0);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const valid =
    name.trim().length > 0 &&
    days.length >= 1 &&
    days.length <= 7 &&
    days.every((d) => d.exercises.length >= 1);
  const invalidReason = !days.every((d) => d.exercises.length >= 1)
    ? "Cada día necesita al menos un ejercicio"
    : name.trim().length === 0
      ? "Ponle un nombre al programa"
      : null;

  function patchDay(idx: number, patch: Partial<DraftDay>) {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }
  function patchExercise(
    di: number,
    ei: number,
    patch: Partial<DraftExercise>,
  ) {
    setDays((prev) =>
      prev.map((d, i) =>
        i === di
          ? {
              ...d,
              exercises: d.exercises.map((e, j) =>
                j === ei ? { ...e, ...patch } : e,
              ),
            }
          : d,
      ),
    );
  }
  function addDay() {
    setDays((prev) => {
      const next = [
        ...prev,
        { key: nextKey(), name: `Día ${prev.length + 1}`, exercises: [] },
      ];
      setOpenDay(next.length - 1);
      return next;
    });
  }
  function removeDay(idx: number) {
    setDays((prev) => prev.filter((_, i) => i !== idx));
    setOpenDay((o) => Math.max(0, Math.min(o, days.length - 2)));
  }
  function moveDay(idx: number, dir: -1 | 1) {
    setDays((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
    // El día abierto sigue a su nueva posición.
    setOpenDay((o) => (o === idx ? idx + dir : o === idx + dir ? idx : o));
  }
  function addExercise(di: number, v: BuilderVariant) {
    setDays((prev) =>
      prev.map((d, i) =>
        i === di ? { ...d, exercises: [...d.exercises, fromVariant(v)] } : d,
      ),
    );
  }
  function removeExercise(di: number, ei: number) {
    setDays((prev) =>
      prev.map((d, i) =>
        i === di
          ? { ...d, exercises: d.exercises.filter((_, j) => j !== ei) }
          : d,
      ),
    );
  }
  function moveExercise(di: number, ei: number, dir: -1 | 1) {
    setDays((prev) =>
      prev.map((d, i) => {
        if (i !== di) return d;
        const j = ei + dir;
        if (j < 0 || j >= d.exercises.length) return d;
        const ex = [...d.exercises];
        [ex[ei], ex[j]] = [ex[j], ex[ei]];
        return { ...d, exercises: ex };
      }),
    );
  }

  function save() {
    if (!valid) return;
    startTransition(async () => {
      const res = await createManualProgramAction({
        name: name.trim(),
        days: days.map((d) => ({
          name: d.name.trim() || "Día",
          exercises: d.exercises.map((e) => ({
            exerciseVariantId: e.variantId,
            baseSets: e.sets,
            repRangeMin: e.repMin,
            repRangeMax: e.repMax,
            targetRir: e.rir,
            restSeconds: e.rest,
          })),
        })),
      });
      if (res.ok) {
        toast.success("Programa creado");
        router.push("/program");
        router.refresh();
      } else {
        toast.error(res.error ?? "No se pudo crear el programa");
      }
    });
  }

  return (
    <div className="pt-2 pb-28">
      <label className="mb-3 block">
        <span className="text-muted-foreground mb-1 block text-xs">
          Nombre del programa
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border-border bg-card min-h-11 w-full rounded-md border px-3 text-base"
          aria-label="Nombre del programa"
        />
      </label>

      <div className="space-y-3">
        {days.map((day, di) => (
          <DayCard
            key={day.key}
            day={day}
            index={di}
            isOpen={openDay === di}
            isFirst={di === 0}
            isLast={di === days.length - 1}
            canRemove={days.length > 1}
            onToggle={() => setOpenDay(openDay === di ? -1 : di)}
            onRename={(v) => patchDay(di, { name: v })}
            onMove={(dir) => moveDay(di, dir)}
            onRemove={() => removeDay(di)}
            onAddExercise={() => setPickerFor(di)}
            onPatchExercise={(ei, patch) => patchExercise(di, ei, patch)}
            onRemoveExercise={(ei) => removeExercise(di, ei)}
            onMoveExercise={(ei, dir) => moveExercise(di, ei, dir)}
          />
        ))}
      </div>

      {days.length < 7 ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-3 min-h-11 w-full"
          onClick={addDay}
        >
          + Añadir día
        </Button>
      ) : null}

      {/* Barra fija de guardado */}
      <div className="border-border bg-background fixed inset-x-0 bottom-0 z-40 border-t p-3">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <span
            className={cn(
              "flex-1 text-xs",
              valid ? "text-muted-foreground" : "text-destructive font-medium",
            )}
            aria-live="polite"
          >
            {valid ? `${days.length} día(s)` : invalidReason}
          </span>
          <Button
            type="button"
            className="min-h-12"
            disabled={!valid || pending}
            aria-busy={pending}
            onClick={save}
          >
            {pending ? "Guardando…" : "Guardar programa"}
          </Button>
        </div>
      </div>

      <PickerSheet
        open={pickerFor !== null}
        catalog={catalog}
        dayName={pickerFor !== null ? days[pickerFor]?.name : undefined}
        existing={
          pickerFor !== null
            ? new Set(days[pickerFor]?.exercises.map((e) => e.variantId))
            : new Set()
        }
        onOpenChange={(o) => setPickerFor(o ? pickerFor : null)}
        onPick={(v) => {
          if (pickerFor !== null) addExercise(pickerFor, v);
        }}
      />
    </div>
  );
}

function DayCard({
  day,
  index,
  isOpen,
  isFirst,
  isLast,
  canRemove,
  onToggle,
  onRename,
  onMove,
  onRemove,
  onAddExercise,
  onPatchExercise,
  onRemoveExercise,
  onMoveExercise,
}: {
  day: DraftDay;
  index: number;
  isOpen: boolean;
  isFirst: boolean;
  isLast: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onRename: (v: string) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onAddExercise: () => void;
  onPatchExercise: (ei: number, patch: Partial<DraftExercise>) => void;
  onRemoveExercise: (ei: number) => void;
  onMoveExercise: (ei: number, dir: -1 | 1) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="min-h-11 min-w-0 flex-1 text-left"
            aria-expanded={isOpen}
          >
            <span className="font-medium">
              {isOpen ? `Día ${index + 1}` : day.name || `Día ${index + 1}`}
            </span>
            <span className="text-muted-foreground ml-2 text-xs">
              {day.exercises.length} ejercicio(s)
            </span>
          </button>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Subir día"
              className="min-h-11 min-w-11 px-2"
              disabled={isFirst}
              onClick={() => onMove(-1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Bajar día"
              className="min-h-11 min-w-11 px-2"
              disabled={isLast}
              onClick={() => onMove(1)}
            >
              ↓
            </Button>
          </div>
        </div>

        {isOpen ? (
          <div className="mt-3 space-y-2">
            <input
              value={day.name}
              onChange={(e) => onRename(e.target.value)}
              className="border-border bg-background min-h-11 w-full rounded-md border px-3 text-sm"
              aria-label={`Nombre del día ${index + 1}`}
            />
            <ul className="space-y-2">
              {day.exercises.map((ex, ei) => (
                <ExerciseRow
                  key={ex.key}
                  ex={ex}
                  isFirst={ei === 0}
                  isLast={ei === day.exercises.length - 1}
                  onPatch={(patch) => onPatchExercise(ei, patch)}
                  onRemove={() => onRemoveExercise(ei)}
                  onMove={(dir) => onMoveExercise(ei, dir)}
                />
              ))}
              {day.exercises.length === 0 ? (
                <li className="text-muted-foreground py-2 text-center text-sm">
                  Añade tu primer ejercicio.
                </li>
              ) : null}
            </ul>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11 w-full"
              onClick={onAddExercise}
            >
              + Añadir ejercicio
            </Button>

            {canRemove ? (
              confirmRemove ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="min-h-11"
                    onClick={onRemove}
                  >
                    Confirmar quitar día
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    onClick={() => setConfirmRemove(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive min-h-11"
                  onClick={() => setConfirmRemove(true)}
                >
                  Quitar día
                </Button>
              )
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ExerciseRow({
  ex,
  isFirst,
  isLast,
  onPatch,
  onRemove,
  onMove,
}: {
  ex: DraftExercise;
  isFirst: boolean;
  isLast: boolean;
  onPatch: (patch: Partial<DraftExercise>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-border bg-card rounded-lg border p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-h-11 min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          <span className="block truncate text-sm font-medium">{ex.label}</span>
          <span className="tnum text-muted-foreground text-xs">
            {ex.sets}×{ex.repMin}–{ex.repMax} · RIR {ex.rir} · {ex.rest}s
          </span>
        </button>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Subir ejercicio"
            className="min-h-11 min-w-11 px-1"
            disabled={isFirst}
            onClick={() => onMove(-1)}
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Bajar ejercicio"
            className="min-h-11 min-w-11 px-1"
            disabled={isLast}
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Stepper
              label="Series"
              value={ex.sets}
              min={1}
              max={10}
              onChange={(v) => onPatch({ sets: v })}
            />
            <Stepper
              label="Descanso (s)"
              value={ex.rest}
              min={30}
              max={600}
              step={REST_STEP}
              onChange={(v) => onPatch({ rest: v })}
            />
            <Stepper
              label="Reps mín."
              value={ex.repMin}
              min={1}
              max={50}
              onChange={(v) =>
                onPatch({ repMin: v, repMax: Math.max(v, ex.repMax) })
              }
            />
            <Stepper
              label="Reps máx."
              value={ex.repMax}
              min={1}
              max={50}
              onChange={(v) =>
                onPatch({ repMax: v, repMin: Math.min(v, ex.repMin) })
              }
            />
          </div>
          <div>
            <span className="text-muted-foreground mb-1 block text-xs">
              RIR
            </span>
            <div
              className="flex gap-1"
              role="radiogroup"
              aria-label="RIR objetivo"
            >
              {[0, 1, 2, 3, 4].map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={ex.rir === r}
                  onClick={() => onPatch({ rir: r })}
                  className={cn(
                    "tnum min-h-11 min-w-11 rounded-md border text-sm",
                    ex.rir === r
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {r === 4 ? "4+" : r}
                </button>
              ))}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive min-h-11"
            aria-label={`Quitar ${ex.label}`}
            onClick={onRemove}
          >
            Quitar ejercicio
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function PickerSheet({
  open,
  catalog,
  dayName,
  existing,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  catalog: BuilderVariant[];
  dayName?: string;
  existing: Set<string>;
  onOpenChange: (open: boolean) => void;
  onPick: (v: BuilderVariant) => void;
}) {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);

  const muscles = useMemo(
    () =>
      [...new Set(catalog.map((v) => v.primaryMuscle).filter(Boolean))].sort(),
    [catalog],
  );
  const q = query.trim().toLowerCase();
  const filtered = catalog
    .filter((v) => (muscle ? v.primaryMuscle === muscle : true))
    .filter((v) => (q ? v.label.toLowerCase().includes(q) : true))
    .slice(0, 60);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="flex flex-row items-center justify-between gap-2">
          <DrawerTitle>
            {dayName ? `Añadir a ${dayName}` : "Añadir ejercicio"}
          </DrawerTitle>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-9"
            onClick={() => onOpenChange(false)}
          >
            Hecho
          </Button>
        </DrawerHeader>
        <div className="space-y-2 px-4 pb-8">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar ejercicio…"
            aria-label="Buscar ejercicio"
            className="border-border bg-background min-h-11 w-full rounded-md border px-3 text-sm"
          />
          <div className="flex flex-wrap gap-1">
            <FilterChip
              active={muscle === null}
              onClick={() => setMuscle(null)}
            >
              Todos
            </FilterChip>
            {muscles.map((m) => (
              <FilterChip
                key={m}
                active={muscle === m}
                onClick={() => setMuscle(m)}
              >
                {m}
              </FilterChip>
            ))}
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {filtered.map((v) => {
              const added = existing.has(v.variantId);
              return (
                <li key={v.variantId}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(v);
                      toast.success("Añadido", { duration: 900 });
                    }}
                    className="hover:bg-accent flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm"
                  >
                    <span className="min-w-0 truncate">{v.label}</span>
                    <span className="shrink-0 text-xs">
                      {added ? (
                        <span className="text-primary">✓ añadido</span>
                      ) : (
                        <span className="text-muted-foreground">
                          {v.equipment}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 ? (
              <li className="text-muted-foreground px-2 py-3 text-sm">
                Sin resultados.
              </li>
            ) : null}
          </ul>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-9 rounded-full border px-3 py-1 text-xs",
        active
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <span className="text-muted-foreground mb-1 block text-xs">{label}</span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Reducir ${label}`}
          className="min-h-11 min-w-11 px-0"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </Button>
        <span
          className="tnum flex-1 text-center text-sm tabular-nums"
          aria-live="polite"
        >
          {value}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Aumentar ${label}`}
          className="min-h-11 min-w-11 px-0"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          +
        </Button>
      </div>
    </div>
  );
}
