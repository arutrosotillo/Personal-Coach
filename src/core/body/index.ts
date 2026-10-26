/**
 * Motor de seguimiento corporal (B1). Puro, determinista y sin dependencias de
 * infraestructura: ni Prisma, ni `Date.now()`, ni red.
 *
 * Punto de entrada único: `analyzeBody(input)`.
 */
export { analyzeBody, BODY_ENGINE_VERSION } from "@/core/body/analyze";
export {
  autocorrelationInflation,
  exponentialMovingAverage,
  linearRegression,
  tCritical975,
} from "@/core/body/stats";
export { weeklyMeanTrend, type WeeklyTrend } from "@/core/body/weekly-trend";
export { evaluateCheckIn } from "@/core/body/check-in";
export type { CheckInEvaluation, CheckInStatus } from "@/core/body/check-in";
export { classifyGoalChange, resetsTrend } from "@/core/body/goal-change";
export type { GoalChangeKind, GoalSnapshot } from "@/core/body/goal-change";
export { cm, kg, pctPoints } from "@/core/body/types";
export type {
  BodyAnalysis,
  BodyAnalysisInput,
  BodyConfidence,
  BodyFatAnalysis,
  BodyFatTrendStatus,
  BodyGoalInput,
  BodyMeasurementPoint,
  BodyReasonCode,
  Cm,
  GoalComparison,
  Kg,
  LinearTrend,
  PctPoints,
  SmoothedPoint,
  WaistAnalysis,
  WaistTrendStatus,
  WeightAnalysis,
  WeightTrendStatus,
} from "@/core/body/types";
