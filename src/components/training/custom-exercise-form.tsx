"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { MUSCLE_GROUPS } from "@/core/catalog/muscle-groups";
import type {
  Contraindication,
  Equipment,
  MovementPattern,
  MuscleGroupCode,
} from "@/core/enums";
import {
  MAX_SECONDARY_MUSCLES,
  SECONDARY_FACTORS,
  type SecondaryFactor,
} from "@/core/schemas/custom-exercise";
import { createCustomExerciseAction } from "@/server/actions/exercise.action";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  BARBELL: "Barra",
  EZ_BAR: "Barra EZ",
  DUMBBELL: "Mancuernas",
  MACHINE: "Máquina",
  SMITH_MACHINE: "Multipower",
  CABLE: "Polea",
  BODYWEIGHT: "Peso corporal",
  BAND: "Banda",
};

const PATTERN_LABELS: Record<MovementPattern, string> = {
  HORIZONTAL_PUSH: "Empuje horizontal",
  VERTICAL_PUSH: "Empuje vertical",
  HORIZONTAL_PULL: "Tirón horizontal",
  VERTICAL_PULL: "Tirón vertical",
  SQUAT: "Dominante de rodilla",
  HINGE: "Bisagra de cadera",
  LUNGE: "Zancada",
  ISOLATION: "Aislamiento",
  CORE: "Core",
};

const CONTRA_LABELS: Record<Contraindication, string> = {
  SHOULDER: "Hombro",
  ELBOW: "Codo",
  WRIST: "Muñeca",
  LOWER_BACK: "Lumbar",
  HIP: "Cadera",
  KNEE: "Rodilla",
  ANKLE: "Tobillo",
};

/**
 * Exigencia sistémica en lenguaje de gimnasio. El número (1..3) decide el RIR
 * por defecto y el coste en minutos por serie, así que se explica con ejemplos
 * concretos en vez de pedir "fatiga sistémica del 1 al 3".
 */
const FATIGUE_OPTIONS: Array<{
  value: 1 | 2 | 3;
  label: string;
  hint: string;
}> = [
  { value: 1, label: "Ligera", hint: "Aislamientos, poleas, máquinas" },
  { value: 2, label: "Media", hint: "Press banca, dominadas, prensa" },
  { value: 3, label: "Alta", hint: "Sentadilla, peso muerto, remo con barra" },
];

interface FormState {
  name: string;
  movementPattern: MovementPattern;
  systemicFatigue: 1 | 2 | 3;
  instructions: string;
  primaryMuscle: MuscleGroupCode;
  secondaryMuscles: Array<{ group: MuscleGroupCode; factor: SecondaryFactor }>;
  variantName: string;
  equipment: Equipment;
  loadStepKg: string;
  repRangeMin: string;
  repRangeMax: string;
  restSeconds: string;
  contraindications: Contraindication[];
}

const INITIAL: FormState = {
  name: "",
  movementPattern: "ISOLATION",
  systemicFatigue: 1,
  instructions: "",
  primaryMuscle: "PECHO_MEDIO_INFERIOR",
  secondaryMuscles: [],
  variantName: "Máquina",
  equipment: "MACHINE",
  loadStepKg: "5",
  repRangeMin: "8",
  repRangeMax: "12",
  restSeconds: "90",
  contraindications: [],
};

/**
 * Alta de un ejercicio propio del banco.
 *
 * Pide más de lo que parece necesario a propósito: sin músculo principal el
 * conteo de volumen no puede contarlo, sin patrón e intensidad no hay RIR por
 * defecto, y sin incremento real de carga el motor de progresión sugeriría
 * kilos que no existen en el gimnasio.
 */
