import { describe, expect, it } from "vitest";

import { evaluateCheckIn } from "@/core/body/check-in";
import { classifyGoalChange, resetsTrend } from "@/core/body/goal-change";
import { cm, kg, type BodyMeasurementPoint } from "@/core/body/types";
import { addDays } from "@/core/dates";

const HOY = "2026-09-01";

function medicion(
  localDate: string,
  fields: {
    weightKg?: number;
    waistCm?: number;
    protocol?: "SINGLE" | "MEAN_OF_THREE";
  } = {},
): BodyMeasurementPoint {
  return {
    localDate,
    weightKg: fields.weightKg === undefined ? null : kg(fields.weightKg),
    waistCm: fields.waistCm === undefined ? null : cm(fields.waistCm),
    waistProtocol: fields.protocol ?? null,
    bodyFatPct: null,
    bodyFatReliability: null,
  };
}

describe("cadencia del check-in", () => {
  it("un perfil sin ninguna medición: nunca hecho, y toca hoy", () => {
    const r = evaluateCheckIn([], HOY);
    expect(r.status).toBe("NEVER_DONE");
    expect(r.lastLocalDate).toBeNull();
    expect(r.daysSinceLast).toBeNull();
    // Hoy, no una deuda retroactiva: a quien nunca lo ha hecho no se le
    // presenta un retraso acumulado desde que se dio de alta.
    expect(r.nextDueLocalDate).toBe(HOY);
    expect(r.daysOverdue).toBe(0);
  });

  it("un perfil ANTIGUO con meses de pesajes pero sin cintura sigue siendo NEVER_DONE", () => {
    // El caso que importa para los usuarios que ya existen: B4 no les inventa
    // historial ni les cuenta un retraso de 200 días.
    const pesajes = Array.from({ length: 200 }, (_, i) =>
      medicion(addDays(HOY, -(199 - i)), { weightKg: 84 }),
    );
    const r = evaluateCheckIn(pesajes, HOY);
    expect(r.status).toBe("NEVER_DONE");
    expect(r.daysOverdue).toBe(0);
    expect(r.nextDueLocalDate).toBe(HOY);
  });

  it("recién medida la cintura: todavía no toca", () => {
    const r = evaluateCheckIn([medicion(HOY, { waistCm: 88 })], HOY);
    expect(r.status).toBe("NOT_DUE");
    expect(r.daysSinceLast).toBe(0);
    expect(r.daysUntilDue).toBe(14);
    expect(r.nextDueLocalDate).toBe(addDays(HOY, 14));
  });

  it("a los 13 días todavía no toca; a los 14 sí", () => {
    const trece = evaluateCheckIn(
      [medicion(addDays(HOY, -13), { waistCm: 88 })],
      HOY,
    );
    expect(trece.status).toBe("NOT_DUE");
    expect(trece.daysUntilDue).toBe(1);

    const catorce = evaluateCheckIn(
      [medicion(addDays(HOY, -14), { waistCm: 88 })],
      HOY,
    );
    expect(catorce.status).toBe("DUE");
    expect(catorce.daysUntilDue).toBe(0);
    expect(catorce.daysOverdue).toBe(0);
  });

  it("vencido: cuenta los días de retraso", () => {
    const r = evaluateCheckIn(
      [medicion(addDays(HOY, -25), { waistCm: 88 })],
      HOY,
    );
    expect(r.status).toBe("DUE");
    expect(r.daysSinceLast).toBe(25);
    expect(r.daysOverdue).toBe(11);
  });

  it("los pesajes sueltos NO cuentan como check-in", () => {
    // Un check-in ES una medición de cintura. Pesarse todos los días no
    // sustituye a medirse.
    const puntos = [
      medicion(addDays(HOY, -20), { waistCm: 88 }),
      ...Array.from({ length: 20 }, (_, i) =>
        medicion(addDays(HOY, -(19 - i)), { weightKg: 84 }),
      ),
    ];
    const r = evaluateCheckIn(puntos, HOY);
    expect(r.status).toBe("DUE");
    expect(r.lastLocalDate).toBe(addDays(HOY, -20));
  });

  it("se queda con la cintura MÁS RECIENTE, llegue en el orden que llegue", () => {
    const desordenadas = [
      medicion(addDays(HOY, -30), { waistCm: 92 }),
      medicion(addDays(HOY, -3), { waistCm: 88, protocol: "MEAN_OF_THREE" }),
      medicion(addDays(HOY, -60), { waistCm: 95 }),
    ];
    const r = evaluateCheckIn(desordenadas, HOY);
    expect(r.lastLocalDate).toBe(addDays(HOY, -3));
    expect(r.lastProtocol).toBe("MEAN_OF_THREE");
    expect(r.status).toBe("NOT_DUE");
  });

  it("una medición del futuro no adelanta el reloj", () => {
    const r = evaluateCheckIn(
      [
        medicion(addDays(HOY, -20), { waistCm: 88 }),
        medicion(addDays(HOY, 5), { waistCm: 86 }),
      ],
      HOY,
    );
    expect(r.status).toBe("DUE");
    expect(r.lastLocalDate).toBe(addDays(HOY, -20));
  });

  it("no lee el reloj del sistema: mismo input, mismo resultado", () => {
    const puntos = [medicion(addDays(HOY, -7), { waistCm: 88 })];
    expect(evaluateCheckIn(puntos, HOY)).toEqual(evaluateCheckIn(puntos, HOY));
    // Y con otra fecha de corte, otro resultado: la fecha manda de verdad.
    expect(evaluateCheckIn(puntos, addDays(HOY, 10)).status).toBe("DUE");
  });
});

