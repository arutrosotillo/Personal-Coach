"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { toast } from "sonner";

import { ChipGroup } from "@/components/onboarding/chip-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MUSCLE_GROUPS } from "@/core/catalog/muscle-groups";
import type {
  Contraindication,
  Equipment,
  GoalType,
  MuscleGroupCode,
  WorkActivity,
} from "@/core/enums";
import { estimateInitialTargets } from "@/core/nutrition/initial-estimate";
import { ageInYears } from "@/core/dates";
import { splitForDays } from "@/core/program/splits";
import { GOAL_LABELS, WORK_ACTIVITY_LABELS } from "@/lib/labels";
import {
  onboardingSchema,
  type OnboardingInput,
} from "@/core/schemas/onboarding";
import { submitOnboarding } from "@/server/actions/onboarding.action";

const EQUIPMENT_OPTIONS: Array<{ value: Equipment; label: string }> = [
  { value: "BARBELL", label: "Barra" },
  { value: "EZ_BAR", label: "Barra EZ" },
  { value: "DUMBBELL", label: "Mancuernas" },
  { value: "MACHINE", label: "Máquinas" },
  { value: "SMITH_MACHINE", label: "Multipower" },
  { value: "CABLE", label: "Poleas" },
  { value: "BODYWEIGHT", label: "Peso corporal" },
  { value: "BAND", label: "Bandas" },
];

// Etiquetas desde @/lib/labels (fuente única); las descripciones son locales al wizard.
const GOAL_DESCRIPTIONS: Record<GoalType, string> = {
  FAT_LOSS: "Déficit gradual conservando músculo",
  RECOMP: "Mismo peso: menos cintura, más fuerza",
  LEAN_GAIN: "Superávit pequeño, mínimo de grasa",
  MAINTENANCE: "Consolidar donde estás",
};
const GOAL_OPTIONS: Array<{
  value: GoalType;
  label: string;
  description: string;
}> = (["FAT_LOSS", "RECOMP", "LEAN_GAIN", "MAINTENANCE"] as const).map(
  (value) => ({
    value,
    label: GOAL_LABELS[value],
    description: GOAL_DESCRIPTIONS[value],
  }),
);

const WORK_ACTIVITY_DESCRIPTIONS: Record<WorkActivity, string> = {
  SEDENTARY: "Escritorio",
  LIGHT: "De pie a ratos",
  MODERATE: "En movimiento",
  HIGH: "Trabajo físico",
};
const WORK_ACTIVITY_OPTIONS: Array<{
  value: WorkActivity;
  label: string;
  description: string;
}> = (["SEDENTARY", "LIGHT", "MODERATE", "HIGH"] as const).map((value) => ({
  value,
  label: WORK_ACTIVITY_LABELS[value],
  description: WORK_ACTIVITY_DESCRIPTIONS[value],
}));

const RATE_OPTIONS: Record<
  string,
  Array<{ value: number; label: string; description: string }>
> = {
  FAT_LOSS: [
    { value: -0.25, label: "Suave", description: "−0,25 % peso/sem" },
    { value: -0.5, label: "Estándar", description: "−0,5 % peso/sem" },
    { value: -0.75, label: "Decidido", description: "−0,75 % peso/sem" },
  ],
  LEAN_GAIN: [
    { value: 0.1, label: "Muy controlado", description: "+0,1 % peso/sem" },
    { value: 0.15, label: "Estándar", description: "+0,15 % peso/sem" },
    { value: 0.25, label: "Ambicioso", description: "+0,25 % peso/sem" },
  ],
};

const CONTRA_OPTIONS: Array<{ value: Contraindication; label: string }> = [
  { value: "SHOULDER", label: "Hombro" },
  { value: "ELBOW", label: "Codo" },
  { value: "WRIST", label: "Muñeca" },
  { value: "LOWER_BACK", label: "Zona lumbar" },
  { value: "HIP", label: "Cadera" },
  { value: "KNEE", label: "Rodilla" },
  { value: "ANKLE", label: "Tobillo" },
];

/** Grupos ofrecidos como prioridad extra (los Tier A ya lo son por defecto). */
const PRIORITY_OPTIONS = MUSCLE_GROUPS.filter((g) => g.tier !== "A").map(
  (g) => ({
    value: g.code,
    label: g.nameEs,
  }),
);

interface StepDef {
  title: string;
  why: string;
  fields: FieldPath<OnboardingInput>[];
}

