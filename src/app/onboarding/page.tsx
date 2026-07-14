import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { toLocalDate } from "@/core/dates";
import { listExerciseNames } from "@/server/repositories/catalog.repo";

export const dynamic = "force-dynamic";

const DEFAULT_TIMEZONE = "Europe/Madrid";

export default async function OnboardingPage() {
  const exerciseNames = await listExerciseNames();
  const todayLocalDate = toLocalDate(new Date(), DEFAULT_TIMEZONE);

  return (
    <OnboardingWizard
      exerciseNames={exerciseNames}
      todayLocalDate={todayLocalDate}
    />
  );
}
