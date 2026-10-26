import { describe, expect, it } from "vitest";

import {
  CYCLE_ORDER,
  cycleName,
  cycleStatusLabel,
  formatDuration,
  formatKcal,
  formatRatePct,
  rateText,
} from "@/lib/cycle-labels";

describe("cycle-labels", () => {
  it("todas las estrategias aparecen una vez en el selector", () => {
    expect(new Set(CYCLE_ORDER).size).toBe(4);
  });

  it("nombres y estados en palabras; un estado desconocido no rompe", () => {
    expect(cycleName("LEAN_GAIN")).toBe("Volumen limpio");
    expect(cycleName(null)).toBe("Ciclo");
    expect(cycleStatusLabel("ABANDONED")).toBe("Sin completar");
    expect(cycleStatusLabel("RARO")).toBe("RARO");
  });

  it("ritmos con signo tipográfico y coma decimal", () => {
    expect(formatRatePct(0.15)).toBe("+0,15 %");
    expect(formatRatePct(-0.5)).toBe("−0,5 %");
    expect(formatRatePct(0)).toBe("0 %");
    expect(rateText("LEAN_GAIN", 0.1)).toBe("+0,1 % de tu peso por semana");
    expect(rateText("MAINTENANCE", 0)).toContain("±1 %");
    expect(rateText("RECOMP_MAINTAIN_WEIGHT", 0)).toContain("cintura");
  });

  it("duraciones legibles", () => {
    expect(formatDuration(5)).toBe("5 días");
    expect(formatDuration(7)).toBe("1 semana");
    expect(formatDuration(120)).toBe("17 semanas y 1 día");
    expect(formatDuration(23)).toBe("3 semanas y 2 días");
  });

  it("kcal con separador de miles", () => {
    expect(formatKcal(2150.4)).toBe("2150");
    expect(formatKcal(12000)).toBe("12.000");
  });
});
