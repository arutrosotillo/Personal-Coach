import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { ExerciseLibrary } from "@/components/training/exercise-library";
import { getCurrentProfile } from "@/server/auth/current-user";
import { listLibrary } from "@/server/repositories/exercise-library.repo";

export const dynamic = "force-dynamic";

export default async function ExerciseLibraryPage() {
  // La biblioteca ya no es global: incluye los ejercicios propios del perfil,
  // así que sin perfil no hay nada que enseñar.
  const profile = await getCurrentProfile();
  if (!profile) redirect("/onboarding");

  const exercises = await listLibrary(profile.id);
  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Biblioteca de ejercicios</h1>
      <ExerciseLibrary exercises={exercises} />
    </AppShell>
  );
}
