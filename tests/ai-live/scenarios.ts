import type { PrismaClient } from "@/generated/prisma/client";
import { addDays } from "@/core/dates";
import { bodyCheckInSchema } from "@/core/schemas/body-measurement";
import { goalUpdateSchema } from "@/core/schemas/goal-update";
import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestUser } from "../integration/helpers/users";
import { seedCompletedSessionWithSets } from "../integration/helpers/seed-sessions";

/**
 * Perfiles de prueba para la QA en vivo del Coach (B6).
 *
 * REGLA DE ESTE ARCHIVO: los escenarios se construyen con los SERVICIOS
 * REALES sobre una base de datos temporal. Nada se escribe a mano en el
 * contexto que viaja al modelo: si un escenario dice "peso bajando con el
 * rendimiento cayendo", es porque los motores deterministas lo han dictaminado
 * así sobre datos sembrados, no porque yo lo haya declarado.
 *
 * El precio de hacerlo así es que un escenario puede NO salir como se
 * pretendía. Por eso cada uno declara lo que espera y el runner verifica el
 * estado real antes de gastar una sola llamada: evaluar el caso "B" contra un
 * perfil que en realidad es "A" daría un informe limpio y falso.
 */

export const HOY = "2026-09-01";
export const AHORA = new Date(`${HOY}T10:00:00Z`);

const BASE: Record<string, unknown> = {
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  trainingYears: 3,
  daysPerWeek: 4,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
  strategy: "FAT_LOSS_MUSCLE_PRESERVATION",
  weeklyRatePct: -0.5,
  targetWeightKg: 78,
  dailySteps: 8500,
  workActivity: "SEDENTARY",
  balancedProgram: true,
  priorityMuscles: [],
  contraindications: [],
  excludedExerciseNames: [],
} as const;

export interface Montaje {
  profileId: string;
  mesocycleId: string;
  templateIds: string[];
  variantIds: string[];
}

type Servicios = typeof import("@/server/services/body.service");

export interface Deps {
  prisma: PrismaClient;
  body: Servicios;
  completeOnboarding: typeof import("@/server/services/onboarding.service").completeOnboarding;
}

async function montar(
  d: Deps,
  username: string,
  overrides: Record<string, unknown> = {},
  diasAtras = 60,
): Promise<Montaje> {
  const userId = await createTestUser(d.prisma, username);
  const crudo: Record<string, unknown> = { ...BASE, ...overrides };
  // `targetWeightKg: undefined` significa "sin peso objetivo": el schema del
  // onboarding no admite `null`, así que la clave se quita en vez de anularse.
  for (const k of Object.keys(crudo)) {
    if (crudo[k] === undefined) delete crudo[k];
  }
  const { profileId } = await d.completeOnboarding(
    userId,
    onboardingSchema.parse(crudo),
    new Date(`${addDays(HOY, -diasAtras)}T10:00:00Z`),
  );
  const program = await d.prisma.trainingProgram.findFirstOrThrow({
    where: { profileId, isActive: true },
    include: {
      mesocycles: {
        include: {
          templates: {
            orderBy: { ordinal: "asc" },
            include: { exercises: { orderBy: { ordinal: "asc" } } },
          },
        },
      },
    },
  });
  const meso = program.mesocycles[0];
  return {
    profileId,
    mesocycleId: meso.id,
    templateIds: meso.templates.map((t) => t.id),
    variantIds: meso.templates
      .flatMap((t) => t.exercises)
      .map((e) => e.exerciseVariantId),
  };
}

/** Serie de pesajes diarios generada por una función del índice. */
async function pesajes(
  d: Deps,
  profileId: string,
  n: number,
  kg: (diasAtras: number, indice: number) => number,
) {
  for (let i = n - 1; i >= 0; i--) {
    await d.body.saveWeight(
      profileId,
      { localDate: addDays(HOY, -i), weightKg: kg(i, n - 1 - i) },
      AHORA,
    );
  }
}

/** Una exposición: carga, repeticiones y RIR por serie. */
type Exposicion = { kg: number; reps: number; rir?: number };

/** Historial de una variante: una exposición cada 4 días. */
async function exposiciones(
  d: Deps,
  m: Montaje,
  variantId: string,
  serie: Exposicion[],
) {
  for (let i = 0; i < serie.length; i++) {
    await seedCompletedSessionWithSets(d.prisma, {
      mesocycleId: m.mesocycleId,
      templateId: m.templateIds[0],
      variantId,
      localDate: addDays(HOY, -(serie.length - i) * 4),
      weekNumber: i + 1,
      sets: [1, 2, 3].map((n) => ({
        setNumber: n,
        weightKg: serie[i].kg,
        reps: serie[i].reps,
        rir: serie[i].rir ?? 2,
      })),
    });
  }
}

