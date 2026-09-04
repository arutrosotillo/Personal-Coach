import { describe, expect, it } from "vitest";

import { TARGET_RIR } from "@/core/config/training-config";
import { defaultTargetRir, resolveStability } from "./prescription-defaults";

/**
 * El RIR objetivo por defecto.
 *
 * Lo que estos tests protegen NO es la fórmula, es la decisión de producto: el
 * objetivo depende de qué EJERCICIO haces (rol y coste sistémico) **y de con
 * qué lo haces** (estabilidad de la variante). Antes dependía solo de lo
 * primero, así que la sentadilla en multipower recibía el mismo objetivo que
 * la sentadilla con barra libre y el press en máquina el mismo que con barra.
 */

/** Azúcar: los casos se leen como se leen en el gimnasio. */
const rir = (
  pattern: string,
  fatiga: number,
  equipment: string,
  stability: string | null = null,
) => defaultTargetRir(pattern, fatiga, stability, equipment);

describe("defaultTargetRir — el rol sigue mandando", () => {
  it("un aislamiento se entrena al fallo se haga donde se haga", () => {
    for (const material of [
      "DUMBBELL",
      "CABLE",
      "MACHINE",
      "BARBELL",
      "EZ_BAR",
      "BODYWEIGHT",
      "BAND",
      "SMITH_MACHINE",
    ]) {
      expect(rir("ISOLATION", 1, material)).toBe(TARGET_RIR.isolation);
    }
  });

  it("un compuesto nunca baja de 1, ni en la máquina más segura", () => {
    // Llevar TODAS las series de un multiarticular al fallo es caro en fatiga
    // se haga donde se haga, y la evidencia no compra nada a cambio.
    expect(rir("SQUAT", 2, "MACHINE")).toBe(TARGET_RIR.compound);
    expect(rir("VERTICAL_PULL", 1, "CABLE")).toBe(TARGET_RIR.compound);
  });

  it("un compuesto nunca sube de 2, ni siendo pesado y libre", () => {
    expect(rir("SQUAT", 3, "BARBELL")).toBe(TARGET_RIR.compoundHeavy);
    expect(rir("HINGE", 3, "BARBELL")).toBe(TARGET_RIR.compoundHeavy);
  });

  it("los tres roles siguen ordenados (aisl < comp < pesado)", () => {
    expect(TARGET_RIR.isolation).toBeLessThan(TARGET_RIR.compound);
    expect(TARGET_RIR.compound).toBeLessThan(TARGET_RIR.compoundHeavy);
  });

  it("sin material ni estabilidad conocidos no endurece ni relaja", () => {
    // Compatibilidad con las llamadas de dos argumentos: SUPPORTED, ajuste 0.
    expect(defaultTargetRir("SQUAT", 3)).toBe(TARGET_RIR.compoundHeavy);
    expect(defaultTargetRir("HORIZONTAL_PUSH", 2)).toBe(TARGET_RIR.compound);
    expect(defaultTargetRir("ISOLATION", 1)).toBe(TARGET_RIR.isolation);
    expect(resolveStability(null, "MATERIAL_QUE_NO_EXISTE")).toBe("SUPPORTED");
    expect(resolveStability("BASURA", "MACHINE")).toBe("GUIDED");
  });
});

