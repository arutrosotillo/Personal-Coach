"use client";

import { Button } from "@/components/ui/button";
import { clearOfflineData } from "@/lib/offline/clear-local";
import { logoutAction } from "@/server/actions/auth.action";

/**
 * Cerrar sesión. Antes de pedirle al servidor que tire la cookie, borra del
 * dispositivo lo que la sesión de entrenamiento había dejado ahí: el snapshot
 * de la sesión en curso y el HTML cacheado por el service worker.
 *
 * Se hace en el cliente porque es donde vive ese almacenamiento: una server
 * action no puede tocar el `localStorage` de nadie.
 */
export function LogoutButton() {
  return (
    <form
      action={logoutAction}
      onSubmit={() => {
        clearOfflineData();
      }}
    >
      <Button type="submit" variant="outline" className="min-h-11">
        Cerrar sesión
      </Button>
    </form>
  );
}