async function entrenamiento(d: Deps, m: Montaje, serie: Exposicion[]) {
  for (const v of m.variantIds.slice(0, 4)) {
    await exposiciones(d, m, v, serie);
  }
}

/** Ruido diario pequeño: peso plano de verdad, dentro de la banda del motor. */
const FINO = [0.1, -0.1, 0.15, -0.05, 0.05, -0.15, 0];

const kg = (xs: number[], reps = 10): Exposicion[] =>
  xs.map((k) => ({ kg: k, reps }));

const SUBIENDO = kg([60, 62.5, 65, 67.5]);
/**
 * Rendimiento SOSTENIDO: ni retrocede ni el motor pide avanzar. Se consigue
 * cerrando el rango con RIR 0 —el motor no sube carga a quien ya está al
 * fallo—, que es el `NEAR_FAILURE_HOLD` real del motor y no un apaño.
 */
const SOSTENIDO: Exposicion[] = [
  { kg: 70, reps: 10, rir: 2 },
  { kg: 70, reps: 10, rir: 2 },
  { kg: 70, reps: 10, rir: 2 },
  { kg: 70, reps: 9, rir: 0 },
];
/**
 * Caída de verdad: el motor tiene que haber llevado la carga hacia atrás y no
 * haberla recuperado. Bajar de peso manteniendo las repeticiones NO sirve —el
 * motor lee eso como doble progresión reconstruyendo—, así que las últimas
 * exposiciones se quedan por debajo del rango con el mismo peso.
 */
const CAYENDO: Exposicion[] = [
  { kg: 70, reps: 10 },
  { kg: 70, reps: 10 },
  { kg: 70, reps: 6 },
  { kg: 70, reps: 5 },
  { kg: 70, reps: 5 },
];

export interface Escenario {
  id: string;
  titulo: string;
  profileId: string;
  /** Lo que los motores DEBEN dictaminar. El runner lo verifica antes de nada. */
  esperado: {
    weight: string;
    performance?: string;
    goalAssessment?: string | null;
    waistProtocol?: string;
    waistStatus?: string;
    bodyFat?: boolean;
  };
}

/**
 * Construye la batería de perfiles. Cada uno vive en la misma base temporal,
 * lo que además hace que un escape de datos entre perfiles sea POSIBLE — y por
 * tanto detectable.
 */
