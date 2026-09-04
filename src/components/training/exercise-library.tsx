"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { MUSCLE_GROUPS } from "@/core/catalog/muscle-groups";
import type { Equipment, MovementPattern } from "@/core/enums";
import {
  deleteCustomExerciseAction,
  saveExerciseNoteAction,
} from "@/server/actions/exercise.action";
import { Button } from "@/components/ui/button";
import { CustomExerciseForm } from "@/components/training/custom-exercise-form";
import { ExerciseNoteEditor } from "@/components/training/exercise-note-editor";
import { Input } from "@/components/ui/input";
import type { LibraryExercise } from "@/server/repositories/exercise-library.repo";
import { cn } from "@/lib/utils";

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  BARBELL: "Barra",
  EZ_BAR: "Barra EZ",
  DUMBBELL: "Mancuernas",
  MACHINE: "Máquinas",
  SMITH_MACHINE: "Multipower",
  CABLE: "Poleas",
  BODYWEIGHT: "Peso corporal",
  BAND: "Bandas",
};

const PATTERN_LABELS: Record<MovementPattern, string> = {
  HORIZONTAL_PUSH: "Empuje horizontal",
  VERTICAL_PUSH: "Empuje vertical",
  HORIZONTAL_PULL: "Tirón horizontal",
  VERTICAL_PULL: "Tirón vertical",
  SQUAT: "Dominante de rodilla",
  HINGE: "Bisagra de cadera",
  LUNGE: "Zancada",
  ISOLATION: "Aislamiento",
  CORE: "Core",
};

const EQUIPMENT_OPTIONS = Object.keys(EQUIPMENT_LABELS) as Equipment[];