describe("defaultTargetRir — el mismo movimiento, distinto aparato", () => {
  it("Back squat con barra ≠ sentadilla en multipower", () => {
    // Es el mismo `movementPattern` y la misma `systemicFatigue`: si el modelo
    // no mirase la variante, estos dos números serían iguales. Ese era el bug.
    const barra = rir("SQUAT", 3, "BARBELL");
    const multipower = rir("SQUAT", 3, "SMITH_MACHINE");
    expect(barra).toBe(2);
    expect(multipower).toBe(1);
    expect(multipower).toBeLessThan(barra);
  });

  it("Press banca con barra pide más reserva que en máquina", () => {
    // Fallar una banca con barra sin pines te deja debajo del peso; fallar en
    // la máquina es apoyar las placas.
    expect(rir("HORIZONTAL_PUSH", 2, "BARBELL")).toBe(2);
    expect(rir("HORIZONTAL_PUSH", 2, "MACHINE")).toBe(1);
    expect(rir("HORIZONTAL_PUSH", 2, "DUMBBELL")).toBe(1);
  });

  it("Remo con barra ≠ remo con apoyo pectoral en máquina", () => {
    // El caso que motivó la auditoría: "row" no es una prescripción.
    expect(rir("HORIZONTAL_PULL", 3, "BARBELL")).toBe(2);
    expect(rir("HORIZONTAL_PULL", 2, "MACHINE")).toBe(1);
    expect(rir("HORIZONTAL_PULL", 2, "CABLE")).toBe(1);
  });

  it("Back squat ≠ zancada búlgara con mancuernas", () => {
    // Los dos son "pierna con carga libre" y no se acercan igual al fallo:
    // en la búlgara fallas soltando las mancuernas.
    expect(rir("SQUAT", 3, "BARBELL")).toBe(2);
    expect(rir("LUNGE", 2, "DUMBBELL")).toBe(1);
    expect(rir("LUNGE", 2, "SMITH_MACHINE")).toBe(1);
  });

  it("Peso muerto rumano con barra ≠ femoral tumbado", () => {
    expect(rir("HINGE", 3, "BARBELL")).toBe(2);
    // El femoral es un aislamiento guiado: acercarse al fallo ahí es gratis.
    expect(rir("ISOLATION", 1, "MACHINE")).toBe(0);
  });

  it("Press militar de pie con barra ≠ press en máquina", () => {
    expect(rir("VERTICAL_PUSH", 2, "BARBELL")).toBe(2);
    expect(rir("VERTICAL_PUSH", 2, "MACHINE")).toBe(1);
  });

  it("una variante puede declarar su estabilidad y ganar al material", () => {
    // Hip thrust con barra: carga libre, pero la espalda va apoyada y fallar es
    // sentarse. Sin la declaración saldría 2 solo por llevar una barra.
    expect(rir("HINGE", 2, "BARBELL")).toBe(2);
    expect(rir("HINGE", 2, "BARBELL", "SUPPORTED")).toBe(1);
  });
});

describe("defaultTargetRir — lo que NO hace", () => {
  it("máquina no significa 'al fallo' en un compuesto", () => {
    for (const patron of [
      "SQUAT",
      "HINGE",
      "LUNGE",
      "HORIZONTAL_PUSH",
      "VERTICAL_PUSH",
      "HORIZONTAL_PULL",
      "VERTICAL_PULL",
    ]) {
      for (const material of ["MACHINE", "SMITH_MACHINE", "CABLE", "BAND"]) {
        expect(rir(patron, 1, material)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("carga libre no significa 'siempre 2 de reserva'", () => {
    // El ajuste NO toca a los aislamientos: fallar un curl es soltar la barra,
    // no quedarse debajo de ella. Subirles la reserva sería inventar un riesgo.
    expect(rir("ISOLATION", 1, "DUMBBELL")).toBe(0);
    expect(rir("ISOLATION", 1, "BARBELL")).toBe(0);
    expect(rir("ISOLATION", 1, "BARBELL", "FREE")).toBe(0);
  });

  it("el objetivo se queda siempre dentro de 0..2", () => {
    for (const patron of ["SQUAT", "ISOLATION", "CORE", "VERTICAL_PULL"]) {
      for (const fatiga of [1, 2, 3]) {
        for (const material of [
          "BARBELL",
          "EZ_BAR",
          "DUMBBELL",
          "MACHINE",
          "SMITH_MACHINE",
          "CABLE",
          "BODYWEIGHT",
          "BAND",
        ]) {
          const value = rir(patron, fatiga, material);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(TARGET_RIR.compoundHeavy);
          expect(Number.isInteger(value)).toBe(true);
        }
      }
    }
  });
});
