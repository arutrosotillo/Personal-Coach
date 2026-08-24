"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
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
  getExerciseHistoryAction,
  logSetAction,
  setPlannedSetsAction,
  substituteExerciseAction,
} from "@/server/actions/workout.action";
import type { ExecutionSession } from "@/server/repositories/workout.repo";
import type { ExerciseHistorySummary } from "@/server/services/progression.service";
import type { ProgressionSuggestion } from "@/core/training/progression";
import { cn } from "@/lib/utils";

export interface SubstitutionExercise {
  exerciseName: string;
  variants: Array<{ id: string; name: string; equipment: string }>;
}

interface RowState {
  weight: string;
  reps: number;
  /**
   * RIR REALMENTE registrado por el usuario. `null` = "no lo sé" / sin
   * registrar. NUNCA se prerrellena con `targetRir`: el objetivo es una
   * prescripción, no un dato reportado, y confundirlos contamina el historial
   * y sesga al motor de progresión (docs/TRAINING_ENGINE_FINAL_AUDIT.md §2.6).
   */
  rir: number | null;
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
        rir: logged?.rir ?? null,
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
  suggestions,
}: {
  session: ExecutionSession;
  substitution: SubstitutionExercise[];
  suggestions: Record<string, ProgressionSuggestion>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<RowsMap>(() => initRows(session));
  const [current, setCurrent] = useState(0);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const exercises = session.exercises;
  const ex = exercises[current];
  const exRows = rows[ex.id] ?? [];
  const suggestion = suggestions[ex.id];

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

  /** Guarda (upsert idempotente) el estado actual de una serie. */
  function persistSet(idx: number, row: RowState, markDone: boolean) {
    const weightKg = row.weight === "" ? 0 : Number(row.weight);
    if (Number.isNaN(weightKg)) {
      toast.error("Peso no válido");
      return false;
    }
    startTransition(async () => {
      const res = await logSetAction({
        workoutExerciseId: ex.id,
        setNumber: idx + 1,
        weightKg,
        reps: row.reps,
        rir: row.rir,
      });
      if (!res.ok) {
        if (markDone) updateRow(ex.id, idx, { done: false });
        toast.error(res.error ?? "No se pudo guardar");
      }
    });
    return true;
  }

  function completeSet(idx: number) {
    const row = exRows[idx];
    // Optimista: marcar hecho y arrancar el descanso al instante.
    if (!persistSet(idx, row, true)) return;
    updateRow(ex.id, idx, { done: true });
    setRestEndsAt(nowMs() + ex.restSeconds * 1000);
  }

  /**
   * Edita una serie. Si ya estaba completada, RE-GUARDA: corregir el RIR (o el
   * peso/reps) después de darle a "Completar" tiene que quedar registrado, no
   * perderse en silencio.
   */
  function editRow(idx: number, patch: Partial<RowState>) {
    const current = exRows[idx];
    updateRow(ex.id, idx, patch);
    if (current?.done) persistSet(idx, { ...current, ...patch }, false);
  }

  function addSet() {
    const arr = rows[ex.id] ?? [];
    const last = arr[arr.length - 1];
    const next = [...arr, { ...last, done: false }];
    setRows((prev) => ({ ...prev, [ex.id]: next }));
    startTransition(async () => {
      const res = await setPlannedSetsAction(ex.id, next.length);
      if (!res.ok) {
        setRows((prev) => ({ ...prev, [ex.id]: arr }));
        toast.error(res.error ?? "No se pudo añadir la serie");
      }
    });
  }

  function removeSet() {
    const arr = rows[ex.id] ?? [];
    if (arr.length <= 1) return;
    const next = arr.slice(0, -1);
    setRows((prev) => ({ ...prev, [ex.id]: next }));
    startTransition(async () => {
      const res = await setPlannedSetsAction(ex.id, next.length);
      if (!res.ok) {
        setRows((prev) => ({ ...prev, [ex.id]: arr }));
        toast.error(res.error ?? "No se pudo quitar la serie");
      }
    });
  }

  /** Aplica la carga y los objetivos por serie sugeridos a todas las series
   * pendientes (prefill; no persiste ni cambia el programa). */
  function applySuggestion() {
    if (!suggestion || suggestion.suggestedWeightKg == null) return;
    const arr = rows[ex.id] ?? [];
    const weight = suggestion.suggestedWeightKg.toString();
    const targets = suggestion.setTargets;
    const pending = arr.filter((r) => !r.done).length;
    if (pending === 0) return;
    setRows((prev) => ({
      ...prev,
      [ex.id]: (prev[ex.id] ?? []).map((r, i) =>
        r.done
          ? r
          : {
              ...r,
              weight,
              reps: targets?.[i] ?? suggestion.suggestedReps ?? r.reps,
            },
      ),
    }));
    const plan = (targets ?? []).filter((_, i) => !arr[i]?.done);
    toast.success(
      plan.length > 0
        ? `${suggestion.suggestedWeightKg} kg · ${plan.join("/")} reps`
        : `${suggestion.suggestedWeightKg} kg`,
    );
  }

  /** Copia peso/reps/RIR de la "última vez" de esta serie (o de la serie
   * anterior de hoy) a una fila no completada, en un tap. */
  function repeatRow(idx: number) {
    const lastSet = ex.lastTime?.sets[idx];
    const prev = idx > 0 ? (rows[ex.id] ?? [])[idx - 1] : undefined;
    // Copia el PLAN (peso y repeticiones), nunca el RIR: el esfuerzo es un
    // dato de HOY y se registra a mano (o se deja sin registrar).
    const source = lastSet
      ? {
          weight: lastSet.weightKg.toString(),
          reps: lastSet.reps,
          rir: null,
        }
      : prev
        ? { weight: prev.weight, reps: prev.reps, rir: null }
        : null;
    if (!source) return;
    updateRow(ex.id, idx, source);
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
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">{ex.exerciseName}</h1>
              <p className="text-muted-foreground text-sm">
                {ex.variantName} · {ex.repRangeMin}–{ex.repRangeMax} reps ·
                objetivo {ex.targetRir} RIR
              </p>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="text-muted-foreground mt-1 min-h-9 text-xs underline underline-offset-2"
              >
                Ver historial
              </button>
            </div>
            {suggestion ? (
              <SuggestionBadge
                suggestion={suggestion}
                onApply={applySuggestion}
              />
            ) : null}
          </div>
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
              targetRir={ex.targetRir}
              lastSet={ex.lastTime?.sets[idx] ?? null}
              onChange={(patch) => editRow(idx, patch)}
              onComplete={() => completeSet(idx)}
              onRepeat={() => repeatRow(idx)}
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
            disabled={pending}
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
              disabled={pending}
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

      <ExerciseHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        variantId={ex.variantId}
        exerciseName={ex.exerciseName}
      />
    </div>
  );
}

