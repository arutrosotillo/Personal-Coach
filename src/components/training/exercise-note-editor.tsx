"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EXERCISE_NOTE_MAX_LENGTH } from "@/core/schemas/exercise-note";
import { saveExerciseNoteAction } from "@/server/actions/exercise.action";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Nota personal de una VARIANTE de ejercicio: se lee de un vistazo y se edita
 * en sitio.
 *
 * El mismo componente sirve en la biblioteca y en medio de la sesión, que es
 * donde de verdad se lee, pero NO guardan igual y esa diferencia es el punto:
 *
 *  · En la biblioteca (`save` sin definir) se llama a la server action y se
 *    espera la respuesta. Es una pantalla que sin cobertura ni siquiera carga.
 *  · En la sesión, el runner pasa `save`, que mete la nota en la outbox y en el
 *    snapshot de `localStorage`. Queda guardada al instante en el móvil y viaja
 *    al servidor cuando haya cobertura, igual que las series. Antes de esto,
 *    escribir una nota sin cobertura mostraba un error y el texto solo vivía en
 *    el estado de React: cerrar la app lo perdía.
 */
export function ExerciseNoteEditor({
  exerciseVariantId,
  exerciseName,
  note,
  save,
  pendingSync = false,
  className,
}: {
  exerciseVariantId: string;
  /** Solo para las etiquetas accesibles: hay varias notas en la misma página. */
  exerciseName: string;
  /** Texto vigente (`null` = no hay nota). Lo controla quien monta el editor. */
  note: string | null;
  /**
   * Guardado alternativo. Devuelve el texto que queda (o lanza). Si no se pasa,
   * se usa la server action directamente.
   */
  save?: (text: string) => Promise<string | null>;
  /** Escrita en este móvil y todavía no confirmada por el servidor. */
  pendingSync?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(note ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function open() {
    setDraft(note ?? "");
    setEditing(true);
  }

  function commit() {
    if (save) {
      // Local-first: guardar no puede fallar ni hacer esperar, y sobre todo no
      // puede DIFERIRSE. Esto vivía dentro de `startTransition` y ahí estaba el
      // fallo: una transición es trabajo de baja prioridad, así que React podía
      // posponer la actualización de estado —y con ella la escritura del
      // cuaderno de `localStorage`— más allá de una recarga o de que el sistema
      // matara la app. La nota volvía a la versión anterior. Aquí se escribe ya.
      void save(draft).then((saved) => setDraft(saved ?? ""));
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await saveExerciseNoteAction({
        exerciseVariantId,
        text: draft,
      });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo guardar la nota.");
        return;
      }
      const saved = result.text ?? null;
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
              onClick={commit}
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
        <span className="flex items-center gap-1.5">
          Mi nota
          {/* La nota ya está guardada EN EL MÓVIL: esto no es un aviso de
              error, es la misma señal honesta que llevan las series. */}
          {pendingSync ? (
            <span className="text-muted-foreground/80 normal-case">
              · guardada aquí, sin sincronizar
            </span>
          ) : null}
        </span>
        <span className="underline underline-offset-2">Editar</span>
      </span>
      <span className="mt-0.5 block text-sm whitespace-pre-wrap">{note}</span>
    </button>
  );
}
