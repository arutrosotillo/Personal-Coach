import { AppShell } from "@/components/layout/app-shell";
import { ExerciseLibrary } from "@/components/training/exercise-library";
import { listLibrary } from "@/server/repositories/exercise-library.repo";

export const dynamic = "force-dynamic";

export default async function ExerciseLibraryPage() {
  const exercises = await listLibrary();
  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Biblioteca de ejercicios</h1>
      <ExerciseLibrary exercises={exercises} />
    </AppShell>
  );
}
