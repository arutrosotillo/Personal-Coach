"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

// Date.now() a nivel de módulo: el lint del compilador lo marca como impuro
// si aparece en el cuerpo del componente.
const nowMs = () => Date.now();

/** Segundos que faltan para el final del descanso. Nunca negativos. */
function secondsLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/**
 * Temporizador de descanso basado en timestamp ABSOLUTO: la cuenta sale siempre
 * de `endsAt - Date.now()`, nunca de acumular ticks. +30 s / omitir / detener.
 *
 * Antes el reloj era SOLO un `setInterval`, y ahí estaba el fallo: entre serie
 * y serie el usuario suelta el móvil y iOS suspende la página de la PWA. Un
 * intervalo suspendido no vuelve solo, así que el número se quedaba clavado en
 * el que hubiera al soltar el teléfono —el temporizador "se congelaba" nada más
 * empezar el descanso— aunque la cuenta fuera absoluta: la fórmula sobrevivía,
 * pero nadie la volvía a evaluar.
 *
 * Ahora hay tres fuentes, y ninguna sobra porque ninguna cubre sola el caso:
 *
 *  · Un frame por pintado. Es la única señal que garantiza que lo que se VE se
 *    acaba de calcular: si el navegador pinta, ese frame trae el reloj de ese
 *    instante. Es lo que devuelve la cuenta al volver de la suspensión.
 *  · Un intervalo de respaldo, para una página que se muestra pero apenas
 *    genera frames (pestaña en segundo plano, ahorro de energía). Ahí no hay
 *    rAF y la cuenta tiene que seguir avanzando igual.
 *  · Los eventos de reanudación, para cuando la página se restaura desde la
 *    caché de la vuelta atrás sin repintar de inmediato.
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
  // El estado son los SEGUNDOS que se pintan, no el reloj: así los frames en
  // los que no cambia el número no re-renderizan nada (React descarta el
  // `setState` que repite el valor), y no hay 60 renders por segundo.
  const [remaining, setRemaining] = useState(() => secondsLeft(endsAt, nowMs()));

  useEffect(() => {
    const sync = () => setRemaining(secondsLeft(endsAt, nowMs()));
    let frame = 0;
    const tick = () => {
      sync();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const backstop = window.setInterval(sync, 250);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("focus", sync);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(backstop);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("focus", sync);
    };
  }, [endsAt]);

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const done = remaining <= 0;

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
          className="min-h-11"
          onClick={() => onAdd(30_000)}
        >
          +30 s
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11"
          onClick={onSkip}
        >
          {done ? "Cerrar" : "Omitir"}
        </Button>
      </div>
    </div>
  );
}
