import { describe, expect, it } from "vitest";

import { EXERCISES } from "@/core/catalog/exercises";
import { MUSCLE_GROUP_BY_CODE } from "@/core/catalog/muscle-groups";
import {
  COMPOUND_PATTERNS,
  TARGET_RIR,
} from "@/core/config/training-config";
import { Contraindication, Equipment, MovementPattern } from "@/core/enums";
import { defaultTargetRir } from "@/core/training/prescription-defaults";

/**
 * Invariantes del catálogo.
 *
 * El catálogo es un dato, no lógica, y por eso da MÁS miedo: un `ISOLATION`
 * donde tocaba `HORIZONTAL_PULL` no rompe ningún test de motor, no lanza
 * ninguna excepción y en producción se manifiesta como un remo prescrito al
 * fallo y un volumen de espalda que no cuadra. Fue exactamente lo que pasó con
 * un ejercicio real. Estos tests son la red para eso.
 *
 * Se ejecutan sobre el catálogo ENTERO, así que crecen solos con él.
 */

const ALL_VARIANTS = EXERCISES.flatMap((e) =>
  e.variants.map((v) => ({ exercise: e, variant: v })),
);

const SECONDARY_FACTORS = [0.75, 0.5, 0.25];

describe("catálogo · integridad estructural", () => {
  it("cada ejercicio tiene patrón válido, fatiga 1..3 e instrucciones", () => {
    for (const e of EXERCISES) {
      expect(MovementPattern.safeParse(e.movementPattern).success).toBe(true);
      expect([1, 2, 3]).toContain(e.systemicFatigue);
      expect(e.instructions.trim().length).toBeGreaterThan(10);
      expect(e.name.trim()).toBe(e.name);
      expect(e.name.length).toBeGreaterThan(2);
    }
  });

  it("cada ejercicio tiene EXACTAMENTE un músculo primario, y existe", () => {
    for (const e of EXERCISES) {
      const primary = e.contributions.filter((c) => c.role === "PRIMARY");
      expect(primary, e.name).toHaveLength(1);
      expect(primary[0].factor).toBe(1.0);
      expect(MUSCLE_GROUP_BY_CODE[primary[0].group], e.name).toBeDefined();
    }
  });

  it("los secundarios usan los cubos permitidos y no repiten al primario", () => {
    for (const e of EXERCISES) {
      const primary = e.contributions.find((c) => c.role === "PRIMARY")!.group;
      const secondary = e.contributions.filter((c) => c.role === "SECONDARY");
      for (const s of secondary) {
        expect(MUSCLE_GROUP_BY_CODE[s.group], `${e.name} → ${s.group}`).toBeDefined();
        expect(SECONDARY_FACTORS, `${e.name} → ${s.group}`).toContain(s.factor);
        expect(s.group, e.name).not.toBe(primary);
      }
      const groups = secondary.map((s) => s.group);
      expect(new Set(groups).size, `${e.name}: secundario repetido`).toBe(
        groups.length,
      );
    }
  });

  it("cada ejercicio tiene al menos una variante y exactamente una por defecto", () => {
    for (const e of EXERCISES) {
      expect(e.variants.length, e.name).toBeGreaterThan(0);
      expect(
        e.variants.filter((v) => v.isDefault).length,
        `${e.name}: variantes por defecto`,
      ).toBe(1);
    }
  });

  it("cada variante tiene material válido, rango coherente y paso razonable", () => {
    for (const { exercise, variant } of ALL_VARIANTS) {
      const donde = `${exercise.name} — ${variant.name}`;
      expect(Equipment.safeParse(variant.equipment).success, donde).toBe(true);
      expect(variant.repRangeMin, donde).toBeGreaterThan(0);
      expect(variant.repRangeMax, donde).toBeGreaterThanOrEqual(
        variant.repRangeMin,
      );
      expect(variant.repRangeMax, donde).toBeLessThanOrEqual(30);
      // `0` = sin carga externa cuantificable (peso corporal puro, banda).
      expect(variant.loadStepKg, donde).toBeGreaterThanOrEqual(0);
      expect(variant.loadStepKg, donde).toBeLessThanOrEqual(25);
      expect(variant.defaultRestSeconds, donde).toBeGreaterThanOrEqual(30);
      expect(variant.defaultRestSeconds, donde).toBeLessThanOrEqual(600);
      for (const contra of variant.contraindications) {
        expect(Contraindication.safeParse(contra).success, donde).toBe(true);
      }
      if (variant.stability !== undefined) {
        expect(["FREE", "SUPPORTED", "GUIDED"], donde).toContain(
          variant.stability,
        );
      }
    }
  });
});

