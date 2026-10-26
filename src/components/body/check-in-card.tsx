"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { CheckInEvaluation } from "@/core/body";
import type { BodyFatReliability, GoalStrategy } from "@/core/enums";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNumber, formatShortDate } from "@/lib/body-labels";
import { parseDecimalInput } from "@/lib/decimal-input";
import { STRATEGY_LABELS } from "@/lib/labels";
import {
  submitCheckInAction,
  updateGoalAction,
} from "@/server/actions/body.action";

/**
 * Check-in corporal quincenal.
 *
 * Se abre desde una tarjeta discreta y NUNCA bloquea nada: entrenar, pesarse y
 * ver el progreso funcionan igual si no se hace nunca. La cadencia es una
 * sugerencia, no una deuda, y por eso el texto no cuenta días de retraso ni
 * usa rojo.
 *
 * El orden de los campos es el orden de importancia real: cintura primero
 * —es lo único que solo se puede hacer aquí—, luego el peso si hoy falta, y el
 * % graso al final, plegado, porque es la métrica menos fiable de las tres.
 */

const RELIABILITY_LABEL: Record<BodyFatReliability, string> = {
  MEASURED: "DEXA o plicómetro",
  ESTIMATED: "báscula o estimación",
};

export interface CheckInGoal {
  strategy: GoalStrategy;
  weeklyRatePct: number;
  targetWeightKg: number | null;
  startDate: string;
}

