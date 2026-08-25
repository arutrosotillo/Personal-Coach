import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

/**
 * 404 propio. El de Next no lleva `AppShell`, así que se quedaba sin barra de
 * navegación y sin un solo enlace: un callejón sin salida. En el navegador aún
 * queda el botón atrás; instalada como PWA en la pantalla de inicio, no — hay
 * que matar la app. Y llegar aquí es fácil: descartas una sesión y su URL
 * sigue en el historial del móvil.
 */
export default function NotFound() {
  return (
    <AppShell>
      <div className="pt-16 text-center">
        <p className="mb-1 text-lg font-medium">Esto ya no está aquí</p>
        <p className="text-muted-foreground mb-6 text-sm">
          La página o la sesión que buscas no existe. Puede que la descartaras.
        </p>
        <Button
          nativeButton={false}
          render={<Link href="/train" />}
          className="mx-auto min-h-11 w-full max-w-xs"
        >
          Ir a Entrenar
        </Button>
      </div>
    </AppShell>
  );
}
