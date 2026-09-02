import { describe, expect, it } from "vitest";

import { alcance, matchesWithPolarity, polarityAt } from "@/ai/clause";

/**
 * Polaridad de cláusula (B6.1).
 *
 * Reemplaza a "¿hay una negación en los 12 caracteres previos?", que producía
 * falsos positivos y falsos negativos por la misma razón: medir en caracteres
 * una propiedad que es gramatical. Los ejemplos de abajo salen de la QA en
 * vivo, no de mi imaginación.
 */

/** Polaridad de la primera aparición de `aguja` en `texto`. */
function p(texto: string, aguja: string) {
  const i = texto.indexOf(aguja);
  expect(i, `"${aguja}" no está en "${texto}"`).toBeGreaterThanOrEqual(0);
  return polarityAt(texto, i);
}

describe("rechazo: el coach dice que NO PUEDE, no que sea falso", () => {
  it.each([
    ["No se puede saber si estás ganando músculo o grasa.", "estás"],
    ["No puedo recomendar aumentar la ingesta.", "aumentar"],
    ["Todavía no corresponde subir carga.", "subir"],
    ["El motor no recomienda descargar ahora.", "descargar"],
    ["No puedes tratar ese 15 % como una medición precisa.", "15"],
    ["No hay datos para afirmar que el peso baje.", "baje"],
    ["No se puede concluir que debas comer más por esto.", "comer"],
    ["No es posible atribuir la caída a la ingesta.", "atribuir"],
  ])("«%s»", (texto, aguja) => {
    expect(p(texto, aguja)).toBe("REJECTION");
  });
});

describe("negación simple: se niega el hecho", () => {
  it.each([
    ["No recortes más las calorías por ahora.", "recortes"],
    ["No estás perdiendo músculo.", "estás"],
    ["No subas la carga todavía.", "subas"],
    ["No añadas series para compensar.", "añadas"],
  ])("«%s»", (texto, aguja) => {
    expect(p(texto, aguja)).toBe("NEGATED");
  });

  it("un negador lejano ya no gobierna la frase", () => {
    // Se mide en PALABRAS: cuatro. Más allá, la negación pertenece a otra idea.
    expect(
      p("No tengo ninguna duda razonable sobre esto y sube la carga", "sube"),
    ).toBe("AFFIRMATIVE");
  });
});

describe("afirmación: se manda", () => {
  it.each([
    ["Estás perdiendo músculo.", "Estás"],
    ["Aumenta la ingesta.", "Aumenta"],
    ["Sube la carga ahora.", "Sube"],
    ["Baja el peso y consolida.", "Baja"],
  ])("«%s»", (texto, aguja) => {
    expect(p(texto, aguja)).toBe("AFFIRMATIVE");
  });

  it("una coma abre cláusula nueva y la negación anterior no la alcanza", () => {
    expect(p("Sin miedo, sube la carga.", "sube")).toBe("AFFIRMATIVE");
    expect(p("No hay duda: sube la carga.", "sube")).toBe("AFFIRMATIVE");
  });
});

describe("condicional e incertidumbre", () => {
  it("una condición describe un requisito, no una orden", () => {
    expect(p("Para subir carga, cierra 8 repeticiones.", "subir")).toBe(
      "CONDITIONAL",
    );
    expect(
      p("Cuando subas la carga, hazlo con el RIR objetivo.", "subas"),
    ).toBe("CONDITIONAL");
  });

  it("pero un adverbio de AHORA la convierte en orden", () => {
    expect(p("Si quieres progresar, sube la carga hoy mismo.", "sube")).toBe(
      "AFFIRMATIVE",
    );
  });

  it("y ese adverbio NO puede pisar un rechazo (fallo F5)", () => {
    // "ahora" cortocircuitaba la negación y bloqueaba la frase entera.
    expect(
      p("El motor no recomienda descargar ni subir carga ahora.", "subir"),
    ).toBe("REJECTION");
  });

  it("lo planteado como posibilidad se marca como tal", () => {
    expect(p("Podría estar relacionado con la ingesta.", "ingesta")).toBe(
      "UNCERTAIN",
    );
    expect(
      p("Es compatible con una mejora de composición corporal.", "composición"),
    ).toBe("UNCERTAIN");
  });
});

describe("alcance", () => {
  it("corta por puntuación fuerte y por coma, la más cercana", () => {
    expect(alcance("Uno. Dos, tres cuatro", 15)).toBe(" tres ");
    expect(alcance("Uno; dos tres", 9)).toBe(" dos ");
  });
});

describe("matchesWithPolarity", () => {
  const SUBIR = /\bsub(?:e|ir)\b[^.]{0,20}\bcarga\b/i;

  it("solo salta en las polaridades que la regla declara", () => {
    const texto = "El motor no recomienda subir carga.";
    expect(matchesWithPolarity(SUBIR, texto, ["AFFIRMATIVE"]).hit).toBe(false);
    expect(matchesWithPolarity(SUBIR, texto, ["REJECTION"]).hit).toBe(true);
  });

  it("con varias coincidencias basta con que UNA sea bloqueable", () => {
    const texto = "No puedo subir la carga. Sube la carga hoy.";
    const r = matchesWithPolarity(SUBIR, texto, ["AFFIRMATIVE"]);
    expect(r.hit).toBe(true);
    expect(r.polarity).toBe("AFFIRMATIVE");
  });
});
