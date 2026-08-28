import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar · Personal Coach",
  // Que un buscador no indexe la puerta de entrada.
  robots: { index: false, follow: false },
};

/**
 * Única pantalla pública. Las cuentas se crean a mano con `pnpm user:create`:
 * no hay registro público, ni email, ni recuperación de contraseña. Si alguien
 * pierde la suya, se le fija otra con `pnpm user:password <usuario>`.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Solo se propaga una ruta interna: evita convertir el login en un
  // redirector hacia dominios ajenos.
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Personal Coach</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground text-sm">
            Esta app es privada. Introduce tus credenciales para continuar.
          </p>
          <LoginForm next={safeNext} />
        </CardContent>
      </Card>
    </main>
  );
}
