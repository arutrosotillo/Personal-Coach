/**
 * Números decimales tecleados a mano.
 *
 * El teclado decimal del iPhone en es-ES imprime una COMA, no un punto, y no
 * ofrece punto ninguno. Sin esto, en mitad de una serie de gemelo, "62,5" era
 * NaN: el peso no entraba y había que redondear a 63 kg un dato que existía.
 * Así que la coma es un separador decimal de primera, igual que el punto.
 */

/**
 * Deja el campo en forma canónica mientras se escribe: solo dígitos y un único
 * separador, siempre punto. Se aplica en el `onChange` de un input controlado,
 * así que tiene que tolerar estados a medio teclear ("62." o "" son válidos).
 */
export function sanitizeDecimalInput(value: string): string {
  const cleaned = value.replace(/[^\d.,]/g, "").replace(/,/g, ".");
  const [whole, ...rest] = cleaned.split(".");
  return rest.length > 0 ? `${whole}.${rest.join("")}` : whole;
}

/**
 * Convierte lo tecleado en número. `null` si está vacío o no es un número
 * (nunca NaN: quien llama decide qué hacer con la ausencia de dato).
 */
export function parseDecimalInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
