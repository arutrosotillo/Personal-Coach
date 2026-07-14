import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { PhaseNote } from "@/components/layout/phase-note";
import { Button } from "@/components/ui/button";

export default function TrainPage() {
  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Entrenar</h1>
      <PhaseNote phase="Fase 2">
        Aquí vivirá la ejecución de entrenamientos: registro de series en un
        tap, valores pre-rellenados, temporizador de descanso y recomendaciones
        de carga explicadas. Mientras tanto, puedes consultar tu programa.
      </PhaseNote>
      <div className="mt-4 space-y-2">
        <Button
          nativeButton={false}
          render={<Link href="/program" />}
          variant="secondary"
          className="min-h-11 w-full"
        >
          Ver mi programa
        </Button>
        <Button
          nativeButton={false}
          render={<Link href="/train/exercises" />}
          variant="secondary"
          className="min-h-11 w-full"
        >
          Biblioteca de ejercicios
        </Button>
      </div>
    </AppShell>
  );
}
