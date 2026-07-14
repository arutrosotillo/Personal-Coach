"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { RestTimer } from "@/components/training/rest-timer";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  discardSessionAction,
  finishSessionAction,
  logSetAction,
  setPlannedSetsAction,
  substituteExerciseAction,
} from "@/server/actions/workout.action";
import type { ExecutionSession } from "@/server/repositories/workout.repo";
import { cn } from "@/lib/utils";

export interface SubstitutionExercise {
  exerciseName: string;
  variants: Array<{ id: string; name: string; equipment: string }>;
}

interface RowState {
  weight: string;
  reps: number;
  rir: number;
  done: boolean;
}

type RowsMap = Record<string, RowState[]>;

// Helper a nivel de módulo: el lint del compilador de React marca Date.now()
// como impuro si aparece dentro del componente, aunque sea en un handler.
const nowMs = () => Date.now();

function initRows(session: ExecutionSession): RowsMap {
  const map: RowsMap = {};
  for (const ex of session.exercises) {
    const rows: RowState[] = [];
    for (let n = 1; n <= ex.plannedSets; n++) {
      const logged = ex.setLogs.find((s) => s.setNumber === n);
      const last =
        ex.lastTime?.sets.find((s) => s.setNumber === n) ??
        ex.lastTime?.sets[ex.lastTime.sets.length - 1];
      rows.push({
        weight:
          logged?.weightKg?.toString() ??
          (last ? last.weightKg.toString() : ""),
        reps: logged?.reps ?? last?.reps ?? ex.repRangeMin,
        rir: logged?.rir ?? last?.rir ?? ex.targetRir,
        done: !!logged,
      });
    }
    map[ex.id] = rows;
  }
  return map;
}

