import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const exercises = await prisma.exercise.findMany({
    where: { isActive: true, deletedAt: null },
    select: { name: true },
    orderBy: { name: "asc" },
  });

  return <OnboardingWizard exerciseNames={exercises.map((e) => e.name)} />;
}
