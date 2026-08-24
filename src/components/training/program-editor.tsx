"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { SubstitutionExercise } from "@/components/training/session-runner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  addDayAction,
  addTemplateExerciseAction,
  changeTemplateVariantAction,
  editTemplateExerciseAction,
  removeDayAction,
  removeTemplateExerciseAction,
  renameDayAction,
  reorderDayAction,
  reorderTemplateExerciseAction,
  restoreInitialProgramAction,
} from "@/server/actions/program.action";

export interface EditorExercise {
  id: string;
  exerciseName: string;
  variantName: string;
  baseSets: number;
  repRangeMin: number;
  repRangeMax: number;
  targetRir: number;
  restSeconds: number;
}

export interface EditorTemplate {
  id: string;
  name: string;
  ordinal: number;
  exercises: EditorExercise[];
}

/** Editor básico del programa (Fase 2A): series/reps/RIR/descanso, orden,
 * sustitución, añadir/quitar y restaurar el plan inicial. */
export function ProgramEditor({
  templates,
  substitutionOptions,
  canRestore = false,
}: {
  templates: EditorTemplate[];
  substitutionOptions: SubstitutionExercise[];
  /** Solo los programas generados pueden restaurar su plan inicial (Fase 3.1). */
  canRestore?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setError(res.error ?? "No se pudo guardar.");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {editing
            ? "Editando. Los cambios no afectan a las sesiones ya guardadas."
            : "Tu plan de la semana."}
        </p>
        <Button
          type="button"
          variant={editing ? "default" : "secondary"}
          size="sm"
          className="min-h-11 shrink-0"
          onClick={() => {
            setEditing((v) => !v);
            setConfirmRestore(false);
            setError(null);
          }}
        >
          {editing ? "Hecho" : "Editar"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {templates.map((template, ti) => (
        <Card key={template.id}>
          <CardHeader>
            {editing ? (
              <DayHeader
                template={template}
                isFirst={ti === 0}
                isLast={ti === templates.length - 1}
                canRemove={templates.length > 1}
                pending={pending}
                run={run}
              />
            ) : (
              <CardTitle className="text-base">
                Día {template.ordinal} — {template.name}
              </CardTitle>
            )}
          </CardHeader>
          <CardContent>
            <ul className="divide-border divide-y">
              {template.exercises.map((ex, i) => (
                <li key={ex.id} className="py-3">
                  {editing ? (
                    <EditableRow
                      ex={ex}
                      isFirst={i === 0}
                      isLast={i === template.exercises.length - 1}
                      pending={pending}
                      substitutionOptions={substitutionOptions}
                      run={run}
                    />
                  ) : (
                    <ReadRow ex={ex} />
                  )}
                </li>
              ))}
            </ul>

            {editing ? (
              <AddExercise
                templateId={template.id}
                pending={pending}
                substitutionOptions={substitutionOptions}
                run={run}
              />
            ) : null}
          </CardContent>
        </Card>
      ))}

      {editing ? (
        <AddDay
          nextNumber={templates.length + 1}
          pending={pending}
          substitutionOptions={substitutionOptions}
          run={run}
        />
      ) : null}

      {editing && canRestore ? (
        <div className="border-border rounded-lg border border-dashed p-4">
          <p className="text-muted-foreground mb-2 text-sm">
            Restaurar el plan inicial descarta tus ediciones y vuelve al
            programa generado en el onboarding. El historial de sesiones se
            conserva.
          </p>
          {confirmRestore ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="min-h-11"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const res = await restoreInitialProgramAction();
                    if (res.ok) setConfirmRestore(false);
                    return res;
                  })
                }
              >
                Sí, restaurar
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-11"
                disabled={pending}
                onClick={() => setConfirmRestore(false)}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11"
              disabled={pending}
              onClick={() => setConfirmRestore(true)}
            >
              Restaurar plan inicial
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DayHeader({
  template,
  isFirst,
  isLast,
  canRemove,
  pending,
  run,
}: {
  template: EditorTemplate;
  isFirst: boolean;
  isLast: boolean;
  canRemove: boolean;
  pending: boolean;
  run: (a: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [name, setName] = useState(template.name);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dirty = name.trim() !== template.name && name.trim().length > 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground shrink-0 text-sm">
          Día {template.ordinal}
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim().length === 0) {
              setName(template.name); // no permitir vaciar el nombre
              return;
            }
            if (dirty) {
              run(() => renameDayAction(template.id, name.trim()));
              toast.success("Día renombrado");
            }
          }}
          aria-label={`Nombre del día ${template.ordinal}`}
          className="border-border bg-background min-h-11 min-w-0 flex-1 rounded-md border px-2 text-sm"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Subir día"
          className="min-h-11 min-w-11 px-1"
          disabled={pending || isFirst}
          onClick={() => run(() => reorderDayAction(template.id, "up"))}
        >
          ↑
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Bajar día"
          className="min-h-11 min-w-11 px-1"
          disabled={pending || isLast}
          onClick={() => run(() => reorderDayAction(template.id, "down"))}
        >
          ↓
        </Button>
      </div>
      {canRemove ? (
        confirmRemove ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="min-h-9"
              disabled={pending}
              onClick={() => run(() => removeDayAction(template.id))}
            >
              Confirmar quitar día
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-9"
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
            className="text-destructive min-h-9"
            disabled={pending}
            onClick={() => setConfirmRemove(true)}
          >
            Quitar día
          </Button>
        )
      ) : null}
    </div>
  );
}