describe("editar el objetivo vs empezar una fase nueva", () => {
  const actual = {
    strategy: "FAT_LOSS_MUSCLE_PRESERVATION" as const,
    weeklyRatePct: -0.5,
    targetWeightKg: 78,
  };

  it("no tocar nada no es un cambio", () => {
    expect(classifyGoalChange(actual, { ...actual })).toBe("NO_CHANGE");
  });

  it("cambiar SOLO el peso objetivo se corrige en sitio", () => {
    // 78 → 77 kg. Sigue siendo la misma definición: el historial describe
    // exactamente lo mismo y solo se mueve la meta.
    const kind = classifyGoalChange(actual, { ...actual, targetWeightKg: 77 });
    expect(kind).toBe("EDIT_IN_PLACE");
    expect(resetsTrend(kind)).toBe(false);
  });

  it("cambiar SOLO el ritmo se corrige en sitio", () => {
    // −0,5 → −0,75 %/semana: la misma fase, algo más rápido. La dirección no
    // cambia, así que los pesajes de las últimas semanas siguen siendo
    // pertinentes; lo único que se mueve es el listón de comparación.
    const kind = classifyGoalChange(actual, {
      ...actual,
      weeklyRatePct: -0.75,
    });
    expect(kind).toBe("EDIT_IN_PLACE");
    expect(resetsTrend(kind)).toBe(false);
  });

  it("cambiar ritmo Y objetivo, con la misma estrategia, sigue siendo edición", () => {
    expect(
      classifyGoalChange(actual, {
        ...actual,
        weeklyRatePct: -0.25,
        targetWeightKg: 80,
      }),
    ).toBe("EDIT_IN_PLACE");
  });

  it("FAT_LOSS → MAINTENANCE abre una fase nueva", () => {
    const kind = classifyGoalChange(actual, {
      strategy: "MAINTENANCE",
      weeklyRatePct: 0,
      targetWeightKg: null,
    });
    expect(kind).toBe("NEW_PHASE");
    expect(resetsTrend(kind)).toBe(true);
  });

  it("FAT_LOSS → LEAN_GAIN abre una fase nueva", () => {
    // El caso más claro: se invierte la dirección. Los kilos que bajaste el
    // mes pasado no dicen nada sobre cómo va el volumen que empieza hoy.
    const kind = classifyGoalChange(actual, {
      strategy: "LEAN_GAIN",
      weeklyRatePct: 0.15,
      targetWeightKg: null,
    });
    expect(kind).toBe("NEW_PHASE");
    expect(resetsTrend(kind)).toBe(true);
  });

  it("la estrategia manda por encima del resto: aunque el ritmo coincida", () => {
    // RECOMP y MAINTENANCE tienen las dos ritmo 0, pero son intenciones
    // distintas y cada una abre su fase.
    expect(
      classifyGoalChange(
        {
          strategy: "RECOMP_MAINTAIN_WEIGHT",
          weeklyRatePct: 0,
          targetWeightKg: null,
        },
        { strategy: "MAINTENANCE", weeklyRatePct: 0, targetWeightKg: null },
      ),
    ).toBe("NEW_PHASE");
  });

  it("quitar el peso objetivo es una edición, no una fase nueva", () => {
    expect(
      classifyGoalChange(actual, { ...actual, targetWeightKg: null }),
    ).toBe("EDIT_IN_PLACE");
  });
});
