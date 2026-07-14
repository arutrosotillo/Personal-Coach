import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { DEFAULT_TIMEZONE, toLocalDate } from "@/core/dates";
import { listExerciseNames } from "@/server/repositories/catalog.repo";

export const dynamic = "force-dynamic";

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
