import Link from "next/link";
import { redirect } from "next/navigation";

import { ProgramBuilder } from "@/components/training/program-builder";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/server/auth/current-user";
import { listBuilderCatalog } from "@/server/repositories/builder-catalog.repo";

export const dynamic = "force-dynamic";

export default async function NewProgramPage() {
  const profile = await getCurrentProfile();
  // El builder necesita un perfil (lo crea el onboarding). Sin él, al onboarding.
  if (!profile) redirect("/onboarding");

  const catalog = await listBuilderCatalog();

  // Flujo a pantalla completa (sin la barra de navegación inferior): la barra de
  // "Guardar programa" del builder ocupa esa zona.
  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Crear mi programa</h1>
        <Button
          nativeButton={false}
          render={<Link href="/program" />}
          variant="ghost"
          size="sm"
          className="min-h-9"
        >
          Cancelar
        </Button>
      </div>
      <p className="text-muted-foreground mb-2 text-sm">
        Al guardar, tu programa actual se archiva (no se borra) y tu historial
        se conserva.
      </p>
      <ProgramBuilder catalog={catalog} />
    </div>
  );
}
