import { describe, expect, it } from "vitest";

import { FATIGUE } from "@/core/config/training-config";
import { addDays } from "@/core/dates";

import {
  assessFatigue,
  type FatigueExerciseInput,
  type FatigueInput,
  type FatigueSessionInput,
} from "./fatigue";

/**
 * Motor de fatiga y deload reactivo (Fase 3.3). Doble aserción en todos los
 * casos: decisión + los números que la justifican.
 *
 * Los dos invariantes que estas pruebas protegen:
 *   · una mala sesión NUNCA dispara nada;
 *   · lo subjetivo por sí solo NUNCA recomienda una descarga.
 */

const TODAY = "2026-08-25";

/** Sesión a `daysAgo` días con el feedback indicado (todo opcional). */
function session(
  daysAgo: number,
  feedback: Partial<Omit<FatigueSessionInput, "localDate">> = {},
): FatigueSessionInput {
  return {
    localDate: addDays(TODAY, -daysAgo),
    perceivedPerformance: null,
    fatigue: null,
    motivation: null,
    jointPain: null,
    completionRate: 1,
    ...feedback,
  };
}

function exercise(
  name: string,
  opts: Partial<FatigueExerciseInput> = {},
): FatigueExerciseInput {
  return {
    variantId: name,
    name,
    regressed: false,
    plateaued: false,
    daysSinceLast: 3,
    ...opts,
  };
}

function run(
  sessions: FatigueSessionInput[],
  exercises: FatigueExerciseInput[] = [],
  weeksSinceDeload: number | null = 3,
) {
  const input: FatigueInput = {
    todayLocalDate: TODAY,
    sessions,
    exercises,
    weeksSinceDeload,
  };
  return assessFatigue(input);
}

/** Cuatro sesiones normales, sin nada reseñable. */
const NORMAL = [session(12), session(9), session(5), session(2)];

