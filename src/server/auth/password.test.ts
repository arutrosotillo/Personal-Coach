import { describe, expect, it } from "vitest";

import {
  LOCKED_PASSWORD_HASH,
  hashPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "./password";

describe("hashing de contraseñas", () => {
  it("acepta la contraseña correcta y rechaza una parecida", async () => {
    const hash = await hashPassword("una-contraseña-larga-de-verdad");
    expect(await verifyPassword("una-contraseña-larga-de-verdad", hash)).toBe(
      true,
    );
    expect(await verifyPassword("una-contraseña-larga-de-verda", hash)).toBe(
      false,
    );
    expect(await verifyPassword("Una-contraseña-larga-de-verdad", hash)).toBe(
      false,
    );
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("nunca guarda la contraseña en claro", async () => {
    const secreto = "esto-no-debe-aparecer-jamas";
    const hash = await hashPassword(secreto);
    expect(hash).not.toContain(secreto);
  });

  it("dos hashes de la misma contraseña son distintos (sal aleatoria)", async () => {
    const a = await hashPassword("la-misma-contraseña-larga");
    const b = await hashPassword("la-misma-contraseña-larga");
    expect(a).not.toBe(b);
    // Y aun así las dos verifican.
    expect(await verifyPassword("la-misma-contraseña-larga", a)).toBe(true);
    expect(await verifyPassword("la-misma-contraseña-larga", b)).toBe(true);
  });

  it("el hash lleva sus parámetros dentro, para poder subirlos más adelante", async () => {
    const hash = await hashPassword("otra-contraseña-larga-aqui");
    const [algoritmo, n, r, p] = hash.split("$");
    expect(algoritmo).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(65536);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  it("la marca de cuenta bloqueada no deja entrar con nada", async () => {
    // Es la que pone la migración en las cuentas creadas para perfiles ya
    // existentes: no puede autenticar hasta que se fije una contraseña.
    for (const intento of ["", "!", "cualquier-cosa", LOCKED_PASSWORD_HASH]) {
      expect(await verifyPassword(intento, LOCKED_PASSWORD_HASH)).toBe(false);
    }
  });

  it("un hash con formato inesperado falla cerrado, sin lanzar", async () => {
    for (const basura of [
      "",
      "scrypt$",
      "scrypt$a$b$c$d$e",
      "bcrypt$1$2$3$sal$hash",
      "scrypt$131072$8$1$$",
      "no-es-un-hash",
    ]) {
      expect(await verifyPassword("loquesea", basura)).toBe(false);
    }
  });
});

describe("nombres de usuario", () => {
  it("se comparan en minúsculas y sin espacios", () => {
    expect(normalizeUsername("  Arturo  ")).toBe("arturo");
    expect(normalizeUsername("ARTURO")).toBe("arturo");
  });

  it("rechaza los que darían problemas al teclearlos", () => {
    expect(validateUsername("a")).not.toBeNull();
    expect(validateUsername("con espacio")).not.toBeNull();
    expect(validateUsername("acentuadó")).not.toBeNull();
    expect(validateUsername("x".repeat(33))).not.toBeNull();
    expect(validateUsername("arturo")).toBeNull();
    expect(validateUsername("mi_hermano-2.0")).toBeNull();
  });
});

describe("contraseñas", () => {
  it("no impone longitud mínima: es una app personal y el dueño decide", () => {
    expect(validatePassword("123")).toBeNull();
    expect(validatePassword("a")).toBeNull();
    expect(validatePassword("corta")).toBeNull();
  });

  it("solo rechaza la vacía y la desmesurada", () => {
    // Vacía: la cuenta no sería utilizable. Enorme: scrypt la procesa entera
    // en cada intento de login.
    expect(validatePassword("")).not.toBeNull();
    expect(validatePassword("x".repeat(201))).not.toBeNull();
    expect(validatePassword("x".repeat(200))).toBeNull();
  });

  it("una contraseña corta se hashea y verifica igual", async () => {
    const hash = await hashPassword("123");
    expect(await verifyPassword("123", hash)).toBe(true);
    expect(await verifyPassword("124", hash)).toBe(false);
    expect(hash).not.toContain("123");
  });
});
