import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function TrainPage() {
  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Entrenar</h1>
      <div className="border-border rounded-lg border border-dashed p-6 text-center">
        <Badge variant="outline">Fase 2</Badge>
        <p className="text-muted-foreground mt-3 text-sm">
          Aquí vivirá la ejecución de entrenamientos: registro de series en un
          tap, valores pre-rellenados, temporizador de descanso y
          recomendaciones de carga explicadas.
        </p>
        <p className="text-muted-foreground mt-2 text-sm">
          Mientras tanto, puedes consultar tu programa.
        </p>
        <Button
          nativeButton={false}
          render={<Link href="/program" />}
          variant="secondary"
          className="mt-4 min-h-11"
        >
          Ver mi programa
        </Button>
      </div>
    </AppShell>
  );
}
