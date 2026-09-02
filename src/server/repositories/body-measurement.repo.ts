import type { BodyFatReliability, WaistProtocol } from "@/core/enums";
import { prisma } from "@/server/db";

/**
 * Lecturas y escrituras de `BodyMeasurement`, la fuente única del seguimiento
 * corporal (ver el comentario del modelo en `schema.prisma`).
 *
 * REGLA DE ESTE ARCHIVO: `profileId` es SIEMPRE el primer parámetro y entra en
 * TODAS las cláusulas `where`. El repositorio no decide de quién son los datos
 * ni lee cookies —eso es `server/auth/current-user`—, pero tampoco existe aquí
 * ninguna consulta que pueda ejecutarse sin dueño. Un `findMany` sin
 * `profileId` sería el mismo fallo que la fase multi-usuario vino a arreglar.
 *
 * `DailyCheckIn.weightKg` no se toca desde aquí ni desde ningún sitio: está
 * obsoleta.
 */

/**
 * Ventana máxima que se carga para el análisis y el gráfico, en días.
 *
 * Poco más de un año. El motor ya se acota por su cuenta (56 días la ventana de
 * tendencia más larga, 112 la cintura, 168 el % graso), así que esto no cambia
 * ningún veredicto: solo evita traerse un historial ilimitado a memoria para
 * pintar una curva. Vive aquí y no en `core/config` porque es un límite de
 * consulta, no un umbral de motor.
 */
export const HISTORY_WINDOW_DAYS = 400;

/**
 * Forma en la que una medición sale de la base de datos.
 *
 * Es un tipo propio y NO el modelo de Prisma: la UI y los services no deben
 * acoplarse al schema. Cambiar el nombre de una columna, añadir los ocho
 * perímetros que la tabla ya tiene o meter `createdAt` no puede obligar a tocar
 * una pantalla.
 */
export interface BodyMeasurementRecord {
  id: string;
  localDate: string;
  weightKg: number | null;
  waistCm: number | null;
  /** Con cuántas tomas se midió la cintura. `null` = desconocido → una toma. */
  waistProtocol: WaistProtocol | null;
  bodyFatPct: number | null;
  bodyFatReliability: BodyFatReliability | null;
}

/** Campos que se traen. Explícitos, para que el DTO no crezca sin querer. */
const SELECT = {
  id: true,
  localDate: true,
  weightKg: true,
  waistCm: true,
  waistProtocol: true,
  bodyFatPct: true,
  bodyFatReliability: true,
} as const;

interface Row {
  id: string;
  localDate: string;
  weightKg: number | null;
  waistCm: number | null;
  waistProtocol: string | null;
  bodyFatPct: number | null;
  bodyFatReliability: string | null;
}

/**
 * `bodyFatReliability` es `String` en la base (convención del proyecto: nada de
 * enums nativos). Se estrecha al leer, y un valor que no reconozcamos se trata
 * como ausente en vez de propagarse como texto arbitrario.
 */
function toRecord(row: Row): BodyMeasurementRecord {
  const reliability =
    row.bodyFatReliability === "MEASURED" ||
    row.bodyFatReliability === "ESTIMATED"
      ? row.bodyFatReliability
      : null;
  return {
    id: row.id,
    localDate: row.localDate,
    weightKg: row.weightKg,
    waistCm: row.waistCm,
    // Cualquier valor que no reconozcamos vale `null`, que el motor trata
    // como una sola toma: el umbral conservador es el seguro por defecto.
    waistProtocol:
      row.waistProtocol === "SINGLE" || row.waistProtocol === "MEAN_OF_THREE"
        ? row.waistProtocol
        : null,
    bodyFatPct: row.bodyFatPct,
    bodyFatReliability: reliability,
  };
}

/** Historial en orden cronológico, acotado a `HISTORY_WINDOW_DAYS`. */
export async function listMeasurements(
  profileId: string,
  fromLocalDate: string,
  toLocalDate: string,
): Promise<BodyMeasurementRecord[]> {
  const rows = await prisma.bodyMeasurement.findMany({
    where: {
      profileId,
      localDate: { gte: fromLocalDate, lte: toLocalDate },
    },
    orderBy: { localDate: "asc" },
    select: SELECT,
  });
  return rows.map(toRecord);
}