describe("catálogo · sin duplicados", () => {
  it("los nombres de ejercicio son únicos (es la clave natural del seed)", () => {
    const names = EXERCISES.map((e) => e.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("los nombres de variante son únicos DENTRO de su ejercicio", () => {
    for (const e of EXERCISES) {
      const names = e.variants.map((v) => v.name);
      expect(new Set(names).size, `${e.name}: ${names.join(", ")}`).toBe(
        names.length,
      );
    }
  });

  it("no hay dos ejercicios con el mismo nombre normalizado", () => {
    // Caza "Remo bajo polea" vs "Remo Bajo Polea" vs "remo bajo  polea", que
    // el índice único de la base NO caza y el buscador enseñaría como dos.
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const seen = new Map<string, string>();
    for (const e of EXERCISES) {
      const key = norm(e.name);
      expect(seen.get(key), `"${e.name}" choca con "${seen.get(key)}"`).toBeUndefined();
      seen.set(key, e.name);
    }
  });

  it("ningún ejercicio mete el material en el nombre del movimiento", () => {
    // Era el patrón que producía duplicados: "Pullover en polea" no dejaba
    // sitio a la máquina ni a la mancuerna del MISMO movimiento, así que
    // invitaba a crear otro ejercicio. El material va en la variante.
    const materialEnNombre =
      /\b(en polea|con barra|en m[áa]quina|con mancuerna|en multipower)\b/i;
    const permitidos = new Set([
      // El material ES el movimiento: sin él no es el mismo ejercicio, y no
      // hay ninguna otra forma de cargarlo que quede fuera del nombre.
      "Remo con barra",
      "Curl con barra",
      "Curl con mancuernas",
      "Remo con mancuerna",
      "Curl inclinado con mancuernas",
      "Peso muerto con barra hexagonal",
      "Curl bayesian en polea",
      "Curl en polea",
      "Extensión de tríceps en polea",
      "Empuje de cadera en polea",
      "Rotación en polea",
    ]);
    const infractores = EXERCISES.map((e) => e.name)
      .filter((n) => materialEnNombre.test(n))
      .filter((n) => !permitidos.has(n));
    expect(infractores).toEqual([]);
  });
});

describe("catálogo · el RIR por defecto sale sano en TODAS las variantes", () => {
  const rirDe = (e: (typeof EXERCISES)[number], v: (typeof e.variants)[number]) =>
    defaultTargetRir(
      e.movementPattern,
      e.systemicFatigue,
      v.stability ?? null,
      v.equipment,
    );

  it("todos los objetivos caen en 0..2 y son enteros", () => {
    for (const { exercise, variant } of ALL_VARIANTS) {
      const rir = rirDe(exercise, variant);
      expect(Number.isInteger(rir)).toBe(true);
      expect(rir, `${exercise.name} — ${variant.name}`).toBeGreaterThanOrEqual(0);
      expect(rir, `${exercise.name} — ${variant.name}`).toBeLessThanOrEqual(2);
    }
  });

  it("ningún COMPUESTO se prescribe al fallo en todas las series", () => {
    for (const { exercise, variant } of ALL_VARIANTS) {
      if (!COMPOUND_PATTERNS.has(exercise.movementPattern)) continue;
      expect(
        rirDe(exercise, variant),
        `${exercise.name} — ${variant.name}`,
      ).toBeGreaterThanOrEqual(TARGET_RIR.compound);
    }
  });

  it("ningún AISLAMIENTO se aparta de 0: la estabilidad no le afecta", () => {
    for (const { exercise, variant } of ALL_VARIANTS) {
      if (COMPOUND_PATTERNS.has(exercise.movementPattern)) continue;
      expect(
        rirDe(exercise, variant),
        `${exercise.name} — ${variant.name}`,
      ).toBe(TARGET_RIR.isolation);
    }
  });

  it("los casos concretos que serían un escándalo si salieran mal", () => {
    const rirDeNombre = (exercise: string, variant: string) => {
      const e = EXERCISES.find((x) => x.name === exercise);
      expect(e, `falta "${exercise}" en el catálogo`).toBeDefined();
      const v = e!.variants.find((x) => x.name === variant);
      expect(v, `falta "${exercise} — ${variant}"`).toBeDefined();
      return rirDe(e!, v!);
    };

    // Peso muerto al fallo sería una lesión, no una prescripción.
    expect(rirDeNombre("Peso muerto convencional", "Barra")).toBe(2);
    expect(rirDeNombre("Peso muerto sumo", "Barra")).toBe(2);
    expect(rirDeNombre("Peso muerto rumano", "Barra")).toBe(2);
    // Una extensión de cuádriceps con 2 de reserva es tirar la serie.
    expect(rirDeNombre("Extensión de cuádriceps", "Máquina")).toBe(0);
    // Un curl con barra no es un movimiento de riesgo.
    expect(rirDeNombre("Curl con barra", "Barra recta")).toBe(0);
    // Un remo en máquina es seguro, pero sigue siendo un compuesto caro.
    expect(rirDeNombre("Remo con apoyo pectoral", "Máquina")).toBe(1);
    expect(rirDeNombre("Remo sentado", "Máquina sentado")).toBe(1);
    // El mismo movimiento, dos aparatos, dos prescripciones.
    expect(rirDeNombre("Sentadilla trasera", "Barra")).toBe(2);
    expect(rirDeNombre("Sentadilla trasera", "Multipower")).toBe(1);
    expect(rirDeNombre("Press banca", "Barra")).toBe(2);
    expect(rirDeNombre("Press banca", "Máquina")).toBe(1);
    // Las excepciones declaradas a mano siguen vivas.
    expect(rirDeNombre("Hip thrust", "Barra")).toBe(1);
    expect(rirDeNombre("Puente de glúteo", "Barra")).toBe(1);
  });
});

describe("catálogo · clasificación coherente", () => {
  it("nada que se llame remo/jalón/dominada está marcado como aislamiento", () => {
    // El fallo real que motivó esta comprobación: un remo unilateral en polea
    // creado como ISOLATION. Prescribía al fallo y contaba su volumen de
    // dorsal como trabajo directo de aislamiento.
    const tiraDeEspalda = /^(remo|jal[óo]n|dominadas|pullover)/i;
    for (const e of EXERCISES) {
      if (!tiraDeEspalda.test(e.name)) continue;
      // El pullover SÍ es un aislamiento (una sola articulación).
      if (e.name.startsWith("Pullover")) continue;
      expect(
        ["HORIZONTAL_PULL", "VERTICAL_PULL"],
        `${e.name} está como ${e.movementPattern}`,
      ).toContain(e.movementPattern);
    }
  });

  it("nada que se llame press/sentadilla/peso muerto es aislamiento", () => {
    const compuestoObvio = /^(press|sentadilla|peso muerto|prensa|zancada|dominadas|fondos)/i;
    for (const e of EXERCISES) {
      if (!compuestoObvio.test(e.name)) continue;
      // Excepciones reales: son de una sola articulación pese al nombre.
      if (["Press francés", "Press Pallof", "Sentadilla sissy"].includes(e.name)) {
        continue;
      }
      expect(
        COMPOUND_PATTERNS.has(e.movementPattern),
        `${e.name} está como ${e.movementPattern}`,
      ).toBe(true);
    }
  });

  it("solo los movimientos realmente caros llevan fatiga sistémica 3", () => {
    // `systemicFatigue: 3` sube el RIR base y el coste en minutos por serie.
    // Si se reparte a voluntad, el generador deja de caber en la sesión.
    const caros = EXERCISES.filter((e) => e.systemicFatigue === 3);
    for (const e of caros) {
      expect(
        ["SQUAT", "HINGE", "HORIZONTAL_PULL", "VERTICAL_PULL"],
        `${e.name} no parece un movimiento de fatiga 3`,
      ).toContain(e.movementPattern);
    }
  });

  it("el catálogo es determinista: dos lecturas dan exactamente lo mismo", () => {
    // Si alguien metiera `Math.random()` o una fecha en un constructor, el seed
    // reescribiría filas en cada despliegue y el diff sería ruido para siempre.
    expect(JSON.stringify(EXERCISES)).toBe(JSON.stringify(EXERCISES));
  });
});
