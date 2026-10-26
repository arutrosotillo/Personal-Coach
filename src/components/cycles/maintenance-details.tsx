import type { MaintenanceEstimate } from "@/core/nutrition/energy-balance";
import {
  CONFIDENCE_LABEL,
  formatKcal,
  MAINTENANCE_BASIS_LABEL,
} from "@/lib/cycle-labels";

/**
 * El mantenimiento estimado, con su margen y su procedencia a la vista y el
 * "de dónde sale" plegado. `<details>` y no estado de React: funciona sin
 * JavaScript y se lee igual con lector de pantalla.
 */
export function MaintenanceDetails({
  maintenance,
  label = "Mantenimiento estimado",
}: {
  maintenance: MaintenanceEstimate;
  label?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="tnum text-lg font-semibold">
        ~{formatKcal(maintenance.tdeeKcal)}{" "}
        <span className="text-muted-foreground text-sm font-normal">
          kcal/día
        </span>
      </p>
      <p className="text-muted-foreground tnum text-xs">
        Probablemente entre {formatKcal(maintenance.lowKcal)} y{" "}
        {formatKcal(maintenance.highKcal)} ·{" "}
        {MAINTENANCE_BASIS_LABEL[maintenance.basis]} ·{" "}
        {CONFIDENCE_LABEL[maintenance.confidence].toLowerCase()}
      </p>
      <details className="group text-xs">
        <summary className="text-muted-foreground min-h-9 cursor-pointer py-2 underline underline-offset-4">
          ¿De dónde sale?
        </summary>
        <div className="text-muted-foreground space-y-2 leading-relaxed">
          <p>{maintenance.explanation}</p>
          {maintenance.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      </details>
    </div>
  );
}