export function SessionRunner({
  session,
  substitution,
}: {
  session: ExecutionSession;
  substitution: SubstitutionExercise[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<RowsMap>(() => initRows(session));
  const [current, setCurrent] = useState(0);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const exercises = session.exercises;
  const ex = exercises[current];
  const exRows = rows[ex.id] ?? [];

  const totalPlanned = exercises.reduce(
    (a, e) => a + (rows[e.id]?.length ?? 0),
    0,
  );
  const totalDone = exercises.reduce(
    (a, e) => a + (rows[e.id]?.filter((r) => r.done).length ?? 0),
    0,
  );

  function updateRow(exId: string, idx: number, patch: Partial<RowState>) {
    setRows((prev) => {
      const copy = { ...prev };
      const arr = [...(copy[exId] ?? [])];
      arr[idx] = { ...arr[idx], ...patch };
      copy[exId] = arr;
      return copy;
    });
  }

  function completeSet(idx: number) {
    const row = exRows[idx];
    const weightKg = row.weight === "" ? 0 : Number(row.weight);
    if (Number.isNaN(weightKg)) {
      toast.error("Peso no válido");
      return;
    }
    // Optimista: marcar hecho y arrancar el descanso al instante.
    updateRow(ex.id, idx, { done: true });
    setRestEndsAt(nowMs() + ex.restSeconds * 1000);
    startTransition(async () => {
      const res = await logSetAction({
        workoutExerciseId: ex.id,
        setNumber: idx + 1,
        weightKg,
        reps: row.reps,
        rir: row.rir,
      });
      if (!res.ok) {
        updateRow(ex.id, idx, { done: false });
        toast.error(res.error ?? "No se pudo guardar");
      }
    });
  }

  function addSet() {
    const arr = rows[ex.id] ?? [];
    const last = arr[arr.length - 1];
    const next = [...arr, { ...last, done: false }];
    setRows((prev) => ({ ...prev, [ex.id]: next }));
    void setPlannedSetsAction(ex.id, next.length);
  }

  function removeSet() {
    const arr = rows[ex.id] ?? [];
    if (arr.length <= 1) return;
    const next = arr.slice(0, -1);
    setRows((prev) => ({ ...prev, [ex.id]: next }));
    void setPlannedSetsAction(ex.id, next.length);
  }

  function substitute(variantId: string) {
    setSubOpen(false);
    startTransition(async () => {
      const res = await substituteExerciseAction(ex.id, variantId);
      if (res.ok) {
        toast.success("Ejercicio sustituido");
        router.refresh();
      } else {
        toast.error(res.error ?? "No se pudo sustituir");
      }
    });
  }

  function finish(feedback: {
    perceivedPerformance?: number;
    pump?: number;
    jointPain?: number;
    fatigue?: number;
    motivation?: number;
    notes?: string;
  }) {
    startTransition(async () => {
      const res = await finishSessionAction(session.id, feedback);
      if (res.ok) {
        toast.success("Sesión guardada");
        router.push("/train");
        router.refresh();
      } else {
        toast.error(res.error ?? "No se pudo finalizar");
      }
    });
  }

  function discard() {
    if (
      !confirm(
        `¿Descartar la sesión? Se perderán ${totalDone} series registradas. No se puede deshacer.`,
      )
    )
      return;
    startTransition(async () => {
      await discardSessionAction(session.id);
      router.push("/train");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pt-4 pb-28">
      {/* Header con progreso */}
      <header className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="Salir"
            className="text-muted-foreground min-h-9 px-1 text-sm"
            onClick={discard}
          >
            ✕ Descartar
          </button>
          <span className="text-muted-foreground text-xs">
            Ejercicio {current + 1}/{exercises.length} · {totalDone}/
            {totalPlanned} series
          </span>
          <span className="text-muted-foreground w-16" />
        </div>
        <div className="mt-2 flex gap-1" aria-hidden>
          {exercises.map((e, i) => (
            <div
              key={e.id}
              className={cn(
                "h-1 flex-1 rounded-full",
                i === current
                  ? "bg-primary"
                  : rows[e.id]?.every((r) => r.done)
                    ? "bg-primary/40"
                    : "bg-muted",
              )}
            />
          ))}
        </div>
      </header>

      {/* Ejercicio actual */}
      <div className="flex-1">
        <div className="mb-3">
          <h1 className="text-xl font-semibold">{ex.exerciseName}</h1>
          <p className="text-muted-foreground text-sm">
            {ex.variantName} · {ex.repRangeMin}–{ex.repRangeMax} reps · RIR{" "}
            {ex.targetRir}
          </p>
          {ex.lastTime ? (
            <p className="tnum text-muted-foreground mt-1 text-xs">
              Última vez ({ex.lastTime.localDate}):{" "}
              {ex.lastTime.sets
                .map(
                  (s) =>
                    `${s.weightKg}×${s.reps}${s.rir != null ? `@${s.rir}` : ""}`,
                )
                .join(" · ")}
            </p>
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">
              Primera vez con este ejercicio: introduce la carga que uses.
            </p>
          )}
        </div>

        <ul className="space-y-2">
          {exRows.map((row, idx) => (
            <SetRow
              key={idx}
              index={idx}
              row={row}
              loadStepKg={ex.loadStepKg}
              onChange={(patch) => updateRow(ex.id, idx, patch)}
              onComplete={() => completeSet(idx)}
              disabled={pending}
            />
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-9"
            onClick={addSet}
          >
            + Añadir serie
          </Button>
          {exRows.length > 1 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-9"
              onClick={removeSet}
            >
              − Quitar serie
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-9"
            onClick={() => setSubOpen(true)}
          >
            Sustituir ejercicio
          </Button>
        </div>
      </div>

      {/* Navegación entre ejercicios */}
      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 flex-1"
          disabled={current === 0}
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
        >
          Anterior
        </Button>
        {current < exercises.length - 1 ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 flex-1"
            onClick={() =>
              setCurrent((c) => Math.min(exercises.length - 1, c + 1))
            }
          >
            Siguiente
          </Button>
        ) : (
          <Button
            type="button"
            className="min-h-11 flex-1"
            onClick={() => setFeedbackOpen(true)}
          >
            Finalizar
          </Button>
        )}
      </div>

      {restEndsAt !== null ? (
        <RestTimer
          endsAt={restEndsAt}
          onAdd={(ms) => setRestEndsAt((e) => (e ?? nowMs()) + ms)}
          onSkip={() => setRestEndsAt(null)}
        />
      ) : null}

      <FeedbackSheet
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        onSubmit={finish}
        pending={pending}
      />

      <SubstitutionSheet
        open={subOpen}
        onOpenChange={setSubOpen}
        options={substitution}
        onPick={substitute}
      />
    </div>
  );
}

function SetRow({
  index,
  row,
  loadStepKg,
  onChange,
  onComplete,
  disabled,
}: {
  index: number;
  row: RowState;
  loadStepKg: number;
  onChange: (patch: Partial<RowState>) => void;
  onComplete: () => void;
  disabled: boolean;
}) {
  const weightNum = row.weight === "" ? 0 : Number(row.weight);
  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        row.done
          ? "border-primary/30 bg-primary/5 opacity-70"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-6 shrink-0 text-sm">
          {index + 1}
        </span>
        <Stepper
          label="Peso (kg)"
          value={row.weight}
          onDec={() =>
            onChange({ weight: Math.max(0, weightNum - loadStepKg).toString() })
          }
          onInc={() =>
            onChange({ weight: (weightNum + loadStepKg).toString() })
          }
          onInput={(v) => onChange({ weight: v })}
          decimal
        />
        <Stepper
          label="Reps"
          value={row.reps.toString()}
          onDec={() => onChange({ reps: Math.max(0, row.reps - 1) })}
          onInc={() => onChange({ reps: row.reps + 1 })}
          onInput={(v) =>
            onChange({ reps: v === "" ? 0 : Math.round(Number(v)) })
          }
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-muted-foreground w-6 shrink-0 text-xs">RIR</span>
        <div
          className="flex gap-1"
          role="group"
          aria-label={`RIR serie ${index + 1}`}
        >
          {[0, 1, 2, 3, 4].map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={row.rir === r}
              onClick={() => onChange({ rir: r })}
              className={cn(
                "tnum min-h-9 min-w-9 rounded-md border text-sm",
                row.rir === r
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground",
              )}
            >
              {r === 4 ? "4+" : r}
            </button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          className="ml-auto min-h-11"
          variant={row.done ? "secondary" : "default"}
          onClick={onComplete}
          disabled={disabled}
        >
          {row.done ? "✓ Hecha" : "Completar"}
        </Button>
      </div>
    </li>
  );
}

function Stepper({
  label,
  value,
  onDec,
  onInc,
  onInput,
  decimal,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
  onInput: (v: string) => void;
  decimal?: boolean;
}) {
  return (
    <div className="flex-1">
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Bajar ${label}`}
          className="border-border bg-card min-h-11 min-w-11 rounded-md border text-lg"
          onClick={onDec}
        >
          −
        </button>
        <input
          inputMode={decimal ? "decimal" : "numeric"}
          value={value}
          onChange={(e) => onInput(e.target.value)}
          aria-label={label}
          className="border-border bg-card tnum h-11 w-full min-w-0 rounded-md border text-center text-lg"
        />
        <button
          type="button"
          aria-label={`Subir ${label}`}
          className="border-border bg-card min-h-11 min-w-11 rounded-md border text-lg"
          onClick={onInc}
        >
          +
        </button>
      </div>
    </div>
  );
}

function FeedbackSheet({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (f: {
    perceivedPerformance?: number;
    pump?: number;
    jointPain?: number;
    fatigue?: number;
    motivation?: number;
    notes?: string;
  }) => void;
  pending: boolean;
}) {
  const [performance, setPerformance] = useState<number | undefined>();
  const [pump, setPump] = useState<number | undefined>();
  const [jointPain, setJointPain] = useState<number | undefined>();
  const [fatigue, setFatigue] = useState<number | undefined>();
  const [motivation, setMotivation] = useState<number | undefined>();
  const [notes, setNotes] = useState("");

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>¿Cómo ha ido?</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-4 overflow-y-auto px-4 pb-6">
          <Scale
            label="Rendimiento"
            value={performance}
            onChange={setPerformance}
          />
          <Scale label="Pump" value={pump} onChange={setPump} />
          <Scale
            label="Molestias articulares"
            value={jointPain}
            onChange={setJointPain}
          />
          <Scale
            label="Fatiga (opcional)"
            value={fatigue}
            onChange={setFatigue}
          />
          <Scale
            label="Motivación (opcional)"
            value={motivation}
            onChange={setMotivation}
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Nota (opcional)"
            aria-label="Nota de la sesión"
            className="border-border bg-card min-h-16 w-full rounded-md border p-2 text-sm"
          />
          <Button
            type="button"
            className="min-h-12 w-full"
            disabled={pending}
            onClick={() =>
              onSubmit({
                perceivedPerformance: performance,
                pump,
                jointPain,
                fatigue,
                motivation,
                notes: notes.trim() || undefined,
              })
            }
          >
            {pending ? "Guardando…" : "Guardar y finalizar"}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Scale({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-sm">{label}</p>
      <div className="flex gap-1.5" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            className={cn(
              "tnum min-h-11 flex-1 rounded-md border text-sm",
              value === n
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border text-muted-foreground",
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function SubstitutionSheet({
  open,
  onOpenChange,
  options,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  options: SubstitutionExercise[];
  onPick: (variantId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.exerciseName.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Sustituir ejercicio</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar ejercicio para sustituir"
            className="border-border bg-card mb-3 h-11 w-full rounded-md border px-3 text-base"
          />
          <ul className="max-h-[50vh] space-y-3 overflow-y-auto">
            {filtered.map((o) => (
              <li key={o.exerciseName}>
                <p className="mb-1 text-sm font-medium">{o.exerciseName}</p>
                <div className="flex flex-wrap gap-1.5">
                  {o.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => onPick(v.id)}
                      className="border-border bg-card min-h-9 rounded-md border px-2.5 py-1 text-xs"
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
