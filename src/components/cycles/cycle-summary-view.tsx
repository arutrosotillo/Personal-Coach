import { MaintenanceDetails } from "@/components/cycles/maintenance-details";
import type { CycleSummary } from "@/core/cycles";
import { formatNumber, formatShortDate, formatSigned } from "@/lib/body-labels";
import { formatDuration, formatKcal, formatRatePct } from "@/lib/cycle-labels";

/**
 * Resumen de un ciclo: lo que pasó, con las mismas cautelas que el resto de
 * la app. La cintura y el % graso solo se afirman por encima de su error; si
 * no, se dice. No hay veredicto de "bien" o "mal": la valoración es tuya.
 */
export function CycleSummaryView({
  summary,
  todayLocalDate,
}: {
  summary: CycleSummary;
  todayLocalDate: string;
}) {
  const { weight, waist, bodyFat, nutrition, performance, maintenance } =
    summary;
  const fmtDate = (d: string) => formatShortDate(d, todayLocalDate);

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground tnum">
        {fmtDate(summary.startLocalDate)} → {fmtDate(summary.endLocalDate)} ·{" "}
        {formatDuration(summary.days)}
      </p>

      {/* ── Peso ── */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <dt className="text-muted-foreground text-xs">Peso al empezar</dt>
          <dd className="tnum font-medium">
            {weight.startKg === null
              ? "—"
              : `${formatNumber(weight.startKg)} kg`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Peso al terminar</dt>
          <dd className="tnum font-medium">
            {weight.endKg === null ? "—" : `${formatNumber(weight.endKg)} kg`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Cambio total</dt>
          <dd className="tnum font-medium">
            {weight.changeKg === null
              ? "—"
              : `${formatSigned(weight.changeKg, 1)} kg`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Ritmo medio</dt>
          <dd className="tnum font-medium">
            {weight.ratePerWeekKg === null
              ? "—"
              : `${formatSigned(weight.ratePerWeekKg)} kg/sem`}
            {weight.ratePctPerWeek !== null ? (
              <span className="text-muted-foreground block text-xs font-normal">
                {formatRatePct(Math.round(weight.ratePctPerWeek * 100) / 100)}{" "}
                del peso · objetivo {formatRatePct(summary.weeklyRatePct)}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      <p className="text-muted-foreground text-xs">
        Peso de inicio y de cierre: media de los primeros y los últimos 7 días (
        {weight.weighings} pesajes en total). Un pesaje suelto mueve el agua, no
        la grasa.
        {summary.targetWeightReached === true
          ? " Llegaste a tu peso objetivo."
          : ""}
      </p>

      {/* ── Cintura y % graso: solo lo que se puede afirmar ── */}
      {waist.startCm !== null ? (
        <div>
          <p className="text-muted-foreground text-xs">Cintura</p>
          <p className="tnum">
            {formatNumber(waist.startCm)} → {formatNumber(waist.endCm!)} cm
            {waist.status === "DECREASING" || waist.status === "INCREASING" ? (
              <span className="text-muted-foreground">
                {" "}
                · {formatSigned(waist.fittedChangeCm!, 1)} cm ajustados, por
                encima del error de la cinta
              </span>
            ) : waist.status === "WITHIN_MEASUREMENT_ERROR" ? (
              <span className="text-muted-foreground">
                {" "}
                · dentro del error de la cinta (
                {formatNumber(waist.minDetectableChangeCm)} cm)
              </span>
            ) : (
              <span className="text-muted-foreground">
                {" "}
                · pocas medidas para afirmar un cambio
              </span>
            )}
          </p>
        </div>
      ) : null}
      {bodyFat.changePp !== null &&
      (bodyFat.status === "DECREASING" || bodyFat.status === "INCREASING") ? (
        <div>
          <p className="text-muted-foreground text-xs">% graso estimado</p>
          <p className="tnum">
            {formatSigned(bodyFat.changePp, 1)} puntos
            <span className="text-muted-foreground">
              {" "}
              · entre lecturas{" "}
              {bodyFat.reliability === "MEASURED" ? "medidas" : "estimadas"} del
              mismo método
            </span>
          </p>
        </div>
      ) : null}

      {/* ── Calorías ── */}
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">Objetivos calóricos</p>
        <ul className="tnum space-y-0.5">
          {nutrition.periods.map((p) => (
            <li key={p.fromLocalDate}>
              {formatKcal(p.kcal)} kcal · {p.proteinG} g proteína{" "}
              <span className="text-muted-foreground text-xs">
                desde el {fmtDate(p.fromLocalDate)}
              </span>
            </li>
          ))}
        </ul>
        {nutrition.loggedDays > 0 && nutrition.meanLoggedKcal !== null ? (
          <p className="text-muted-foreground tnum text-xs">
            Registraste lo que comías {nutrition.loggedDays} días (
            {Math.round(nutrition.loggedCoverage * 100)} %): media de{" "}
            {formatKcal(nutrition.meanLoggedKcal)} kcal
            {nutrition.meanLoggedProteinG !== null
              ? ` y ${Math.round(nutrition.meanLoggedProteinG)} g de proteína`
              : ""}
            .
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Sin registro de lo que comías: la app no confunde el objetivo con lo
            comido, así que la estimación del gasto lleva más margen.
          </p>
        )}
      </div>

      {maintenance ? (
        <MaintenanceDetails
          maintenance={maintenance}
          label="Tu mantenimiento al final del ciclo"
        />
      ) : null}

      {/* ── Rendimiento ── */}
      {performance ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            Rendimiento (mejor e1RM de las primeras y las últimas{" "}
            {Math.round(performance.windowDays / 7)} semanas)
          </p>
          <p className="tnum">
            {performance.improved} mejoran · {performance.stable} se mantienen ·{" "}
            {performance.declined} bajan
          </p>
          <ul className="text-muted-foreground tnum space-y-0.5 text-xs">
            {performance.highlights.map((h) => (
              <li key={`${h.exerciseName}-${h.variantName}`}>
                {h.exerciseName}{" "}
                <span className="opacity-80">({h.variantName})</span>:{" "}
                {formatNumber(h.fromKg)} → {formatNumber(h.toKg)} kg (
                {formatSigned(h.changePct, 1)} %)
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          No hay ejercicios entrenados al principio y al final del ciclo con los
          que comparar el rendimiento.
        </p>
      )}
    </div>
  );
}
