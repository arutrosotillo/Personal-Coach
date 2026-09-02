import type { BodyPerformanceInsight } from "@/core/insights";
import { Card, CardContent } from "@/components/ui/card";
import { formatSigned } from "@/lib/body-labels";
import { GOAL_ASSESSMENT_COPY } from "@/lib/insight-labels";

/**
 * El insight cuerpo × rendimiento, cuando lo hay.
 *
 * Devuelve `null` si el motor no tiene nada defendible que decir, que es la
 * mayoría del tiempo y está bien que lo sea: una tarjeta vacía o con una
 * perogrullada ocupa el mismo sitio que una útil y enseña a ignorar la zona.
 *
 * UN SOLO insight. No es un feed: el motor produce como mucho una valoración
 * respecto al objetivo, y esa es la que se enseña.
 *
 * Sin verde ni rojo, igual que el resto de `/progress`: que el peso suba o
 * baje no es bueno ni malo, y las dos combinaciones "de atención" no son un
 * suspenso sino dos hechos que conviene mirar.
 */
export function InsightCard({
  insight,
}: {
  insight: BodyPerformanceInsight | null;
}) {
  if (!insight?.worthShowing || !insight.goalAssessment) return null;

  const copy = GOAL_ASSESSMENT_COPY[insight.goalAssessment.code];
  const { weightSlopeKgPerWeek, judgedVariants, improving, declining } =
    insight.numbers;

  return (
    <Card>
      <CardContent className="space-y-2">
        <p className="font-medium">{copy.headline}</p>
        <p className="text-muted-foreground text-sm">{copy.body}</p>

        {/* Las cifras que sostienen la frase, para que se pueda comprobar.
            Vienen calculadas del motor: aquí no se deriva ninguna. */}
        {judgedVariants > 0 ? (
          <p className="text-muted-foreground tnum text-xs">
            {weightSlopeKgPerWeek !== null ? (
              <>{formatSigned(weightSlopeKgPerWeek)} kg/semana · </>
            ) : null}
            {judgedVariants} ejercicios con historial suficiente
            {improving > 0 ? `, ${improving} progresando` : ""}
            {declining > 0 ? `, ${declining} hacia atrás` : ""}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
