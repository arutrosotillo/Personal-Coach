import { describe, expect, it } from "vitest";

import { addDays } from "@/core/dates";
import type { CatalogExercise } from "@/core/program/types";
import {
  computeBlockStats,
  type BlockExerciseInput,
  type BlockSessionInput,
} from "@/core/training/block-stats";

const START = "2026-08-31"; // lunes

const catalog: CatalogExercise[] = [
  {
    id: "press",
    name: "Press",
    movementPattern: "HORIZONTAL_PUSH",
    systemicFatigue: 2,
    contributions: [
      { group: "PECHO_SUPERIOR", role: "PRIMARY", factor: 1 },
      { group: "TRICEPS", role: "SECONDARY", factor: 0.5 },
    ],
    variants: [{ id: "press-maquina" }, { id: "press-suelto" }],
  },
  {
    id: "curl",
    name: "Curl",
    movementPattern: "ISOLATION",
    systemicFatigue: 1,
    contributions: [{ group: "BICEPS", role: "PRIMARY", factor: 1 }],
    variants: [{ id: "curl-v" }],
  },
  {
    id: "dominada",
    name: "Dominada",
    movementPattern: "VERTICAL_PULL",
    systemicFatigue: 2,
    contributions: [{ group: "DORSAL", role: "PRIMARY", factor: 1 }],
    variants: [{ id: "dominada-v" }],
  },
] as unknown as CatalogExercise[];

function exercise(
  variantId: string,
  weightKg: number,
  reps: number[],
  rir: number | null = 1,
  over: Partial<BlockExerciseInput> = {},
): BlockExerciseInput {
  return {
    variantId,
    exerciseName: variantId,
    variantName: "V",
    equipment: "MACHINE",
    movementPattern: "HORIZONTAL_PUSH",
    ordinal: 1,
    plannedSets: reps.length,
    targetRir: 1,
    sets: reps.map((r) => ({
      weightKg,
      reps: r,
      rir,
      estimated1Rm:
        rir === null || r + rir > 12
          ? null
          : Math.round(weightKg * (1 + (r + rir) / 30) * 10) / 10,
    })),
    ...over,
  };
}

function session(
  localDate: string,
  exercises: BlockExerciseInput[],
  over: Partial<BlockSessionInput> = {},
): BlockSessionInput {
  return {
    id: localDate,
    localDate,
    deload: false,
    perceivedPerformance: 3,
    fatigue: 3,
    jointPain: 1,
    motivation: 3,
    durationMin: 60,
    exercises,
    ...over,
  };
}

const stats = (
  sessions: BlockSessionInput[],
  over: Partial<Parameters<typeof computeBlockStats>[0]> = {},
) =>
  computeBlockStats({
    daysPerWeek: 3,
    sessions,
    catalog,
    equipmentChanges: [],
    ...over,
  })!;