const STEPS: StepDef[] = [
  {
    title: "Sobre ti",
    why: "Para calcular tu gasto energético de partida",
    fields: ["sex", "birthDate", "heightCm", "weightKg", "waistCm"],
  },
  {
    title: "Tu experiencia",
    why: "Para dimensionar el programa a tu disponibilidad real",
    fields: ["trainingYears", "daysPerWeek", "minutesPerSession"],
  },
  {
    title: "Tu equipamiento",
    why: "Solo se programan ejercicios que puedas hacer",
    fields: ["equipment"],
  },
  {
    title: "Tu objetivo",
    why: "Marca las calorías y el enfoque del programa",
    fields: ["goalType", "weeklyRatePct", "targetWeightKg"],
  },
  {
    title: "Prioridades musculares",
    why: "Hombros, espalda y pecho superior ya tienen prioridad; añade las tuyas",
    fields: ["priorityMuscles"],
  },
  {
    title: "Actividad y nutrición",
    why: "Afinan la estimación de tu gasto diario",
    fields: [
      "dailySteps",
      "workActivity",
      "sleepHoursTypical",
      "mealsPerDay",
      "dietaryPreference",
    ],
  },
  {
    title: "Molestias y exclusiones",
    why: "Para no programarte nada que te haga daño o que odies",
    fields: ["contraindications", "excludedExerciseNames"],
  },
  {
    title: "Revisión",
    why: "Esto es lo que se creará al confirmar",
    fields: [],
  },
];

