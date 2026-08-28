import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  isAuthConfigured,
  readSessionToken,
  sessionCookieOptions,
  shouldRefresh,
} from "./session";

const USER = "usr_abc123";
const SECRET = "un-secreto-de-pruebas-suficientemente-largo-1234";
const OTHER_SECRET = "otro-secreto-de-pruebas-igual-de-largo-98765";

const original = { ...process.env };

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
});

afterEach(() => {
  process.env = { ...original };
});

const NOW = new Date("2026-08-26T10:00:00Z");

describe("sesión de usuario único", () => {
  it("un token recién emitido es válido y dura lo anunciado", () => {
    const token = createSessionToken(USER, NOW);
    const state = readSessionToken(token, NOW);
    expect(state.valid).toBe(true);
    expect(state.remainingSeconds).toBeGreaterThan(
      SESSION_MAX_AGE_SECONDS - 10,
    );
  });

  it("rechaza un token caducado", () => {
    const token = createSessionToken(USER, NOW);
    const after = new Date(
      NOW.getTime() + (SESSION_MAX_AGE_SECONDS + 1) * 1000,
    );
    expect(readSessionToken(token, after).valid).toBe(false);
  });

  it("rechaza una firma manipulada", () => {
    const token = createSessionToken(USER, NOW);
    const [payload, signature] = token.split(".");
    const tampered = `${payload}.${signature.slice(0, -1)}X`;
    expect(readSessionToken(tampered, NOW).valid).toBe(false);
  });

  it("rechaza alargar la caducidad conservando la firma", () => {
    // El ataque obvio: cambiar el payload para que dure más. La firma cubre
    // el payload, así que deja de cuadrar.
    const token = createSessionToken(USER, NOW);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const forged = `${NOW.getTime() + 10 * 365 * 24 * 3600 * 1000}.${signature}`;
    expect(readSessionToken(forged, NOW).valid).toBe(false);
  });

  it("rechaza un token firmado con otro secreto (rotar cierra sesiones)", () => {
    const token = createSessionToken(USER, NOW);
    process.env.AUTH_SECRET = OTHER_SECRET;
    expect(readSessionToken(token, NOW).valid).toBe(false);
  });

  it("rechaza tokens con formato inesperado sin lanzar", () => {
    for (const bad of [
      undefined,
      "",
      ".",
      "sinpunto",
      ".soloFirma",
      "noNumerico.abc",
      `${NOW.getTime()}.`,
    ]) {
      expect(readSessionToken(bad, NOW).valid).toBe(false);
    }
  });

  it("sin AUTH_SECRET no entra nadie (falla cerrado)", () => {
    const token = createSessionToken(USER, NOW);
    delete process.env.AUTH_SECRET;
    expect(readSessionToken(token, NOW).valid).toBe(false);
    expect(isAuthConfigured()).toBe(false);
  });

  it("una AUTH_SECRET corta se rechaza al emitir", () => {
    process.env.AUTH_SECRET = "corta";
    expect(() => createSessionToken(USER, NOW)).toThrow(/AUTH_SECRET/);
  });
});

describe("renovación deslizante", () => {
  it("no renueva una sesión recién creada", () => {
    expect(
      shouldRefresh(readSessionToken(createSessionToken(USER, NOW), NOW)),
    ).toBe(false);
  });

  it("renueva cuando le queda poca vida", () => {
    const token = createSessionToken(USER, NOW);
    const late = new Date(
      NOW.getTime() + (SESSION_MAX_AGE_SECONDS - 3600) * 1000,
    );
    expect(shouldRefresh(readSessionToken(token, late))).toBe(true);
  });

  it("nunca renueva una sesión inválida", () => {
    expect(
      shouldRefresh({ valid: false, userId: null, remainingSeconds: 0 }),
    ).toBe(false);
  });
});

describe("cookie", () => {
  it("es httpOnly y sameSite lax, para que el JS no la lea y la PWA funcione", () => {
    const options = sessionCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("es secure en producción y no en desarrollo (que sirve por HTTP)", () => {
    const previous = process.env.NODE_ENV;
    try {
      Object.defineProperty(process.env, "NODE_ENV", {
        value: "production",
        configurable: true,
      });
      expect(sessionCookieOptions().secure).toBe(true);
      Object.defineProperty(process.env, "NODE_ENV", {
        value: "development",
        configurable: true,
      });
      expect(sessionCookieOptions().secure).toBe(false);
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", {
        value: previous,
        configurable: true,
      });
    }
  });
});