/** Badge discreto con la sugerencia de progresión. Un tap despliega el "por
 * qué"; "aplicar" solo rellena el primer set (no persiste, no toca el programa). */
function SuggestionBadge({
  suggestion,
  onApply,
}: {
  suggestion: ProgressionSuggestion;
  onApply: () => void;
}) {
  const [open, setOpen] = useState(false);
  const canApply =
    suggestion.suggestedWeightKg != null && suggestion.action !== "START";
  const tentative = suggestion.confidence !== "HIGH";

  const explanationId = `sug-why-${suggestion.reasonCode}`;
  const label =
    suggestion.action === "INCREASE_LOAD"
      ? `${tentative ? "Prueba" : "Sube"} ${suggestion.suggestedWeightKg} kg`
      : suggestion.action === "DECREASE_LOAD"
        ? `Baja a ${suggestion.suggestedWeightKg} kg`
        : suggestion.action === "ADD_REP"
          ? `Prueba ${suggestion.suggestedReps} reps`
          : suggestion.action === "START"
            ? "Primera vez"
            : "Mantén";

  return (
    <div className="flex max-w-[45%] shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "min-h-9 rounded-full border px-3 py-2 text-xs",
          canApply
            ? "border-primary/40 text-foreground"
            : "border-border text-muted-foreground",
        )}
        aria-expanded={open}
        aria-controls={explanationId}
        aria-label={`${label}. Ver por qué`}
      >
        {label} <span aria-hidden>· por qué</span>
      </button>
      {canApply ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-h-11"
          aria-label={`Rellenar las series pendientes con ${suggestion.suggestedWeightKg} kg (no guarda el cambio)`}
          onClick={onApply}
        >
          Aplicar
        </Button>
      ) : null}
      {open ? (
        <div
          id={explanationId}
          className="text-muted-foreground max-w-full text-right text-xs"
        >
          <p>{suggestion.explanation}</p>
          {suggestion.signals.map((signal) => (
            <p key={signal.code} className="mt-1 italic">
              {signal.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const TREND_LABEL: Record<string, string> = {
  UP: "↑ progresando",
  FLAT: "→ estable",
  DOWN: "↓ a la baja",
  INSUFFICIENT: "sin datos suficientes",
};

/** Drawer de mini-historial del ejercicio: mejor set, e1RM~ y tendencia.
 * Carga on-demand al abrir (lectura efímera, sin persistir). */
function ExerciseHistorySheet({
  open,
  onOpenChange,
  variantId,
  exerciseName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  variantId: string;
  exerciseName: string;
}) {
  // Solo se hace setState dentro del callback asíncrono (no de forma síncrona
  // en el efecto). `loading` se deriva comparando la variante ya cargada.
  const [data, setData] = useState<{
    variantId: string;
    summary: ExerciseHistorySummary | null;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    getExerciseHistoryAction(variantId).then((res) => {
      if (!alive) return;
      setData({
        variantId,
        summary: res.ok ? res.summary : null,
        error: !res.ok,
      });
    });
    return () => {
      alive = false;
    };
  }, [open, variantId]);

  const loaded = data?.variantId === variantId ? data : null;
  const loading = open && loaded === null;
  const summary = loaded?.summary ?? null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{exerciseName}</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-3 px-4 pb-8 text-sm">
          {loading ? (
            <p className="text-muted-foreground">Cargando…</p>
          ) : loaded?.error ? (
            <p className="text-destructive">
              No se pudo cargar el historial. Inténtalo de nuevo.
            </p>
          ) : !summary || summary.sessionCount === 0 ? (
            <p className="text-muted-foreground">
              Aún no hay historial de este ejercicio en las últimas semanas.
            </p>
          ) : (
            <>
              <Row label="Sesiones (8 sem)">
                <span className="tnum">{summary.sessionCount}</span>
              </Row>
              {summary.bestSet ? (
                <Row label="Mejor set">
                  <span className="tnum">
                    {summary.bestSet.weightKg}×{summary.bestSet.reps}
                    {summary.bestSet.e1rm != null
                      ? ` · e1RM~ ${summary.bestSet.e1rm} kg`
                      : ""}{" "}
                    <span className="text-muted-foreground">
                      ({summary.bestSet.localDate})
                    </span>
                  </span>
                </Row>
              ) : null}
              {summary.currentE1rm != null ? (
                <Row label="e1RM~ actual">
                  <span className="tnum">~{summary.currentE1rm} kg</span>
                </Row>
              ) : null}
              <Row label="Tendencia">
                <span>{TREND_LABEL[summary.trend.direction]}</span>
              </Row>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function SetRow({
  index,
  row,
  loadStepKg,
  targetRir,
  lastSet,
  onChange,
  onComplete,
  onRepeat,
  disabled,
}: {
  index: number;
  row: RowState;
  loadStepKg: number;
  targetRir: number;
  lastSet: { weightKg: number; reps: number; rir: number | null } | null;
  onChange: (patch: Partial<RowState>) => void;
  onComplete: () => void;
  onRepeat: () => void;
  disabled: boolean;
}) {
  const weightNum = row.weight === "" ? 0 : Number(row.weight);
  const ghost = lastSet
    ? `${lastSet.weightKg}×${lastSet.reps}${lastSet.rir != null ? `@${lastSet.rir}` : ""}`
    : null;
  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        row.done
          ? "border-primary/30 bg-primary/5 opacity-70"
          : "border-border bg-card",
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-muted-foreground w-6 shrink-0 text-sm">
          {index + 1}
        </span>
        {ghost ? (
          <span className="tnum text-muted-foreground text-xs">
            últ {ghost}
          </span>
        ) : null}
        {!row.done && (ghost || index > 0) ? (
          <button
            type="button"
            onClick={onRepeat}
            disabled={disabled}
            aria-label={
              ghost
                ? `Repetir la última vez de esta serie: ${ghost}`
                : "Repetir la serie anterior"
            }
            className="border-border text-muted-foreground ml-auto min-h-9 rounded-full border px-3 py-1.5 text-xs"
          >
            {ghost ? "repetir" : "repetir anterior"}
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0" />
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
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground w-6 shrink-0 text-xs">RIR</span>
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label={`RIR de la serie ${index + 1} (objetivo ${targetRir})`}
        >
          {[0, 1, 2, 3, 4].map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={row.rir === r}
              aria-label={`RIR ${r === 4 ? "4 o más" : r}`}
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
          <button
            type="button"
            aria-pressed={row.rir === null}
            aria-label="RIR: no lo sé"
            onClick={() => onChange({ rir: null })}
            className={cn(
              "min-h-9 rounded-md border px-2 text-xs",
              row.rir === null
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border text-muted-foreground",
            )}
          >
            No lo sé
          </button>
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