// ───────────────────────────────────────────────────────────────────────────
describe("datos insuficientes", () => {
  it("con menos de 3 sesiones en la ventana no valora nada", () => {
    const r = run([session(4), session(1)]);
    expect(r.decision).toBe("INSUFFICIENT_DATA");
    expect(r.level).toBe("INSUFFICIENT_DATA");
    expect(r.plan).toBeNull();
    expect(r.explanation).toContain("2 sesiones");
  });

  it("las sesiones fuera de la ventana no cuentan", () => {
    const r = run([session(60), session(50), session(40), session(2)]);
    expect(r.numbers.sessionsInWindow).toBe(1);
    expect(r.decision).toBe("INSUFFICIENT_DATA");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("A · progreso normal → sin deload", () => {
  it("sin señales, no recomienda nada", () => {
    const r = run(NORMAL, [exercise("Press banca"), exercise("Sentadilla")]);
    expect(r.decision).toBe("NO_DELOAD");
    expect(r.level).toBe("LOW");
    expect(r.score).toBe(0);
    expect(r.signals).toHaveLength(0);
    expect(r.plan).toBeNull();
    expect(r.explanation).toMatch(/Sin señales de fatiga/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("B · una mala sesión → NUNCA dispara nada", () => {
  it("fatiga 5/5 una sola vez no es una señal", () => {
    const r = run([
      session(12),
      session(9),
      session(5),
      session(2, { fatigue: 5, perceivedPerformance: 1, motivation: 1 }),
    ]);
    expect(r.decision).toBe("NO_DELOAD");
    expect(r.score).toBe(0);
    expect(r.signals).toHaveLength(0);
  });

  it("una sesión acortada tampoco", () => {
    const r = run([
      session(12),
      session(9),
      session(5),
      session(2, { completionRate: 0.3 }),
    ]);
    expect(r.decision).toBe("NO_DELOAD");
    expect(r.signals).toHaveLength(0);
  });

  it("un solo ejercicio con regresión tampoco", () => {
    const r = run(NORMAL, [
      exercise("Press banca", { regressed: true }),
      exercise("Sentadilla"),
    ]);
    expect(r.decision).toBe("NO_DELOAD");
    expect(r.signals).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("C · caída sostenida de rendimiento → señal objetiva", () => {
  it("dos ejercicios con regresión emiten PERFORMANCE_DECLINE con sus nombres", () => {
    const r = run(NORMAL, [
      exercise("Press banca", { regressed: true }),
      exercise("Sentadilla", { regressed: true }),
      exercise("Remo"),
    ]);
    const signal = r.signals.find((s) => s.code === "PERFORMANCE_DECLINE");
    expect(signal).toBeDefined();
    expect(signal!.kind).toBe("OBJECTIVE");
    expect(signal!.message).toContain("Press banca");
    expect(signal!.message).toContain("Sentadilla");
    expect(r.objectiveScore).toBe(FATIGUE.WEIGHTS.PERFORMANCE_DECLINE);
    // 3 puntos objetivos: vigilancia, todavía no recomendación.
    expect(r.decision).toBe("DELOAD_WATCH");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("D · rendimiento cae + fatiga alta → recomendación con números", () => {
  it("recomienda deload y lo explica con las cifras exactas", () => {
    const r = run(
      [
        session(12),
        session(9, { fatigue: 4 }),
        session(5, { fatigue: 5 }),
        session(2, { fatigue: 4 }),
      ],
      [
        exercise("Press banca", { regressed: true }),
        exercise("Sentadilla", { regressed: true }),
      ],
    );
    expect(r.decision).toBe("DELOAD_RECOMMENDED");
    expect(r.level).toBe("HIGH");
    expect(r.score).toBeGreaterThanOrEqual(FATIGUE.RECOMMEND_SCORE);
    expect(r.objectiveScore).toBeGreaterThanOrEqual(
      FATIGUE.MIN_OBJECTIVE_SCORE,
    );
    // La explicación LARGA (la que consume Coach AI) conserva los números.
    expect(r.explanation).toMatch(/2 ejercicios/);
    expect(r.explanation).toMatch(/fatiga ≥4\/5 en 3 de las últimas 4/);
    // El titular que se enseña en pantalla es corto y no repite cada señal.
    expect(r.headline).toMatch(/No la aplico, la decides tú/i);
    expect(r.headline.length).toBeLessThan(120);
  });

  it("el plan recorta VOLUMEN y mantiene la carga", () => {
    const r = run(
      [
        session(12),
        session(9, { fatigue: 4 }),
        session(5, { fatigue: 5 }),
        session(2, { fatigue: 4 }),
      ],
      [
        exercise("Press banca", { regressed: true }),
        exercise("Sentadilla", { regressed: true }),
      ],
    );
    expect(r.plan).not.toBeNull();
    expect(r.plan!.setFraction).toBe(0.5);
    expect(r.plan!.loadChange).toBe("KEEP");
    expect(r.plan!.rirIncrease).toBe(2);
    expect(r.plan!.summary).toMatch(/VOLUMEN, no la intensidad/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("E · dolor articular → vía propia, con precedencia", () => {
  it("no puntúa, pero escala su aviso y se mantiene aunque no haya deload", () => {
    const r = run([
      session(12),
      session(9),
      session(5, { jointPain: 3 }),
      session(2, { jointPain: 4 }),
    ]);
    expect(r.jointPain.level).toBe("ACTION");
    expect(r.jointPain.message).toMatch(/cambia o retira el ejercicio/i);
    // El dolor NO infla el score de fatiga.
    expect(r.score).toBe(0);
    expect(r.decision).toBe("NO_DELOAD");
  });

  it("un aviso leve aislado solo se vigila", () => {
    const r = run([
      session(12),
      session(9),
      session(5),
      session(2, { jointPain: 3 }),
    ]);
    expect(r.jointPain.level).toBe("WATCH");
    expect(r.jointPain.message).toMatch(/solo lo vigilo/i);
  });

  it("con dolor de acción, el plan de descarga sí recorta carga", () => {
    const r = run(
      [
        session(12),
        session(9, { fatigue: 4, jointPain: 4 }),
        session(5, { fatigue: 5, jointPain: 4 }),
        session(2, { fatigue: 4 }),
      ],
      [
        exercise("Press banca", { regressed: true }),
        exercise("Sentadilla", { regressed: true }),
      ],
    );
    expect(r.decision).toBe("DELOAD_RECOMMENDED");
    expect(r.plan!.loadChange).toBe("REDUCE_10_PCT");
  });

  it("sin dolor no inventa aviso", () => {
    const r = run(NORMAL);
    expect(r.jointPain.level).toBe("NONE");
    expect(r.jointPain.message).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("F · señales subjetivas solas → NUNCA recomiendan descarga", () => {
  it("motivación baja con rendimiento estable no sobrerreacciona", () => {
    const r = run(
      [
        session(12, { motivation: 1 }),
        session(9, { motivation: 2 }),
        session(5, { motivation: 1 }),
        session(2, { motivation: 2 }),
      ],
      [exercise("Press banca"), exercise("Sentadilla")],
    );
    expect(r.decision).toBe("NO_DELOAD");
    expect(r.signals.map((s) => s.code)).toEqual(["LOW_MOTIVATION_SUSTAINED"]);
    expect(r.signals[0].message).toMatch(/adherencia, no de fatiga/i);
  });

  it("fatiga alta + rendimiento percibido bajo + motivación baja: aviso, NO descarga", () => {
    const bad = {
      fatigue: 5,
      perceivedPerformance: 1,
      motivation: 1,
    };
    const r = run(
      [session(12, bad), session(9, bad), session(5, bad), session(2, bad)],
      [exercise("Press banca"), exercise("Sentadilla")],
    );
    // 2 + 1 + 1 = 4 puntos, todos subjetivos.
    expect(r.score).toBe(4);
    expect(r.objectiveScore).toBe(0);
    expect(r.decision).toBe("DELOAD_WATCH");
    expect(r.plan).toBeNull();
    expect(r.headline).toMatch(/no basta para recomendarte una descarga/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("G · ejercicios abandonados no cuentan", () => {
  it("un ejercicio que no se toca desde hace un mes no genera señal", () => {
    const r = run(NORMAL, [
      exercise("Press banca", { regressed: true, daysSinceLast: 45 }),
      exercise("Sentadilla", { regressed: true, daysSinceLast: 40 }),
    ]);
    expect(r.numbers.exercisesTracked).toBe(0);
    expect(r.decision).toBe("NO_DELOAD");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("H · meseta sin fatiga → nunca deload, nunca volumen", () => {
  it("meseta generalizada avisa pero no recomienda descarga", () => {
    const r = run(NORMAL, [
      exercise("Curl", { plateaued: true }),
      exercise("Elevación lateral", { plateaued: true }),
      exercise("Press banca"),
    ]);
    expect(r.signals.map((s) => s.code)).toContain("WIDESPREAD_PLATEAU");
    expect(r.score).toBe(FATIGUE.WEIGHTS.WIDESPREAD_PLATEAU);
    expect(r.decision).toBe("NO_DELOAD");
    expect(r.plan).toBeNull();
    // Y jamás propone tocar el volumen.
    expect(JSON.stringify(r)).not.toMatch(/añad\w* (una )?serie|ADD_SET/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("I · calendario: red suave, nunca suficiente", () => {
  it("8 semanas acumulando suman 1 punto y no recomiendan nada solas", () => {
    const r = run(NORMAL, [], 9);
    expect(r.signals.map((s) => s.code)).toEqual(["LONG_ACCUMULATION"]);
    expect(r.score).toBe(1);
    expect(r.decision).toBe("NO_DELOAD");
    expect(r.signals[0].message).toMatch(/no mejora las ganancias/i);
  });

  it("por debajo del umbral no dice nada", () => {
    const r = run(NORMAL, [], 4);
    expect(r.signals).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("invariantes", () => {
  const grid: Array<[string, ReturnType<typeof run>]> = [];
  for (const fatigue of [null, 1, 3, 5]) {
    for (const motivation of [null, 1, 5]) {
      for (const perf of [null, 1, 5]) {
        for (const regressed of [0, 1, 2, 3]) {
          for (const plateaued of [0, 2]) {
            const sessions = [12, 9, 5, 2].map((d) =>
              session(d, {
                fatigue,
                motivation,
                perceivedPerformance: perf,
              }),
            );
            const exercises = Array.from({ length: 4 }, (_, i) =>
              exercise(`E${i}`, {
                regressed: i < regressed,
                plateaued: i < plateaued,
              }),
            );
            grid.push([
              `f${fatigue}/m${motivation}/p${perf}/r${regressed}/pl${plateaued}`,
              run(sessions, exercises),
            ]);
          }
        }
      }
    }
  }

  it("P1 · nunca recomienda descarga sin evidencia objetiva suficiente", () => {
    for (const [label, r] of grid) {
      if (r.decision !== "DELOAD_RECOMMENDED") continue;
      expect(r.objectiveScore, label).toBeGreaterThanOrEqual(
        FATIGUE.MIN_OBJECTIVE_SCORE,
      );
      expect(r.score, label).toBeGreaterThanOrEqual(FATIGUE.RECOMMEND_SCORE);
    }
  });

  it("P2 · el plan solo existe cuando se recomienda, y es advisory", () => {
    for (const [label, r] of grid) {
      if (r.decision === "DELOAD_RECOMMENDED") {
        expect(r.plan, label).not.toBeNull();
        expect(r.plan!.days, label).toBe(7);
      } else {
        expect(r.plan, label).toBeNull();
      }
    }
  });

  it("P3 · el motor jamás propone tocar volumen, programa ni carga fuera del plan", () => {
    for (const [label, r] of grid) {
      const json = JSON.stringify(r);
      expect(json, label).not.toMatch(/ADD_SET|REMOVE_SET|INCREASE_LOAD/);
    }
  });

  it("P4 · determinista y con explicación no vacía", () => {
    for (const [label, r] of grid) {
      expect(r.explanation.length, label).toBeGreaterThan(20);
      expect(["LOW", "MEDIUM", "HIGH"], label).toContain(r.confidence);
      expect(r.engineVersion, label).toBe("1.0.0");
    }
  });
});
