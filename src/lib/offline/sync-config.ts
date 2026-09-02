/**
 * Umbrales de la capa offline de la sesión de entrenamiento.
 *
 * No viven en `src/core/config/` a propósito: allí van los umbrales de los
 * MOTORES (progresión, fatiga, nutrición), que son dominio y deciden números
 * que el usuario ve explicados. Esto es infraestructura de cliente —cada cuánto
 * se reintenta una escritura— y no entra en ninguna decisión del coach.
 */
export const SYNC = {
  /**
   * Versión del formato del snapshot local. Al subirla, los snapshots viejos se
   * ignoran en vez de intentar migrarlos: perder el borrador de una sesión al
   * desplegar es molesto; leerlo mal y pintar series equivocadas es peor.
   */
  SNAPSHOT_VERSION: 1,

  /** Prefijo de todas las claves en localStorage (se borran juntas al salir). */
  STORAGE_PREFIX: "pc:session:v1:",

  /**
   * Techo para un lote de sincronización. Con cobertura mala una petición puede
   * quedarse colgada minutos sin fallar nunca; sin este tope, la cola se queda
   * bloqueada detrás de ella. Cortar es seguro: si la petición llegó igualmente
   * al servidor, el reintento es idempotente.
   */
  BATCH_TIMEOUT_MS: 10_000,

  /** Backoff exponencial entre reintentos: 2s, 4s, 8s, 16s, 30s, 30s… */
  BACKOFF_BASE_MS: 2_000,
  BACKOFF_MAX_MS: 30_000,

  /**
   * Fallos de transporte seguidos antes de cambiar el mensaje de "sin conexión"
   * (normal en un gimnasio) a "algo va mal" (ya no lo es). Con el backoff, son
   * unos dos minutos insistiendo.
   */
  DEGRADED_AFTER_ATTEMPTS: 6,
} as const;
