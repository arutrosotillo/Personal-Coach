"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { MaintenanceDetails } from "@/components/cycles/maintenance-details";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CYCLE_CONFIG } from "@/core/config/cycle-config";
import { NUTRITION_CONFIG } from "@/core/config/nutrition-config";
import {
  STRATEGY_TO_GOAL_TYPE,
  type CycleOutcome,
  type GoalStrategy,
  type InterimNutrition,
  type WorkActivity,
} from "@/core/enums";
import { formatNumber, formatShortDate } from "@/lib/body-labels";
import {
  CYCLE_NAME,
  CYCLE_ORDER,
  CYCLE_PURPOSE,
  formatKcal,
  formatRatePct,
} from "@/lib/cycle-labels";
import { parseDecimalInput } from "@/lib/decimal-input";
import { WORK_ACTIVITY_LABELS } from "@/lib/labels";
import {
  closeCycleAction,
  previewCyclePlanAction,
  startCycleAction,
} from "@/server/actions/cycle.action";
import type {
  ClosePreview,
  CyclePlanPreview,
} from "@/server/services/cycle.service";

/**
 * Finalizar un ciclo y, si se quiere, empezar otro. Pasos cortos, cada uno
 * con una sola decisión:
 *
 *   resumen → ¿completado o sin completar? → ¿empezar otro o solo finalizar?
 *     · solo finalizar → qué calorías quedan mientras decides → confirmar
 *     · empezar otro   → tus datos de hoy → objetivo y ritmo → propuesta
 *                         explicada → confirmar
 *
 * Nada se guarda hasta el botón final. La propuesta se recalcula en el
 * servidor al confirmar; si un dato nuevo la ha cambiado, se enseña la nueva
 * en vez de aplicar algo que no se vio. Un mismo flujo reusa su `requestId`:
 * pulsar dos veces, o reintentar sin cobertura, no crea dos ciclos.
 */

type Step = "summary" | "interim" | "data" | "goal" | "proposal";

export interface CycleFlowDefaults {
  activeGoalId: string | null;
  activeStrategy: GoalStrategy | null;
  weightKg: number | null;
  lastWeighLocalDate: string | null;
  waistCm: number | null;
  dailySteps: number;
  workActivity: WorkActivity;
  bodyFatCeilingPct: number | null;
}

const decimal = (n: number | null, digits = 1) =>
  n === null ? "" : formatNumber(n, digits);

