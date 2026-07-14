import type { BodyRegion, MuscleGroupCode, PriorityTier } from "@/core/enums";

/** Los 16 grupos musculares del dominio, con su tier de prioridad por defecto. */
export interface MuscleGroupSeed {
  code: MuscleGroupCode;
  nameEs: string;
  region: BodyRegion;
  tier: PriorityTier;
}

export const MUSCLE_GROUPS: MuscleGroupSeed[] = [
  { code: "PECHO_SUPERIOR", nameEs: "Pecho superior", region: "UPPER", tier: "A" },
  { code: "PECHO_MEDIO_INFERIOR", nameEs: "Pecho medio/inferior", region: "UPPER", tier: "C" },
  { code: "DELT_ANTERIOR", nameEs: "Deltoide anterior", region: "UPPER", tier: "C" },
  { code: "DELT_LATERAL", nameEs: "Deltoide lateral", region: "UPPER", tier: "A" },
  { code: "DELT_POSTERIOR", nameEs: "Deltoide posterior", region: "UPPER", tier: "A" },
  { code: "DORSAL", nameEs: "Dorsal", region: "UPPER", tier: "A" },
  { code: "ESPALDA_ALTA", nameEs: "Espalda alta", region: "UPPER", tier: "B" },
  { code: "TRAPECIO_SUPERIOR", nameEs: "Trapecio superior", region: "UPPER", tier: "C" },
  { code: "BICEPS", nameEs: "Bíceps", region: "UPPER", tier: "B" },
  { code: "TRICEPS", nameEs: "Tríceps", region: "UPPER", tier: "B" },
  { code: "ANTEBRAZO", nameEs: "Antebrazo", region: "UPPER", tier: "C" },
  { code: "CUADRICEPS", nameEs: "Cuádriceps", region: "LOWER", tier: "B" },
  { code: "ISQUIOS", nameEs: "Isquiosurales", region: "LOWER", tier: "B" },
  { code: "GLUTEO", nameEs: "Glúteo", region: "LOWER", tier: "B" },
  { code: "GEMELO", nameEs: "Gemelo", region: "LOWER", tier: "C" },
  { code: "CORE", nameEs: "Core", region: "CORE", tier: "C" },
];