describe("computeBlockStats", () => {
  it("un bloque sin sesiones no tiene estadísticas: no se inventa un cero", () => {
    expect(
      computeBlockStats({
        daysPerWeek: 3,
        sessions: [],
        catalog,
        equipmentChanges: [],
      }),
    ).toBeNull();
  });

  describe("periodo y adherencia", () => {
    const s = stats([
      session(START, [exercise("press-maquina", 50, [10, 10, 10])]),
      session(addDays(START, 2), [exercise("curl-v", 10, [12, 12])]),
      // Semana 2 vacía: la 3 tiene una sesión.
      session(addDays(START, 14), [
        exercise("press-maquina", 50, [10, 10], 1, { plannedSets: 3 }),
      ]),
    ]);

    it("el periodo sale de las sesiones, y las semanas del calendario", () => {
      expect(s.startLocalDate).toBe(START);
      expect(s.endLocalDate).toBe(addDays(START, 14));
      expect(s.days).toBe(15);
      expect(s.weeks).toBe(3);
    });

    it("adherencia: sesiones hechas ÷ previstas, semana a semana", () => {
      expect(s.adherence.completed).toBe(3);
      expect(s.adherence.expected).toBe(9);
      expect(s.adherence.pct).toBe(33);
      expect(s.adherence.weeks.map((w) => w.completed)).toEqual([2, 0, 1]);
      expect(s.adherence.weeks[1].weekStartDate).toBe(addDays(START, 7));
    });

    it("series: lo registrado frente a lo previsto en esas sesiones", () => {
      expect(s.adherence.setsPlanned).toBe(8);
      expect(s.adherence.setsLogged).toBe(7);
      expect(s.adherence.setCompletionPct).toBe(88);
      expect(s.totalWorkingSets).toBe(7);
    });
  });

  describe("comparación de un ejercicio consigo mismo", () => {
    const progresa = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        session(addDays(START, i * 7), [
          exercise("press-maquina", 50 + i * 2.5, [10, 10, 9]),
        ]),
      );

    it("compara las primeras sesiones contra las últimas, con sus números", () => {
      const e = stats(progresa(8)).exercises[0];
      expect(e.sessions).toBe(8);
      expect(e.comparison).not.toBeNull();
      const c = e.comparison!;
      expect(c.start.sessions).toBe(3);
      expect(c.end.sessions).toBe(3);
      expect(c.start.workWeightKg).toBe(52.5);
      expect(c.end.workWeightKg).toBe(65);
      expect(c.verdict).toBe("UP");
      expect(c.basis).toBe("EQUIVALENT_LOAD");
      expect(c.changePct).toBeGreaterThan(20);
    });

    it("con menos de 4 sesiones no compara: serían días sueltos", () => {
      const e = stats(progresa(3)).exercises[0];
      expect(e.comparison).toBeNull();
      expect(stats(progresa(3)).comparison.notCompared).toBe(1);
    });

    it("dentro de la banda se dice estable, no sube ni baja", () => {
      const e = stats(
        Array.from({ length: 6 }, (_, i) =>
          session(addDays(START, i * 7), [
            exercise("press-maquina", 50, [10, 10, 10]),
          ]),
        ),
      ).exercises[0];
      expect(e.comparison!.changePct).toBe(0);
      expect(e.comparison!.verdict).toBe("FLAT");
    });

    it("las sesiones de descarga se enseñan pero no se comparan", () => {
      const sesiones = progresa(6);
      sesiones[5] = session(
        addDays(START, 35),
        [exercise("press-maquina", 20, [10])],
        { deload: true },
      );
      const e = stats(sesiones).exercises[0];
      expect(e.points).toHaveLength(6);
      expect(e.points[5].deload).toBe(true);
      // La última que compara es la anterior a la descarga, no la de 20 kg.
      expect(e.comparison!.end.toDate).toBe(addDays(START, 28));
      expect(e.comparison!.verdict).toBe("UP");
    });

    it("nunca compara entre máquinas: un cambio parte la serie", () => {
      const change = addDays(START, 28);
      const sesiones = [
        ...Array.from({ length: 4 }, (_, i) =>
          session(addDays(START, i * 7), [
            exercise("press-maquina", 100, [10, 10, 10]),
          ]),
        ),
        ...Array.from({ length: 4 }, (_, i) =>
          session(addDays(change, i * 7), [
            exercise("press-maquina", 60, [10, 10, 10]),
          ]),
        ),
      ];
      const e = stats(sesiones, {
        equipmentChanges: [
          { variantId: "press-maquina", sinceLocalDate: change },
        ],
      }).exercises[0];
      // Leído a pelo sería 100 → 60 kg: una caída del 40 % que no existe.
      expect(e.comparableSince).toBe(change);
      expect(e.comparison!.start.workWeightKg).toBe(60);
      expect(e.comparison!.end.workWeightKg).toBe(60);
      expect(e.comparison!.verdict).toBe("FLAT");
    });

    it("un cambio posterior al bloque no recorta nada: el bloque archivado sigue entero", () => {
      const e = stats(progresa(6), {
        equipmentChanges: [
          { variantId: "press-maquina", sinceLocalDate: addDays(START, 100) },
        ],
      }).exercises[0];
      expect(e.comparableSince).toBeNull();
      expect(e.comparison!.verdict).toBe("UP");
    });

    it("con peso corporal no se estima: la carga anotada es solo el lastre", () => {
      const e = stats(
        Array.from({ length: 6 }, (_, i) =>
          session(addDays(START, i * 7), [
            exercise("dominada-v", 5 + i, [8, 8, 7], 1, {
              equipment: "BODYWEIGHT",
              movementPattern: "VERTICAL_PULL",
            }),
          ]),
        ),
      ).exercises[0];
      expect(e.points[0].equivalentLoadKg).toBeNull();
      expect(e.points[0].e1rmKg).toBeNull();
      expect(e.comparison!.basis).toBe("VOLUME_LOAD");
      expect(e.comparison!.verdict).toBe("UP");
    });

    it("sin RIR no hay e1RM ni media de RIR, pero sí carga equivalente", () => {
      const p = stats([
        session(START, [exercise("press-maquina", 50, [10, 10], null)]),
      ]).exercises[0].points[0];
      expect(p.avgRir).toBeNull();
      expect(p.e1rmKg).toBeNull();
      expect(p.equivalentLoadKg).toBe(50);
    });

    it("con reps altas no hay e1RM~, y el resumen cuenta las variantes aparte", () => {
      const s = stats(
        Array.from({ length: 4 }, (_, i) =>
          session(addDays(START, i * 7), [
            exercise("curl-v", 10, [15, 15], 0, {
              movementPattern: "ISOLATION",
            }),
            exercise("press-maquina", 50, [10, 10], 1, { ordinal: 2 }),
          ]),
        ),
      );
      const curl = s.exercises.find((e) => e.variantId === "curl-v")!;
      expect(curl.points[0].e1rmKg).toBeNull();
      expect(curl.comparison!.end.e1rmKg).toBeNull();
      expect(s.comparison.compared).toBe(2);
      expect(s.comparison.flat).toBe(2);
    });
  });

  describe("volumen por músculo", () => {
    const s = stats([
      session(START, [exercise("press-maquina", 50, [10, 10, 10])]),
      session(addDays(START, 1), [
        exercise("curl-v", 10, [12, 12], 1, { movementPattern: "ISOLATION" }),
      ]),
      session(addDays(START, 14), [exercise("press-maquina", 50, [10, 10])]),
    ]);
    const of = (code: string) => s.volume.muscles.find((m) => m.code === code)!;

    it("cuenta directas enteras e indirectas por su factor, semana a semana", () => {
      expect(of("PECHO_SUPERIOR").weeks).toEqual([3, null, 2]);
      expect(of("TRICEPS").weeks).toEqual([1.5, null, 1]);
    });

    it("una semana sin sesiones es un hueco, no un cero", () => {
      expect(of("BICEPS").weeks).toEqual([2, null, 0]);
    });

    it("la media reparte entre todas las semanas del bloque", () => {
      expect(of("PECHO_SUPERIOR").avgEffectiveSets).toBeCloseTo(1.7, 5);
      expect(of("PECHO_SUPERIOR").avgDirectSets).toBeCloseTo(1.7, 5);
      expect(of("TRICEPS").avgDirectSets).toBe(0);
    });

    it("avisa de las series que no puede atribuir, en vez de tragárselas", () => {
      const r = stats([session(START, [exercise("borrado", 10, [10, 10])])]);
      expect(r.volume.unattributedSets).toBe(2);
    });
  });

  describe("esfuerzo y recuperación", () => {
    const s = stats([
      session(
        START,
        [
          exercise("press-maquina", 50, [8, 8], 2),
          exercise("curl-v", 10, [10, 10], 0, {
            movementPattern: "ISOLATION",
            ordinal: 2,
          }),
          exercise("curl-v", 10, [10], null, {
            movementPattern: "ISOLATION",
            ordinal: 3,
          }),
        ],
        { fatigue: 4, jointPain: null },
      ),
      session(addDays(START, 2), [exercise("press-maquina", 50, [8], 1)], {
        fatigue: 2,
        jointPain: 3,
      }),
    ]);

    it("separa básicos y aislamientos y no imputa el RIR que falta", () => {
      const week = s.effort[0];
      expect(week.avgRirCompound).toBeCloseTo(1.7, 5);
      expect(week.avgRirIsolation).toBe(0);
      expect(week.setsWithRir).toBe(5);
      expect(week.setsWithoutRir).toBe(1);
      expect(week.failurePct).toBe(40);
    });

    it("promedia las valoraciones ignorando las que no se contestaron", () => {
      const week = s.recovery[0];
      expect(week.sessions).toBe(2);
      expect(week.fatigue).toBe(3);
      expect(week.jointPain).toBe(3);
    });
  });

  describe("inicio y final del bloque", () => {
    it("con 6 semanas o más compara 3 contra 3 y da los dos extremos", () => {
      const s = stats(
        Array.from({ length: 6 }, (_, i) =>
          session(
            addDays(START, i * 7),
            [
              exercise(
                "press-maquina",
                50,
                i < 3 ? [10, 10] : [10, 10, 10, 10],
              ),
            ],
            { fatigue: i < 3 ? 2 : 4 },
          ),
        ),
      );
      expect(s.startEnd!.windowWeeks).toBe(3);
      const m = (k: string) => s.startEnd!.metrics.find((x) => x.key === k)!;
      expect(m("SESSIONS_PER_WEEK")).toMatchObject({ start: 1, end: 1 });
      expect(m("SETS_PER_WEEK")).toMatchObject({ start: 2, end: 4 });
      expect(m("FATIGUE")).toMatchObject({ start: 2, end: 4 });
    });

    it("con menos de 4 semanas no se puede separar inicio de final", () => {
      const s = stats([
        session(START, [exercise("press-maquina", 50, [10])]),
        session(addDays(START, 14), [exercise("press-maquina", 50, [10])]),
      ]);
      expect(s.startEnd).toBeNull();
    });
  });

  it("es determinista y no depende del orden de entrada", () => {
    const sesiones = [
      session(addDays(START, 7), [exercise("press-maquina", 52.5, [10, 10])]),
      session(START, [exercise("press-maquina", 50, [10, 10])]),
    ];
    expect(stats(sesiones)).toEqual(stats([...sesiones].reverse()));
    expect(stats(sesiones).startLocalDate).toBe(START);
  });
});