/** La medición de un día concreto, o `null`. */
export async function findMeasurementByDate(
  profileId: string,
  localDate: string,
): Promise<BodyMeasurementRecord | null> {
  const row = await prisma.bodyMeasurement.findUnique({
    where: { profileId_localDate: { profileId, localDate } },
    select: SELECT,
  });
  return row ? toRecord(row) : null;
}

export interface MeasurementFields {
  weightKg: number | null;
  waistCm: number | null;
  waistProtocol: WaistProtocol | null;
  bodyFatPct: number | null;
  bodyFatReliability: BodyFatReliability | null;
}

/**
 * Guarda la medición de un día. Upsert contra la clave natural
 * `(profileId, localDate)`: registrar dos veces el mismo día ACTUALIZA, nunca
 * duplica, y la última medición del día gana.
 *
 * Aquí está la propiedad de seguridad más importante del módulo: el cliente
 * identifica la fila por FECHA, no por id, y el `profileId` lo pone el
 * servidor. No hay ningún identificador que se pueda apuntar a la fila de otra
 * persona, así que la escritura NO TIENE superficie IDOR: no hay nada que
 * comprobar porque no hay nada que suplantar.
 *
 * Los campos van completos en `create` y en `update`: guardar es declarar el
 * estado del día entero, así que borrar la cintura de un día es mandarla a
 * `null`, no omitirla.
 */
export async function upsertMeasurement(
  profileId: string,
  localDate: string,
  fields: MeasurementFields,
): Promise<BodyMeasurementRecord> {
  const row = await prisma.bodyMeasurement.upsert({
    where: { profileId_localDate: { profileId, localDate } },
    create: { profileId, localDate, ...fields },
    update: fields,
    select: SELECT,
  });
  return toRecord(row);
}

/**
 * Escribe SOLO los campos indicados, dejando el resto de la fila como estaba.
 *
 * Es la escritura del check-in. La regla que gobierna los tres formularios de
 * la app: **cada uno escribe exactamente lo que enseña**. El del historial
 * enseña los tres campos y declara el día entero (`upsertMeasurement`); la
 * tarjeta rápida enseña el peso y solo escribe el peso (`upsertWeight`); el
 * check-in enseña cintura y, opcionalmente, peso y % graso, y escribe eso.
 *
 * Un formulario que borra datos que ni siquiera muestra es un defecto, no una
 * decisión de diseño.
 */
export async function upsertMeasurementFields(
  profileId: string,
  localDate: string,
  fields: Partial<MeasurementFields>,
): Promise<BodyMeasurementRecord> {
  const row = await prisma.bodyMeasurement.upsert({
    where: { profileId_localDate: { profileId, localDate } },
    create: { profileId, localDate, ...fields },
    update: fields,
    select: SELECT,
  });
  return toRecord(row);
}

/**
 * Escribe SOLO el peso del día, dejando el resto de la fila como estaba.
 *
 * Es la operación de la tarjeta rápida. Si usara `upsertMeasurement`, un
 * formulario de un campo mandaría `waistCm: null` y borraría la cintura que se
 * anotó esa misma mañana. Aquí el `update` nombra una sola columna, así que no
 * hay forma de que eso ocurra ni aunque quien llame se despiste.
 */
export async function upsertWeight(
  profileId: string,
  localDate: string,
  weightKg: number,
): Promise<BodyMeasurementRecord> {
  const row = await prisma.bodyMeasurement.upsert({
    where: { profileId_localDate: { profileId, localDate } },
    create: { profileId, localDate, weightKg },
    update: { weightKg },
    select: SELECT,
  });
  return toRecord(row);
}

/**
 * Borra una medición por id, SOLO si es de este perfil.
 *
 * `deleteMany` con `profileId` en el `where`, y no `delete` por id: así la
 * comprobación de propiedad y el borrado son la MISMA operación atómica. Con un
 * `findUnique` previo seguido de un `delete` habría una ventana entre las dos
 * consultas, y sobre todo dos sitios donde equivocarse en vez de uno.
 *
 * Devuelve cuántas filas se borraron: 0 significa "no existe o no es tuya", y
 * el service no distingue entre las dos cosas a propósito — decir "existe pero
 * no es tuya" confirmaría la existencia de un dato ajeno.
 */
export async function deleteMeasurementOwnedBy(
  profileId: string,
  id: string,
): Promise<number> {
  const { count } = await prisma.bodyMeasurement.deleteMany({
    where: { id, profileId },
  });
  return count;
}
