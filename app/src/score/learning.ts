import type { ModelDocument } from '../lib/core/model.js';
import type { EvidencePowerScaling, EvidenceQuantity, ModelEvidenceBundle } from '../lib/modelEvidence.js';
import { qoiSymbolOf } from './modelSpace.js';

/**
 * From prior to posterior with only quantile summaries of the posterior.
 * The morph moves every prior draw to the posterior quantile of the same
 * rank (the 1-D optimal transport map), so t = 0 is the prior simulation and
 * t = 1 has the posterior's 5/50/95% quantiles.
 */

export interface Quantiles {
  q05: number;
  q50: number;
  q95: number;
}

export interface PosteriorSummary {
  quantity: EvidenceQuantity;
  bundle: ModelEvidenceBundle;
}

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function inverseNormal(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

const Z95 = inverseNormal(0.95);

/** Quantile function of the split normal that has these 5/50/95% quantiles. */
export function splitNormalQuantile(quantiles: Quantiles, u: number): number {
  const z = inverseNormal(Math.min(1 - 1e-6, Math.max(1e-6, u)));
  const scale = z < 0 ? (quantiles.q50 - quantiles.q05) / Z95 : (quantiles.q95 - quantiles.q50) / Z95;
  return quantiles.q50 + scale * z;
}

/** Rank of each draw, for repeated morphing of the same prior draws. */
export function ranksOf(draws: readonly number[]): Float64Array {
  const order = draws.map((_, index) => index).sort((a, b) => draws[a]! - draws[b]!);
  const ranks = new Float64Array(draws.length);
  order.forEach((index, rank) => { ranks[index] = (rank + 0.5) / draws.length; });
  return ranks;
}

/** Displacement interpolation: each prior draw moves toward the posterior quantile of its rank. */
export function morphDraws(prior: readonly number[], posterior: Quantiles, t: number, ranks = ranksOf(prior)): number[] {
  if (t <= 0) return [...prior];
  return prior.map((value, index) => (1 - t) * value + t * splitNormalQuantile(posterior, ranks[index]!));
}

function sortedQuantile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]!;
}

/* ------------------------------------------------------------------ */

export type LearningVerdict = 'learned' | 'partial' | 'prior_dominated';

export const LEARNING_LABEL: Record<LearningVerdict, string> = {
  learned: 'データから学んだ',
  partial: '一部だけ学んだ',
  prior_dominated: 'prior が決めている',
};

export interface Learning {
  prior: Quantiles;
  posterior: Quantiles;
  /** Posterior 90% width / prior 90% width. */
  ratio: number;
  /** 1 − ratio², the share of prior variance the data removed (when both are near normal). */
  contraction: number;
  verdict: LearningVerdict;
  /** Prior CDF at the posterior median; near 0 or 1 means the data pulled into the prior's tail. */
  priorTail: number;
  conflict: boolean;
}

/** How much the data moved a statement away from its prior. */
export function learningOf(priorDraws: readonly number[], posterior: Quantiles): Learning | null {
  if (priorDraws.length < 20) return null;
  const sorted = [...priorDraws].sort((a, b) => a - b);
  const prior = { q05: sortedQuantile(sorted, 0.05), q50: sortedQuantile(sorted, 0.5), q95: sortedQuantile(sorted, 0.95) };
  const priorWidth = prior.q95 - prior.q05;
  if (!(priorWidth > 0)) return null;
  const ratio = (posterior.q95 - posterior.q05) / priorWidth;
  const contraction = Math.max(0, Math.min(1, 1 - ratio * ratio));
  const below = sorted.findIndex((value) => value > posterior.q50);
  const priorTail = (below < 0 ? sorted.length : below) / sorted.length;
  return {
    prior,
    posterior: { q05: posterior.q05, q50: posterior.q50, q95: posterior.q95 },
    ratio,
    contraction,
    verdict: contraction >= 0.5 ? 'learned' : contraction >= 0.1 ? 'partial' : 'prior_dominated',
    priorTail,
    conflict: priorTail < 0.05 || priorTail > 0.95,
  };
}

/* ------------------------------------------------------------------ */

export type PowerScalingDiagnosis = 'ok' | 'prior_data_conflict' | 'strong_prior' | 'unknown';

export const DIAGNOSIS_LABEL: Record<PowerScalingDiagnosis, string> = {
  ok: '感度は小さい',
  prior_data_conflict: 'prior とデータが食い違う',
  strong_prior: 'prior が強く、尤度が弱い',
  unknown: '感度は未計算',
};

/** priorsense's rule of thumb: a sensitivity of 0.05 or more is notable. */
export function powerScalingDiagnosis(scaling: EvidencePowerScaling | undefined, threshold = 0.05): PowerScalingDiagnosis {
  const prior = scaling?.priorSensitivity;
  const likelihood = scaling?.likelihoodSensitivity;
  if (prior === undefined || likelihood === undefined) return 'unknown';
  if (prior >= threshold && likelihood >= threshold) return 'prior_data_conflict';
  if (prior >= threshold) return 'strong_prior';
  return 'ok';
}

/** Alphas available for one component, always including α = 1 (the posterior itself). */
export function powerScalingRange(scaling: EvidencePowerScaling | undefined, component: 'prior' | 'likelihood'): [number, number] | null {
  const alphas = (scaling?.sequence ?? []).filter((step) => step.component === component).map((step) => step.alpha);
  if (!alphas.length) return null;
  return [Math.min(1, ...alphas), Math.max(1, ...alphas)];
}

/** Posterior quantiles under prior (or likelihood) power α, interpolated in log α between reported steps. */
export function powerScaledQuantiles(quantity: EvidenceQuantity, component: 'prior' | 'likelihood', alpha: number): Quantiles {
  const steps = [
    { alpha: 1, q05: quantity.q05, q50: quantity.q50, q95: quantity.q95 },
    ...(quantity.powerScaling?.sequence ?? []).filter((step) => step.component === component && step.alpha !== 1),
  ].sort((a, b) => a.alpha - b.alpha);
  const target = Math.log(alpha);
  if (target <= Math.log(steps[0]!.alpha)) return steps[0]!;
  const last = steps[steps.length - 1]!;
  if (target >= Math.log(last.alpha)) return last;
  const upper = steps.findIndex((step) => Math.log(step.alpha) >= target);
  const a = steps[upper - 1]!;
  const b = steps[upper]!;
  const w = (target - Math.log(a.alpha)) / (Math.log(b.alpha) - Math.log(a.alpha));
  const mix = (key: keyof Quantiles) => (1 - w) * a[key] + w * b[key];
  return { q05: mix('q05'), q50: mix('q50'), q95: mix('q95') };
}

/* ------------------------------------------------------------------ */

/**
 * The latest posterior summary per entity of this document. A summary of a
 * query whose expression is a bare symbol belongs to that symbol's entity.
 */
export function posteriorsByEntity(document: ModelDocument, bundles: readonly ModelEvidenceBundle[]): Record<string, PosteriorSummary> {
  const bySymbol = new Map(Object.values(document.entities).map((entity) => [entity.symbol, entity.id]));
  const out: Record<string, PosteriorSummary> = {};
  const latest = [...bundles].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const bundle of latest) {
    for (const quantity of bundle.quantities ?? []) {
      if (quantity.distribution !== 'posterior') continue;
      const symbol = qoiSymbolOf(document, quantity.entityId);
      const entityId = symbol ? bySymbol.get(symbol) : undefined;
      if (entityId && !out[entityId]) out[entityId] = { quantity, bundle };
    }
  }
  return out;
}
