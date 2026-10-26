import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { GymChangeForm } from "@/components/training/gym-change-form";
import { Button } from "@/components/ui/button";
import { EQUIPMENT_CHANGE } from "@/core/config/training-config";
import { DEFAULT_TIMEZONE, toLocalDate } from "@/core/dates";
import { getCurrentProfile } from "@/server/auth/current-user";
import { getGymChangeFormData } from "@/server/repositories/equipment-change.repo";

export const dynamic = "force-dynamic";

/** Corregir (o deshacer) un cambio de gimnasio ya registrado. */
export default async function EditGymChangePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/onboarding");
  const { days, change } = await getGymChangeFormData(profile.id, id);
  if (!change) notFound();

  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Cambio de gimnasio</h1>
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
      <GymChangeForm
        days={days}
        todayLocalDate={toLocalDate(
          new Date(),
          profile.timezone ?? DEFAULT_TIMEZONE,
        )}
        initial={{
          localDate: change.localDate,
          label: change.label,
          variantIds: change.exercises.map((e) => e.variantId),
        }}
        preselectEquipment={EQUIPMENT_CHANGE.MACHINE_DEPENDENT_EQUIPMENT}
        eventId={change.id}
      />
    </div>
  );
}
