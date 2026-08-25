"use client";

import { useState } from "react";

import { CoachPanel } from "@/components/coach/coach-panel";
import { Textarea } from "@/components/ui/textarea";

/**
 * Pregunta libre al coach. Ámbito acotado a entrenamiento y recuperación: el
 * system prompt lo impone y las sugerencias de ejemplo lo encauzan. No es un
 * chatbot general y no guarda conversación.
 */

const SUGGESTIONS = [
  "¿Estoy progresando?",
  "¿Por qué no subo en dominadas?",
  "¿Debería entrenar mañana?",
  "¿Qué significa esta señal de meseta?",
] as const;

export function AskCoach() {
  const [question, setQuestion] = useState("");
  const trimmed = question.trim();

  return (
    <div>
      <label htmlFor="coach-question" className="text-sm font-medium">
        Preguntar al coach
      </label>
      <Textarea
        id="coach-question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Sobre tu entrenamiento, tu progreso o tu recuperación…"
        className="mt-1"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setQuestion(s)}
            className="border-border text-muted-foreground min-h-11 rounded-full border px-3 text-xs"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {trimmed.length >= 3 ? (
          <CoachPanel
            key={trimmed}
            request={{ task: "ASK", question: trimmed }}
            label="Preguntar"
          />
        ) : (
          <p className="text-muted-foreground text-xs">
            Escribe una pregunta (mínimo 3 caracteres) o toca una de las de
            arriba.
          </p>
        )}
      </div>
    </div>
  );
}
