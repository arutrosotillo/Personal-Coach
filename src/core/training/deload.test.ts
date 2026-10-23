import { describe, expect, it } from "vitest";

import { FATIGUE } from "@/core/config/training-config";
import { addDays, diffDays } from "@/core/dates";

import { deloadStatus, type TimelineSession } from "./deload";

/**
 * ¿En qué punto de una descarga estás? Doble aserción: la fase y los números
 * que la sitúan (sesiones de la tanda y sus fechas).
 *
 * Lo que protegen estas pruebas:
 *   · una descarga tiene FIN: una semana o tantas sesiones como días entrenas;
 *   · una sola sesión recortada no es una descarga;
 *   · volver a entrenar normal cierra la descarga, pero no borra desde cuándo
 *     los datos de cada ejercicio son nuevos.
 */

const TODAY = "2026-08-25";

const normal = (daysAgo: number): TimelineSession => ({
  localDate: addDays(TODAY, -daysAgo),
  deload: false,
});
const descarga = (daysAgo: number): TimelineSession => ({
  localDate: addDays(TODAY, -daysAgo),
  deload: true,
});

/** Tres semanas normales de tres días: lo que hay antes de cualquier descarga. */
const ANTES = [23, 21, 19, 16, 14, 12, 9].map(normal);

describe("sin descarga", () => {
  it("si nunca has descargado no hay fase ni punto de corte", () => {
    const r = deloadStatus(ANTES, TODAY, 3);
    expect(r.phase).toBe("NONE");
    expect(r.current).toBeNull();
    expect(r.lastCompleted).toBeNull();
    expect(r.sessionsPerWeek).toBe(3);
  });
});

describe("descarga en curso", () => {
  it("empieza con la primera sesión de descarga", () => {
    const r = deloadStatus([...ANTES, descarga(0)], TODAY, 3);
    expect(r.phase).toBe("IN_PROGRESS");
    expect(r.current).toEqual({
      startLocalDate: TODAY,
      endLocalDate: TODAY,
      sessions: 1,
    });
    // La que está en curso no cuenta como hecha: todavía no ha servido.
    expect(r.lastCompleted).toBeNull();
  });

  it("sigue en curso mientras no hayas hecho las sesiones de tu semana", () => {
    const r = deloadStatus([...ANTES, descarga(4), descarga(2)], TODAY, 3);
    expect(r.phase).toBe("IN_PROGRESS");
    expect(r.current?.sessions).toBe(2);
    expect(r.current?.startLocalDate).toBe(addDays(TODAY, -4));
  });

  it("aunque no hayas entrenado hoy: lo que cuenta es la semana desde la primera", () => {
    // Seis días desde la primera sesión: todavía es su semana.
    const r = deloadStatus([...ANTES, descarga(6)], TODAY, 3);
    expect(r.phase).toBe("IN_PROGRESS");
    expect(r.current?.sessions).toBe(1);
  });
});

