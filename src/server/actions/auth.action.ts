"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  createSessionToken,
  isAuthConfigured,
  sessionCookieOptions,
  verifyPassword,
} from "@/server/auth/session";

export interface LoginState {
  error?: string;
}

/**
 * Limitador de intentos por proceso. Deliberadamente simple: la app tiene un
 * solo usuario y no merece una tabla ni un Redis. En serverless cada instancia
 * lleva su propio contador, así que no es una defensa dura contra un atacante
 * distribuido — para eso está tener una contraseña larga. Sí frena el ataque
 * realista: alguien probando contraseñas a mano contra la URL.
 */
const attempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_ATTEMPTS = 8;
const BLOCK_MS = 15 * 60 * 1000;

function rateLimit(key: string): number {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry) return 0;
  if (entry.blockedUntil > now) {
    return Math.ceil((entry.blockedUntil - now) / 60000);
  }
  if (entry.blockedUntil !== 0) attempts.delete(key);
  return 0;
}

function registerFailure(key: string): void {
  const entry = attempts.get(key) ?? { count: 0, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = Date.now() + BLOCK_MS;
    entry.count = 0;
  }
  attempts.set(key, entry);
}

/**
 * Comprueba la contraseña y abre sesión. La contraseña llega por POST en el
 * cuerpo del formulario: nunca por query string, nunca a localStorage.
 */
export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (!isAuthConfigured()) {
    return {
      error:
        "Falta configurar APP_PASSWORD y AUTH_SECRET en el servidor. " +
        "Sin ellas nadie puede entrar.",
    };
  }

  const blockedMinutes = rateLimit("single-user");
  if (blockedMinutes > 0) {
    return {
      error: `Demasiados intentos. Vuelve a probar en ${blockedMinutes} min.`,
    };
  }

  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0) {
    return { error: "Escribe la contraseña." };
  }

  if (!verifyPassword(password)) {
    registerFailure("single-user");
    // Mensaje único: no revela si la contraseña existe, es corta o casi acierta.
    return { error: "Contraseña incorrecta." };
  }

  attempts.delete("single-user");
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());

  const rawNext = formData.get("next");
  // Solo rutas internas: un `next` absoluto sería un open redirect.
  const next =
    typeof rawNext === "string" &&
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//")
      ? rawNext
      : "/";
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
