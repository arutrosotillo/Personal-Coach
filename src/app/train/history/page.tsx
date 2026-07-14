import { AppShell } from "@/components/layout/app-shell";
import { getProfile } from "@/server/repositories/profile.repo";
import { listCompletedSessions } from "@/server/repositories/workout.repo";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const profile = await getProfile();
  const sessions = profile ? await listCompletedSessions(profile.id) : [];

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Historial</h1>
      {sessions.length === 0 ? (
        <p className="text-muted-foreground">
          Aún no has completado ninguna sesión. Cuando termines un entrenamiento
          aparecerá aquí.
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="border-border bg-card flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
            >
              <div>
                <p className="font-medium">{s.templateName}</p>
                <p className="tnum text-muted-foreground text-xs">
                  {s.localDate} · semana {s.weekNumber}
                </p>
              </div>
              <p className="tnum text-muted-foreground shrink-0 text-sm">
                {s.totalSets} series
                {s.durationMin != null ? ` · ${s.durationMin} min` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
