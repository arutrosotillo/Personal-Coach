"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { reactivateProgramAction } from "@/server/actions/program.action";

export interface ArchivedProgramView {
  id: string;
  name: string;
  daysPerWeek: number;
  dateLabel: string;
  isGenerated: boolean;
}

/** Listado simple de programas anteriores con reactivación (Fase 3.1b). */
export function ArchivedPrograms({
  programs,
}: {
  programs: ArchivedProgramView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function reactivate(id: string) {
    startTransition(async () => {
      const res = await reactivateProgramAction(id);
      if (res.ok) {
        toast.success("Programa reactivado");
        router.push("/program");
        router.refresh();
      } else {
        toast.error(res.error ?? "No se pudo reactivar");
        setConfirmId(null);
      }
    });
  }

  if (programs.length === 0) {
    return (
      <p className="text-muted-foreground pt-8 text-center text-sm">
        No tienes programas anteriores. Cuando cambies de programa, el anterior
        se archivará aquí.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {programs.map((p) => (
        <li key={p.id}>
          <Card>
            <CardContent className="p-3">
              <p className="font-medium">{p.name}</p>
              <p className="text-muted-foreground text-sm">
                <span className="tnum">{p.daysPerWeek}</span> días · Archivado ·{" "}
                {p.isGenerated ? "Generado" : "Manual"} · {p.dateLabel}
              </p>

              {confirmId === p.id ? (
                <div className="mt-3 space-y-2">
                  <p className="text-muted-foreground text-sm">
                    Tu programa actual se archivará. Tus entrenamientos e
                    historial se conservarán.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-11"
                      disabled={pending}
                      aria-busy={pending}
                      onClick={() => reactivate(p.id)}
                    >
                      {pending ? "Reactivando…" : "Confirmar reactivar"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-h-11"
                      disabled={pending}
                      onClick={() => setConfirmId(null)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-3 min-h-11"
                  onClick={() => setConfirmId(p.id)}
                >
                  Reactivar
                </Button>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
