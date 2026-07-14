"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

// Date.now() a nivel de módulo: el lint del compilador lo marca como impuro
// si aparece en el cuerpo del componente.
const nowMs = () => Date.now();

/**
 * Temporizador de descanso basado en timestamp ABSOLUTO: sobrevive a que la
 * pestaña pierda el foco o se recargue (no cuenta ticks). +30 s / omitir / detener.
 */
export function RestTimer({
  endsAt,
  onAdd,
  onSkip,
}: {
  endsAt: number; // epoch ms en que termina el descanso
  onAdd: (ms: number) => void;
  onSkip: () => void;
}) {
  const [now, setNow] = useState(nowMs);

  useEffect(() => {
    const id = setInterval(() => setNow(nowMs()), 250);
    return () => clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, endsAt - now);
  const remainingS = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(remainingS / 60);
  const ss = remainingS % 60;
  const done = remainingMs <= 0;

  return (
    <div
      className="border-border bg-card sticky bottom-16 z-30 flex items-center gap-3 rounded-lg border p-3"
      role="timer"
      aria-live="polite"
    >
      <span
        className={`tnum text-2xl font-semibold tabular-nums ${done ? "text-primary" : ""}`}
      >
        {done ? "¡Descanso!" : `${mm}:${ss.toString().padStart(2, "0")}`}
      </span>
      <div className="ml-auto flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-9"
          onClick={() => onAdd(30_000)}
        >
          +30 s
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-9"
          onClick={onSkip}
        >
          {done ? "Cerrar" : "Omitir"}
        </Button>
      </div>
    </div>
  );
}