describe("descarga terminada", () => {
  it("al hacer tantas sesiones como días entrenas por semana", () => {
    const r = deloadStatus(
      [...ANTES, descarga(4), descarga(2), descarga(0)],
      TODAY,
      3,
    );
    expect(r.phase).toBe("FINISHED");
    expect(r.current?.sessions).toBe(3);
    expect(r.lastCompleted).toEqual({
      startLocalDate: addDays(TODAY, -4),
      endLocalDate: TODAY,
      sessions: 3,
    });
  });

  it("o al cumplirse la semana, aunque hicieras menos sesiones", () => {
    // Cuatro días por semana, dos sesiones de descarga y la semana ya pasada.
    const r = deloadStatus([...ANTES, descarga(8), descarga(6)], TODAY, 4);
    expect(r.phase).toBe("FINISHED");
    expect(r.current?.sessions).toBe(2);
    expect(diffDays(r.current!.startLocalDate, TODAY)).toBeGreaterThanOrEqual(
      FATIGUE.DELOAD_PLAN.DAYS,
    );
  });

  it("con un día por semana, una sesión ya es la descarga entera", () => {
    const r = deloadStatus([...ANTES, descarga(0)], TODAY, 1);
    expect(r.phase).toBe("FINISHED");
    expect(r.lastCompleted?.sessions).toBe(1);
  });

  it("al volver a entrenar normal deja de ser 'terminada', pero el corte se queda", () => {
    // El titular de la vuelta ya ha cumplido su función. El punto desde el que
    // los datos son nuevos, no: sigue siendo el final de la descarga.
    const r = deloadStatus(
      [...ANTES, descarga(6), descarga(4), descarga(2), normal(0)],
      TODAY,
      3,
    );
    expect(r.phase).toBe("NONE");
    expect(r.current).toBeNull();
    expect(r.lastCompleted?.endLocalDate).toBe(addDays(TODAY, -2));
    expect(r.lastCompleted?.sessions).toBe(3);
  });

  it("volver antes de tiempo también la cierra: dos sesiones ya son una descarga corta", () => {
    const r = deloadStatus(
      [...ANTES, descarga(4), descarga(2), normal(0)],
      TODAY,
      3,
    );
    expect(r.phase).toBe("NONE");
    expect(r.lastCompleted?.sessions).toBe(
      FATIGUE.DELOAD_DETECTION.MIN_SESSIONS_TO_RESET,
    );
  });
});

describe("lo que NO es una descarga", () => {
  it("una sola sesión recortada y de vuelta a lo normal", () => {
    // Una sola sesión no puede borrar las caídas que pedían la descarga: es
    // el mismo umbral que reinicia el contador de acumulación.
    const r = deloadStatus([...ANTES, descarga(2), normal(0)], TODAY, 3);
    expect(r.phase).toBe("NONE");
    expect(r.lastCompleted).toBeNull();
  });

  it("una sola sesión recortada y una semana sin volver", () => {
    const r = deloadStatus([...ANTES, descarga(8)], TODAY, 3);
    expect(r.phase).toBe("NONE");
    expect(r.current).toBeNull();
    expect(r.lastCompleted).toBeNull();
  });

  it("una sesión con fecha por delante de hoy no existe todavía", () => {
    const r = deloadStatus([...ANTES, descarga(-1)], TODAY, 3);
    expect(r.phase).toBe("NONE");
    expect(r.current).toBeNull();
  });
});

describe("varias descargas", () => {
  it("una normal en medio corta la tanda: la segunda es otra descarga", () => {
    const r = deloadStatus(
      [
        ...ANTES,
        descarga(40),
        descarga(38),
        descarga(36),
        normal(30),
        normal(28),
        descarga(1),
      ],
      TODAY,
      3,
    );
    expect(r.phase).toBe("IN_PROGRESS");
    expect(r.current).toEqual({
      startLocalDate: addDays(TODAY, -1),
      endLocalDate: addDays(TODAY, -1),
      sessions: 1,
    });
    // Mientras la nueva está en curso, el corte es el final de la anterior.
    expect(r.lastCompleted?.endLocalDate).toBe(addDays(TODAY, -36));
  });

  it("un hueco largo entre dos descargas también: ya no son la misma semana", () => {
    const hueco = FATIGUE.DELOAD_DETECTION.WINDOW_DAYS;
    const r = deloadStatus(
      [descarga(hueco + 6), descarga(hueco + 4), descarga(2)],
      TODAY,
      3,
    );
    expect(r.phase).toBe("IN_PROGRESS");
    expect(r.current?.sessions).toBe(1);
    expect(r.lastCompleted?.sessions).toBe(2);
  });

  it("el orden de entrada no importa", () => {
    const ordenado = [...ANTES, descarga(4), descarga(2), descarga(0)];
    const r = deloadStatus([...ordenado].reverse(), TODAY, 3);
    expect(r).toEqual(deloadStatus(ordenado, TODAY, 3));
  });
});
