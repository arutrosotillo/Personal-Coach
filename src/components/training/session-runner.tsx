"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { EXERCISE_NOTE_MAX_LENGTH } from "@/core/schemas/exercise-note";
import { RestTimer } from "@/components/training/rest-timer";
import { SyncStatus } from "@/components/training/sync-status";
import { useSessionSync } from "@/components/training/use-session-sync";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  initNotes,
  initRows,
  reconcile,
  variantMap,
  type NotesMap,
  type ReconciledState,
  type RowState,
  type RowsMap,
} from "@/lib/offline/session-snapshot";
import {
  browserStorage,
  createSnapshotStore,
} from "@/lib/offline/session-storage";
import {
  discardSessionAction,
  getExerciseHistoryAction,
  substituteExerciseAction,
} from "@/server/actions/workout.action";
import type { ClientExecutionSession } from "@/server/repositories/workout.repo";
import type { ExerciseHistorySummary } from "@/server/services/progression.service";
import type { ProgressionSuggestion } from "@/core/training/progression";
import { CoachPanel } from "@/components/coach/coach-panel";
import { ExerciseNoteEditor } from "@/components/training/exercise-note-editor";
import { cn } from "@/lib/utils";

export interface SubstitutionExercise {
  exerciseName: string;
  variants: Array<{ id: string; name: string; equipment: string }>;
}

// Helper a nivel de módulo: el lint del compilador de React marca Date.now()
// como impuro si aparece dentro del componente, aunque sea en un handler.
const nowMs = () => Date.now();

