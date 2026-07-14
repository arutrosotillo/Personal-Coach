"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { startSessionAction } from "@/server/actions/workout.action";

/** Inicia (o reanuda) una sesión desde una plantilla y navega a la ejecución. */
export function StartSessionButton({
  templateId,
  label,
  variant = "default",
}: {
  templateId: string;
  label: string;
  variant?: "default" | "secondary";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={variant}
      className="min-h-11 w-full"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await startSessionAction(templateId);
          if (res.ok && res.sessionId) {
            router.push(`/train/session/${res.sessionId}`);
          } else {
            toast.error(res.error ?? "No se pudo iniciar");
          }
        })
      }
    >
      {pending ? "Preparando…" : label}
    </Button>
  );
}
