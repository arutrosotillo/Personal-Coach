"use client";

import { useEffect } from "react";

/**
 * Registra el service worker que hace que la pantalla de entrenamiento se pueda
 * recargar (o reabrir) sin cobertura.
 *
 * Solo se monta en las dos rutas que ese service worker cachea, así que quien
 * no entra a entrenar nunca lo instala.
 *
 * OFFLINE-FIRST ES COMPORTAMIENTO PERMANENTE, no una función opcional: todo
 * build de producción lo lleva. No hay variable de entorno que lo active ni,
 * por tanto, ninguna que se pueda olvidar en un despliegue y dejar sin red de
 * seguridad a quien entrena en un sótano.
 */

/**
 * ¿Toca registrarlo en este entorno?
 *
 * Dos condiciones, y las dos son técnicas:
 *
 *  1. Que el navegador tenga service workers. Safari en privado y cualquier
 *     contexto no seguro no los exponen.
 *  2. Que sea un build de PRODUCCIÓN. Esto no es un resto del antiguo flag: en
 *     `next dev` los estáticos se sirven con `Cache-Control: no-cache,
 *     must-revalidate` —comprobado— y `cacheFirst` ignora ese header por
 *     completo, así que serviría un chunk viejo para siempre y se comería el
 *     hot reload. Además `networkFirst` guardaría el HTML de `/train` con las
 *     URLs de chunks de esa sesión de `next dev`, que dejan de existir al
 *     reiniciarlo. En producción es justo al revés: los estáticos van
 *     hasheados por contenido e inmutables, que es lo que hace correcto
 *     cachearlos así.
 *
 * `NODE_ENV` la fija la herramienta, no una persona: `next dev` vale
 * "development" y `next build` la incrusta como "production". No hay nada que
 * recordar configurar.
 */
export function shouldRegisterServiceWorker(
  nodeEnv: string | undefined,
  serviceWorkerAvailable: boolean,
): boolean {
  if (!serviceWorkerAvailable) return false;
  return nodeEnv === "production";
}

export function RegisterServiceWorker() {
  useEffect(() => {
    const disponible =
      typeof navigator !== "undefined" && "serviceWorker" in navigator;
    if (!shouldRegisterServiceWorker(process.env.NODE_ENV, disponible)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Que no se pueda instalar no puede impedir entrenar: sin él, todo
      // funciona igual salvo recargar sin conexión.
    });
  }, []);
  return null;
}