export async function construirEscenarios(d: Deps): Promise<Escenario[]> {
  const out: Escenario[] = [];

  // ── A. FAT_LOSS · peso bajando · rendimiento sostenido ──────────────────
  const a = await montar(d, "eval-a");
  await pesajes(d, a.profileId, 28, (i) => 84 - 0.06 * (27 - i));
  await entrenamiento(d, a, SUBIENDO);
  out.push({
    id: "A",
    titulo: "FAT_LOSS · peso bajando · rendimiento sostenido",
    profileId: a.profileId,
    esperado: { weight: "LOSING" },
  });

  // ── A2. FAT_LOSS · peso bajando · rendimiento SOSTENIDO ────────────────
  const a2 = await montar(d, "eval-a2");
  await pesajes(d, a2.profileId, 28, (i) => 84 - 0.06 * (27 - i));
  await entrenamiento(d, a2, SOSTENIDO);
  out.push({
    id: "A2",
    titulo: "FAT_LOSS · peso bajando · rendimiento sostenido (HELD)",
    profileId: a2.profileId,
    esperado: { weight: "LOSING", performance: "STABLE" },
  });

  // ── B. FAT_LOSS · peso bajando · rendimiento cayendo ────────────────────
  const b = await montar(d, "eval-b");
  await pesajes(d, b.profileId, 28, (i) => 84 - 0.06 * (27 - i));
  await entrenamiento(d, b, CAYENDO);
  out.push({
    id: "B",
    titulo: "FAT_LOSS · peso bajando · rendimiento cayendo",
    profileId: b.profileId,
    esperado: { weight: "LOSING", performance: "DECLINING" },
  });

  // ── C. LEAN_GAIN · peso subiendo · rendimiento subiendo ─────────────────
  const c = await montar(d, "eval-c", {
    strategy: "LEAN_GAIN",
    weeklyRatePct: 0.25,
    weightKg: 78,
    targetWeightKg: 84,
  });
  await pesajes(d, c.profileId, 28, (i) => 78 + 0.028 * (27 - i));
  await entrenamiento(d, c, SUBIENDO);
  out.push({
    id: "C",
    titulo: "LEAN_GAIN · peso subiendo · rendimiento subiendo",
    profileId: c.profileId,
    esperado: { weight: "GAINING" },
  });

  // ── D. RECOMP · peso estable · rendimiento subiendo ─────────────────────
  const dEsc = await montar(d, "eval-d", {
    strategy: "RECOMP_MAINTAIN_WEIGHT",
    weeklyRatePct: 0,
    weightKg: 80,
    targetWeightKg: undefined,
  });
  await pesajes(d, dEsc.profileId, 28, (_i, k) => 80 + FINO[k % FINO.length]);
  await entrenamiento(d, dEsc, SUBIENDO);
  out.push({
    id: "D",
    titulo: "RECOMP · peso estable · rendimiento subiendo",
    profileId: dEsc.profileId,
    esperado: { weight: "MAINTAINING" },
  });

  // ── E. INCONCLUSIVE · pendiente calculada pero no afirmable ─────────────
  const ruidoGrande = [0.9, -0.8, 0.3, -0.9, 0.8, -0.2, -0.1];
  const e = await montar(d, "eval-e");
  await pesajes(
    d,
    e.profileId,
    28,
    (_i, k) => 84 + ruidoGrande[k % ruidoGrande.length],
  );
  await entrenamiento(d, e, SUBIENDO);
  out.push({
    id: "E",
    titulo: "INCONCLUSIVE · el motor tiene pendiente, el contexto no",
    profileId: e.profileId,
    esperado: { weight: "INCONCLUSIVE" },
  });

  // ── F. INSUFFICIENT_DATA · tres pesajes ─────────────────────────────────
  const f = await montar(d, "eval-f");
  await pesajes(d, f.profileId, 3, (i) => 84 - 0.1 * (2 - i));
  await entrenamiento(d, f, SUBIENDO);
  out.push({
    id: "F",
    titulo: "INSUFFICIENT_DATA · tres pesajes",
    profileId: f.profileId,
    esperado: { weight: "INSUFFICIENT_DATA" },
  });

  // ── G. % graso estimado presente ────────────────────────────────────────
  const g = await montar(d, "eval-g");
  await pesajes(d, g.profileId, 28, (i) => 84 - 0.06 * (27 - i));
  await entrenamiento(d, g, SUBIENDO);
  await d.body.saveMeasurement(
    g.profileId,
    {
      localDate: addDays(HOY, -56),
      weightKg: 87,
      waistCm: null,
      bodyFatPct: 19,
      bodyFatReliability: "ESTIMATED",
      waistProtocol: null,
    },
    AHORA,
  );
  await d.body.saveMeasurement(
    g.profileId,
    {
      localDate: HOY,
      weightKg: 82.4,
      waistCm: null,
      bodyFatPct: 18,
      bodyFatReliability: "ESTIMATED",
      waistProtocol: null,
    },
    AHORA,
  );
  out.push({
    id: "G",
    titulo: "% graso estimado (18 %), cambio por debajo del umbral",
    profileId: g.profileId,
    esperado: { weight: "LOSING", bodyFat: true },
  });

  // ── H1. Cintura de TRES TOMAS (umbral fino, 3,1 cm) ─────────────────────
  const h1 = await montar(d, "eval-h1");
  await pesajes(d, h1.profileId, 28, (i) => 84 - 0.06 * (27 - i));
  await entrenamiento(d, h1, SUBIENDO);
  // Cambio elegido a propósito ENTRE los dos umbrales (3,1 y 5,4 cm): es la
  // única zona donde el protocolo cambia el veredicto, y por tanto la única
  // que prueba si el modelo entiende que la precisión depende de cómo se midió.
  for (const [dias, w] of [
    [84, [97.8, 98.2, 98.0]],
    [56, [95.7, 96.1, 95.9]],
    [28, [93.7, 94.1, 93.9]],
    [0, [91.7, 92.1, 91.9]],
  ] as Array<[number, number[]]>) {
    await d.body.submitCheckIn(
      h1.profileId,
      bodyCheckInSchema.parse({
        localDate: addDays(HOY, -dias),
        waist1: w[0],
        waist2: w[1],
        waist3: w[2],
      }),
      AHORA,
    );
  }
  out.push({
    id: "H1",
    titulo: "Cintura MEAN_OF_THREE · umbral 3,1 cm",
    profileId: h1.profileId,
    esperado: {
      weight: "LOSING",
      waistProtocol: "MEAN_OF_THREE",
      waistStatus: "DECREASING",
    },
  });

  // ── H2. Cintura MIXTA (una toma antigua, umbral grueso 5,4 cm) ──────────
  const h2 = await montar(d, "eval-h2");
  await pesajes(d, h2.profileId, 28, (i) => 84 - 0.06 * (27 - i));
  await entrenamiento(d, h2, SUBIENDO);
  // Mediciones de una sola toma: es lo que deja el onboarding y la edición a
  // mano del historial, y su error es casi el doble.
  for (const [dias, cm] of [
    [84, 98.0],
    [56, 95.9],
    [28, 93.9],
    [0, 91.9],
  ] as Array<[number, number]>) {
    await d.body.saveMeasurement(
      h2.profileId,
      {
        localDate: addDays(HOY, -dias),
        weightKg: null,
        waistCm: cm,
        bodyFatPct: null,
        bodyFatReliability: null,
        waistProtocol: null,
      },
      AHORA,
    );
  }
  out.push({
    id: "H2",
    titulo: "Cintura de una toma · umbral 5,4 cm",
    profileId: h2.profileId,
    esperado: {
      weight: "LOSING",
      waistProtocol: "SINGLE",
      waistStatus: "WITHIN_MEASUREMENT_ERROR",
    },
  });

  // ── Cobertura de `goalAssessmentCode` ──────────────────────────────────
  //
  // El modelo recibe el CÓDIGO, no la frase determinista de la pantalla. Para
  // saber si lo interpreta bien hace falta un perfil real por cada código que
  // de verdad puede viajar; inventarlos a mano en el contexto probaría otra
  // cosa (que sabe leer una etiqueta), no que el sistema los produce y los
  // explica de forma coherente.
  const restantes: Array<{
    id: string;
    user: string;
    titulo: string;
    perfil: Record<string, unknown>;
    peso: (i: number, k: number) => number;
    entreno: Exposicion[];
    weight: string;
    code: string;
  }> = [
    {
      id: "GC-GAIN-HELD",
      user: "eval-gain-held",
      titulo: "LEAN_GAIN · peso subiendo · rendimiento sostenido",
      perfil: {
        strategy: "LEAN_GAIN",
        weeklyRatePct: 0.25,
        weightKg: 78,
        targetWeightKg: 84,
      },
      peso: (i) => 78 + 0.028 * (27 - i),
      entreno: SOSTENIDO,
      weight: "GAINING",
      code: "GAINING_PERFORMANCE_HELD",
    },
    {
      id: "GC-GAIN-DOWN",
      user: "eval-gain-down",
      titulo: "LEAN_GAIN · peso subiendo · rendimiento cayendo",
      perfil: {
        strategy: "LEAN_GAIN",
        weeklyRatePct: 0.25,
        weightKg: 78,
        targetWeightKg: 84,
      },
      peso: (i) => 78 + 0.028 * (27 - i),
      entreno: CAYENDO,
      weight: "GAINING",
      code: "GAINING_PERFORMANCE_DOWN",
    },
    {
      id: "GC-NOT-MOVING",
      user: "eval-not-moving",
      titulo: "FAT_LOSS · peso quieto · rendimiento sostenido",
      perfil: {},
      peso: (_i, k) => 84 + FINO[k % FINO.length],
      entreno: SOSTENIDO,
      weight: "MAINTAINING",
      code: "WEIGHT_NOT_MOVING",
    },
    {
      id: "GC-AGAINST",
      user: "eval-against",
      titulo: "FAT_LOSS · peso SUBIENDO (contra el objetivo)",
      perfil: {},
      peso: (i) => 84 + 0.03 * (27 - i),
      entreno: SOSTENIDO,
      weight: "GAINING",
      code: "MOVING_AGAINST_GOAL",
    },
    {
      id: "GC-HOLDING",
      user: "eval-holding",
      titulo: "MAINTENANCE · peso quieto · rendimiento sostenido",
      perfil: {
        strategy: "MAINTENANCE",
        weeklyRatePct: 0,
        targetWeightKg: undefined,
      },
      peso: (_i, k) => 84 + FINO[k % FINO.length],
      entreno: SOSTENIDO,
      weight: "MAINTAINING",
      code: "HOLDING_AS_INTENDED",
    },
    {
      id: "GC-DRIFT",
      user: "eval-drift",
      titulo: "MAINTENANCE · el peso se está yendo",
      perfil: {
        strategy: "MAINTENANCE",
        weeklyRatePct: 0,
        targetWeightKg: undefined,
      },
      peso: (i) => 84 - 0.06 * (27 - i),
      entreno: SOSTENIDO,
      weight: "LOSING",
      code: "WEIGHT_DRIFTING",
    },
  ];

  for (const r of restantes) {
    const m = await montar(d, r.user, r.perfil);
    await pesajes(d, m.profileId, 28, r.peso);
    await entrenamiento(d, m, r.entreno);
    out.push({
      id: r.id,
      titulo: r.titulo,
      profileId: m.profileId,
      esperado: { weight: r.weight, goalAssessment: r.code },
    });
  }

  return out;
}

export { montar, pesajes, entrenamiento, kg, goalUpdateSchema };
export type { Exposicion };
