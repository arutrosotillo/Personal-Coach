import { FlaskConical, Sparkles } from "lucide-react";
import Link from "next/link";

import { isCoachConfigured } from "@/ai/config";
import { AskCoach } from "@/components/coach/ask-coach";
import { CoachPanel } from "@/components/coach/coach-panel";
import { AppShell } from "@/components/layout/app-shell";
import { RecoveryCard } from "@/components/training/recovery-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentProfile } from "@/server/auth/current-user";
import {
  DEFAULT_WINDOW_DAYS,
  getTrainingAnalysis,
} from "@/server/services/fatigue.service";

export const dynamic = "force-dynamic";

export default async function CoachPage() {
  const profile = await getCurrentProfile();
  const analysis = profile ? await getTrainingAnalysis(profile.id) : null;
  const configured = isCoachConfigured();

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-semibold">Coach</h1>
      <p className="text-muted-foreground mb-4 text-sm">
        Los motores calculan los números; el coach los interpreta y te los
        explica. Nunca cambia tu programa.
      </p>

      {!configured ? (
        <Card className="mb-4">
          <CardContent className="pt-4">
            <p className="font-medium">AI Coach no configurado</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Añade <code className="tnum">OPENAI_API_KEY</code> a tu fichero{" "}
              <code>.env</code> y reinicia el servidor. Todo lo demás —el plan,
              el registro de series, la progresión y el estado de recuperación—
              funciona sin IA.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {analysis && analysis.context.sessions.length > 0 ? (
        <>
          <Card className="mb-4">
            <CardContent className="pt-4">
              <h2 className="mb-1 flex items-center gap-2 font-medium">
                <Sparkles className="size-4" aria-hidden />
                Resumen semanal
              </h2>
              <p className="text-muted-foreground mb-3 text-sm">
                {analysis.context.sessions.length} sesiones y{" "}
                {analysis.variants.length} ejercicios en los últimos{" "}
                {DEFAULT_WINDOW_DAYS} días.
              </p>
              <CoachPanel
                request={{ task: "WEEKLY" }}
                label="Generar resumen"
                emptyHint="Se genera solo cuando lo pides: una consulta cuesta menos de un céntimo."
              />
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardContent className="pt-4">
              <AskCoach />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="mb-4">
          <CardContent className="pt-4">
            <p className="text-muted-foreground text-sm">
              {profile
                ? "Todavía no hay sesiones completadas que analizar. Entrena y vuelve por aquí."
                : "Primero crea tu plan: el coach interpreta lo que entrenas, así que necesita datos para decir algo."}
            </p>
            {profile ? null : (
              <Button
                nativeButton={false}
                render={<Link href="/onboarding" />}
                className="mt-3 min-h-11 w-full"
              >
                Crear mi plan
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sin sesiones, la tarjeta solo diría "no puedo valorar tu fatiga":
          dos estados vacíos apilados diciendo lo mismo. */}
      {analysis && analysis.context.sessions.length > 0 ? (
        <RecoveryCard fatigue={analysis.fatigue} />
      ) : null}

      <Button
        nativeButton={false}
        render={<Link href="/science" />}
        variant="secondary"
        className="min-h-11 w-full"
      >
        <FlaskConical className="mr-2 size-4" aria-hidden />
        Ciencia y bibliografía
      </Button>
    </AppShell>
  );
}
