import { Badge } from "@/components/ui/badge";

/**
 * Aviso consistente de funcionalidad prevista para una fase futura.
 * Único patrón visual para todos los "Próximamente / Fase N" de la app.
 */
export function PhaseNote({
  phase,
  children,
}: {
  phase: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border rounded-xl border border-dashed p-4">
      <Badge variant="outline">{phase}</Badge>
      <p className="text-muted-foreground mt-3 text-sm">{children}</p>
    </div>
  );
}
