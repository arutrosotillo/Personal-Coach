import type { MetadataRoute } from "next";

/**
 * Manifiesto de la PWA, servido en /manifest.webmanifest.
 *
 * `display: standalone` es lo que hace que al abrir desde el icono no haya
 * barra de direcciones y parezca una app. Funciona en iOS: Apple anunció que
 * retiraría las apps web de la pantalla de inicio en la UE por la DMA y
 * revirtió la decisión el 1 de marzo de 2024.
 *
 * Ojo: iOS IGNORA este array de iconos para el icono de la pantalla de inicio.
 * Ese sale de la etiqueta `apple-touch-icon` del <head> (ver layout.tsx); sin
 * ella, iOS pone una captura de la página.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Personal Coach",
    // Lo que cabe bajo el icono en la pantalla de inicio.
    short_name: "Coach",
    description:
      "Entrenamiento de hipertrofia, nutrición y seguimiento corporal",
    // Se entra a entrenar, que es a lo que se abre la app en el gimnasio.
    start_url: "/train",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Iguales al tema de la app para que la pantalla de arranque no dé un
    // fogonazo blanco antes de cargar.
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    lang: "es-ES",
    dir: "ltr",
    categories: ["health", "fitness"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        // Android recorta el icono a la forma del sistema; este tiene la marca
        // dentro del círculo de seguridad para que no se coma las barras.
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
