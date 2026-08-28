import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sesión de un usuario concreto. La app es multi-usuario ligera y privada: las
 * cuentas se crean a mano, no hay registro, ni email, ni recuperación.
 *
 * El token es autocontenido y firmado: `base64url(userId:caducidad).HMAC`. No
 * se guarda nada en la base de datos, así que cerrar sesión en un dispositivo
 * no cierra los demás. Para invalidar TODAS las sesiones de golpe se rota
 * `AUTH_SECRET`.
 *
 * El token dice QUIÉN eres, no si sigues teniendo permiso: `isActive` se
 * comprueba contra la base de datos en `current-user.ts`, porque desactivar una
 * cuenta debe echarla fuera sin esperar 90 días a que caduque la cookie.
 *
 * Este módulo solo usa `node:crypto` y no toca la base de datos, para poder
 * importarse desde `src/proxy.ts`.
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
 * originales para que la longitud no se filtre por el tamaño del buffer ni
 * haga fallar a `timingSafeEqual`.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** ¿Se puede firmar? Sin secreto, la app se queda cerrada a propósito. */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET);
}

/** Emite un token para `userId`, válido `SESSION_MAX_AGE_SECONDS`. */
export function createSessionToken(
  userId: string,
  now: Date = new Date(),
): string {
  const expiresAt = now.getTime() + SESSION_MAX_AGE_SECONDS * 1000;
  // base64url del par completo: así el id puede contener cualquier carácter
  // sin que un separador ambiguo permita fabricar otro token válido.
  const payload = Buffer.from(`${userId}:${expiresAt}`, "utf8").toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

export interface SessionState {
  valid: boolean;
  /** Cuenta a la que pertenece la sesión, null si no es válida. */
  userId: string | null;
  /** Segundos que le quedan de vida (0 si no es válida). */
  remainingSeconds: number;
}

const INVALID: SessionState = {
  valid: false,
  userId: null,
  remainingSeconds: 0,
};

/**
 * Verifica firma y caducidad y extrae el usuario. Cualquier token manipulado,
 * caducado o con formato inesperado se trata igual: sesión inválida.
 */
export function readSessionToken(
  token: string | undefined,
  now: Date = new Date(),
): SessionState {
  if (!token) return INVALID;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return INVALID;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    // AUTH_SECRET ausente o inválida: nadie entra.
    return INVALID;
  }
  if (!safeEqual(signature, expected)) return INVALID;

  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return INVALID;
  }

  const cut = decoded.lastIndexOf(":");
  if (cut <= 0) return INVALID;

  const userId = decoded.slice(0, cut);
  const expiresAt = Number(decoded.slice(cut + 1));
  if (!userId || !Number.isFinite(expiresAt)) return INVALID;

  const remainingMs = expiresAt - now.getTime();
  if (remainingMs <= 0) return INVALID;

  return {
    valid: true,
    userId,
    remainingSeconds: Math.floor(remainingMs / 1000),
  };
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
