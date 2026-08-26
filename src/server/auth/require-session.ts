import { cookies } from "next/headers";

import { SESSION_COOKIE, readSessionToken } from "@/server/auth/session";

/**
 * Segunda línea de defensa. `src/proxy.ts` ya bloquea todo lo que no lleve
 * cookie válida, pero un `matcher` mal editado podría dejar una ruta fuera sin
 * que nadie lo note. Las server actions que escriben datos vuelven a
 * comprobarlo aquí.
 *
 * Vive fuera de `auth.action.ts` a propósito: en un fichero `"use server"`
 * toda función exportada se convierte en un endpoint invocable, y esta no
 * tiene por qué serlo.
 */
export async function hasValidSession(): Promise<boolean> {
  const store = await cookies();
  return readSessionToken(store.get(SESSION_COOKIE)?.value).valid;
}

export async function requireSession(): Promise<void> {
  if (!(await hasValidSession())) {
    throw new Error("Sesión no válida. Vuelve a iniciar sesión.");
  }
}
