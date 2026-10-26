"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatKcal } from "@/lib/cycle-labels";
import {
  clearIntakeAction,
  saveIntakeAction,
} from "@/server/actions/intake.action";

/**
 * Lo que has comido hoy (o ayer), en totales: kcal y, si quieres, proteína.
 *
 * OPCIONAL de verdad: la app funciona entera sin esto. Lo que aporta es que el
 * mantenimiento se calcule con lo COMIDO en vez de suponer que comiste tu
 * objetivo, y que el ajuste no suba un número que no estás comiendo. Por eso
 * el texto lo dice así, sin rachas ni recordatorios.
 *
 * "Ayer" porque mucha gente lo apunta por la mañana: obligar a hacerlo antes
 * de dormir es la forma más rápida de que deje de hacerse.
 */

interface DayEntry {
  localDate: string;
  kcal: number;
  proteinG: number | null;
}

const parseIntOrNull = (value: string): number | null => {
  const digits = value.replace(/[^\d]/g, "");
  return digits === "" ? null : Number(digits);
};

export function IntakeCard({
  todayLocalDate,
  yesterdayLocalDate,
  today,
  yesterday,
  targetKcal,
  targetProteinG,
}: {
  todayLocalDate: string;
  yesterdayLocalDate: string;
  today: DayEntry | null;
  yesterday: DayEntry | null;
  targetKcal: number | null;
  targetProteinG: number | null;
}) {
  const [day, setDay] = useState<"today" | "yesterday">("today");
  const [saved, setSaved] = useState({ today, yesterday });
  const current = saved[day];
  const localDate = day === "today" ? todayLocalDate : yesterdayLocalDate;
  const [kcal, setKcal] = useState(current ? String(current.kcal) : "");
  const [protein, setProtein] = useState(
    current?.proteinG != null ? String(current.proteinG) : "",
  );
  const [editing, setEditing] = useState(current === null);
  const [pending, startTransition] = useTransition();

  function switchDay(next: "today" | "yesterday") {
    const entry = saved[next];
    setDay(next);
    setKcal(entry ? String(entry.kcal) : "");
    setProtein(entry?.proteinG != null ? String(entry.proteinG) : "");
    setEditing(entry === null);
  }

  function save() {
    const kcalValue = parseIntOrNull(kcal);
    if (kcalValue === null) {
      toast.error("Escribe las kcal del día.");
      return;
    }
    const proteinValue = parseIntOrNull(protein);
    startTransition(async () => {
      const result = await saveIntakeAction({
        localDate,
        kcal: kcalValue,
        proteinG: proteinValue,
      });
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo guardar.");
        return;
      }
      setSaved((s) => ({
        ...s,
        [day]: { localDate, kcal: kcalValue, proteinG: proteinValue },
      }));
      setEditing(false);
      toast.success(
        `${day === "today" ? "Hoy" : "Ayer"}: ${formatKcal(kcalValue)} kcal guardadas.`,
      );
    });
  }

  function clear() {
    startTransition(async () => {
      const result = await clearIntakeAction(localDate);
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo borrar.");
        return;
      }
      setSaved((s) => ({ ...s, [day]: null }));
      setKcal("");
      setProtein("");
      setEditing(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>Lo que has comido</span>
          <span
            role="group"
            aria-label="Día"
            className="bg-muted inline-flex rounded-md p-0.5 text-xs font-normal"
          >
            {(["today", "yesterday"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={day === d}
                disabled={pending}
                onClick={() => switchDay(d)}
                className={`min-h-9 rounded px-3 ${day === d ? "bg-background text-foreground" : "text-muted-foreground"}`}
              >
                {d === "today" ? "Hoy" : "Ayer"}
              </button>
            ))}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!editing && current ? (
          <div className="flex items-center justify-between gap-4">
            <p className="tnum">
              <span className="text-2xl font-semibold">
                {formatKcal(current.kcal)}
              </span>{" "}
              <span className="text-muted-foreground">kcal</span>
              {current.proteinG !== null ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {current.proteinG} g proteína
                </span>
              ) : null}
            </p>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={pending}
                onClick={() => setEditing(true)}
              >
                Corregir
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                disabled={pending}
                onClick={clear}
              >
                Borrar
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <div>
              <Label htmlFor="intake-kcal" className="mb-1 block text-xs">
                kcal del día
              </Label>
              <Input
                id="intake-kcal"
                inputMode="numeric"
                type="text"
                autoComplete="off"
                placeholder={targetKcal ? formatKcal(targetKcal) : "2.200"}
                value={kcal}
                disabled={pending}
                onChange={(e) => setKcal(e.target.value)}
                className="tnum min-h-11"
              />
            </div>
            <div>
              <Label htmlFor="intake-protein" className="mb-1 block text-xs">
                Proteína (g){" "}
                <span className="text-muted-foreground font-normal">
                  — opcional
                </span>
              </Label>
              <Input
                id="intake-protein"
                inputMode="numeric"
                type="text"
                autoComplete="off"
                placeholder={targetProteinG ? String(targetProteinG) : "150"}
                value={protein}
                disabled={pending}
                onChange={(e) => setProtein(e.target.value)}
                className="tnum min-h-11"
              />
            </div>
            <Button
              type="button"
              className="min-h-11"
              disabled={pending || kcal.trim() === ""}
              onClick={save}
            >
              Anotar
            </Button>
          </div>
        )}
        <p className="text-muted-foreground text-xs">
          {targetKcal !== null
            ? `Tu objetivo: ${formatKcal(targetKcal)} kcal${targetProteinG ? ` y ${targetProteinG} g de proteína` : ""}. `
            : ""}
          Opcional. Con unas semanas de registro, tu mantenimiento se calcula
          con lo que comes de verdad y no con tu objetivo.
        </p>
      </CardContent>
    </Card>
  );
}
