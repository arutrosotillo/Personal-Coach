import { describe, expect, it } from "vitest";

import { TARGET_RIR } from "@/core/config/training-config";
import { defaultTargetRir } from "./prescription-defaults";

describe("defaultTargetRir — RIR por rol", () => {
  it("aislamiento (patrón no compuesto) → RIR de aislamiento", () => {
    expect(defaultTargetRir("ISOLATION_CURL", 1)).toBe(TARGET_RIR.isolation);
    expect(defaultTargetRir("LATERAL_RAISE", 3)).toBe(TARGET_RIR.isolation);
  });

  it("compuesto ligero (systemicFatigue < 3) → RIR de compuesto", () => {
    expect(defaultTargetRir("HORIZONTAL_PUSH", 2)).toBe(TARGET_RIR.compound);
    expect(defaultTargetRir("VERTICAL_PULL", 1)).toBe(TARGET_RIR.compound);
  });

  it("compuesto pesado (systemicFatigue ≥ 3) → RIR de compuesto pesado", () => {
    expect(defaultTargetRir("SQUAT", 3)).toBe(TARGET_RIR.compoundHeavy);
    expect(defaultTargetRir("HINGE", 3)).toBe(TARGET_RIR.compoundHeavy);
  });

  it("los tres roles son distintos y ordenados (aisl < comp < pesado)", () => {
    expect(TARGET_RIR.isolation).toBeLessThan(TARGET_RIR.compound);
    expect(TARGET_RIR.compound).toBeLessThan(TARGET_RIR.compoundHeavy);
  });
});
