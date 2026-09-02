/**
 * Insights deterministas cuerpo × rendimiento (B5).
 *
 * Puro: cruza las salidas de `core/body` y `core/training` sin volver a
 * calcular ninguna de las dos. OBSERVA; no diagnostica.
 */
export { assessPerformance } from "@/core/insights/performance";
export type {
  PerformanceAssessment,
  PerformanceExclusion,
  PerformanceReasonCode,
  PerformanceTrend,
  VariantPerformance,
  VariantState,
} from "@/core/insights/performance";
export {
  analyzeBodyPerformance,
  INSIGHT_ENGINE_VERSION,
} from "@/core/insights/body-performance";
export type {
  BodyPerformanceInput,
  BodyPerformanceInsight,
  GoalAssessmentCode,
  ObservationCode,
} from "@/core/insights/body-performance";
