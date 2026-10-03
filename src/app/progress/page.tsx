import Link from "next/link";

import { CalorieAdjustmentCard } from "@/components/body/calorie-adjustment-card";
import { CheckInCard } from "@/components/body/check-in-card";
import { InsightCard } from "@/components/body/insight-card";
import { MeasurementHistory } from "@/components/body/measurement-history";
import { WeightChart } from "@/components/body/weight-chart";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatConfidenceInterval,
  formatNumber,
  formatShortDate,
  formatSigned,
  formatWindow,
  showsSlope,
  WAIST_STATUS_TITLE,
  WEIGHT_REASON_HINT,
  WEIGHT_STATUS_TITLE,
} from "@/lib/body-labels";
import { getCurrentProfile } from "@/server/auth/current-user";
import {
  getBodyProgress,
  getGoalForEdit,
} from "@/server/services/body.service";
import { getCalorieAdjustment } from "@/server/services/nutrition-adjustment.service";

export const dynamic = "force-dynamic";

/**
 * Progreso corporal.
 *
 * La pantalla no interpreta: enseña exactamente lo que dice el motor y con sus
 * mismas cautelas. Tres reglas que explican por qué no hay flechas de colores:
 *
 *   · Con `INCONCLUSIVE` no se insinúa dirección. No se enseña la pendiente ni
 *     una flecha "por si acaso": se dice que todavía no hay tendencia clara.
 *   · Que el peso suba o baje no es bueno ni malo. Depende del objetivo, y
 *     valorarlo es trabajo de B5, no de esta pantalla. Por eso no hay verde ni
 *     rojo en ningún sitio.
 *   · La "confianza" del motor es PRECISIÓN, no aprobación. Se enseña como lo
 *     que es —el margen de error en kg/semana— y no como una nota.
 */
