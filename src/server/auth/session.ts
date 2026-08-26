import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sesión de un solo usuario. Personal Coach no tiene sistema de usuarios: es
 * una puerta con una llave. No hay registro, ni roles, ni recuperación, ni
 * tabla de sesiones.
 *
 * El token es autocontenido y firmado: `<caducidadMs>.<HMAC-SHA256>`. No se
 * guarda nada en la base de datos, así que cerrar sesión en un dispositivo no
 * cierra los demás. La forma de invalidar TODAS las sesiones es rotar
 * `AUTH_SECRET`, que es justo lo que querrías hacer si sospechas una fuga.
 *
 * Este módulo solo usa `node:crypto` y no toca la base de datos, para poder
 * importarse desde `src/proxy.ts` (que en Next 16 corre en runtime Node).
 */

export const SESSION_COOKIE = "pc_session";

/** 90 días. Se renueva sola mientras uses la app (ver `shouldRefresh`). */
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/** Por debajo de este resto de vida, el proxy vuelve a emitir la cookie. */
const REFRESH_THRESHOLD_SECONDS = 60 * 24 * 60 * 60;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "AUTH_SECRET no está definida o es demasiado corta (mínimo 32 caracteres). " +
        "Genera una con: openssl rand -base64 32",
    );
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * Comparación en tiempo constante. Se comparan digests y no los valores
 * originales para que la longitud del secreto no se filtre por el tamaño del
 * buffer ni haga fallar a `timingSafeEqual`.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** ¿Hay contraseña configurada? Sin ella la app no puede publicarse. */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD && process.env.AUTH_SECRET);
}

export function verifyPassword(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  return safeEqual(candidate, expected);
}

/** Emite un token válido durante `SESSION_MAX_AGE_SECONDS`. */
export function createSessionToken(now: Date = new Date()): string {
  const expiresAt = now.getTime() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

export interface SessionState {
  valid: boolean;
  /** Segundos que le quedan de vida (0 si no es válida). */
  remainingSeconds: number;
}

/**
 * Verifica firma y caducidad. Cualquier token manipulado, caducado o con
 * formato inesperado se trata igual: sesión inválida.
 */
export function readSessionToken(
  token: string | undefined,
  now: Date = new Date(),
): SessionState {
  const invalid: SessionState = { valid: false, remainingSeconds: 0 };
  if (!token) return invalid;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return invalid;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    // AUTH_SECRET ausente o inválida: nadie entra.
    return invalid;
  }
  if (!safeEqual(signature, expected)) return invalid;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return invalid;

  const remainingMs = expiresAt - now.getTime();
  if (remainingMs <= 0) return invalid;

  return { valid: true, remainingSeconds: Math.floor(remainingMs / 1000) };
}

/** Renueva la cookie cuando le queda menos de un tercio de vida. */
export function shouldRefresh(session: SessionState): boolean {
  return session.valid && session.remainingSeconds < REFRESH_THRESHOLD_SECONDS;
}

/** Opciones de cookie compartidas por el proxy y las server actions. */
export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    // En desarrollo se sirve por HTTP y una cookie `secure` no viajaría.
    secure: process.env.NODE_ENV === "production",
    // `lax` deja que la cookie viaje al abrir la app desde el icono de la
    // pantalla de inicio; `strict` rompería esa navegación.
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
