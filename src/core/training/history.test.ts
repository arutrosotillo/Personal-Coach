import { describe, expect, it } from "vitest";

import { estimateOneRepMax } from "./e1rm";
import {
  bestSet,
  currentE1rm,
  trend,
  type HistorySession,
  type HistorySet,
} from "./history";

const set = (
  weightKg: number,
  reps: number,
  rir: number | null,
): HistorySet => ({
  weightKg,
  reps,
  rir,
  estimated1Rm: estimateOneRepMax(weightKg, reps, rir),
});

describe("bestSet", () => {
  it("elige la serie de mayor e1RM~ cuando existe", () => {
    const sessions: HistorySession[] = [
      { localDate: "2026-06-01", sets: [set(80, 8, 2), set(82.5, 6, 1)] },
      { localDate: "2026-06-08", sets: [set(85, 5, 2)] },
    ];
    const best = bestSet(sessions);
    expect(best).not.toBeNull();
    expect(best!.metric).toBe("E1RM");
    // 80×8@2 tiene mayor e1RM~ (~106,7) que 82,5×6@1 (~101,8) y 85×5@2 (~104,8):
    // elige el mejor por e1RM, no el más pesado.
    expect(best!.weightKg).toBe(80);
    expect(best!.reps).toBe(8);
    expect(best!.localDate).toBe("2026-06-01");
  });

  it("cae a tonelaje cuando ninguna serie tiene e1RM~ (reps altas)", () => {
    // reps+rir > 12 → estimated1Rm null en todas.
    const sessions: HistorySession[] = [
      { localDate: "2026-06-01", sets: [set(20, 20, 2), set(22.5, 18, 1)] },
    ];
    const best = bestSet(sessions);
    expect(best!.metric).toBe("TONNAGE");
    // 22.5×18 = 405 > 20×20 = 400.
    expect(best!.weightKg).toBe(22.5);
  });

  it("devuelve null sin sets", () => {
    expect(bestSet([])).toBeNull();
    expect(bestSet([{ localDate: "2026-06-01", sets: [] }])).toBeNull();
  });
});

describe("currentE1rm", () => {
  it("toma el mejor e1RM de la sesión más reciente", () => {
    const sessions: HistorySession[] = [
      { localDate: "2026-06-01", sets: [set(80, 8, 2)] },
      { localDate: "2026-06-08", sets: [set(82.5, 8, 2), set(82.5, 6, 1)] },
    ];
    const e = currentE1rm(sessions);
    expect(e).toBe(estimateOneRepMax(82.5, 8, 2));
  });

  it("null si la última sesión no tiene e1RM~ estimable", () => {
    const sessions: HistorySession[] = [
      { localDate: "2026-06-08", sets: [set(20, 20, 3)] },
    ];
    expect(currentE1rm(sessions)).toBeNull();
  });
});

describe("trend", () => {
  it("<2 sesiones → INSUFFICIENT (nunca concluye por un dato aislado)", () => {
    expect(trend([]).direction).toBe("INSUFFICIENT");
    expect(
      trend([{ localDate: "2026-06-01", sets: [set(80, 8, 2)] }]).direction,
    ).toBe("INSUFFICIENT");
  });

  it("progreso al alza por e1RM~ → UP", () => {
    const t = trend([
      { localDate: "2026-06-01", sets: [set(80, 8, 2)] },
      { localDate: "2026-07-01", sets: [set(85, 8, 2)] },
    ]);
    expect(t.direction).toBe("UP");
    expect(t.metric).toBe("E1RM");
    expect(t.toValue!).toBeGreaterThan(t.fromValue!);
  });

  it("caída → DOWN", () => {
    const t = trend([
      { localDate: "2026-06-01", sets: [set(85, 8, 2)] },
      { localDate: "2026-07-01", sets: [set(80, 8, 2)] },
    ]);
    expect(t.direction).toBe("DOWN");
  });

  it("sin cambio material → FLAT", () => {
    const t = trend([
      { localDate: "2026-06-01", sets: [set(80, 8, 2)] },
      { localDate: "2026-07-01", sets: [set(80, 8, 2)] },
    ]);
    expect(t.direction).toBe("FLAT");
  });

  it("usa tonelaje si algún extremo no tiene e1RM~", () => {
    const t = trend([
      { localDate: "2026-06-01", sets: [set(20, 20, 2)] }, // e1RM null
      { localDate: "2026-07-01", sets: [set(22.5, 20, 2)] }, // e1RM null
    ]);
    expect(t.metric).toBe("TONNAGE");
    expect(t.direction).toBe("UP");
  });
});