function AddDay({
  nextNumber,
  pending,
  substitutionOptions,
  run,
}: {
  nextNumber: number;
  pending: boolean;
  substitutionOptions: SubstitutionExercise[];
  run: (a: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {open ? (
        <div className="border-border rounded-lg border p-2">
          <p className="text-muted-foreground mb-2 text-sm">
            Elige el primer ejercicio del nuevo día:
          </p>
          <VariantPicker
            substitutionOptions={substitutionOptions}
            disabled={pending}
            onPick={(variantId) => {
              setOpen(false);
              run(() => addDayAction(`Día ${nextNumber}`, variantId));
            }}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11 w-full"
          disabled={pending}
          onClick={() => setOpen(true)}
        >
          + Añadir día
        </Button>
      )}
    </div>
  );
}

function ReadRow({ ex }: { ex: EditorExercise }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{ex.exerciseName}</p>
        <p className="text-muted-foreground truncate text-xs">
          {ex.variantName}
        </p>
      </div>
      <p className="tnum text-muted-foreground shrink-0 text-sm">
        {ex.baseSets} × {ex.repRangeMin}–{ex.repRangeMax} · RIR {ex.targetRir}
      </p>
    </div>
  );
}

function EditableRow({
  ex,
  isFirst,
  isLast,
  pending,
  substitutionOptions,
  run,
}: {
  ex: EditorExercise;
  isFirst: boolean;
  isLast: boolean;
  pending: boolean;
  substitutionOptions: SubstitutionExercise[];
  run: (a: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [sets, setSets] = useState(ex.baseSets);
  const [repMin, setRepMin] = useState(ex.repRangeMin);
  const [repMax, setRepMax] = useState(ex.repRangeMax);
  const [rir, setRir] = useState(ex.targetRir);
  const [rest, setRest] = useState(ex.restSeconds);
  const [showSub, setShowSub] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const dirty =
    sets !== ex.baseSets ||
    repMin !== ex.repRangeMin ||
    repMax !== ex.repRangeMax ||
    rir !== ex.targetRir ||
    rest !== ex.restSeconds;

  const setsChanged = sets !== ex.baseSets;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{ex.exerciseName}</p>
          <p className="text-muted-foreground truncate text-xs">
            {ex.variantName}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Subir ejercicio"
            className="min-h-11 min-w-11 px-2"
            disabled={pending || isFirst}
            onClick={() =>
              run(() => reorderTemplateExerciseAction(ex.id, "up"))
            }
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label="Bajar ejercicio"
            className="min-h-11 min-w-11 px-2"
            disabled={pending || isLast}
            onClick={() =>
              run(() => reorderTemplateExerciseAction(ex.id, "down"))
            }
          >
            ↓
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumberField
          label="Series"
          value={sets}
          min={1}
          max={10}
          onChange={setSets}
        />
        <NumberField
          label="RIR"
          value={rir}
          min={0}
          max={5}
          onChange={setRir}
        />
        <NumberField
          label="Reps mín."
          value={repMin}
          min={1}
          max={50}
          onChange={setRepMin}
        />
        <NumberField
          label="Reps máx."
          value={repMax}
          min={1}
          max={50}
          onChange={setRepMax}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Descanso (s)"
          value={rest}
          min={30}
          max={600}
          step={15}
          onChange={setRest}
        />
      </div>

      {setsChanged ? (
        <p className="text-muted-foreground text-xs">
          Cambias el volumen de este ejercicio: {ex.baseSets} → {sets} series
          {sets > ex.baseSets
            ? " (más volumen y duración)"
            : " (menos volumen)"}
          .
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="min-h-11"
          aria-busy={pending}
          disabled={pending || !dirty}
          onClick={() =>
            run(() =>
              editTemplateExerciseAction(ex.id, {
                baseSets: sets,
                repRangeMin: repMin,
                repRangeMax: repMax,
                targetRir: rir,
                restSeconds: rest,
              }),
            )
          }
        >
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11"
          disabled={pending}
          onClick={() => setShowSub((v) => !v)}
        >
          Sustituir
        </Button>
        {confirmRemove ? (
          <>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="min-h-11"
              disabled={pending}
              onClick={() => run(() => removeTemplateExerciseAction(ex.id))}
            >
              Confirmar quitar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              disabled={pending}
              onClick={() => setConfirmRemove(false)}
            >
              Cancelar
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive min-h-11"
            disabled={pending}
            onClick={() => setConfirmRemove(true)}
          >
            Quitar
          </Button>
        )}
      </div>

      {showSub ? (
        <VariantPicker
          substitutionOptions={substitutionOptions}
          disabled={pending}
          onPick={(variantId) => {
            setShowSub(false);
            run(() => changeTemplateVariantAction(ex.id, variantId));
          }}
        />
      ) : null}
    </div>
  );
}

function AddExercise({
  templateId,
  pending,
  substitutionOptions,
  run,
}: {
  templateId: string;
  pending: boolean;
  substitutionOptions: SubstitutionExercise[];
  run: (a: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      {open ? (
        <VariantPicker
          substitutionOptions={substitutionOptions}
          disabled={pending}
          onPick={(variantId) => {
            setOpen(false);
            run(() => addTemplateExerciseAction(templateId, variantId));
          }}
        />
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11"
          disabled={pending}
          onClick={() => setOpen(true)}
        >
          + Añadir ejercicio
        </Button>
      )}
    </div>
  );
}

function VariantPicker({
  substitutionOptions,
  disabled,
  onPick,
}: {
  substitutionOptions: SubstitutionExercise[];
  disabled: boolean;
  onPick: (variantId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = substitutionOptions
    .flatMap((e) => e.variants)
    .filter((v) => (q ? v.name.toLowerCase().includes(q) : true))
    .slice(0, 30);

  return (
    <div className="border-border bg-muted/30 mt-2 space-y-2 rounded-lg border p-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar ejercicio…"
        className="border-border bg-background min-h-11 w-full rounded-md border px-3 text-sm"
        aria-label="Buscar ejercicio para sustituir o añadir"
      />
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {filtered.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(v.id)}
              className="hover:bg-accent flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm disabled:opacity-50"
            >
              <span className="min-w-0 truncate">{v.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {v.equipment}
              </span>
            </button>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="text-muted-foreground px-2 py-2 text-sm">
            Sin resultados.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function NumberField({
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
    <div className="block" role="group" aria-label={label}>
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
          className="tnum w-10 text-center text-sm tabular-nums"
          aria-live="polite"
          aria-atomic="true"
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
