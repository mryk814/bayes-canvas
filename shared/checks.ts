/** Exploratory checks on synthetic evidence; no inference or persistence side effects. */
export type CheckDefinition = {
  id: string;
  label: string;
  xMin: number;
  xMax: number;
  group?: string;
  statistic: 'mean' | 'max' | 'sd' | 'exceedance';
  threshold?: number;
};

export type CheckContext = { modelVersionId: string; datasetId: string; runId: string };
export type CheckPoint = { x: number; y: number; group?: string };
export type CheckEvidence = {
  context: CheckContext;
  observed: readonly CheckPoint[];
  replicated: readonly (readonly CheckPoint[])[];
};
export type BoundCheck = {
  definition: Readonly<CheckDefinition>;
  context: Readonly<CheckContext>;
};
export type CheckResult = Readonly<{
  definition: Readonly<CheckDefinition>;
  context: Readonly<CheckContext>;
  observedValue: number;
  observedCount: number;
  replicatedValues: readonly number[];
  /** Central 90% interval of replicated statistics (linear interpolation). */
  predictiveRange: readonly [number, number];
  /** Upper-tail fraction, including ties: count(T_rep >= T_obs) / draws. */
  tailFraction: number;
}>;

const contextKeys = ['modelVersionId', 'datasetId', 'runId'] as const;

function validateContext(context: CheckContext): void {
  if (contextKeys.some(key => typeof context[key] !== 'string' || !context[key].trim())) {
    throw new Error('Check context requires modelVersionId, datasetId and runId.');
  }
}

/** Explicitly bind a saved definition to a particular evidence version for a new run. */
export function bindCheck(definition: CheckDefinition, context: CheckContext): BoundCheck {
  if (!Number.isFinite(definition.xMin) || !Number.isFinite(definition.xMax) || definition.xMin > definition.xMax) {
    throw new Error('Check interval must have finite bounds with xMin <= xMax.');
  }
  if (definition.statistic !== 'mean' && definition.statistic !== 'max' && definition.statistic !== 'sd' && definition.statistic !== 'exceedance') throw new Error('Unsupported check statistic.');
  if (definition.statistic === 'exceedance' ? !Number.isFinite(definition.threshold) : definition.threshold !== undefined) {
    throw new Error('A finite threshold is required only for exceedance checks.');
  }
  if (typeof definition.id !== 'string' || !definition.id.trim() || typeof definition.label !== 'string' || !definition.label.trim()) {
    throw new Error('Check id and label are required.');
  }
  if (definition.group !== undefined && typeof definition.group !== 'string') throw new Error('Check group must be a string.');
  validateContext(context);
  return Object.freeze({ definition: Object.freeze({ ...definition }), context: Object.freeze({ ...context }) });
}

function populationSd(points: readonly CheckPoint[]): number {
  const scale = points.reduce((maximum, point) => Math.max(maximum, Math.abs(point.y)), 0);
  if (scale === 0) return 0;
  // Subtract before scaling to preserve small spreads around a large common offset.
  // Opposite-sign extremes can overflow subtraction; normalize first only then.
  const anchor = points[0].y;
  const offset = (value: number) => Number.isFinite(value - anchor)
    ? (value - anchor) / scale : value / scale - anchor / scale;
  const meanOffset = points.reduce((sum, point) => sum + offset(point.y) / points.length, 0);
  const variance = points.reduce((sum, point) => sum + (offset(point.y) - meanOffset) ** 2 / points.length, 0);
  // A population bounded by [-1, 1] has variance <= 1; trim floating-point overshoot.
  return scale * Math.sqrt(Math.min(1, variance));
}

function summarize(points: readonly CheckPoint[], definition: CheckDefinition): { value: number; count: number } {
  // Invalid coordinates must not silently disappear through the selection predicate.
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('Evidence coordinates must be finite.');
  const selected = points.filter(point => point.x >= definition.xMin && point.x <= definition.xMax && (definition.group === undefined || point.group === definition.group));
  if (!selected.length) throw new Error('Check selection is empty in observed or replicated evidence.');
  const value = definition.statistic === 'max'
    ? selected.reduce((maximum, point) => Math.max(maximum, point.y), -Infinity)
    : definition.statistic === 'sd' ? populationSd(selected)
    : definition.statistic === 'exceedance' ? selected.filter(point => point.y > definition.threshold!).length / selected.length
    : selected.reduce((sum, point) => sum + point.y / selected.length, 0);
  if (!Number.isFinite(value)) throw new Error('Check statistic must be finite.');
  return { value, count: selected.length };
}

function quantile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[Math.ceil(position)] * fraction;
}

export function runCheck(bound: BoundCheck, evidence: Omit<CheckEvidence, 'replicated'> & { replicated: Iterable<readonly CheckPoint[]> }): CheckResult {
  const snapshot = bindCheck(bound.definition, bound.context);
  validateContext(evidence.context);
  if (contextKeys.some(key => snapshot.context[key] !== evidence.context[key])) {
    throw new Error('Evidence context mismatch: explicitly bind the check to the new version before rerunning.');
  }
  const observed = summarize(evidence.observed, snapshot.definition);
  const replicatedValues: number[] = [];
  // Retain one statistic per draw, not every replicated observation in every draw.
  for (const points of evidence.replicated) replicatedValues.push(summarize(points, snapshot.definition).value);
  if (!replicatedValues.length) throw new Error('At least one replication is required.');
  const sorted = [...replicatedValues].sort((a, b) => a - b);
  return Object.freeze({
    ...snapshot,
    observedValue: observed.value,
    observedCount: observed.count,
    replicatedValues: Object.freeze(replicatedValues),
    predictiveRange: Object.freeze([quantile(sorted, 0.05), quantile(sorted, 0.95)] as [number, number]),
    tailFraction: replicatedValues.filter(value => value >= observed.value).length / replicatedValues.length,
  });
}

// Two deterministic synthetic model versions, sharing observations but using distinct runs.
// These are authored examples, not fitted posterior draws.
const observed: CheckPoint[] = Array.from({ length: 12 }, (_, index) => ({
  x: index % 6,
  y: 2 + (index % 6) * 1.2 + (index >= 6 ? 1.4 : 0) + (index % 2 ? 0.3 : -0.2),
  group: index < 6 ? 'A' : 'B',
}));

export const checkFixtures: readonly CheckEvidence[] = [0, 1].map(version => ({
  context: { modelVersionId: `model-v${version + 1}`, datasetId: 'synthetic-observations', runId: `synthetic-run-${version + 1}` },
  observed: observed.map(point => ({ ...point })),
  replicated: Array.from({ length: 20 }, (_, draw) => observed.map(point => ({
    ...point,
    y: 2 + point.x * (version === 0 ? 0.55 : 1.2) + (point.group === 'B' ? 1.4 : 0) + (draw - 9.5) * 0.12 + Math.sin(draw + point.x) * 0.2,
  }))),
}));
