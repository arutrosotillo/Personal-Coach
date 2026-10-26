/**
 * Dominio de ciclos (docs/CYCLES.md). Puro y determinista: cerrar y abrir
 * ciclos lo hace el servicio; aquí solo se resume, se planifica y se avisa.
 */
export {
  CYCLE_SUMMARY_VERSION,
  summarizeCycle,
  type CycleSummary,
  type CycleSummaryInput,
  type CycleTargetPeriod,
} from "@/core/cycles/summary";
export {
  summarizePerformance,
  type CyclePerformanceSummary,
  type PerformanceHighlight,
  type PerformanceSetPoint,
} from "@/core/cycles/performance";
export {
  CYCLE_PLAN_VERSION,
  planCycleTargets,
  trainingVolumeNote,
  type CyclePlan,
  type CyclePlanInput,
} from "@/core/cycles/plan";
export {
  assessComposition,
  type CompositionAdvisory,
  type CompositionInput,
  type CompositionSignal,
  type CompositionSignalCode,
} from "@/core/cycles/composition";