export function ExerciseLibrary({
  exercises,
}: {
  exercises: LibraryExercise[];
}) {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const router = useRouter();
  const [deleting, startDelete] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (muscle && !e.muscles.some((m) => m.code === muscle)) return false;
      if (equipment && !e.variants.some((v) => v.equipment === equipment))
        return false;
      return true;
    });
  }, [exercises, query, muscle, equipment]);

  return (
    <div className="space-y-4">
      <Input
        type="search"
        inputMode="search"
        placeholder="Buscar ejercicio…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar ejercicio"
      />

      <div>
        <p className="text-muted-foreground mb-1 text-xs">Músculo</p>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={muscle === null} onClick={() => setMuscle(null)}>
            Todos
          </FilterChip>
          {MUSCLE_GROUPS.map((g) => (
            <FilterChip
              key={g.code}
              active={muscle === g.code}
              onClick={() => setMuscle(muscle === g.code ? null : g.code)}
            >
              {g.nameEs}
            </FilterChip>
          ))}
        </div>
      </div>

      <div>
        <p className="text-muted-foreground mb-1 text-xs">Equipamiento</p>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            active={equipment === null}
            onClick={() => setEquipment(null)}
          >
            Todos
          </FilterChip>
          {EQUIPMENT_OPTIONS.map((eq) => (
            <FilterChip
              key={eq}
              active={equipment === eq}
              onClick={() => setEquipment(equipment === eq ? null : eq)}
            >
              {EQUIPMENT_LABELS[eq]}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {filtered.length} ejercicio{filtered.length === 1 ? "" : "s"}
        </p>
        <CustomExerciseForm />
      </div>

      <ul className="space-y-2">
        {filtered.map((e) => {
          const open = openId === e.id;
          const primary = e.muscles.find((m) => m.role === "PRIMARY");
          return (
            <li key={e.id} className="border-border bg-card rounded-lg border">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : e.id)}
                className="focus-visible:ring-ring/50 flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:ring-2 focus-visible:outline-none"
              >
                <span>
                  <span className="font-medium">{e.name}</span>
                  {e.isOwn ? (
                    <span className="border-primary/50 text-muted-foreground ml-2 rounded-full border px-1.5 py-0.5 align-middle text-[10px]">
                      Tuyo
                    </span>
                  ) : null}
                  {!e.isActive ? (
                    <span className="text-muted-foreground ml-2 text-xs">
                      (inactivo)
                    </span>
                  ) : null}
                  {e.variants.some((v) => v.note !== null) ? (
                    <span
                      className="text-muted-foreground ml-2 align-middle text-[10px]"
                      title="Tienes una nota en alguna variante de este ejercicio"
                    >
                      ✎
                    </span>
                  ) : null}
                  <span className="text-muted-foreground block text-xs">
                    {primary ? primary.nameEs : ""} ·{" "}
                    {PATTERN_LABELS[e.movementPattern as MovementPattern] ??
                      e.movementPattern}
                  </span>
                </span>
                <span
                  className="text-muted-foreground shrink-0 text-xs"
                  aria-hidden
                >
                  {open ? "▲" : "▼"}
                </span>
              </button>
              {open ? (
                <div className="border-border space-y-3 border-t px-4 py-3 text-sm">
                  {e.instructions ? (
                    <p className="text-muted-foreground">{e.instructions}</p>
                  ) : null}
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-medium">
                      Músculos
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {e.muscles.map((m) => (
                        <span
                          key={m.code}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs",
                            m.role === "PRIMARY"
                              ? "border-primary/50 text-foreground"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {m.nameEs}
                          {m.role === "SECONDARY" ? ` ·${m.factor}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-medium">
                      Variantes
                    </p>
                    {/* La nota va DENTRO de la variante, no en el ejercicio:
                        casi todas describen el montaje de una máquina concreta
                        ("2 discos son 40 kg") y en la variante de al lado son
                        falsas. Es además la misma identidad que usan el
                        historial y la progresión. */}
                    <ul className="tnum space-y-3">
                      {e.variants.map((v) => (
                        <li key={v.id} className="space-y-1">
                          <div className="flex justify-between gap-3">
                            <span>{v.name}</span>
                            <span className="text-muted-foreground">
                              {EQUIPMENT_LABELS[v.equipment as Equipment] ??
                                v.equipment}{" "}
                              · {v.repRangeMin}–{v.repRangeMax} reps
                            </span>
                          </div>
                          <VariantNote
                            variantId={v.id}
                            label={`${e.name} — ${v.name}`}
                            initialNote={v.note}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                  {e.isOwn ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-h-9"
                      disabled={deleting}
                      onClick={() =>
                        startDelete(async () => {
                          const r = await deleteCustomExerciseAction(e.id);
                          if (!r.ok) {
                            toast.error(r.error ?? "No se pudo borrar.");
                            return;
                          }
                          toast.success(`"${e.name}" borrado.`);
                          router.refresh();
                        })
                      }
                    >
                      Borrar de mi banco
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring/50 min-h-8 rounded-full border px-2.5 py-1 text-xs focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border bg-card text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * La nota de UNA variante en la biblioteca. Guarda contra el servidor y se
 * queda con el texto que este devuelve, que es el que de verdad hay guardado.
 * Aquí no hay capa offline a propósito: la biblioteca es una pantalla de casa
 * y sin cobertura ni siquiera carga. La sesión, que sí se usa en el gimnasio,
 * guarda por la outbox (ver `session-runner`).
 */
function VariantNote({
  variantId,
  label,
  initialNote,
}: {
  variantId: string;
  label: string;
  initialNote: string | null;
}) {
  const [note, setNote] = useState(initialNote);
  return (
    <ExerciseNoteEditor
      exerciseVariantId={variantId}
      exerciseName={label}
      note={note}
      save={async (text) => {
        const result = await saveExerciseNoteAction({
          exerciseVariantId: variantId,
          text,
        });
        if (!result.ok) {
          toast.error(result.error ?? "No se pudo guardar la nota.");
          return note;
        }
        const saved = result.text ?? null;
        setNote(saved);
        toast.success(saved ? "Nota guardada." : "Nota borrada.");
        return saved;
      }}
    />
  );
}