export function CustomExerciseForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function toggleSecondary(group: MuscleGroupCode) {
    setForm((f) => {
      const existing = f.secondaryMuscles.find((m) => m.group === group);
      if (existing) {
        return {
          ...f,
          secondaryMuscles: f.secondaryMuscles.filter((m) => m.group !== group),
        };
      }
      if (f.secondaryMuscles.length >= MAX_SECONDARY_MUSCLES) return f;
      return {
        ...f,
        secondaryMuscles: [...f.secondaryMuscles, { group, factor: 0.5 }],
      };
    });
  }

  function setSecondaryFactor(group: MuscleGroupCode, factor: SecondaryFactor) {
    setForm((f) => ({
      ...f,
      secondaryMuscles: f.secondaryMuscles.map((m) =>
        m.group === group ? { ...m, factor } : m,
      ),
    }));
  }

  function toggleContra(c: Contraindication) {
    setForm((f) => ({
      ...f,
      contraindications: f.contraindications.includes(c)
        ? f.contraindications.filter((x) => x !== c)
        : [...f.contraindications, c],
    }));
  }

  async function submit() {
    setSaving(true);
    try {
      const result = await createCustomExerciseAction({
        name: form.name,
        movementPattern: form.movementPattern,
        systemicFatigue: form.systemicFatigue,
        instructions: form.instructions.trim() || undefined,
        primaryMuscle: form.primaryMuscle,
        secondaryMuscles: form.secondaryMuscles,
        variantName: form.variantName,
        equipment: form.equipment,
        loadStepKg: Number(form.loadStepKg.replace(",", ".")),
        repRangeMin: Number(form.repRangeMin),
        repRangeMax: Number(form.repRangeMax),
        restSeconds: Number(form.restSeconds),
        contraindications: form.contraindications,
      });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo crear el ejercicio.");
        return;
      }
      toast.success(`"${form.name}" añadido a tu banco.`);
      setForm(INITIAL);
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="min-h-9"
        onClick={() => setOpen(true)}
      >
        Añadir ejercicio
      </Button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader className="flex flex-row items-center justify-between gap-2">
            <DrawerTitle>Nuevo ejercicio</DrawerTitle>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-9"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
          </DrawerHeader>

          <div className="space-y-5 overflow-y-auto px-4 pb-4">
            <p className="text-muted-foreground text-xs">
              Se añade solo a tu banco. El músculo principal y la intensidad no
              son decorativos: con ellos se cuenta tu volumen semanal y se
              calcula el RIR por defecto.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="ce-name">Nombre</Label>
              <Input
                id="ce-name"
                value={form.name}
                maxLength={60}
                placeholder="Remo en máquina Hammer"
                onChange={(e) => set("name", e.target.value)}
              />
            </div>

            <Field label="Músculo principal">
              <ChipGrid>
                {MUSCLE_GROUPS.map((g) => (
                  <Chip
                    key={g.code}
                    active={form.primaryMuscle === g.code}
                    onClick={() => set("primaryMuscle", g.code)}
                  >
                    {g.nameEs}
                  </Chip>
                ))}
              </ChipGrid>
            </Field>

            <Field
              label="Músculos secundarios"
              hint={`Opcional, máximo ${MAX_SECONDARY_MUSCLES}. Cuentan como volumen parcial.`}
            >
              <ChipGrid>
                {MUSCLE_GROUPS.filter((g) => g.code !== form.primaryMuscle).map(
                  (g) => {
                    const sel = form.secondaryMuscles.find(
                      (m) => m.group === g.code,
                    );
                    return (
                      <Chip
                        key={g.code}
                        active={Boolean(sel)}
                        onClick={() => toggleSecondary(g.code)}
                      >
                        {g.nameEs}
                      </Chip>
                    );
                  },
                )}
              </ChipGrid>
              {form.secondaryMuscles.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {form.secondaryMuscles.map((m) => (
                    <li
                      key={m.group}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-sm">
                        {MUSCLE_GROUPS.find((g) => g.code === m.group)?.nameEs}
                      </span>
                      <span className="flex gap-1.5">
                        {SECONDARY_FACTORS.map((f) => (
                          <Chip
                            key={f}
                            active={m.factor === f}
                            onClick={() => setSecondaryFactor(m.group, f)}
                          >
                            {f === 0.75 ? "Alto" : f === 0.5 ? "Medio" : "Bajo"}
                          </Chip>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Field>

            <Field label="Patrón de movimiento">
              <ChipGrid>
                {(Object.keys(PATTERN_LABELS) as MovementPattern[]).map((p) => (
                  <Chip
                    key={p}
                    active={form.movementPattern === p}
                    onClick={() => set("movementPattern", p)}
                  >
                    {PATTERN_LABELS[p]}
                  </Chip>
                ))}
              </ChipGrid>
            </Field>

            <Field
              label="Exigencia"
              hint="Cuánto te cuesta recuperarte de una serie, no cuánto arde."
            >
              <div className="flex flex-col gap-1.5">
                {FATIGUE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={form.systemicFatigue === o.value}
                    onClick={() => set("systemicFatigue", o.value)}
                    className={cn(
                      "focus-visible:ring-ring/50 min-h-11 rounded-lg border px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none",
                      form.systemicFatigue === o.value
                        ? "border-primary bg-primary/15"
                        : "border-border bg-card",
                    )}
                  >
                    <span className="text-sm font-medium">{o.label}</span>
                    <span className="text-muted-foreground block text-xs">
                      {o.hint}
                    </span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Equipamiento">
              <ChipGrid>
                {(Object.keys(EQUIPMENT_LABELS) as Equipment[]).map((eq) => (
                  <Chip
                    key={eq}
                    active={form.equipment === eq}
                    onClick={() => set("equipment", eq)}
                  >
                    {EQUIPMENT_LABELS[eq]}
                  </Chip>
                ))}
              </ChipGrid>
            </Field>

            <div className="space-y-1.5">
              <Label htmlFor="ce-variant">Nombre de la variante</Label>
              <Input
                id="ce-variant"
                value={form.variantName}
                maxLength={40}
                placeholder="Máquina"
                onChange={(e) => set("variantName", e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ce-min">Reps mínimas</Label>
                <Input
                  id="ce-min"
                  inputMode="numeric"
                  value={form.repRangeMin}
                  onChange={(e) => set("repRangeMin", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-max">Reps máximas</Label>
                <Input
                  id="ce-max"
                  inputMode="numeric"
                  value={form.repRangeMax}
                  onChange={(e) => set("repRangeMax", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-step">Incremento (kg)</Label>
                <Input
                  id="ce-step"
                  inputMode="decimal"
                  value={form.loadStepKg}
                  onChange={(e) => set("loadStepKg", e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  El salto real del material. 0 si no lleva peso.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-rest">Descanso (s)</Label>
                <Input
                  id="ce-rest"
                  inputMode="numeric"
                  value={form.restSeconds}
                  onChange={(e) => set("restSeconds", e.target.value)}
                />
              </div>
            </div>

            <Field
              label="Contraindicaciones"
              hint="Si marcas una, el generador no te lo propondrá con esa lesión."
            >
              <ChipGrid>
                {(Object.keys(CONTRA_LABELS) as Contraindication[]).map((c) => (
                  <Chip
                    key={c}
                    active={form.contraindications.includes(c)}
                    onClick={() => toggleContra(c)}
                  >
                    {CONTRA_LABELS[c]}
                  </Chip>
                ))}
              </ChipGrid>
            </Field>

            <div className="space-y-1.5">
              <Label htmlFor="ce-instr">Notas de ejecución (opcional)</Label>
              <Input
                id="ce-instr"
                value={form.instructions}
                maxLength={400}
                placeholder="Asiento en el 4, agarre neutro"
                onChange={(e) => set("instructions", e.target.value)}
              />
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={saving || form.name.trim().length < 3}
              onClick={submit}
            >
              {saving ? "Guardando…" : "Añadir a mi banco"}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{label}</p>
      {hint ? (
        <p className="text-muted-foreground mb-1.5 text-xs">{hint}</p>
      ) : null}
      {children}
    </div>
  );
}

function ChipGrid({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring/50 min-h-8 rounded-full border px-2.5 py-1 text-xs focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border bg-card text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