export function OnboardingWizard({
  exerciseNames,
  todayLocalDate,
}: {
  exerciseNames: string[];
  /** Fecha local del servidor (misma timezone con la que se guardará). */
  todayLocalDate: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [excludedDraft, setExcludedDraft] = useState("");

  const form = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    mode: "onTouched",
    defaultValues: {
      equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
      goalType: "FAT_LOSS",
      priorityMuscles: [],
      contraindications: [],
      excludedExerciseNames: [],
      dailySteps: 6000,
      workActivity: "SEDENTARY",
      dietaryPreference: "NONE",
      daysPerWeek: 4,
      minutesPerSession: 75,
    },
  });

  const values = form.watch();
  const isLast = step === STEPS.length - 1;

  async function next() {
    const ok = await form.trigger(STEPS[step].fields, { shouldFocus: true });
    if (!ok) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function submit() {
    startTransition(async () => {
      const result = await submitOnboarding(form.getValues());
      if (result.ok) {
        toast.success("Plan creado. ¡Vamos allá!");
        router.push("/");
        router.refresh();
      } else if (result.fieldErrors) {
        toast.error(
          "Revisa los datos: " + Object.values(result.fieldErrors).join(" · "),
        );
      } else {
        toast.error(result.error ?? "Algo falló. No se ha guardado nada.");
      }
    });
  }

  const numberField = (
    name: FieldPath<OnboardingInput>,
    opts?: { step?: string },
  ) => ({
    ...form.register(name, {
      setValueAs: (v: unknown) =>
        v === "" || v === null ? undefined : Number(v),
    }),
    type: "number" as const,
    inputMode: "decimal" as const,
    step: opts?.step ?? "any",
  });

  const error = (name: FieldPath<OnboardingInput>) => {
    const err = form.getFieldState(name).error;
    return err ? (
      <p className="text-destructive mt-1 text-xs">{err.message}</p>
    ) : null;
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-6">
      {/* Progreso */}
      <header className="mb-6">
        <div
          className="mb-3 flex gap-1"
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-valuetext={`Paso ${step + 1} de ${STEPS.length}: ${STEPS[step].title}`}
          aria-label="Progreso del onboarding"
        >
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Paso {step + 1} de {STEPS.length}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{STEPS[step].title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{STEPS[step].why}</p>
      </header>

      <form
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (isLast) submit();
          else void next();
        }}
      >
        <div className="flex-1 space-y-5">
          {step === 0 && (
            <>
              <div>
                <Label className="mb-2 block">
                  Sexo (para los cálculos energéticos)
                </Label>
                <ChipGroup
                  label="Sexo para los cálculos energéticos"
                  options={[
                    { value: "MALE", label: "Hombre" },
                    { value: "FEMALE", label: "Mujer" },
                  ]}
                  value={values.sex}
                  onChange={(v) =>
                    form.setValue("sex", v as "MALE" | "FEMALE", {
                      shouldValidate: true,
                    })
                  }
                />
                {error("sex")}
              </div>
              <div>
                <Label htmlFor="birthDate" className="mb-2 block">
                  Fecha de nacimiento
                </Label>
                <Input
                  id="birthDate"
                  type="date"
                  {...form.register("birthDate")}
                />
                {error("birthDate")}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="heightCm" className="mb-2 block">
                    Altura (cm)
                  </Label>
                  <Input
                    id="heightCm"
                    placeholder="178"
                    {...numberField("heightCm")}
                  />
                  {error("heightCm")}
                </div>
                <div>
                  <Label htmlFor="weightKg" className="mb-2 block">
                    Peso actual (kg)
                  </Label>
                  <Input
                    id="weightKg"
                    placeholder="84,0"
                    {...numberField("weightKg", { step: "0.1" })}
                  />
                  {error("weightKg")}
                </div>
              </div>
              <div>
                <Label htmlFor="waistCm" className="mb-2 block">
                  Cintura a la altura del ombligo (cm){" "}
                  <span className="text-muted-foreground">— opcional</span>
                </Label>
                <Input
                  id="waistCm"
                  placeholder="88"
                  {...numberField("waistCm", { step: "0.5" })}
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  Es el mejor indicador barato de pérdida de grasa. Puedes
                  añadirla más adelante.
                </p>
                {error("waistCm")}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <Label htmlFor="trainingYears" className="mb-2 block">
                  Años entrenando fuerza (0 si empiezas)
                </Label>
                <Input
                  id="trainingYears"
                  placeholder="3"
                  {...numberField("trainingYears", { step: "0.5" })}
                />
                {error("trainingYears")}
              </div>
              <div>
                <Label className="mb-2 block">
                  Días que puedes entrenar por semana
                </Label>
                <ChipGroup
                  label="Días que puedes entrenar por semana"
                  columns={3}
                  options={[2, 3, 4, 5, 6].map((d) => ({
                    value: d,
                    label: `${d} días`,
                  }))}
                  value={values.daysPerWeek}
                  onChange={(v) =>
                    form.setValue("daysPerWeek", v as number, {
                      shouldValidate: true,
                    })
                  }
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  Más días no siempre es mejor: cuenta solo los que cumplirás de
                  verdad.
                </p>
                {error("daysPerWeek")}
              </div>
              <div>
                <Label className="mb-2 block">Duración máxima por sesión</Label>
                <ChipGroup
                  label="Duración máxima por sesión"
                  columns={3}
                  options={[45, 60, 75, 90, 120].map((m) => ({
                    value: m,
                    label: `${m} min`,
                  }))}
                  value={values.minutesPerSession}
                  onChange={(v) =>
                    form.setValue("minutesPerSession", v as number, {
                      shouldValidate: true,
                    })
                  }
                />
                {error("minutesPerSession")}
              </div>
            </>
          )}

          {step === 2 && (
            <div>
              <Label className="mb-2 block">
                Marca todo lo que tengas disponible
              </Label>
              <ChipGroup
                label="Equipamiento disponible"
                options={EQUIPMENT_OPTIONS}
                value={values.equipment}
                onChange={(v) =>
                  form.setValue("equipment", v as Equipment[], {
                    shouldValidate: true,
                  })
                }
                multiple
              />
              {error("equipment")}
            </div>
          )}

          {step === 3 && (
            <>
              <div>
                <Label className="mb-2 block">
                  Objetivo principal (podrás cambiarlo)
                </Label>
                <ChipGroup
                  label="Objetivo principal"
                  options={GOAL_OPTIONS}
                  value={values.goalType}
                  onChange={(v) => {
                    form.setValue("goalType", v as GoalType, {
                      shouldValidate: true,
                    });
                    form.setValue("weeklyRatePct", undefined);
                  }}
                />
                {error("goalType")}
              </div>
              {RATE_OPTIONS[values.goalType ?? ""] ? (
                <div>
                  <Label className="mb-2 block">Ritmo deseado</Label>
                  <ChipGroup
                    label="Ritmo deseado"
                    columns={3}
                    options={RATE_OPTIONS[values.goalType!]}
                    value={values.weeklyRatePct}
                    onChange={(v) =>
                      form.setValue("weeklyRatePct", v as number, {
                        shouldValidate: true,
                      })
                    }
                  />
                  <p className="text-muted-foreground mt-1 text-xs">
                    Si no eliges, se usa el estándar. Conservador gana a rápido:
                    lo insostenible no funciona.
                  </p>
                  {error("weeklyRatePct")}
                </div>
              ) : null}
              <div>
                <Label htmlFor="targetWeightKg" className="mb-2 block">
                  Peso objetivo aproximado (kg){" "}
                  <span className="text-muted-foreground">— opcional</span>
                </Label>
                <Input
                  id="targetWeightKg"
                  placeholder="78"
                  {...numberField("targetWeightKg", { step: "0.5" })}
                />
                {error("targetWeightKg")}
              </div>
            </>
          )}

          {step === 4 && (
            <div>
              <Label className="mb-2 block">
                Prioridades extra{" "}
                <span className="text-muted-foreground">
                  — opcional, máx. 6
                </span>
              </Label>
              <p className="text-muted-foreground mb-3 text-xs">
                Deltoide lateral y posterior, dorsal y pecho superior ya son
                prioridad del programa. Lo que marques aquí también se protegerá
                al ajustar el tiempo.
              </p>
              <ChipGroup
                label="Prioridades musculares extra"
                options={PRIORITY_OPTIONS}
                value={values.priorityMuscles}
                onChange={(v) =>
                  form.setValue("priorityMuscles", v as MuscleGroupCode[], {
                    shouldValidate: true,
                  })
                }
                multiple
              />
              {error("priorityMuscles")}
            </div>
          )}

          {step === 5 && (
            <>
              <div>
                <Label htmlFor="dailySteps" className="mb-2 block">
                  Pasos diarios aproximados
                </Label>
                <Input
                  id="dailySteps"
                  placeholder="6000"
                  {...numberField("dailySteps", { step: "500" })}
                />
                {error("dailySteps")}
              </div>
              <div>
                <Label className="mb-2 block">Actividad en tu trabajo</Label>
                <ChipGroup
                  label="Actividad en tu trabajo"
                  options={WORK_ACTIVITY_OPTIONS}
                  value={values.workActivity}
                  onChange={(v) =>
                    form.setValue("workActivity", v as "SEDENTARY", {
                      shouldValidate: true,
                    })
                  }
                />
                {error("workActivity")}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="sleepHoursTypical" className="mb-2 block">
                    Horas de sueño{" "}
                    <span className="text-muted-foreground">(opc.)</span>
                  </Label>
                  <Input
                    id="sleepHoursTypical"
                    placeholder="7,5"
                    {...numberField("sleepHoursTypical", { step: "0.5" })}
                  />
                  {error("sleepHoursTypical")}
                </div>
                <div>
                  <Label htmlFor="mealsPerDay" className="mb-2 block">
                    Comidas al día{" "}
                    <span className="text-muted-foreground">(opc.)</span>
                  </Label>
                  <Input
                    id="mealsPerDay"
                    placeholder="4"
                    {...numberField("mealsPerDay")}
                  />
                  {error("mealsPerDay")}
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Preferencia alimentaria</Label>
                <ChipGroup
                  label="Preferencia alimentaria"
                  options={[
                    { value: "NONE", label: "Sin restricción" },
                    { value: "VEGETARIAN", label: "Vegetariana" },
                    { value: "VEGAN", label: "Vegana" },
                    { value: "OTHER", label: "Otra" },
                  ]}
                  value={values.dietaryPreference}
                  onChange={(v) =>
                    form.setValue("dietaryPreference", v as "NONE", {
                      shouldValidate: true,
                    })
                  }
                />
              </div>
            </>
          )}

          {step === 6 && (
            <>
              <div>
                <Label className="mb-2 block">
                  Zonas con molestias o lesiones{" "}
                  <span className="text-muted-foreground">— opcional</span>
                </Label>
                <p className="text-muted-foreground mb-3 text-xs">
                  No se programarán ejercicios que carguen estas zonas. Esto no
                  sustituye a un profesional sanitario: si hay dolor real,
                  consúltalo.
                </p>
                <ChipGroup
                  label="Zonas con molestias o lesiones"
                  options={CONTRA_OPTIONS}
                  value={values.contraindications}
                  onChange={(v) =>
                    form.setValue(
                      "contraindications",
                      v as Contraindication[],
                      { shouldValidate: true },
                    )
                  }
                  multiple
                />
              </div>
              <div>
                <Label htmlFor="excluded" className="mb-2 block">
                  Ejercicios que no quieres hacer{" "}
                  <span className="text-muted-foreground">— opcional</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="excluded"
                    list="exercise-names"
                    value={excludedDraft}
                    onChange={(e) => setExcludedDraft(e.target.value)}
                    placeholder="Escribe un nombre…"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    onClick={() => {
                      const name = excludedDraft.trim();
                      if (!name) return;
                      const current = values.excludedExerciseNames ?? [];
                      if (!current.includes(name)) {
                        form.setValue("excludedExerciseNames", [
                          ...current,
                          name,
                        ]);
                      }
                      setExcludedDraft("");
                    }}
                  >
                    Añadir
                  </Button>
                </div>
                <datalist id="exercise-names">
                  {exerciseNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(values.excludedExerciseNames ?? []).map((name) => (
                    <button
                      key={name}
                      type="button"
                      aria-label={`Quitar ${name}`}
                      className="border-border bg-card focus-visible:border-ring focus-visible:ring-ring/50 rounded-full border px-3 py-1.5 text-xs focus-visible:ring-3 focus-visible:outline-none"
                      onClick={() =>
                        form.setValue(
                          "excludedExerciseNames",
                          (values.excludedExerciseNames ?? []).filter(
                            (n) => n !== name,
                          ),
                        )
                      }
                    >
                      {name} <span aria-hidden="true">✕</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 7 && (
            <ReviewStep values={values} todayLocalDate={todayLocalDate} />
          )}
        </div>

        {/* Acciones */}
        <div className="mt-8 flex gap-3">
          {step > 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="min-h-12"
              onClick={() => setStep((s) => s - 1)}
              disabled={pending}
            >
              Atrás
            </Button>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="min-h-12 flex-1"
            disabled={pending}
          >
            {isLast
              ? pending
                ? "Creando tu plan…"
                : "Confirmar y crear mi plan"
              : "Continuar"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Paso final: muestra exactamente qué se creará antes de confirmar. */
function ReviewStep({
  values,
  todayLocalDate,
}: {
  values: OnboardingInput;
  todayLocalDate: string;
}) {
  const parsed = onboardingSchema.safeParse(values);
  if (!parsed.success) {
    return (
      <p className="text-destructive text-sm">
        Faltan datos en pasos anteriores: {parsed.error.issues[0]?.message}.
        Vuelve atrás para completarlos.
      </p>
    );
  }
  const data = parsed.data;
  // Misma fecha local que usará el servidor al guardar (no UTC del navegador).
  const today = todayLocalDate;
  const estimate = estimateInitialTargets({
    sex: data.sex,
    ageYears: ageInYears(data.birthDate, today),
    heightCm: data.heightCm,
    weightKg: data.weightKg,
    dailySteps: data.dailySteps,
    workActivity: data.workActivity,
    trainingSessionsPerWeek: data.daysPerWeek,
    minutesPerSession: data.minutesPerSession,
    goalType: data.goalType,
    weeklyRatePct: data.weeklyRatePct,
  });
  const split = splitForDays(data.daysPerWeek);
  const goalLabel =
    GOAL_OPTIONS.find((g) => g.value === data.goalType)?.label ?? data.goalType;

  return (
    <div className="space-y-4">
      <section className="border-border bg-card rounded-lg border p-4">
        <h2 className="text-muted-foreground text-sm font-medium">Objetivo</h2>
        <p className="mt-1 font-medium">{goalLabel}</p>
        <p className="tnum text-muted-foreground text-sm">
          Ritmo: {estimate.weeklyRatePct.toLocaleString("es-ES")} % del
          peso/semana
          {data.targetWeightKg
            ? ` · Peso objetivo ~${data.targetWeightKg} kg`
            : ""}
        </p>
      </section>

      <section className="border-border bg-card rounded-lg border p-4">
        <h2 className="text-muted-foreground text-sm font-medium">
          Nutrición de partida
        </h2>
        <p className="tnum mt-1 text-2xl font-semibold">
          {estimate.kcalTarget.toLocaleString("es-ES")} kcal/día
        </p>
        <p className="tnum text-muted-foreground text-sm">
          {estimate.proteinG} g proteína · {estimate.fatG} g grasa ·{" "}
          {estimate.carbsG} g carbohidratos
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          {estimate.explanations.tdee}
        </p>
        {estimate.clampedToFloor ? (
          <p className="text-warning mt-2 text-xs">
            {estimate.explanations.kcal}
          </p>
        ) : null}
      </section>

      <section className="border-border bg-card rounded-lg border p-4">
        <h2 className="text-muted-foreground text-sm font-medium">
          Programa inicial
        </h2>
        <p className="mt-1 font-medium">{split.label}</p>
        <p className="text-muted-foreground text-sm">
          {split.days.map((d) => d.name).join(" · ")}
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          Es un punto de partida conservador con énfasis en hombros, espalda y
          pecho superior; los motores de progresión lo refinarán con tus datos
          reales.
        </p>
      </section>

      <p className="text-muted-foreground text-xs">
        Todos los datos se guardan únicamente en tu ordenador (SQLite local).
        Nada sale de tu máquina.
      </p>
    </div>
  );
}
