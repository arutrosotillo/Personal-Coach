import { describe, expect, it } from "vitest";

import { manualExerciseSchema } from "@/core/schemas/manual-program";
import { suggestProgression } from "@/core/training/progression";
import {
  formatTargetRir,
  isValidRirRange,
  isWithinTargetRir,
} from "@/core/training/rir-target";

/** Cierra el rango de 8–12 a 50 kg con el RIR dado, dos series de tres en el techo. */
function closeRangeAt(rir: number, targetRir: number) {
  return suggestProgression({
    prescription: {
      repRangeMin: 8,
      repRangeMax: 12,
      targetRir,
      loadStepKg: 2.5,
      plannedSets: 3,
    },
    history: [
      {
        localDate: "2026-11-01",
        sets: [1, 2, 3].map(() => ({ weightKg: 50, reps: 12, rir })),
      },
    ],
    todayLocalDate: "2026-11-06",
  });
}

describe("rango de RIR", () => {
  it("se enseña tal cual se escribió, y sin rango como un número", () => {
    expect(formatTargetRir(2, 1)).toBe("1–2");
    expect(formatTargetRir(3, 2)).toBe("2–3");
    expect(formatTargetRir(1, 0)).toBe("0–1");
    expect(formatTargetRir(1, null)).toBe("1");
    // Una sesión guardada en el móvil antes de que existiera el campo.
    expect(formatTargetRir(1, undefined)).toBe("1");
  });

  it("solo admite rangos de un punto: los que el motor hace cumplir", () => {
    expect(isValidRirRange(2, 1)).toBe(true);
    expect(isValidRirRange(2, null)).toBe(true);
    expect(isValidRirRange(3, 1)).toBe(false);
    expect(isValidRirRange(2, 2)).toBe(false);
    expect(isValidRirRange(1, 2)).toBe(false);

    const base = {
      exerciseVariantId: "v",
      baseSets: 3,
      repRangeMin: 5,
      repRangeMax: 10,
      restSeconds: 120,
    };
    expect(
      manualExerciseSchema.safeParse({ ...base, targetRir: 2, targetRirMin: 1 })
        .success,
    ).toBe(true);
    expect(
      manualExerciseSchema.safeParse({ ...base, targetRir: 3, targetRirMin: 1 })
        .success,
    ).toBe(false);
    expect(
      manualExerciseSchema.safeParse({ ...base, targetRir: 1 }).success,
    ).toBe(true);
  });

  it("isWithinTargetRir respeta el rango y, sin él, el valor exacto", () => {
    expect(isWithinTargetRir(1, 2, 1)).toBe(true);
    expect(isWithinTargetRir(2, 2, 1)).toBe(true);
    expect(isWithinTargetRir(0, 2, 1)).toBe(false);
    expect(isWithinTargetRir(3, 2, 1)).toBe(false);
    expect(isWithinTargetRir(2, 2, null)).toBe(true);
    expect(isWithinTargetRir(1, 2, null)).toBe(false);
  });

  describe("el motor hace cumplir el rango guardando el extremo superior", () => {
    it("1–2: cerrar el rango con RIR 1 sube la carga", () => {
      const s = closeRangeAt(1, 2);
      expect(s.action).toBe("INCREASE_LOAD");
      expect(s.reasonCode).toBe("RANGE_CLOSED");
    });

    it("1–2: cerrar el rango al fallo frena y pide consolidar", () => {
      const s = closeRangeAt(0, 2);
      expect(s.action).toBe("HOLD");
      expect(s.reasonCode).toBe("CLOSED_RANGE_AT_FAILURE");
      expect(s.explanation).toContain("llegaste al fallo");
    });

    it("2–3: cerrar el rango con RIR 2 sube; con RIR 1 frena", () => {
      expect(closeRangeAt(2, 3).action).toBe("INCREASE_LOAD");
      const dura = closeRangeAt(1, 3);
      expect(dura.action).toBe("HOLD");
      expect(dura.reasonCode).toBe("CLOSED_RANGE_AT_FAILURE");
    });

    it("0–1: el fallo está dentro del objetivo y no frena", () => {
      const s = closeRangeAt(0, 1);
      expect(s.action).toBe("INCREASE_LOAD");
      expect(s.reasonCode).toBe("RANGE_CLOSED");
    });

    it("control: guardar el extremo INFERIOR de 1–2 quitaría el freno", () => {
      // Por eso `targetRir` es el superior: con objetivo 1 llegar al fallo en un
      // básico pasaría sin que el motor dijera nada.
      expect(closeRangeAt(0, 1).action).toBe("INCREASE_LOAD");
    });
  });
});
