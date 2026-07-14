import type { BodyRegion, MuscleGroupCode } from "@/core/enums";

/**
 * Los 16 grupos musculares del dominio.
 * NO hay prioridad estética por defecto: la única prioridad es la que elige el
 * usuario en el onboarding. Los volúmenes de partida viven en
 * src/core/config/training-config.ts.
 */
export interface MuscleGroupSeed {
  code: MuscleGroupCode;
  nameEs: string;
  region: BodyRegion;
}

export const MUSCLE_GROUPS: MuscleGroupSeed[] = [
  { code: "PECHO_SUPERIOR", nameEs: "Pecho superior", region: "UPPER" },
  {
    code: "PECHO_MEDIO_INFERIOR",
    nameEs: "Pecho medio/inferior",
    region: "UPPER",
  },
  { code: "DELT_ANTERIOR", nameEs: "Deltoide anterior", region: "UPPER" },
  { code: "DELT_LATERAL", nameEs: "Deltoide lateral", region: "UPPER" },
  { code: "DELT_POSTERIOR", nameEs: "Deltoide posterior", region: "UPPER" },
  { code: "DORSAL", nameEs: "Dorsal", region: "UPPER" },
  { code: "ESPALDA_ALTA", nameEs: "Espalda alta", region: "UPPER" },
  { code: "TRAPECIO_SUPERIOR", nameEs: "Trapecio superior", region: "UPPER" },
  { code: "BICEPS", nameEs: "Bíceps", region: "UPPER" },
  { code: "TRICEPS", nameEs: "Tríceps", region: "UPPER" },
  { code: "ANTEBRAZO", nameEs: "Antebrazo", region: "UPPER" },
  { code: "CUADRICEPS", nameEs: "Cuádriceps", region: "LOWER" },
  { code: "ISQUIOS", nameEs: "Isquiosurales", region: "LOWER" },
  { code: "GLUTEO", nameEs: "Glúteo", region: "LOWER" },
  { code: "GEMELO", nameEs: "Gemelo", region: "LOWER" },
  { code: "CORE", nameEs: "Core", region: "CORE" },
];

/** Búsqueda rápida por código. */
export const MUSCLE_GROUP_BY_CODE: Record<MuscleGroupCode, MuscleGroupSeed> =
  Object.fromEntries(MUSCLE_GROUPS.map((g) => [g.code, g])) as Record<
    MuscleGroupCode,
    MuscleGroupSeed
  >;
