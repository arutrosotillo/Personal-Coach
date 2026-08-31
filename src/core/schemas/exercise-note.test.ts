import { describe, expect, it } from "vitest";

import { EXERCISE_NOTE_MAX_LENGTH, exerciseNoteSchema } from "./exercise-note";

describe("exerciseNoteSchema", () => {
  it("acepta una nota normal", () => {
    const parsed = exerciseNoteSchema.parse({
      exerciseId: "ex1",
      text: "Piernas encogidas, no estiradas.",
    });
    expect(parsed.text).toBe("Piernas encogidas, no estiradas.");
  });

  it("recorta los espacios de los extremos", () => {
    const parsed = exerciseNoteSchema.parse({
      exerciseId: "ex1",
      text: "  omóplatos retraídos  ",
    });
    expect(parsed.text).toBe("omóplatos retraídos");
  });

  it("acepta el texto vacío: es la forma de borrar la nota", () => {
    const parsed = exerciseNoteSchema.parse({ exerciseId: "ex1", text: "   " });
    expect(parsed.text).toBe("");
  });

  it("rechaza pasarse del tope de longitud", () => {
    const result = exerciseNoteSchema.safeParse({
      exerciseId: "ex1",
      text: "a".repeat(EXERCISE_NOTE_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(
      String(EXERCISE_NOTE_MAX_LENGTH),
    );
  });

  it("el tope se aplica DESPUÉS de recortar", () => {
    const result = exerciseNoteSchema.safeParse({
      exerciseId: "ex1",
      text: `  ${"a".repeat(EXERCISE_NOTE_MAX_LENGTH)}  `,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza una nota sin ejercicio", () => {
    const result = exerciseNoteSchema.safeParse({ exerciseId: "", text: "x" });
    expect(result.success).toBe(false);
  });
});