export function CycleFlow({
  todayLocalDate,
  close,
  summarySlot,
  defaults,
}: {
  todayLocalDate: string;
  close: ClosePreview | null;
  /** Resumen del ciclo activo, renderizado en el servidor. */
  summarySlot: ReactNode;
  defaults: CycleFlowDefaults;
}) {
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState<Step>(close ? "summary" : "data");
  const [pending, startTransition] = useTransition();

  const [outcome, setOutcome] = useState<CycleOutcome | null>(null);
  const [interim, setInterim] = useState<InterimNutrition>("MAINTENANCE");

  // Vacío a propósito: la media reciente se usa para calcular, pero solo se
  // guarda un pesaje si la persona escribe el que ha hecho hoy. Prerrellenar y
  // guardar sería registrar como pesaje un valor suavizado que nadie pesó.
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [steps, setSteps] = useState(String(defaults.dailySteps));
  const [work, setWork] = useState<WorkActivity>(defaults.workActivity);

  const firstChoice: GoalStrategy =
    defaults.activeStrategy === "FAT_LOSS_MUSCLE_PRESERVATION"
      ? "LEAN_GAIN"
      : (CYCLE_ORDER.find((s) => s !== defaults.activeStrategy) ?? "LEAN_GAIN");
  const [strategy, setStrategy] = useState<GoalStrategy>(firstChoice);
  const defaultRate = (s: GoalStrategy) =>
    NUTRITION_CONFIG.weeklyRatePct[STRATEGY_TO_GOAL_TYPE[s]].default;
  const [rate, setRate] = useState(
    String(defaultRate(firstChoice)).replace(".", ","),
  );
  const [targetWeight, setTargetWeight] = useState("");
  const [ceiling, setCeiling] = useState(
    defaults.bodyFatCeilingPct === null
      ? ""
      : decimal(defaults.bodyFatCeilingPct, 1),
  );
  const [preview, setPreview] = useState<CyclePlanPreview | null>(null);
  const [planChanged, setPlanChanged] = useState(false);

  const referenceKg = parseDecimalInput(weight) ?? defaults.weightKg ?? 75;
  const range = NUTRITION_CONFIG.weeklyRatePct[STRATEGY_TO_GOAL_TYPE[strategy]];
  const flatRate = range.min === 0 && range.max === 0;

  function request() {
    return {
      strategy,
      weeklyRatePct: flatRate ? 0 : (parseDecimalInput(rate) ?? Number.NaN),
      targetWeightKg: parseDecimalInput(targetWeight),
      weightKg: parseDecimalInput(weight),
      waistCm: parseDecimalInput(waist),
      dailySteps: Number(steps.replace(/[^\d]/g, "")) || 0,
      workActivity: work,
      bodyFatCeilingPct:
        strategy === "LEAN_GAIN" ? parseDecimalInput(ceiling) : null,
    };
  }

  function loadPreview(afterChange = false) {
    startTransition(async () => {
      const result = await previewCyclePlanAction(request());
      if (!result.ok || !result.preview) {
        toast.error(result.error ?? "No se pudo calcular la propuesta.");
        return;
      }
      setPreview(result.preview);
      setPlanChanged(afterChange);
      setStep("proposal");
    });
  }

  function confirmStart() {
    if (!preview) return;
    startTransition(async () => {
      const result = await startCycleAction({
        ...request(),
        requestId,
        expectedActiveGoalId: defaults.activeGoalId,
        closeOutcome: defaults.activeGoalId ? outcome : null,
        expectedKcal: preview.plan.kcal,
      });
      if (!result.ok) {
        if (result.stalePlan) {
          toast.warning(result.error ?? "Los números han cambiado.");
          loadPreview(true);
          return;
        }
        toast.error(result.error ?? "No se pudo empezar el ciclo.");
        return;
      }
      toast.success(
        `${CYCLE_NAME[strategy]} empezado. Tu historial sigue entero.`,
      );
      router.push("/progress");
      router.refresh();
    });
  }

  function confirmClose() {
    if (!close || !outcome) return;
    startTransition(async () => {
      const result = await closeCycleAction({
        goalId: close.goalId,
        outcome,
        interimNutrition: interim,
        expectedKcal: interim === "MAINTENANCE" ? close.interim.kcal : null,
      });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo finalizar el ciclo.");
        if (result.stalePlan) router.refresh();
        return;
      }
      toast.success("Ciclo finalizado. Empieza otro cuando quieras.");
      router.push("/progress");
      router.refresh();
    });
  }

  const activeName = defaults.activeStrategy
    ? CYCLE_NAME[defaults.activeStrategy]
    : null;

  // ── Paso 1: resumen + cómo termina + qué sigue ──
  if (step === "summary" && close) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Tu {activeName?.toLowerCase()}
            </CardTitle>
          </CardHeader>
          <CardContent>{summarySlot}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              ¿Cómo lo das por terminado?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <fieldset className="space-y-2">
              <legend className="sr-only">Resultado del ciclo</legend>
              {(
                [
                  [
                    "COMPLETED",
                    "Completado",
                    "Has conseguido lo que buscabas con esta fase.",
                  ],
                  [
                    "ABANDONED",
                    "Sin completar",
                    "Lo dejas antes de tiempo. No es un fallo: es una decisión, y queda así en tu historial.",
                  ],
                ] as const
              ).map(([value, label, help]) => (
                <label
                  key={value}
                  className={`border-border flex min-h-11 cursor-pointer gap-3 rounded-md border p-3 ${outcome === value ? "border-primary bg-primary/5" : ""}`}
                >
                  <input
                    type="radio"
                    name="outcome"
                    value={value}
                    checked={outcome === value}
                    onChange={() => setOutcome(value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="text-muted-foreground block text-xs">
                      {help}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="text-muted-foreground text-xs">
              Llegar al peso objetivo no cierra nada por sí solo: la fase la
              cierras tú.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={!outcome}
                onClick={() => setStep("interim")}
              >
                Solo finalizar
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={!outcome}
                onClick={() => setStep("data")}
              >
                Empezar otro ciclo
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Solo finalizar: qué calorías quedan ──
  if (step === "interim" && close) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Mientras decides tu siguiente fase
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Sin ciclo activo la app no ajusta tus calorías ni compara tu peso
            con ningún ritmo; tu entrenamiento sigue igual. Elige qué calorías
            quieres mientras tanto:
          </p>
          <fieldset className="space-y-2">
            <legend className="sr-only">Calorías provisionales</legend>
            <label
              className={`border-border flex min-h-11 cursor-pointer gap-3 rounded-md border p-3 ${interim === "MAINTENANCE" ? "border-primary bg-primary/5" : ""}`}
            >
              <input
                type="radio"
                name="interim"
                checked={interim === "MAINTENANCE"}
                onChange={() => setInterim("MAINTENANCE")}
                className="mt-1"
              />
              <span>
                <span className="font-medium">
                  Mantenimiento: {formatKcal(close.interim.kcal)} kcal
                  (recomendado)
                </span>
                <span className="text-muted-foreground tnum block text-xs">
                  {close.interim.proteinG} g proteína · {close.interim.fatG} g
                  grasa · {close.interim.carbsG} g carbohidratos. Lo más seguro
                  entre fases.
                </span>
              </span>
            </label>
            <label
              className={`border-border flex min-h-11 cursor-pointer gap-3 rounded-md border p-3 ${interim === "KEEP" ? "border-primary bg-primary/5" : ""}`}
            >
              <input
                type="radio"
                name="interim"
                checked={interim === "KEEP"}
                onChange={() => setInterim("KEEP")}
                className="mt-1"
              />
              <span>
                <span className="font-medium">
                  Mantener mis calorías actuales
                  {close.currentKcal !== null
                    ? ` (${formatKcal(close.currentKcal)} kcal)`
                    : ""}
                </span>
                <span className="text-muted-foreground block text-xs">
                  Si vienes de una definición, seguirías en déficit sin un ciclo
                  que lo vigile.
                </span>
              </span>
            </label>
          </fieldset>
          <MaintenanceDetails maintenance={close.maintenance} />
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={pending}
              onClick={() => setStep("summary")}
            >
              Atrás
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={pending}
              onClick={confirmClose}
            >
              Finalizar ciclo
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Tus datos de hoy ──
  if (step === "data") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Confirma tus datos de hoy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Con ellos se calculan tus calorías. No hace falta repetir el
            onboarding ni tocar tu programa de entrenamiento.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cycle-weight" className="mb-1 block text-xs">
                Peso de hoy (kg)
              </Label>
              <Input
                id="cycle-weight"
                inputMode="decimal"
                type="text"
                placeholder={decimal(defaults.weightKg)}
                value={weight}
                disabled={pending}
                onChange={(e) => setWeight(e.target.value)}
                className="tnum min-h-11"
              />
              <p className="text-muted-foreground mt-1 text-xs">
                {defaults.weightKg !== null
                  ? `Si lo dejas vacío uso tu media reciente (${decimal(defaults.weightKg)} kg${defaults.lastWeighLocalDate ? `, último pesaje el ${formatShortDate(defaults.lastWeighLocalDate, todayLocalDate)}` : ""}). Si te has pesado hoy, escríbelo y se guarda.`
                  : "Pésate en ayunas y escríbelo: es tu punto de partida."}
              </p>
            </div>
            <div>
              <Label htmlFor="cycle-waist" className="mb-1 block text-xs">
                Cintura (cm){" "}
                <span className="text-muted-foreground font-normal">
                  — opcional
                </span>
              </Label>
              <Input
                id="cycle-waist"
                inputMode="decimal"
                type="text"
                placeholder={
                  defaults.waistCm !== null ? decimal(defaults.waistCm) : ""
                }
                value={waist}
                disabled={pending}
                onChange={(e) => setWaist(e.target.value)}
                className="tnum min-h-11"
              />
            </div>
            <div>
              <Label htmlFor="cycle-steps" className="mb-1 block text-xs">
                Pasos al día
              </Label>
              <Input
                id="cycle-steps"
                inputMode="numeric"
                type="text"
                value={steps}
                disabled={pending}
                onChange={(e) => setSteps(e.target.value)}
                className="tnum min-h-11"
              />
            </div>
            <div>
              <Label htmlFor="cycle-work" className="mb-1 block text-xs">
                Actividad en el trabajo
              </Label>
              <select
                id="cycle-work"
                value={work}
                disabled={pending}
                onChange={(e) => setWork(e.target.value as WorkActivity)}
                className="border-input bg-background min-h-11 w-full rounded-md border px-3 text-sm"
              >
                {(Object.keys(WORK_ACTIVITY_LABELS) as WorkActivity[]).map(
                  (w) => (
                    <option key={w} value={w}>
                      {WORK_ACTIVITY_LABELS[w]}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() =>
                close ? setStep("summary") : router.push("/progress")
              }
            >
              Atrás
            </Button>
            <Button
              type="button"
              className="min-h-11"
              onClick={() => setStep("goal")}
            >
              Siguiente
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Objetivo y ritmo ──
  if (step === "goal") {
    const presets = CYCLE_CONFIG.ratePresets[strategy];
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">¿Qué quieres ahora?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <fieldset className="space-y-2">
            <legend className="sr-only">Objetivo del nuevo ciclo</legend>
            {CYCLE_ORDER.map((s) => (
              <label
                key={s}
                className={`border-border flex min-h-11 cursor-pointer gap-3 rounded-md border p-3 ${strategy === s ? "border-primary bg-primary/5" : ""}`}
              >
                <input
                  type="radio"
                  name="strategy"
                  value={s}
                  checked={strategy === s}
                  onChange={() => {
                    setStrategy(s);
                    setRate(String(defaultRate(s)).replace(".", ","));
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">
                    {CYCLE_NAME[s]}
                    {s === defaults.activeStrategy ? (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        · fase actual
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {CYCLE_PURPOSE[s]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {!flatRate ? (
            <div className="space-y-2">
              <p className="font-medium">Ritmo</p>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => {
                  const selected = parseDecimalInput(rate) === p;
                  return (
                    <Button
                      key={p}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      className="min-h-11"
                      aria-pressed={selected}
                      onClick={() => setRate(String(p).replace(".", ","))}
                    >
                      {formatRatePct(p)}
                    </Button>
                  );
                })}
              </div>
              <div>
                <Label htmlFor="cycle-rate" className="mb-1 block text-xs">
                  % de tu peso por semana (de{" "}
                  {String(range.min).replace(".", ",")} a{" "}
                  {String(range.max).replace(".", ",")})
                </Label>
                <Input
                  id="cycle-rate"
                  inputMode="decimal"
                  type="text"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  className="tnum min-h-11 w-32"
                />
              </div>
              {strategy === "LEAN_GAIN" ? (
                <p className="text-muted-foreground text-xs">
                  Con un 0,15 % a {decimal(referenceKg)} kg son unos{" "}
                  {Math.round(referenceKg * 1.5)} g por semana: casi invisible
                  en la báscula de un día a otro, y es justo lo que se busca.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cycle-target" className="mb-1 block text-xs">
                Peso objetivo (kg){" "}
                <span className="text-muted-foreground font-normal">
                  — opcional
                </span>
              </Label>
              <Input
                id="cycle-target"
                inputMode="decimal"
                type="text"
                value={targetWeight}
                onChange={(e) => setTargetWeight(e.target.value)}
                className="tnum min-h-11"
              />
            </div>
            {strategy === "LEAN_GAIN" ? (
              <div>
                <Label htmlFor="cycle-ceiling" className="mb-1 block text-xs">
                  % graso que prefieres no pasar{" "}
                  <span className="text-muted-foreground font-normal">
                    — opcional
                  </span>
                </Label>
                <Input
                  id="cycle-ceiling"
                  inputMode="decimal"
                  type="text"
                  value={ceiling}
                  onChange={(e) => setCeiling(e.target.value)}
                  className="tnum min-h-11"
                />
              </div>
            ) : null}
          </div>
          {strategy === "LEAN_GAIN" ? (
            <p className="text-muted-foreground text-xs">
              El % graso solo orienta el aviso de composición: una báscula
              doméstica se equivoca varios puntos, así que nunca será un límite
              que cambie nada solo.
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={pending}
              onClick={() => setStep("data")}
            >
              Atrás
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={pending}
              onClick={() => loadPreview()}
            >
              Ver propuesta
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Propuesta explicada + confirmación ──
  if (step === "proposal" && preview) {
    const { plan } = preview;
    const stabilization =
      preview.previousGoalType === "FAT_LOSS" && plan.goalType !== "FAT_LOSS"
        ? NUTRITION_CONFIG.regimeStart.postDeficitStabilizationDays
        : NUTRITION_CONFIG.regimeStart.stabilizationDays;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Tu propuesta de {CYCLE_NAME[strategy].toLowerCase()}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {planChanged ? (
            <p className="border-primary/40 bg-primary/5 rounded-md border px-3 py-2 text-xs">
              Los números han cambiado desde que los viste (llegó un dato
              nuevo). Esta es la propuesta actualizada.
            </p>
          ) : null}
          <div className="border-border rounded-md border p-3">
            <p className="tnum text-3xl font-semibold">
              {formatKcal(plan.kcal)}
              <span className="text-muted-foreground ml-1 text-base font-normal">
                kcal/día
              </span>
            </p>
            <p className="text-muted-foreground tnum mt-1 text-xs">
              {plan.proteinG} g proteína · {plan.fatG} g grasa · {plan.carbsG} g
              carbohidratos
              {plan.deltaVsCurrentKcal !== null && plan.deltaVsCurrentKcal !== 0
                ? ` · ${plan.deltaVsCurrentKcal > 0 ? "+" : "−"}${formatKcal(Math.abs(plan.deltaVsCurrentKcal))} kcal respecto a ahora`
                : ""}
            </p>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            {plan.explanation.kcal}
          </p>
          <p className="text-muted-foreground leading-relaxed">
            {plan.explanation.macros}
          </p>
          <MaintenanceDetails maintenance={preview.maintenance} />
          {plan.explanation.expectations.length > 0 ? (
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
              {plan.explanation.expectations.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-1">
            <p className="font-medium">Qué pasará al confirmar</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
              {close && outcome ? (
                <li>
                  Tu {activeName?.toLowerCase()} se cierra como{" "}
                  {outcome === "COMPLETED" ? "completado" : "sin completar"},
                  con su resumen guardado tal y como lo has visto.
                </li>
              ) : null}
              <li>
                {CYCLE_NAME[strategy]} empieza hoy. La tendencia empieza a
                contar dentro de {stabilization} días: antes, la báscula se
                mueve sobre todo por agua y glucógeno.
              </li>
              <li>
                Tu programa de entrenamiento, tus marcas y todo tu historial
                siguen igual.
              </li>
              <li>
                Nada se ajusta solo: si hace falta cambiar las calorías, te lo
                propondré con el porqué y lo decides tú.
              </li>
            </ul>
          </div>
          {preview.volumeNote ? (
            <p className="border-border rounded-md border px-3 py-2 text-xs">
              <span className="font-medium">Entrenamiento (opcional): </span>
              {preview.volumeNote}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={pending}
              onClick={() => setStep("goal")}
            >
              Atrás
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={pending}
              onClick={confirmStart}
            >
              Confirmar y empezar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
