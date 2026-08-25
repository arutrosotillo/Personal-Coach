import { describe, expect, it } from "vitest";

import {
  addDays,
  ageInYears,
  diffDays,
  isLocalDate,
  isoWeekOf,
  toLocalDate,
  weekIndexSince,
} from "@/core/dates";

const MADRID = "Europe/Madrid";
const LA = "America/Los_Angeles";

describe("toLocalDate — el día del usuario depende de su timezone", () => {
  it("un registro a las 23:30 UTC del día 14 en Madrid (verano, UTC+2) cae en el día 15", () => {
    const instant = new Date("2026-07-14T23:30:00Z");
    expect(toLocalDate(instant, MADRID)).toBe("2026-07-15");
    expect(toLocalDate(instant, LA)).toBe("2026-07-14");
  });

  it("medianoche local: 22:00 UTC en invierno (UTC+1) aún es el mismo día; 23:30 ya es el siguiente", () => {
    expect(toLocalDate(new Date("2026-01-10T22:00:00Z"), MADRID)).toBe(
      "2026-01-10",
    );
    expect(toLocalDate(new Date("2026-01-10T23:30:00Z"), MADRID)).toBe(
      "2026-01-11",
    );
  });

  it("cambio de hora de marzo (DST): el día local se calcula bien en la transición", () => {
    // 29-mar-2026 a las 01:30 UTC = 03:30 en Madrid (ya en horario de verano)
    expect(toLocalDate(new Date("2026-03-29T01:30:00Z"), MADRID)).toBe(
      "2026-03-29",
    );
    // 25-oct-2026 a las 00:30 UTC = 02:30 en Madrid (vuelta a invierno, hora repetida)
    expect(toLocalDate(new Date("2026-10-25T00:30:00Z"), MADRID)).toBe(
      "2026-10-25",
    );
  });
});

describe("isLocalDate", () => {
  it.each(["2026-07-14", "2024-02-29"])("acepta %s", (d) => {
    expect(isLocalDate(d)).toBe(true);
  });
  it.each([
    "2026-13-01",
    "2026-02-30",
    "2025-02-29",
    "14/07/2026",
    "2026-7-4",
    "",
  ])("rechaza %s", (d) => {
    expect(isLocalDate(d)).toBe(false);
  });
});

describe("aritmética de fechas de calendario", () => {
  it("addDays cruza meses y años", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("diffDays", () => {
    expect(diffDays("2026-07-01", "2026-07-15")).toBe(14);
    expect(diffDays("2026-07-15", "2026-07-01")).toBe(-14);
  });
});

describe("ageInYears", () => {
  it("cuenta años cumplidos, no aproximados", () => {
    expect(ageInYears("1992-07-15", "2026-07-14")).toBe(33); // cumple mañana
    expect(ageInYears("1992-07-14", "2026-07-14")).toBe(34); // cumple hoy
  });
});

describe("isoWeekOf", () => {
  it("calcula semana ISO y lunes de la semana", () => {
    // 2026-01-01 es jueves → semana ISO 1 de 2026, lunes 2025-12-29
    expect(isoWeekOf("2026-01-01")).toEqual({
      isoYear: 2026,
      isoWeek: 1,
      weekStartDate: "2025-12-29",
    });
    // 2026-07-14 es martes → semana 29, lunes 13-jul
    expect(isoWeekOf("2026-07-14")).toEqual({
      isoYear: 2026,
      isoWeek: 29,
      weekStartDate: "2026-07-13",
    });
  });

  it("los 7 días de una semana comparten isoWeek (incluida la semana con cambio de hora)", () => {
    // Semana del 23 al 29 de marzo de 2026 (DST el domingo 29)
    const days = Array.from({ length: 7 }, (_, i) => addDays("2026-03-23", i));
    const weeks = new Set(
      days.map((d) => `${isoWeekOf(d).isoYear}-${isoWeekOf(d).isoWeek}`),
    );
    expect(weeks.size).toBe(1);
  });
});

describe("weekIndexSince — la semana del programa sale de las fechas", () => {
  it("la primera semana es la 1", () => {
    expect(weekIndexSince("2026-06-01", "2026-06-01")).toBe(1);
    expect(weekIndexSince("2026-06-01", "2026-06-07")).toBe(1);
  });

  it("cambia de semana el LUNES, no a los 7 días del inicio", () => {
    // Empezar un jueves y llegar al lunes siguiente ya es la semana 2, aunque
    // solo hayan pasado 4 días: para el usuario "esta semana" es de lunes a
    // domingo.
    expect(weekIndexSince("2026-06-04", "2026-06-07")).toBe(1); // jue → dom
    expect(weekIndexSince("2026-06-04", "2026-06-08")).toBe(2); // jue → lun
  });

  it("cuenta semanas de calendario a largo plazo", () => {
    expect(weekIndexSince("2026-06-01", "2026-06-08")).toBe(2);
    expect(weekIndexSince("2026-06-01", "2026-07-06")).toBe(6);
  });

  it("no se rompe al cruzar el año", () => {
    expect(weekIndexSince("2026-12-28", "2027-01-04")).toBe(2);
  });
});
