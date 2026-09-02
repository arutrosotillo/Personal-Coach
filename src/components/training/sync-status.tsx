"use client";

import { cn } from "@/lib/utils";
import type { SyncPhase } from "@/components/training/use-session-sync";

/**
 * El estado de guardado, en el hueco que ya había libre a la derecha de la
 * cabecera.
 *
 * Discreto a propósito. Perder la cobertura en un gimnasio no es una avería: es
 * el martes. Lo que el usuario necesita saber es que su serie está a salvo, no
 * que la red se ha caído otra vez — así que "sin conexión" se cuenta como lo
 * que es, un aplazamiento, y solo se pone en rojo cuando llevamos tanto rato
 * fallando que ya no parece el edificio.
 */
export function SyncStatus({
  phase,
  pending,
}: {
  phase: SyncPhase;
  pending: number;
}) {
  const cambios = `${pending} ${pending === 1 ? "cambio" : "cambios"}`;
  const { label, full, tone } = {
    saved: {
      label: "✓ Guardado",
      full: "Todo guardado en el servidor",
      tone: "muted" as const,
    },
    syncing: {
      label: "Guardando…",
      full: `Sincronizando ${cambios}`,
      tone: "muted" as const,
    },
    offline: {
      label: `Sin conexión · ${pending}`,
      full: `Sin conexión: ${cambios} guardados en este móvil. Se enviarán solos cuando vuelva la cobertura.`,
      tone: "muted" as const,
    },
    degraded: {
      label: `Sin enviar · ${pending}`,
      full: `${cambios} llevan rato sin poder enviarse. Siguen guardados en este móvil y se sigue reintentando.`,
      tone: "warn" as const,
    },
  }[phase];

  return (
    <span
      role="status"
      aria-label={full}
      title={full}
      className={cn(
        "tnum shrink-0 text-xs",
        tone === "warn" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}