export function SessionRunner({
  session,
  substitution,
  suggestions,
  coachEnabled,
}: {
  session: ClientExecutionSession;
  substitution: SubstitutionExercise[];
  suggestions: Record<string, ProgressionSuggestion>;
  /** Si no hay OPENAI_API_KEY, los botones de IA no se pintan. */
  coachEnabled: boolean;
}) {
  const router = useRouter();
  const exercises = session.exercises;
  // El primer render es el del SERVIDOR, sin tocar el `localStorage`. Es
  // deliberado: leerlo aquí hacía que el HTML del servidor y el del cliente no
  // coincidieran, y cada recarga sin cobertura —justo la que importa— tiraba un
  // error de hidratación. Lo guardado se aplica en un efecto, justo después.
  const [rows, setRows] = useState<RowsMap>(() => initRows(exercises));
  const [notes, setNotes] = useState<NotesMap>(() => initNotes(exercises));
  const [current, setCurrent] = useState(0);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [restored, setRestored] = useState<ReconciledState | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const variants = useMemo(() => variantMap(exercises), [exercises]);

  // Recupera lo que quedó guardado en ESTE móvil y lo funde con lo que trae el
  // servidor. La regla está explicada en `reconcile`: si el servidor tiene
  // confirmada una serie y no hay nada pendiente sobre ella, manda el servidor;
  // en cualquier otro caso, manda lo local. Así ni un dato pendiente ni un
  // borrador se pierden al recargar, y unos datos viejos del servidor —el HTML
  // que sirve el service worker cuando no hay cobertura— no pisan nada.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const store = createSnapshotStore(browserStorage());
    // Solo hay una sesión activa a la vez: cualquier otra que quedara guardada
    // es de un entrenamiento ya terminado y no vuelve a leerse nunca.
    store.keepOnly(session.id);
    const state = reconcile(exercises, store.read(session.id), session.id);
    setRestored(state);
    setRows(state.rows);
    setNotes(state.notes);
    setCurrent(state.current);
    setRestEndsAt(state.restEndsAt);
    if (state.recovered) {
      // Recargar en mitad de un entrenamiento y ver tus series ahí es lo
      // esperable; enterarte de que además siguen pendientes de enviar, no.
      toast.success("He recuperado tu entrenamiento de este móvil.");
    }
  }, [exercises, session.id]);

  const sync = useSessionSync({
    sessionId: session.id,
    restored,
    rows,
    notes,
    variantByExercise: variants,
    current,
    restEndsAt,
    onFinishSynced: ({ deload }) => {
      // Si contó como descarga, decirlo: si no, el usuario ve una sesión
      // corta como cualquier otra y un contador que se reinicia solo.
      toast.success(
        deload
          ? "Sesión guardada como descarga: no cuenta como sesión acortada."
          : "Sesión guardada",
      );
      router.push("/train");
      router.refresh();
    },
  });
  const ex = exercises[current];
  const exRows = rows[ex.id] ?? [];
  const suggestion = suggestions[ex.id];

  /**
   * Guardar la nota es LOCAL-FIRST, exactamente como una serie: se pinta y se
   * escribe en el cuaderno del móvil ya, y la outbox se encarga del servidor.
   * Nunca falla ni hace esperar, así que devuelve el texto sin `await` de red.
   *
   * `text` viene ya recortado por el editor; vacío = borrar la nota, la misma
   * semántica que valida Zod y aplica el servicio.
   */
  const saveNote = useCallback(
    async (text: string): Promise<string | null> => {
      const clean = text.trim().slice(0, EXERCISE_NOTE_MAX_LENGTH);
      const variantId = exercises[current].variantId;
      setNotes((prev) => ({ ...prev, [variantId]: clean === "" ? null : clean }));
      sync.queueNote({ exerciseVariantId: variantId, text: clean });
      return clean === "" ? null : clean;
    },
    [current, exercises, sync],
  );
  /** Variantes cuya nota todavía no ha confirmado el servidor. */
  const notePending = sync.pendingNotes;

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

  /**
   * Encola el estado actual de una serie para el servidor.
   *
   * Antes esto ESCRIBÍA y, si fallaba —cualquier caída de red—, revertía la
   * fila al estado previo: la serie que acababas de registrar se borraba sola
   * delante de ti. Ese era el problema. Ahora la fila es la verdad en pantalla
   * y la cola se encarga de que llegue, hoy o dentro de media hora.
   */
  function persistSet(idx: number, row: RowState) {
    const weightKg = row.weight === "" ? 0 : Number(row.weight);
    if (Number.isNaN(weightKg)) {
      toast.error("Peso no válido");
      return false;
    }
    sync.queueSet({
      workoutExerciseId: ex.id,
      setNumber: idx + 1,
      weightKg,
      reps: row.reps,
      rir: row.rir,
    });
    return true;
  }

  function completeSet(idx: number) {
    const row = exRows[idx];
    if (!persistSet(idx, { ...row, done: true })) return;
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
    // Solo se re-guarda una serie YA completada, y nunca con el peso a medio
    // teclear (el campo vacío persistiría un 0 real en la base de datos).
    const next = { ...current, ...patch };
    if (current?.done && next.weight !== "") persistSet(idx, next);
  }

  function addSet() {
    const arr = rows[ex.id] ?? [];
    const last = arr[arr.length - 1];
    // Se hereda el PLAN (peso y reps), nunca el RIR: la serie nueva todavía no
    // se ha hecho, así que su esfuerzo está sin registrar.
    const next = [
      ...arr,
      { ...last, rir: null, rirAnswered: false, done: false },
    ];
    setRows((prev) => ({ ...prev, [ex.id]: next }));
    sync.queuePlanned({ workoutExerciseId: ex.id, plannedSets: next.length });
  }

  function removeSet() {
    const arr = rows[ex.id] ?? [];
    if (arr.length <= 1) return;
    const next = arr.slice(0, -1);
    setRows((prev) => ({ ...prev, [ex.id]: next }));
    sync.queuePlanned({ workoutExerciseId: ex.id, plannedSets: next.length });
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
    const plan = (targets ?? [])
      .slice(0, arr.length)
      .filter((_, i) => !arr[i].done);
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
          rirAnswered: false,
        }
      : prev
        ? {
            weight: prev.weight,
            reps: prev.reps,
            rir: null,
            rirAnswered: false,
          }
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

  /**
   * Cierra la sesión. Se puede pulsar SIN cobertura: el cierre se encola con un
   * token de idempotencia y la pantalla pasa a "terminado". Cuando el servidor
   * lo confirma, `onFinishSynced` navega a /train. No se navega antes porque
   * /train necesita servidor: llevar a alguien sin cobertura a una pantalla
   * rota justo después de decirle "guardado" sería la peor forma de terminar.
   */
  function finish(feedback: {
    perceivedPerformance?: number;
    pump?: number;
    jointPain?: number;
    fatigue?: number;
    motivation?: number;
    notes?: string;
  }) {
    setFeedbackOpen(false);
    sync.queueFinish(feedback);
  }

  function discard() {
    if (
      !confirm(
        `¿Descartar la sesión? Se perderán ${totalDone} series registradas. No se puede deshacer.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await discardSessionAction(session.id);
      if (!res.ok) toast.error(res.error ?? "No se pudo descartar");
      router.push("/train");
      router.refresh();
    });
  }

  // Ya pulsó "Guardar y finalizar". Con cobertura esto dura un parpadeo y
  // `onFinishSynced` navega; sin ella, es la pantalla honesta: el entrenamiento
  // está terminado y guardado en el móvil, y se enviará solo.
  if (sync.finishedLocally) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-xl font-semibold">Entrenamiento terminado</h1>
        <p className="tnum text-muted-foreground text-sm">
          {totalDone} series registradas
        </p>
        <p className="text-muted-foreground text-sm">
          {sync.pending === 0
            ? "Guardado. Un momento…"
            : sync.reachable
              ? "Guardando en el servidor…"
              : "Guardado en este móvil. Se enviará solo en cuanto vuelva la cobertura: puedes cerrar la app."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pt-4 pb-28">
      {/* Header con progreso */}
      <header className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="Descartar sesión"
            // Descartar borra series sin vuelta atrás y necesita servidor. Sin
            // conexión no se encola: una destrucción irreversible aplazada
            // media hora es justo lo que no debe hacer una cola de reintentos.
            disabled={!sync.reachable}
            className="text-muted-foreground min-h-9 px-1 text-sm disabled:opacity-40"
            onClick={discard}
          >
            ✕ Descartar
          </button>
          <span className="text-muted-foreground text-xs">
            Ejercicio {current + 1}/{exercises.length} · {totalDone}/
            {totalPlanned} series
          </span>
          <SyncStatus phase={sync.phase} pending={sync.pending} />
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
          {/* Tu nota de ESTA variante, donde de verdad se lee: justo antes de
              la serie. Se edita aquí mismo sin salir de la sesión, y se guarda
              como las series —al instante en el móvil, al servidor cuando haya
              cobertura—, no con una llamada que falla en un sótano.
              `key` por variante y no por ejercicio: dos variantes del mismo
              ejercicio en el mismo día son dos notas distintas, y con la clave
              del ejercicio React reutilizaba el mismo editor para las dos. */}
          <ExerciseNoteEditor
            key={ex.variantId}
            exerciseVariantId={ex.variantId}
            exerciseName={`${ex.exerciseName} — ${ex.variantName}`}
            note={notes[ex.variantId] ?? null}
            pendingSync={notePending.has(ex.variantId)}
            save={saveNote}
            className="mt-2"
          />
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
            />
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11"
            onClick={addSet}
          >
            + Añadir serie
          </Button>
          {exRows.length > 1 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11"
              onClick={removeSet}
            >
              − Quitar serie
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-11"
            // Borra las series ya registradas del ejercicio y necesita el
            // catálogo del servidor: no tiene una versión offline honesta.
            disabled={!sync.reachable || pending}
            onClick={() => setSubOpen(true)}
          >
            {sync.reachable
              ? "Sustituir ejercicio"
              : "Sustituir (sin conexión)"}
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
        coachEnabled={coachEnabled}
      />
    </div>
  );
}

/** Badge discreto con la sugerencia de progresión. Un tap despliega el "por
 * qué"; "aplicar" rellena las series pendientes (no persiste, no toca el
 * programa) y las señales informativas se muestran bajo la explicación. */
function SuggestionBadge({
  suggestion,
  onApply,
}: {
  suggestion: ProgressionSuggestion;
  onApply: () => void;
}) {
  const [open, setOpen] = useState(false);
  /**
   * Con cargas mezcladas (serie top + descargas, o series ascendentes) el
   * `suggestedWeightKg` es el peso MÁS ALTO que ya moviste: una referencia para
   * que el motor no te proponga menos, NO una prescripción para las tres
   * series. Aplicarlo de un toque escribía 3×100 a quien había hecho
   * 1×100 + 2×70. La explicación sigue disponible; lo que se retira es el
   * atajo que la malinterpreta.
   */
  const canApply =
    suggestion.suggestedWeightKg != null &&
    suggestion.action !== "START" &&
    !suggestion.signals.some((x) => x.code === "MIXED_LOADS");
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
  coachEnabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  variantId: string;
  exerciseName: string;
  coachEnabled: boolean;
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
        {/* `overflow-y-auto`: el popup tiene tope de altura y el contenedor
            interno es `overflow-hidden`, así que sin esto una respuesta larga
            del coach se recortaba sin posibilidad de hacer scroll. */}
        <div className="space-y-3 overflow-y-auto px-4 pb-8 text-sm">
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

          {/* Coach AI, bajo demanda: una consulta por tap, nunca automática.
              Sin clave configurada no se pinta nada: dos botones que solo
              devuelven "no configurado" en mitad del entrenamiento son ruido. */}
          {coachEnabled ? (
            <div className="border-border space-y-3 border-t pt-3">
              <CoachPanel
                request={{ task: "EXERCISE", variantId }}
                label="Analizar con AI Coach"
              />
              <CoachPanel
                request={{ task: "EXPLAIN", variantId }}
                label="¿Por qué hago esto?"
              />
            </div>
          ) : null}
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
}: {
  index: number;
  row: RowState;
  loadStepKg: number;
  targetRir: number;
  lastSet: { weightKg: number; reps: number; rir: number | null } | null;
  onChange: (patch: Partial<RowState>) => void;
  onComplete: () => void;
  onRepeat: () => void;
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
              aria-pressed={row.rirAnswered && row.rir === r}
              aria-label={`RIR ${r === 4 ? "4 o más" : r}`}
              onClick={() => onChange({ rir: r, rirAnswered: true })}
              className={cn(
                "tnum min-h-11 min-w-11 rounded-md border text-sm",
                row.rirAnswered && row.rir === r
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground",
              )}
            >
              {r === 4 ? "4+" : r}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={row.rirAnswered && row.rir === null}
            aria-label="RIR: no lo sé"
            onClick={() => onChange({ rir: null, rirAnswered: true })}
            className={cn(
              "min-h-11 rounded-md border px-2 text-xs",
              row.rirAnswered && row.rir === null
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
            Guardar y finalizar
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
        <div className="overflow-y-auto px-4 pb-6">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar ejercicio para sustituir"
            className="border-border bg-card mb-3 h-11 w-full rounded-md border px-3 text-base"
          />
          <ul className="space-y-3">
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
