import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CustomExerciseInput } from "@/core/schemas/custom-exercise";
import { onboardingSchema } from "@/core/schemas/onboarding";

import { createTestDatabase } from "./helpers/test-db";
import { createTestUser } from "./helpers/users";

/**
 * Crear un ejercicio DESDE el flujo de programa.
 *
 * La biblioteca ya sabía crear ejercicios propios; lo que faltaba era poder
 * hacerlo sin abandonar el builder o el editor cuando descubres, a mitad de
 * armar el programa, que tu gimnasio tiene algo que el catálogo no cubre.
 *
 * Lo que se prueba aquí es que es LA MISMA capability, no una segunda copia:
 * mismo esquema, mismo service, misma comprobación de propiedad y el mismo
 * motor de defaults. Un ejercicio creado desde el programa tiene que ser
 * indistinguible de uno creado desde la biblioteca.
 */

const testDb = await createTestDatabase();
process.env.DATABASE_URL = testDb.url;

const { prisma } = await import("@/server/db");
const { runSeed } = await import("../../prisma/seed/run-seed");
const { completeOnboarding } =
  await import("@/server/services/onboarding.service");
const { createCustomExercise, DuplicateExerciseNameError } =
  await import("@/server/services/custom-exercise.service");
const { getBuilderVariant, listBuilderCatalog } =
  await import("@/server/repositories/builder-catalog.repo");
const { listLibrary } =
  await import("@/server/repositories/exercise-library.repo");
const { addTemplateExercise } =
  await import("@/server/services/program-edit.service");

const ONBOARDING = onboardingSchema.parse({
  sex: "MALE",
  birthDate: "1992-03-10",
  heightCm: 178,
  weightKg: 84,
  trainingYears: 3,
  daysPerWeek: 3,
  minutesPerSession: 75,
  equipment: ["BARBELL", "DUMBBELL", "MACHINE", "CABLE", "BODYWEIGHT"],
  strategy: "LEAN_GAIN",
  dailySteps: 8000,
  workActivity: "SEDENTARY",
  balancedProgram: true,
  priorityMuscles: [],
});

/** Un remo unilateral en máquina: compuesto guiado, el caso interesante. */
const REMO_MAQUINA: CustomExerciseInput = {
  name: "Remo Hammer unilateral",
  movementPattern: "HORIZONTAL_PULL",
  systemicFatigue: 2,
  instructions: "",
  primaryMuscle: "ESPALDA_ALTA",
  secondaryMuscles: [{ group: "DORSAL", factor: 0.5 }],
  variantName: "Máquina de discos",
  equipment: "MACHINE",
  loadStepKg: 5,
  repRangeMin: 8,
  repRangeMax: 12,
  restSeconds: 90,
  contraindications: [],
};

let ana: string;
let bruno: string;
let templateId: string;

beforeAll(async () => {
  await runSeed(prisma);
  const result = await completeOnboarding(
    await createTestUser(prisma, "ana"),
    ONBOARDING,
    new Date("2026-08-31T08:00:00Z"),
  );
  ana = result.profileId;
  const program = await prisma.trainingProgram.findUniqueOrThrow({
    where: { id: result.programId },
    include: {
      mesocycles: { include: { templates: { orderBy: { ordinal: "asc" } } } },
    },
  });
  templateId = program.mesocycles[0].templates[0].id;

  const otro = await completeOnboarding(
    await createTestUser(prisma, "bruno"),
    ONBOARDING,
    new Date("2026-08-31T08:00:00Z"),
  );
  bruno = otro.profileId;
});

afterAll(async () => {
  await prisma.$disconnect();
  testDb.cleanup();
});

describe("crear un ejercicio sin salir del programa", () => {
  it("queda listo para añadirlo al programa en el mismo gesto", async () => {
    const { variantId } = await createCustomExercise(ana, REMO_MAQUINA);

    // Es lo que devuelve la acción al builder: la fila del picker, ya con su
    // RIR resuelto por el motor de defaults (no por el cliente).
    const fila = await getBuilderVariant(ana, variantId);
    expect(fila).not.toBeNull();
    expect(fila!.variantId).toBe(variantId);
    expect(fila!.label).toBe("Remo Hammer unilateral — Máquina de discos");
    expect(fila!.primaryMuscle).toBe("Espalda alta");
    // Compuesto guiado → 1. Ni 0 (es un compuesto) ni 2 (no es carga libre).
    expect(fila!.defaultTargetRir).toBe(1);

    // Y añadirlo al programa graba ESE RIR, no un literal.
    await addTemplateExercise(ana, templateId, variantId);
    const te = await prisma.templateExercise.findFirstOrThrow({
      where: { templateId, exerciseVariantId: variantId },
    });
    expect(te.targetRir).toBe(1);
    expect(te.repRangeMin).toBe(REMO_MAQUINA.repRangeMin);
    expect(te.restSeconds).toBe(REMO_MAQUINA.restSeconds);
  });

  it("aparece después en la biblioteca, como cualquier otro", async () => {
    const biblioteca = await listLibrary(ana);
    const creado = biblioteca.find((e) => e.name === REMO_MAQUINA.name);
    expect(creado).toBeDefined();
    expect(creado!.isOwn).toBe(true);
    expect(creado!.movementPattern).toBe("HORIZONTAL_PULL");
    expect(creado!.variants.map((v) => v.name)).toEqual([
      REMO_MAQUINA.variantName,
    ]);
  });

  it("y en el picker del builder, junto al catálogo global", async () => {
    const catalogo = await listBuilderCatalog(ana);
    const fila = catalogo.find((v) => v.label.startsWith(REMO_MAQUINA.name));
    expect(fila).toBeDefined();
    expect(fila!.defaultTargetRir).toBe(1);
    // El catálogo global sigue entero: crear no sustituye a nada.
    expect(catalogo.length).toBeGreaterThan(200);
  });

  it("sigue siendo PRIVADO: crear desde el programa no lo hace global", async () => {
    // El modelo de propiedad no cambia por la puerta de entrada. Es la misma
    // capability, así que hereda la misma semántica.
    const deBruno = await listBuilderCatalog(bruno);
    expect(
      deBruno.find((v) => v.label.startsWith(REMO_MAQUINA.name)),
    ).toBeUndefined();
    expect(await getBuilderVariant(bruno, (await variantDeAna()).id)).toBeNull();
  });

  it("rechaza el nombre repetido, con el mismo error que la biblioteca", async () => {
    await expect(
      createCustomExercise(ana, REMO_MAQUINA),
    ).rejects.toBeInstanceOf(DuplicateExerciseNameError);
    // Y también si lo intenta otra persona: el nombre es único global.
    await expect(
      createCustomExercise(bruno, REMO_MAQUINA),
    ).rejects.toBeInstanceOf(DuplicateExerciseNameError);
  });

  it("rechaza chocar con un ejercicio del catálogo global", async () => {
    await expect(
      createCustomExercise(ana, { ...REMO_MAQUINA, name: "Press banca" }),
    ).rejects.toBeInstanceOf(DuplicateExerciseNameError);
  });
});

async function variantDeAna() {
  return prisma.exerciseVariant.findFirstOrThrow({
    where: { exercise: { name: REMO_MAQUINA.name } },
    select: { id: true },
  });
}