export function CheckInCard({
  checkIn,
  todayLocalDate,
  todayWeightKg,
  goal,
}: {
  checkIn: CheckInEvaluation;
  todayLocalDate: string;
  /** Peso ya registrado hoy: si lo hay, el check-in no lo vuelve a pedir. */
  todayWeightKg: number | null;
  goal: CheckInGoal | null;
}) {
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <CheckInForm
        todayLocalDate={todayLocalDate}
        todayWeightKg={todayWeightKg}
        goal={goal}
        onDone={() => setOpen(false)}
      />
    );
  }

  const cuando =
    checkIn.status === "NEVER_DONE"
      ? "Nunca has medido tu cintura. Es el mejor indicador barato de cambio de composición."
      : checkIn.status === "DUE"
        ? `Tu última medida de cintura es del ${formatShortDate(checkIn.lastLocalDate!, todayLocalDate)}.`
        : `Última medida el ${formatShortDate(checkIn.lastLocalDate!, todayLocalDate)}. La siguiente, hacia el ${formatShortDate(checkIn.nextDueLocalDate, todayLocalDate)}.`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {checkIn.status === "NOT_DUE"
            ? "Próximo check-in"
            : "Actualicemos cómo vas"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">{cuando}</p>
        <Button
          type="button"
          variant={checkIn.status === "NOT_DUE" ? "secondary" : "default"}
          className="min-h-11 w-full"
          onClick={() => setOpen(true)}
        >
          {checkIn.status === "NOT_DUE"
            ? "Hacer el check-in igualmente"
            : "Hacer el check-in"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CheckInForm({
  todayLocalDate,
  todayWeightKg,
  goal,
  onDone,
}: {
  todayLocalDate: string;
  todayWeightKg: number | null;
  goal: CheckInGoal | null;
  onDone: () => void;
}) {
  const [w1, setW1] = useState("");
  const [w2, setW2] = useState("");
  const [w3, setW3] = useState("");
  const [weight, setWeight] = useState("");
  const [fat, setFat] = useState("");
  const [reliability, setReliability] =
    useState<BodyFatReliability>("ESTIMATED");
  const [showFat, setShowFat] = useState(false);
  const [showGoal, setShowGoal] = useState(false);
  const [pending, startTransition] = useTransition();

  const tomas = [
    parseDecimalInput(w1),
    parseDecimalInput(w2),
    parseDecimalInput(w3),
  ];
  const completas = tomas.filter((t): t is number => t !== null);
  const media =
    completas.length === 3
      ? Math.round((completas.reduce((a, t) => a + t, 0) / 3) * 10) / 10
      : null;
  const dispersion =
    completas.length === 3
      ? Math.max(...completas) - Math.min(...completas)
      : null;

  function save() {
    startTransition(async () => {
      const result = await submitCheckInAction({
        localDate: todayLocalDate,
        weightKg: parseDecimalInput(weight),
        waist1: tomas[0],
        waist2: tomas[1],
        waist3: tomas[2],
        bodyFatPct: parseDecimalInput(fat),
        bodyFatReliability:
          parseDecimalInput(fat) === null ? null : reliability,
      });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo guardar el check-in.");
        return;
      }
      toast.success("Check-in guardado.");
      onDone();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Actualicemos cómo vas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── Cintura, lo único que solo se puede hacer aquí ── */}
        <div className="space-y-3">
          <div>
            <p className="font-medium">Cintura, tres veces seguidas</p>
            <p className="text-muted-foreground mt-1 text-sm">
              A la altura del ombligo, de pie, al soltar el aire y sin apretar
              la cinta. Mide, suelta la cinta del todo y repite: promediando
              tres tomas el margen de error baja de unos 5 cm a unos 3, que es
              la diferencia entre detectar tu progreso y no detectarlo.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["checkin-w1", "1.ª", w1, setW1],
                ["checkin-w2", "2.ª", w2, setW2],
                ["checkin-w3", "3.ª", w3, setW3],
              ] as const
            ).map(([id, label, value, set]) => (
              <div key={id}>
                <Label htmlFor={id} className="mb-1 block text-xs">
                  {label} toma
                </Label>
                <Input
                  id={id}
                  inputMode="decimal"
                  type="text"
                  placeholder="cm"
                  value={value}
                  disabled={pending}
                  onChange={(e) => set(e.target.value)}
                  className="tnum min-h-11"
                />
              </div>
            ))}
          </div>
          {media !== null ? (
            <p
              className="text-muted-foreground tnum text-xs"
              aria-live="polite"
            >
              Media: {formatNumber(media)} cm
              {dispersion !== null && dispersion > 5
                ? ` · tus tomas se separan ${formatNumber(dispersion)} cm, revisa que la cinta pase por el mismo sitio`
                : ""}
            </p>
          ) : null}
        </div>

        {/* ── Peso, solo si hoy falta ── */}
        {todayWeightKg === null ? (
          <div>
            <Label htmlFor="checkin-weight" className="mb-1 block">
              Peso de hoy{" "}
              <span className="text-muted-foreground font-normal">
                — opcional
              </span>
            </Label>
            <Input
              id="checkin-weight"
              inputMode="decimal"
              type="text"
              placeholder="82,4"
              value={weight}
              disabled={pending}
              onChange={(e) => setWeight(e.target.value)}
              className="tnum min-h-11"
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Peso de hoy ya anotado:{" "}
            <span className="tnum">{formatNumber(todayWeightKg)} kg</span>.
          </p>
        )}

        {/* ── % graso, plegado: es el dato menos fiable ── */}
        {showFat ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="checkin-fat" className="mb-1 block text-xs">
                % graso
              </Label>
              <Input
                id="checkin-fat"
                inputMode="decimal"
                type="text"
                value={fat}
                disabled={pending}
                onChange={(e) => setFat(e.target.value)}
                className="tnum min-h-11"
              />
            </div>
            <div>
              <Label htmlFor="checkin-method" className="mb-1 block text-xs">
                Cómo lo mediste
              </Label>
              <select
                id="checkin-method"
                value={reliability}
                disabled={pending}
                onChange={(e) =>
                  setReliability(e.target.value as BodyFatReliability)
                }
                className="border-input bg-background min-h-11 w-full rounded-md border px-3 text-sm"
              >
                <option value="ESTIMATED">{RELIABILITY_LABEL.ESTIMATED}</option>
                <option value="MEASURED">{RELIABILITY_LABEL.MEASURED}</option>
              </select>
            </div>
            <p className="text-muted-foreground col-span-2 text-xs">
              Opcional y secundario: una báscula de bioimpedancia se equivoca
              varios puntos en el valor absoluto. Lo que sirve es el cambio
              entre dos lecturas del mismo aparato.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowFat(true)}
            className="text-muted-foreground focus-visible:ring-ring/50 min-h-9 text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
          >
            + Añadir % graso (opcional)
          </button>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={pending}
            onClick={onDone}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={pending}
            onClick={save}
          >
            Guardar check-in
          </Button>
        </div>

        {/* ── Revisión del objetivo: aparte y nunca obligatoria ── */}
        {goal ? (
          <div className="border-border border-t pt-4">
            {showGoal ? (
              <GoalReview goal={goal} onDone={() => setShowGoal(false)} />
            ) : (
              <>
                <p className="text-sm">
                  Tu objetivo:{" "}
                  <span className="font-medium">
                    {STRATEGY_LABELS[goal.strategy]}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => setShowGoal(true)}
                  className="text-muted-foreground focus-visible:ring-ring/50 mt-1 min-h-9 text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
                >
                  Revisar objetivo
                </button>
              </>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Revisión del objetivo DENTRO de la fase actual: ritmo y peso objetivo.
 *
 * Cambiar de objetivo (de definición a volumen, por ejemplo) ya no se hace
 * aquí: es cerrar un ciclo y empezar otro, con su resumen, tus datos de hoy y
 * unas calorías recalculadas que confirmas tú (`/progress/cycle`). Este
 * formulario solo corrige el listón de la fase en curso y no reinicia nada.
 */
export function GoalReview({
  goal,
  onDone,
}: {
  goal: CheckInGoal;
  onDone: () => void;
}) {
  const [rate, setRate] = useState(
    String(goal.weeklyRatePct).replace(".", ","),
  );
  const [target, setTarget] = useState(
    goal.targetWeightKg === null
      ? ""
      : String(goal.targetWeightKg).replace(".", ","),
  );
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateGoalAction({
        strategy: goal.strategy,
        weeklyRatePct: parseDecimalInput(rate) ?? 0,
        targetWeightKg: parseDecimalInput(target),
      });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo guardar el objetivo.");
        return;
      }
      toast.success(
        result.kind === "EDIT_IN_PLACE"
          ? "Objetivo actualizado. Tu tendencia sigue igual."
          : "No has cambiado nada.",
      );
      onDone();
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm">
          Fase actual:{" "}
          <span className="font-medium">{STRATEGY_LABELS[goal.strategy]}</span>
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          ¿Quieres cambiar de objetivo?{" "}
          <Link href="/progress/cycle" className="underline underline-offset-2">
            Finaliza tu ciclo y empieza otro
          </Link>
          : verás su resumen y unas calorías recalculadas antes de confirmar.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="goal-rate" className="mb-1 block text-xs">
            Ritmo (% peso/semana)
          </Label>
          <Input
            id="goal-rate"
            inputMode="decimal"
            type="text"
            value={rate}
            disabled={pending}
            onChange={(e) => setRate(e.target.value)}
            className="tnum min-h-11"
          />
        </div>
        <div>
          <Label htmlFor="goal-target" className="mb-1 block text-xs">
            Peso objetivo (kg)
          </Label>
          <Input
            id="goal-target"
            inputMode="decimal"
            type="text"
            placeholder="opcional"
            value={target}
            disabled={pending}
            onChange={(e) => setTarget(e.target.value)}
            className="tnum min-h-11"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-9"
          disabled={pending}
          onClick={onDone}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          className="min-h-9"
          disabled={pending}
          onClick={save}
        >
          Guardar objetivo
        </Button>
      </div>
    </div>
  );
}
