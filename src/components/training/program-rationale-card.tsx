import { MUSCLE_GROUP_BY_CODE } from "@/core/catalog/muscle-groups";
import type { Equipment } from "@/core/enums";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProgramRationale } from "@/server/repositories/program.repo";

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  BARBELL: "Barra",
  EZ_BAR: "Barra EZ",
  DUMBBELL: "Mancuernas",
  MACHINE: "Máquinas",
  SMITH_MACHINE: "Multipower",
  CABLE: "Poleas",
  BODYWEIGHT: "Peso corporal",
  BAND: "Bandas",
};

const CONTRA_LABELS: Record<string, string> = {
  SHOULDER: "hombro",
  ELBOW: "codo",
  WRIST: "muñeca",
  LOWER_BACK: "zona lumbar",
  HIP: "cadera",
  KNEE: "rodilla",
  ANKLE: "tobillo",
};

/** Bloque "Por qué este programa": datos derivados, no texto genérico. */
export function ProgramRationaleCard({
  rationale,
}: {
  rationale: ProgramRationale;
}) {
  const o = rationale.output;
  const priorityNames =
    o.priorityMuscles.length > 0
      ? o.priorityMuscles.map((c) => MUSCLE_GROUP_BY_CODE[c].nameEs).join(", ")
      : "Equilibrado (sin prioridad especial)";
  const avgMinutes = Math.round(
    o.perDayMinutes.reduce((s, m) => s + m, 0) /
      Math.max(o.perDayMinutes.length, 1),
  );
  // Volumen ordenado: mayor volumen directo primero.
  const volumes = [...o.volumeByGroup]
    .filter((v) => v.directSets > 0 || v.fractionalSets >= 1)
    .sort(
      (a, b) =>
        b.directSets - a.directSets || b.fractionalSets - a.fractionalSets,
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Por qué este programa</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">{rationale.explanation}</p>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">División</dt>
          <dd>{o.splitLabel}</dd>
          <dt className="text-muted-foreground">Disponibilidad</dt>
          <dd className="tnum">
            {o.daysPerWeek} días/semana · {o.minutesPerSession} min/sesión
            (media real ~{avgMinutes} min)
          </dd>
          <dt className="text-muted-foreground">Prioridades</dt>
          <dd>{priorityNames}</dd>
          <dt className="text-muted-foreground">Equipamiento</dt>
          <dd>{o.equipment.map((e) => EQUIPMENT_LABELS[e]).join(", ")}</dd>
          {o.contraindications.length > 0 ? (
            <>
              <dt className="text-muted-foreground">Molestias respetadas</dt>
              <dd>
                {o.contraindications
                  .map((c) => CONTRA_LABELS[c] ?? c)
                  .join(", ")}
              </dd>
            </>
          ) : null}
          {o.excludedExerciseNames.length > 0 ? (
            <>
              <dt className="text-muted-foreground">Ejercicios excluidos</dt>
              <dd>{o.excludedExerciseNames.join(", ")}</dd>
            </>
          ) : null}
        </dl>

        <div>
          <h3 className="text-muted-foreground mb-1 text-xs font-medium">
            Series semanales por grupo (directas · fraccionales · frecuencia)
          </h3>
          <ul className="tnum divide-border divide-y">
            {volumes.map((v) => (
              <li
                key={v.group}
                className="flex items-baseline justify-between gap-3 py-1"
              >
                <span>
                  {MUSCLE_GROUP_BY_CODE[v.group].nameEs}
                  {v.isPriority ? (
                    <span className="text-primary ml-1" aria-label="prioridad">
                      ★
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">
                  {v.directSets} directas · {v.fractionalSets} fracc. ·{" "}
                  {v.frequency}×/sem
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-1 text-xs">
            Las series fraccionales cuentan el volumen indirecto por su
            contribución (una serie de press aporta fracciones a tríceps y
            deltoides). Son aproximaciones operativas, no medidas exactas.
          </p>
        </div>

        {o.warnings.length > 0 ? (
          <ul className="text-warning list-disc space-y-1 pl-4 text-xs">
            {o.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}

        <p className="text-muted-foreground border-border border-t pt-3 text-xs">
          Este es un programa inicial. Durante las siguientes fases se ajustará
          según tu rendimiento, recuperación y adherencia. Generador{" "}
          <span className="tnum">
            v{rationale.version} · {rationale.ruleId}
          </span>
          .
        </p>
      </CardContent>
    </Card>
  );
}
