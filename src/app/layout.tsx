import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Personal Coach",
  description: "Entrenamiento de hipertrofia, nutrición y seguimiento corporal",
  // App privada de una sola persona: no tiene nada que hacer en un buscador.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    // iOS ignora los iconos del manifest y usa SOLO esta etiqueta para la
    // pantalla de inicio. Sin ella, el icono es una captura de la página.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Coach",
    // "black" y no "black-translucent": este último mete el contenido debajo
    // de la isla dinámica, y la app solo compensa el margen inferior.
    statusBarStyle: "black",
  },
  other: {
    // Next 16 emite el estándar `mobile-web-app-capable`, pero no el antiguo
    // de Apple. De esta etiqueta depende que al abrir desde el icono no haya
    // barra de direcciones en versiones de iOS que aún no honran el
    // `display: standalone` del manifiesto. Duplicarla no cuesta nada y
    // quita el riesgo de que el objetivo entero se caiga por un metadato.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover activa las env(safe-area-inset-*) usadas por la bottom nav.
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
