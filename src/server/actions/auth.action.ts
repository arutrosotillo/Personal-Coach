"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/server/db";
import {
  SESSION_COOKIE,
  createSessionToken,
  isAuthConfigured,
  sessionCookieOptions,
} from "@/server/auth/session";
import { normalizeUsername, verifyPassword } from "@/server/auth/password";

export interface LoginState {
  error?: string;
}

/**
 * Limitador de intentos por usuario y por proceso. Deliberadamente simple:
 * las cuentas se crean a mano y son un puñado. En serverless cada instancia
 * lleva su propio contador, así que no es una defensa dura contra un atacante
 * distribuido —para eso están las contraseñas largas—. Sí frena el ataque
 * realista: alguien probando contraseñas a mano contra la URL.
 */
const attempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_ATTEMPTS = 8;
const BLOCK_MS = 15 * 60 * 1000;

function blockedMinutes(key: string): number {
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
 * Comprueba usuario y contraseña y abre sesión. Las credenciales llegan por
 * POST en el cuerpo del formulario: nunca por query string, nunca a
 * localStorage.
 */
export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (!isAuthConfigured()) {
    return {
      error:
        "Falta configurar AUTH_SECRET en el servidor. Sin ella nadie puede entrar.",
    };
  }

  const rawUsername = formData.get("username");
  const password = formData.get("password");
  if (typeof rawUsername !== "string" || typeof password !== "string") {
    return { error: "Rellena usuario y contraseña." };
  }
  const username = normalizeUsername(rawUsername);
  if (!username || !password) {
    return { error: "Rellena usuario y contraseña." };
  }

  const espera = blockedMinutes(username);
  if (espera > 0) {
    return { error: `Demasiados intentos. Vuelve a probar en ${espera} min.` };
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, passwordHash: true, isActive: true },
  });

  // Mensaje único para "no existe", "desactivado" y "contraseña incorrecta":
  // distinguirlos revelaría qué cuentas existen.
  const generico = "Usuario o contraseña incorrectos.";

  if (!user) {
    // Se verifica igualmente contra un hash imposible para que el tiempo de
    // respuesta no delate si el usuario existe.
    await verifyPassword(password, "!");
    registerFailure(username);
    return { error: generico };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok || !user.isActive) {
    registerFailure(username);
    return { error: generico };
  }

  attempts.delete(username);
  const store = await cookies();
  store.set(
    SESSION_COOKIE,
    createSessionToken(user.id),
    sessionCookieOptions(),
  );

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
