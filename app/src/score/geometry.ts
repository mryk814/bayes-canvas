import type { ModelDocument, RandomVariableEntity } from '../lib/core/model.js';
import { findDistribution } from '../lib/distributionRegistry.js';
import type { PriorSimulation } from './priorSim.js';
import type { ScoreProjection, ScoreRow } from './scoreModel.js';

/**
 * Prior geometry read from aligned joint draws.
 * A funnel exists where a repeated latent's scale is itself uncertain:
 * small scale squeezes the latent into a narrow neck that a single HMC step
 * size cannot traverse. The non-centered coordinates z = (x - loc) / scale
 * show the same draws without the neck.
 */

export interface FunnelSpec {
  childId: string;
  scaleId: string;
  locationId?: string;
  locationValue?: number;
  nonCentered: boolean;
}

export interface Cloud {
  xs: number[];
  ys: number[];
  xLabel: string;
  yLabel: string;
  /** ±2 sd envelope of y in bins of x. */
  envelope: Array<{ x: number; lo: number; hi: number }>;
}

export interface FunnelGeometry {
  spec: FunnelSpec;
  centered: Cloud;
  nonCentered: Cloud;
  /** Spread of the latent at large scale divided by spread at small scale (centered). */
  neck: number;
}

export interface PairGeometry {
  parentId: string;
  cloud: Cloud;
  correlation: number;
}

function bareSymbol(source: string | undefined): string | undefined {
  const trimmed = source?.trim();
  return trimmed && /^[A-Za-z_]\w*$/.test(trimmed) ? trimmed : undefined;
}

export function findFunnels(document: ModelDocument, projection: ScoreProjection): FunnelSpec[] {
  const bySymbol = new Map(Object.values(document.entities).map((entity) => [entity.symbol, entity]));
  const out: FunnelSpec[] = [];
  for (const row of projection.rows) {
    const entity = row.entity;
    if (entity.kind !== 'random_variable' || entity.role === 'observation' || !entity.plateIds.length) continue;
    const params = findDistribution(entity.distribution.distributionId)?.params ?? [];
    const scaleKey = params.find((param) => param.role === 'scale' && entity.distribution.args[param.name])?.name;
    const locationKey = params.find((param) => param.role === 'location' && entity.distribution.args[param.name])?.name;
    if (!scaleKey) continue;
    const scale = bySymbol.get(bareSymbol(entity.distribution.args[scaleKey]!.source) ?? '');
    if (scale?.kind !== 'random_variable') continue;
    const locationSource = locationKey ? entity.distribution.args[locationKey]!.source.trim() : '0';
    const location = bySymbol.get(bareSymbol(locationSource) ?? '');
    out.push({
      childId: entity.id,
      scaleId: scale.id,
      locationId: location?.kind === 'random_variable' ? location.id : undefined,
      locationValue: location ? undefined : Number.isFinite(Number(locationSource)) ? Number(locationSource) : 0,
      nonCentered: (entity as RandomVariableEntity).hints?.some((hint) => hint.kind === 'parameterization' && hint.value === 'non_centered') ?? false,
    });
  }
  return out;
}

function envelope(xs: number[], ys: number[], bins = 12): Cloud['envelope'] {
  const order = xs.map((_, index) => index).sort((a, b) => xs[a]! - xs[b]!);
  const size = Math.max(8, Math.floor(order.length / bins));
  const out: Cloud['envelope'] = [];
  for (let start = 0; start + size <= order.length; start += size) {
    const slice = order.slice(start, start + size);
    const mean = slice.reduce((sum, index) => sum + ys[index]!, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((sum, index) => sum + (ys[index]! - mean) ** 2, 0) / slice.length);
    const x = slice.reduce((sum, index) => sum + xs[index]!, 0) / slice.length;
    out.push({ x, lo: mean - 2 * sd, hi: mean + 2 * sd });
  }
  return out;
}

function spread(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export function funnelGeometry(spec: FunnelSpec, sim: PriorSimulation, document: ModelDocument): FunnelGeometry | null {
  const child = sim.joint[spec.childId];
  const scale = sim.joint[spec.scaleId];
  const location = spec.locationId ? sim.joint[spec.locationId] : undefined;
  if (!child?.length || !scale?.length || child.length !== scale.length) return null;
  const n = child.length;
  const logScale: number[] = [];
  const raw: number[] = [];
  const z: number[] = [];
  for (let index = 0; index < n; index += 1) {
    const s = scale[index]!;
    if (!(s > 0)) continue;
    const centered = child[index]! - (location ? location[index]! : spec.locationValue ?? 0);
    logScale.push(Math.log(s));
    raw.push(centered);
    z.push(centered / s);
  }
  const order = logScale.map((_, index) => index).sort((a, b) => logScale[a]! - logScale[b]!);
  const decile = Math.max(5, Math.floor(order.length / 10));
  const low = spread(order.slice(0, decile).map((index) => raw[index]!));
  const high = spread(order.slice(-decile).map((index) => raw[index]!));
  const scaleSymbol = document.entities[spec.scaleId]?.symbol ?? spec.scaleId;
  const childSymbol = document.entities[spec.childId]?.symbol ?? spec.childId;
  const locationSymbol = spec.locationId ? document.entities[spec.locationId]?.symbol : undefined;
  const centeredLabel = locationSymbol ? `${childSymbol} − ${locationSymbol}` : childSymbol;
  return {
    spec,
    neck: low > 0 ? high / low : Infinity,
    centered: { xs: logScale, ys: raw, xLabel: `log ${scaleSymbol}`, yLabel: centeredLabel, envelope: envelope(logScale, raw) },
    nonCentered: { xs: logScale, ys: z, xLabel: `log ${scaleSymbol}`, yLabel: `z = (${centeredLabel}) / ${scaleSymbol}`, envelope: envelope(logScale, z) },
  };
}

/** Joint shape of a statement with each stochastic parent it depends on. */
export function pairGeometry(row: ScoreRow, sim: PriorSimulation, document: ModelDocument, limit = 3): PairGeometry[] {
  const own = sim.joint[row.id];
  if (!own?.length) return [];
  const out: PairGeometry[] = [];
  for (const parentId of row.parents) {
    const parent = document.entities[parentId];
    const values = sim.joint[parentId];
    if (parent?.kind !== 'random_variable' || !values || values.length !== own.length) continue;
    const positive = parent.valueType.domain?.kind === 'positive' || values.every((value) => value > 0);
    const xs = positive ? values.map((value) => Math.log(Math.max(value, 1e-12))) : values;
    out.push({
      parentId,
      cloud: { xs, ys: own, xLabel: positive ? `log ${parent.symbol}` : parent.symbol, yLabel: row.entity.symbol, envelope: envelope(xs, own) },
      correlation: correlation(xs, own),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((sum, value) => sum + value, 0) / n;
  const my = ys.reduce((sum, value) => sum + value, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = xs[index]! - mx;
    const dy = ys[index]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}
