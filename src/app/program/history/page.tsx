import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { ArchivedPrograms } from "@/components/training/archived-programs";
import { Button } from "@/components/ui/button";
import { getProfile } from "@/server/repositories/profile.repo";
import { listArchivedPrograms } from "@/server/repositories/program.repo";

export const dynamic = "force-dynamic";

const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
function dateLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default async function ProgramHistoryPage() {
  const profile = await getProfile();
  if (!profile) redirect("/onboarding");

  const archived = await listArchivedPrograms(profile.id);

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Programas anteriores</h1>
        <Button
          nativeButton={false}
          render={<Link href="/program" />}
          variant="ghost"
          size="sm"
          className="min-h-9"
        >
          Volver
        </Button>
      </div>
      <ArchivedPrograms
        programs={archived.map((p) => ({
          id: p.id,
          name: p.name,
          daysPerWeek: p.daysPerWeek,
          dateLabel: dateLabel(p.createdAt),
          isGenerated: p.isGenerated,
        }))}
      />
    </AppShell>
  );
}
