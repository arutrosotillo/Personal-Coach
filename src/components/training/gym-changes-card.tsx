import Link from "next/link";

import { formatLocalDate } from "@/core/dates";
import type { GymChangeRecord } from "@/server/repositories/equipment-change.repo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Cambios de gimnasio registrados, en `/program`. Es el punto de entrada del
 * flujo y también la memoria de qué ejercicios empezaron una referencia nueva
 * y cuándo: sin esto, "¿por qué la prensa dice 'equipamiento nuevo'?" no
 * tendría respuesta en ninguna pantalla.
 */
function describeChange(c: GymChangeRecord): string {
  const n = c.exercises.length;
  if (n === 0) return "Todas tus cargas siguen siendo comparables.";
  const nombres = c.exercises
    .slice(0, 3)
    .map((e) => e.exerciseName)
    .join(", ");
  const resto = n > 3 ? ` y ${n - 3} más` : "";
  return `Equipamiento nuevo en ${n} ${n === 1 ? "ejercicio" : "ejercicios"}: ${nombres}${resto}.`;
}

export function GymChangesCard({ changes }: { changes: GymChangeRecord[] }) {
  return (
    <Card className="mb-4">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-medium">¿Cambias de gimnasio?</h2>
            <p className="text-muted-foreground text-xs">
              Marca qué ejercicios cambian de máquina: sus cargas empiezan una
              referencia nueva y el resto sigue igual.
            </p>
          </div>
          <Button
            nativeButton={false}
            render={<Link href="/program/gym-change" />}
            variant="secondary"
            size="sm"
            className="min-h-11 shrink-0"
          >
            Registrar
          </Button>
        </div>
        {changes.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {changes.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/program/gym-change/${c.id}`}
                  className="border-border hover:bg-muted/50 block rounded-lg border p-3"
                >
                  <p className="text-sm">
                    {c.label ?? "Cambio de gimnasio"}{" "}
                    <span className="text-muted-foreground">
                      · desde el {formatLocalDate(c.localDate)}
                    </span>
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {describeChange(c)}{" "}
                    <span className="underline underline-offset-2">
                      Corregir
                    </span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
