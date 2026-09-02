import { describe, expect, it } from "vitest";

import type { WaistTrendStatus, WeightTrendStatus } from "@/core/body";
import {
  formatConfidenceInterval,
  formatNumber,
  formatShortDate,
  formatSigned,
  formatWindow,
  showsSlope,
  WAIST_STATUS_TITLE,
  WEIGHT_STATUS_TITLE,
} from "@/lib/body-labels";

/**
 * Estos tests vigilan la frontera donde es más fácil mentir: la traducción de
 * lo que el motor calcula a lo que una persona lee.
 */

const TODOS_LOS_ESTADOS: WeightTrendStatus[] = [
  "INSUFFICIENT_DATA",
  "INCONCLUSIVE",
  "MAINTAINING",
  "LOSING",
  "GAINING",
];

describe("cada estado del motor tiene su frase, y dice lo que el motor dice", () => {
  it("no falta ninguno: un estado sin texto saldría vacío en pantalla", () => {
    for (const estado of TODOS_LOS_ESTADOS) {
      expect(WEIGHT_STATUS_TITLE[estado]).toBeTruthy();
    }
    const waist: WaistTrendStatus[] = [
      "INSUFFICIENT_DATA",
      "WITHIN_MEASUREMENT_ERROR",
      "DECREASING",
      "INCREASING",
    ];
    for (const estado of waist) expect(WAIST_STATUS_TITLE[estado]).toBeTruthy();
  });

  it("INSUFFICIENT_DATA e INCONCLUSIVE dicen cosas DISTINTAS", () => {
    // "No puedo calcular" y "he calculado y no distingo la dirección" son dos
    // situaciones diferentes, y la persona debería poder notarlo.
    expect(WEIGHT_STATUS_TITLE.INSUFFICIENT_DATA).not.toBe(
      WEIGHT_STATUS_TITLE.INCONCLUSIVE,
    );
    expect(WEIGHT_STATUS_TITLE.INSUFFICIENT_DATA).toMatch(/faltan mediciones/i);
    expect(WEIGHT_STATUS_TITLE.INCONCLUSIVE).toMatch(/no hay una tendencia/i);
  });

  it("ni INSUFFICIENT_DATA ni INCONCLUSIVE insinúan dirección", () => {
    // La tentación clásica: "parece que estás bajando, pero…". Ninguna de las
    // dos frases puede contener un verbo de dirección.
    const prohibidas = /baj|sub|pierd|gana|aument|desciend/i;
    expect(WEIGHT_STATUS_TITLE.INSUFFICIENT_DATA).not.toMatch(prohibidas);
    expect(WEIGHT_STATUS_TITLE.INCONCLUSIVE).not.toMatch(prohibidas);
  });

  it("MAINTAINING afirma estabilidad, no ausencia de datos", () => {
    expect(WEIGHT_STATUS_TITLE.MAINTAINING).toMatch(/estable/i);
    expect(WEIGHT_STATUS_TITLE.MAINTAINING).not.toMatch(
      /falta|no hay|todavía/i,
    );
  });

  it("LOSING y GAINING dicen la dirección, y son distintas", () => {
    expect(WEIGHT_STATUS_TITLE.LOSING).toMatch(/bajando/i);
    expect(WEIGHT_STATUS_TITLE.GAINING).toMatch(/subiendo/i);
    expect(WEIGHT_STATUS_TITLE.LOSING).not.toBe(WEIGHT_STATUS_TITLE.GAINING);
  });

  it("ninguna frase valora si el usuario lo está haciendo bien", () => {
    // Que el peso suba o baje no es bueno ni malo: depende del objetivo, y
    // esta pantalla no lo sabe. Ni felicitaciones ni regañinas.
    // Con límites de palabra: sin ellos, "subiendo" contiene "bien" y el test
    // fallaba por la frase más neutra de todas.
    const valorativas =
      /\b(bien|mal|genial|enhorabuena|perfecto|cuidado|ojo|deber[íi]as|fenomenal|estupendo|felicidades)\b/i;
    for (const estado of TODOS_LOS_ESTADOS) {
      expect(WEIGHT_STATUS_TITLE[estado]).not.toMatch(valorativas);
    }
  });
});

describe("showsSlope", () => {
  it("solo deja enseñar la pendiente cuando el motor la respalda", () => {
    expect(showsSlope("LOSING")).toBe(true);
    expect(showsSlope("GAINING")).toBe(true);
    expect(showsSlope("MAINTAINING")).toBe(true);
  });

  it("NUNCA con INCONCLUSIVE, aunque la pendiente esté calculada", () => {
    // Es la regla que impide "bajas 0,2 kg/semana" cuando el intervalo va de
    // −0,4 a +0,1. La pendiente existe; afirmarla, no.
    expect(showsSlope("INCONCLUSIVE")).toBe(false);
    expect(showsSlope("INSUFFICIENT_DATA")).toBe(false);
  });
});

describe("formato numérico es-ES", () => {
  it("usa coma decimal", () => {
    expect(formatNumber(82.4)).toBe("82,4");
    expect(formatNumber(82.45, 2)).toBe("82,45");
  });

  it("el signo es explícito y el menos es tipográfico", () => {
    expect(formatSigned(-0.42)).toBe("−0,42");
    expect(formatSigned(0.42)).toBe("+0,42");
    // El menos de verdad (U+2212), no el guion del teclado: se alinea con las
    // cifras en tabular-nums.
    expect(formatSigned(-1)).toContain("−");
    expect(formatSigned(-1)).not.toContain("-");
  });

  it("el cero no finge dirección", () => {
    expect(formatSigned(0)).toBe("±0,00");
  });

  it("el intervalo se lee como un rango, no como una nota", () => {
    expect(formatConfidenceInterval(-0.48, -0.33, "kg/semana")).toBe(
      "entre −0,48 y −0,33 kg/semana",
    );
  });

  it("la ventana dice de cuántos días habla", () => {
    expect(formatWindow(28)).toBe("últimos 28 días");
  });
});

describe("formatShortDate", () => {
  it("omite el año cuando es el mismo", () => {
    expect(formatShortDate("2026-08-31", "2026-09-02")).toBe("31 ago");
    expect(formatShortDate("2026-01-05", "2026-09-02")).toBe("5 ene");
  });

  it("lo incluye cuando es otro, para que un historial largo no engañe", () => {
    expect(formatShortDate("2025-12-28", "2026-09-02")).toBe("28 dic 2025");
  });
});
