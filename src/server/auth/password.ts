import type { ScryptOptions } from "node:crypto";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * `promisify` pierde la sobrecarga de `scrypt` que acepta opciones, así que se
 * envuelve a mano en lugar de silenciar el tipo con un `any`.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/**
 * Hashing de contraseñas con scrypt, que viene en Node y no necesita módulos
 * nativos ni dependencias nuevas.
 *
 * Parámetros: N=2^17, r=8, p=1 — el mínimo que recomienda OWASP para scrypt.
 * Cuesta ~250 ms y ~128 MB por verificación, que para un login cada 90 días es
 * irrelevante y encarece muchísimo un ataque por fuerza bruta.
 *
 * Formato almacenado: `scrypt$N$r$p$salt_b64$hash_b64`. Lleva los parámetros
 * dentro para poder subirlos en el futuro sin invalidar los hashes antiguos.
 */
const N = 131072;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
// scrypt necesita ~128*N*r bytes; el tope por defecto de Node (32 MB) se queda
// corto con estos parámetros y lanzaría en vez de calcular.
const MAX_MEM = 256 * 1024 * 1024;

/**
 * Marca de cuenta sin contraseña utilizable. La migración a multi-usuario la
 * pone en las cuentas que crea para perfiles ya existentes: no es un hash
 * válido en este formato, así que `verifyPassword` lo rechaza siempre.
 */
export const LOCKED_PASSWORD_HASH = "!";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verifica en tiempo constante. Cualquier hash con formato inesperado —la
 * marca de cuenta bloqueada, una cadena vacía, basura— se trata como fallo, no
 * como error: falla cerrado.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const partes = stored.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = partes;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let salt: Buffer;
  let esperado: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64");
    esperado = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || esperado.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scryptAsync(password, salt, esperado.length, {
      N: n,
      r,
      p,
      maxmem: MAX_MEM,
    });
  } catch {
    // Parámetros absurdos guardados en la fila: no es un fallo del servidor,
    // es una credencial inservible.
    return false;
  }
  return timingSafeEqual(derived, esperado);
}

/**
 * Los nombres de usuario se comparan en minúsculas y sin espacios alrededor,
 * para que "Arturo" y "arturo" no sean dos cuentas distintas.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Reglas mínimas: sin espacios, sin sorpresas al teclearlo en el móvil. */
export function validateUsername(raw: string): string | null {
  const nombre = normalizeUsername(raw);
  if (nombre.length < 2) return "El usuario necesita al menos 2 caracteres.";
  if (nombre.length > 32) return "El usuario no puede pasar de 32 caracteres.";
  if (!/^[a-z0-9._-]+$/.test(nombre)) {
    return "El usuario solo puede llevar letras, números, punto, guion y guion bajo.";
  }
  return null;
}

/**
 * Mínimo deliberadamente modesto: estas cuentas las creas tú a mano para
 * familiares, no se exponen a registro público, y una regla demasiado estricta
 * solo consigue que se apunten la contraseña en un papel.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 10) {
    return "La contraseña necesita al menos 10 caracteres.";
  }
  if (password.length > 200) {
    return "La contraseña no puede pasar de 200 caracteres.";
  }
  return null;
}
