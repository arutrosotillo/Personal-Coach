"use client";

import { cn } from "@/lib/utils";

interface ChipOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
}

/** Grupo de chips táctiles (≥44 px) para selección única o múltiple. */
export function ChipGroup<T extends string | number>({
  options,
  value,
  onChange,
  multiple = false,
  columns = 2,
}: {
  options: ReadonlyArray<ChipOption<T>>;
  value: T | T[] | undefined;
  onChange: (next: T | T[]) => void;
  multiple?: boolean;
  columns?: 2 | 3;
}) {
  const selected = new Set(
    Array.isArray(value) ? value : value !== undefined ? [value] : [],
  );

  function toggle(option: T) {
    if (multiple) {
      const next = new Set(selected);
      if (next.has(option)) next.delete(option);
      else next.add(option);
      onChange([...next] as T[]);
    } else {
      onChange(option);
    }
  }

  return (
    <div
      className={cn(
        "grid gap-2",
        columns === 3 ? "grid-cols-3" : "grid-cols-2",
      )}
    >
      {options.map((option) => {
        const active = selected.has(option.value);
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(option.value)}
            className={cn(
              "min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              active
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="block font-medium">{option.label}</span>
            {option.description ? (
              <span className="text-muted-foreground mt-0.5 block text-xs">
                {option.description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
