import { BottomNav } from "@/components/layout/bottom-nav";

/** Envoltorio de las pantallas con navegación (todas salvo el onboarding). */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-6 pb-24">
        {children}
      </main>
      <BottomNav />
    </>
  );
}
