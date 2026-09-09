import { describe, expect, it } from "vitest";

import { parseDecimalInput, sanitizeDecimalInput } from "@/lib/decimal-input";

/**
 * El caso que originó esto: 62,5 kg en elevación de gemelo, tecleados con el
 * teclado decimal del iPhone en español, que solo ofrece coma.
 */
describe("sanitizeDecimalInput", () => {
  it("acepta la coma del teclado español como separador decimal", () => {
    expect(sanitizeDecimalInput("62,5")).toBe("62.5");
  });

  it("acepta también el punto", () => {
    expect(sanitizeDecimalInput("62.5")).toBe("62.5");
  });

  it("tolera estados a medio teclear", () => {
    expect(sanitizeDecimalInput("")).toBe("");
    expect(sanitizeDecimalInput("62,")).toBe("62.");
    expect(sanitizeDecimalInput(",5")).toBe(".5");
  });

  it("colapsa separadores repetidos en vez de romper el campo", () => {
    expect(sanitizeDecimalInput("62,,5")).toBe("62.5");
    expect(sanitizeDecimalInput("62.5,5")).toBe("62.55");
  });

  it("descarta lo que no es número ni separador", () => {
    expect(sanitizeDecimalInput("62,5 kg")).toBe("62.5");
    expect(sanitizeDecimalInput("-62,5")).toBe("62.5");
  });
});

describe("parseDecimalInput", () => {
  it("lee coma y punto por igual", () => {
    expect(parseDecimalInput("62,5")).toBe(62.5);
    expect(parseDecimalInput("62.5")).toBe(62.5);
    expect(parseDecimalInput(" 62,5 ")).toBe(62.5);
  });

  it("devuelve null en vez de NaN cuando no hay número", () => {
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("   ")).toBeNull();
    expect(parseDecimalInput("kg")).toBeNull();
    expect(parseDecimalInput("1,2,3")).toBeNull();
  });
});
