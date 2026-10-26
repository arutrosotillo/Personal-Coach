import Link from "next/link";
import { redirect } from "next/navigation";

import { GymChangeForm } from "@/components/training/gym-change-form";
import { Button } from "@/components/ui/button";
import { EQUIPMENT_CHANGE } from "@/core/config/training-config";
import { DEFAULT_TIMEZONE, toLocalDate } from "@/core/dates";
import { getCurrentProfile } from "@/server/auth/current-user";
import { getGymChangeFormData } from "@/server/repositories/equipment-change.repo";

export const dynamic = "force-dynamic";

export default async function GymChangePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/onboarding");
  const { days } = await getGymChangeFormData(profile.id);

  // Flujo a pantalla completa, como el builder: la barra de "Registrar" ocupa
  // la zona de la navegación inferior.
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
          Cancelar
        </Button>
      </div>
      <GymChangeForm
        days={days}
        todayLocalDate={toLocalDate(
          new Date(),
          profile.timezone ?? DEFAULT_TIMEZONE,
        )}
        initial={null}
        preselectEquipment={EQUIPMENT_CHANGE.MACHINE_DEPENDENT_EQUIPMENT}
      />
    </div>
  );
}