export default async function ProgressPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    return (
      <AppShell>
        <h1 className="mb-4 text-2xl font-semibold">Progreso</h1>
        <Card>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Todavía no tienes perfil. Completa el onboarding y empezaremos a
              seguir tu progreso desde el primer dato.
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

  const [
    { analysis, history, chartSeries, checkIn, phaseStartLocalDate, insight },
    editableGoal,
    calorieAdjustment,
  ] = await Promise.all([
    getBodyProgress(profile.id),
    getGoalForEdit(profile.id),
    getCalorieAdjustment(profile.id),
  ]);
  const { weight, waist, bodyFat, goal, todayLocalDate } = analysis;
  const hoy = history.find((m) => m.localDate === todayLocalDate);
  const hasTodayRow = hoy !== undefined;

  // Historial RECIENTE: con pesaje diario, medio año son 180 filas y la
  // pantalla deja de servir para nada. La serie completa sigue en la curva y
  // en la tabla accesible del gráfico.
  // La nota de fase solo aparece cuando el recorte RECORTA de verdad: si hay
  // mediciones anteriores al inicio de la fase que el análisis está dejando
  // fuera. Para quien nunca ha cambiado de objetivo, la fase empezó en el
  // onboarding y no hay nada antes, así que la nota sería ruido.
  const phaseClipsHistory =
    phaseStartLocalDate !== null &&
    history.some((m) => m.localDate < phaseStartLocalDate);

  const RECIENTES = 20;
  const recientes = history.slice(0, RECIENTES);

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold">Progreso</h1>

      <div className="space-y-4">
        {/* ── Peso y tendencia ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Peso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {weight.latestKg === null ? (
              <p className="text-muted-foreground text-sm">
                Aún no has registrado ningún peso.
              </p>
            ) : (
              <div>
                <p className="tnum text-4xl font-semibold">
                  {formatNumber(weight.latestKg)}
                  <span className="text-muted-foreground ml-1 text-lg font-normal">
                    kg
                  </span>
                </p>
                <p className="text-muted-foreground tnum mt-1 text-xs">
                  Último pesaje ·{" "}
                  {formatShortDate(weight.latestLocalDate!, todayLocalDate)}
                  {weight.series.length > 1 && weight.totalChangeKg !== null ? (
                    <>
                      {" · "}
                      {formatSigned(weight.totalChangeKg, 1)} kg desde el primer
                      registro
                    </>
                  ) : null}
                </p>
              </div>
            )}

            <div className="border-border border-t pt-3">
              <p className="font-medium">
                {WEIGHT_STATUS_TITLE[weight.status]}
              </p>

              {showsSlope(weight.status) && weight.trend ? (
                <p className="text-muted-foreground tnum mt-1 text-sm">
                  <span className="text-foreground font-medium">
                    {formatSigned(weight.trend.slopePerWeek)} kg/semana
                  </span>{" "}
                  ·{" "}
                  {formatConfidenceInterval(
                    weight.trend.ciLowPerWeek,
                    weight.trend.ciHighPerWeek,
                    "kg/semana",
                  )}
                </p>
              ) : weight.trend ? (
                // Sin dirección afirmable se enseña el margen, nunca la
                // pendiente: es lo único que se puede sostener.
                <p className="text-muted-foreground tnum mt-1 text-sm">
                  Margen actual:{" "}
                  {formatConfidenceInterval(
                    weight.trend.ciLowPerWeek,
                    weight.trend.ciHighPerWeek,
                    "kg/semana",
                  )}
                </p>
              ) : null}

              {WEIGHT_REASON_HINT[weight.reasonCode] ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  {WEIGHT_REASON_HINT[weight.reasonCode]}
                </p>
              ) : null}

              {weight.windowDays !== null ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  Calculado sobre los {formatWindow(weight.windowDays)} ·{" "}
                  {weight.measurementsInWindow} pesajes
                </p>
              ) : null}

              {/* Si la fase empezó hace poco, decirlo evita que "faltan
                  mediciones" parezca un fallo cuando es la consecuencia
                  correcta de haber cambiado de objetivo. */}
              {phaseClipsHistory ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  Tu fase actual empezó el{" "}
                  <span className="tnum">
                    {formatShortDate(phaseStartLocalDate!, todayLocalDate)}
                  </span>
                  : la tendencia solo usa lo registrado desde entonces.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* ── Insight cuerpo × rendimiento. Se pinta solo, y solo cuando
             el motor tiene algo defendible que decir. ── */}
        <InsightCard insight={insight} />

        {/* ── Objetivo ── */}
        {goal ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tu objetivo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <dt className="text-muted-foreground text-xs">
                    Ritmo objetivo
                  </dt>
                  <dd className="tnum font-medium">
                    {/* Un objetivo de ritmo cero se dice con palabras: leer
                        "±0,00 kg/semana" no ayuda a nadie. */}
                    {goal.expectedDirection === "FLAT"
                      ? "Mantener el peso"
                      : goal.targetKgPerWeek === null
                        ? "—"
                        : `${formatSigned(goal.targetKgPerWeek)} kg/semana`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Ritmo real</dt>
                  <dd className="tnum font-medium">
                    {goal.observedKgPerWeek === null ? (
                      <span className="text-muted-foreground font-normal">
                        Sin tendencia todavía
                      </span>
                    ) : (
                      `${formatSigned(goal.observedKgPerWeek)} kg/semana`
                    )}
                  </dd>
                </div>
                {goal.targetWeightKg !== null ? (
                  <>
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        Peso objetivo
                      </dt>
                      <dd className="tnum font-medium">
                        {formatNumber(goal.targetWeightKg)} kg
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        Te quedan
                      </dt>
                      <dd className="tnum font-medium">
                        {goal.kgToTargetWeight === null
                          ? "—"
                          : `${formatNumber(Math.abs(goal.kgToTargetWeight))} kg`}
                      </dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </CardContent>
          </Card>
        ) : null}

        {/* ── Ajuste calórico: solo propone, nunca aplica solo ── */}
        <CalorieAdjustmentCard
          adjustment={calorieAdjustment}
          todayLocalDate={todayLocalDate}
        />

        {/* ── Check-in: discreto, y nunca bloquea nada ── */}
        <CheckInCard
          checkIn={checkIn}
          todayLocalDate={todayLocalDate}
          todayWeightKg={hoy?.weightKg ?? null}
          goal={editableGoal}
        />

        {/* ── Curva: historial COMPLETO, aunque la tendencia se acote a la
             fase actual. Acotar lo que se afirma no es borrar lo que se ve. ── */}
        {chartSeries.length >= 2 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tu curva de peso</CardTitle>
            </CardHeader>
            <CardContent>
              <WeightChart
                series={chartSeries}
                todayLocalDate={todayLocalDate}
              />
            </CardContent>
          </Card>
        ) : null}

        {/* ── Cintura: solo si hay algo que enseñar ── */}
        {waist.latestCm !== null ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cintura</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="tnum text-2xl font-semibold">
                {formatNumber(waist.latestCm)}
                <span className="text-muted-foreground ml-1 text-base font-normal">
                  cm
                </span>
              </p>
              <p className="text-sm">{WAIST_STATUS_TITLE[waist.status]}</p>
              {waist.fittedChangeCm !== null ? (
                <p className="text-muted-foreground tnum text-xs">
                  {formatSigned(waist.fittedChangeCm, 1)} cm ajustados · una
                  cinta métrica en casa no distingue cambios menores de{" "}
                  {formatNumber(waist.minDetectableChangeCm)} cm
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* ── % graso: siempre secundario y siempre con su error ── */}
        {bodyFat.latestPct !== null ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">% graso estimado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="tnum text-2xl font-semibold">
                {bodyFat.changePp === null
                  ? "—"
                  : `${formatSigned(bodyFat.changePp, 1)} pp`}
              </p>
              <p className="text-muted-foreground text-sm">
                {bodyFat.status === "DECREASING" ||
                bodyFat.status === "INCREASING"
                  ? "Cambio desde tu primera lectura comparable."
                  : bodyFat.status === "MIXED_RELIABILITY"
                    ? "Tus lecturas vienen de métodos distintos, así que no son comparables entre sí."
                    : bodyFat.status === "NOT_INTERPRETABLE"
                      ? `El cambio es menor de ${formatNumber(bodyFat.minInterpretableChangePp)} puntos, que es el error típico del método.`
                      : "Hacen falta al menos dos lecturas del mismo método, separadas un mes."}
              </p>
              <p className="text-muted-foreground text-xs">
                Última lectura: {formatNumber(bodyFat.latestPct)} %. Es una
                estimación, no una medición exacta: lo que sirve es el cambio,
                no la cifra.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {/* ── Historial ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historial</CardTitle>
          </CardHeader>
          <CardContent>
            <MeasurementHistory
              rows={recientes}
              todayLocalDate={todayLocalDate}
              hasTodayRow={hasTodayRow}
            />
            {history.length > RECIENTES ? (
              <p className="text-muted-foreground tnum mt-3 text-xs">
                Mostrando las {RECIENTES} más recientes de {history.length}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
