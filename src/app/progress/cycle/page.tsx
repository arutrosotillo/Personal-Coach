import Link from "next/link";

import { CycleFlow } from "@/components/cycles/cycle-flow";
import { CycleSummaryView } from "@/components/cycles/cycle-summary-view";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentProfile } from "@/server/auth/current-user";
import {
  getClosePreview,
  getCycleFormDefaults,
} from "@/server/services/cycle.service";

export const dynamic = "force-dynamic";

/**
 * Finalizar el ciclo actual y, si se quiere, empezar otro. También es la
 * entrada para empezar un ciclo cuando no hay ninguno activo.
 *
 * El resumen se calcula aquí, en el servidor, y se pasa ya pintado al flujo:
 * lo que la persona ve es exactamente lo que se congelará al confirmar.
 */
export default async function CyclePage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    return (
      <AppShell>
        <Card>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Todavía no tienes perfil. Completa el onboarding primero.
            </p>
            <Button
              nativeButton={false}
              render={<Link href="/onboarding" />}
              className="min-h-11 w-full"
            >
              Crear mi plan
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const [close, defaults] = await Promise.all([
    getClosePreview(profile.id),
    getCycleFormDefaults(profile.id),
  ]);

  return (
    <AppShell>
      <div className="mb-4">
        <Link
          href="/progress"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← Progreso
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {close ? "Finalizar ciclo" : "Empezar un ciclo"}
        </h1>
      </div>
      <CycleFlow
        todayLocalDate={defaults.todayLocalDate}
        close={close}
        summarySlot={
          close ? (
            <CycleSummaryView
              summary={close.summary}
              todayLocalDate={close.todayLocalDate}
            />
          ) : null
        }
        defaults={{
          activeGoalId: defaults.activeGoalId,
          activeStrategy: defaults.activeStrategy,
          weightKg:
            defaults.weightKg === null
              ? null
              : Math.round(defaults.weightKg * 10) / 10,
          lastWeighLocalDate: defaults.lastWeighLocalDate,
          waistCm: defaults.waistCm,
          dailySteps: defaults.dailySteps,
          workActivity: defaults.workActivity,
          bodyFatCeilingPct: defaults.bodyFatCeilingPct,
        }}
      />
    </AppShell>
  );
}
