"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EXERCISE_NOTE_MAX_LENGTH } from "@/core/schemas/exercise-note";
import { saveExerciseNoteAction } from "@/server/actions/exercise.action";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Nota personal de un ejercicio: se lee de un vistazo y se edita en sitio.
 *
 * El mismo componente sirve en la biblioteca y en medio de la sesión, que es
 * donde de verdad se lee. Guarda el texto que devuelve el servidor (ya
 * recortado) en vez del que se tecleó, para no pintar algo distinto de lo que
 * hay guardado.
 */
export function ExerciseNoteEditor({
  exerciseId,
  exerciseName,
  initialNote,
  className,
}: {
  exerciseId: string;
  /** Solo para las etiquetas accesibles: hay varias notas en la misma página. */
  exerciseName: string;
  initialNote: string | null;
  className?: string;
}) {
  const [note, setNote] = useState(initialNote);
  const [draft, setDraft] = useState(initialNote ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function open() {
    setDraft(note ?? "");
    setEditing(true);
  }

  function save() {
    startTransition(async () => {
      const result = await saveExerciseNoteAction({ exerciseId, text: draft });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo guardar la nota.");
        return;
      }
      const saved = result.text ?? null;
      setNote(saved);
      setDraft(saved ?? "");
      setEditing(false);
      toast.success(saved ? "Nota guardada." : "Nota borrada.");
    });
  }

  if (editing) {
    return (
      <div className={cn("space-y-2", className)}>
        <Textarea
          autoFocus
          value={draft}
          maxLength={EXERCISE_NOTE_MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ej.: piernas encogidas, omóplatos retraídos, asiento en el 4…"
          aria-label={`Nota sobre ${exerciseName}`}
          className="text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            {/* Guardarla vacía la borra: es el gesto natural para quitarla. */}
            {draft.trim() === ""
              ? "Vacía = borrar la nota"
              : `${draft.length}/${EXERCISE_NOTE_MAX_LENGTH}`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-9"
              disabled={pending}
              onClick={() => setEditing(false)}
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
      </div>
    );
  }

  if (note === null) {
    return (
      <button
        type="button"
        onClick={open}
        className={cn(
          "text-muted-foreground focus-visible:ring-ring/50 min-h-9 text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none",
          className,
        )}
      >
        + Añadir nota
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label={`Editar mi nota sobre ${exerciseName}`}
      className={cn(
        "border-primary/40 bg-primary/5 focus-visible:ring-ring/50 w-full rounded-lg border px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      <span className="text-muted-foreground flex items-center justify-between gap-2 text-[10px] tracking-wide uppercase">
        Mi nota
        <span className="underline underline-offset-2">Editar</span>
      </span>
      <span className="mt-0.5 block text-sm whitespace-pre-wrap">{note}</span>
    </button>
  );
}
