"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { startSessionAction } from "@/server/actions/workout.action";

/**
 * El mensaje cuando no hay forma de hablar con el servidor.
 *
 * Empezar una sesión es la ÚNICA parte del entrenamiento que necesita conexión,
 * y es una decisión de producto, no una carencia: crear la sesión en el
 * servidor es lo que da los ids con los que se registra todo después. Hacerlo
 * offline exigiría ids locales y el motor de progresión en el cliente, o sea
 * dos fuentes de verdad que pueden divergir — no compensa.
 *
 * Lo que sí hay que hacer es DECIRLO. Antes, sin cobertura, la promesa de la
 * server action se rechazaba dentro de `startTransition` y nadie la recogía: el
 * botón volvía de "Preparando…" a su texto y no pasaba absolutamente nada.
 */
const SIN_CONEXION =
  "Necesitas conexión solo para empezar el entrenamiento. Una vez dentro, " +
  "puedes registrar series, corregirlas, anotar y finalizar sin cobertura.";

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
          try {
            const res = await startSessionAction(templateId);
            if (res.ok && res.sessionId) {
              router.push(`/train/session/${res.sessionId}`);
              return;
            }
            toast.error(res.error ?? "No se pudo iniciar");
          } catch {
            // La server action ni siquiera llegó. No se distingue por
            // `navigator.onLine` —dentro de un gimnasio vale `true` mientras
            // nada llega a ninguna parte—: la señal es que no hubo respuesta.
            toast.error(SIN_CONEXION, { duration: 8000 });
          }
        })
      }
    >
      {pending ? "Preparando…" : label}
    </Button>
  );
}
