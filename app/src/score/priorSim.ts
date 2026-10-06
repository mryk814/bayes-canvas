import { parseExpression, type ExprNode } from '../lib/core/expression.js';
import type { DistributionCall, ModelDocument } from '../lib/core/model.js';
import type { ScoreProjection } from './scoreModel.js';

/**
 * Forward simulation of the prior from the ModelDocument itself.
 * Plates other than the observation plate are simulated with GROUPS members;
 * the observation plate is probed at fixed predictor values instead of looping
 * over N rows (no data is invented).
 */

export const GROUPS = 8;
export const DRAWS = 1200;
export const PROBES = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];

export interface PriorSimulation {
  /** Pooled marginal draws per entity (all plate members flattened). */
  marginals: Record<string, number[]>;
  /** One value per draw, aligned across entities: plated entities use their first member, observation rows the middle probe. */
  joint: Record<string, number[]>;
  /** One group's conditional members, for plated entities. */
  fan?: { predictor: string; outcome: string; probes: number[]; quantiles: number[][] };
  unsupported: string[];
}

type Value = number | number[];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  private spare: number | null = null;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  uniform() {
    let u = this.next();
    while (u === 0) u = this.next();
    return u;
  }
  normal() {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;
      return value;
    }
    const u = this.uniform();
    const v = this.uniform();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
  gamma(shape: number): number {
    if (shape < 1) return this.gamma(shape + 1) * Math.pow(this.uniform(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.uniform();
      if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
    }
  }
}

const SAMPLERS: Record<string, (rng: Rng, a: Record<string, number>) => number> = {
  normal: (rng, a) => a.mu! + a.sigma! * rng.normal(),
  halfnormal: (rng, a) => Math.abs(a.sigma! * rng.normal()),
  student_t: (rng, a) => a.mu! + a.sigma! * rng.normal() / Math.sqrt(2 * rng.gamma(a.nu! / 2) / a.nu!),
  exponential: (rng, a) => -Math.log(rng.uniform()) / a.lam!,
  lognormal: (rng, a) => Math.exp(a.mu! + a.sigma! * rng.normal()),
  halfcauchy: (rng, a) => Math.abs(a.beta! * Math.tan(Math.PI * (rng.uniform() - 0.5))),
  cauchy: (rng, a) => a.alpha! + a.beta! * Math.tan(Math.PI * (rng.uniform() - 0.5)),
  laplace: (rng, a) => {
    const u = rng.uniform() - 0.5;
    return a.mu! - a.b! * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  },
  uniform: (rng, a) => a.lower! + (a.upper! - a.lower!) * rng.uniform(),
  gamma: (rng, a) => rng.gamma(a.alpha!) / a.beta!,
  beta: (rng, a) => {
    const x = rng.gamma(a.alpha!);
    return x / (x + rng.gamma(a.beta!));
  },
  logistic: (rng, a) => {
    const u = rng.uniform();
    return a.mu! + a.s! * Math.log(u / (1 - u));
  },
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  exp: Math.exp,
  log: Math.log,
  log1p: Math.log1p,
  sqrt: Math.sqrt,
  abs: Math.abs,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  inv_logit: (x) => 1 / (1 + Math.exp(-x)),
  logit: (x) => Math.log(x / (1 - x)),
};

export function isSimulable(call: DistributionCall): boolean {
  return call.distributionId in SAMPLERS;
}

class Unsupported extends Error {}

function evaluate(node: ExprNode, env: Map<string, Value>): Value {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'reference': {
      const value = env.get(node.symbol);
      if (value === undefined) throw new Unsupported(`未定義の記号 ${node.symbol}`);
      return value;
    }
    case 'unary': {
      const value = scalar(evaluate(node.operand, env));
      return node.operator === '-' ? -value : value;
    }
    case 'binary': {
      const left = scalar(evaluate(node.left, env));
      const right = scalar(evaluate(node.right, env));
      switch (node.operator) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return left / right;
        case '^': return Math.pow(left, right);
        default: throw new Unsupported(`演算子 ${node.operator}`);
      }
    }
    case 'call': {
      const fn = FUNCTIONS[node.functionName];
      if (!fn) throw new Unsupported(`関数 ${node.functionName}`);
      return fn(...node.args.map((arg) => scalar(evaluate(arg, env))));
    }
    case 'index': {
      const target = evaluate(node.target, env);
      if (typeof target === 'number') return target; // observation-plate values are probed as scalars
      const index = scalar(evaluate(node.indices[0]!, env));
      const value = target[Math.round(index) % target.length];
      if (value === undefined) throw new Unsupported('index が範囲外');
      return value;
    }
    case 'slice':
      throw new Unsupported('slice');
  }
}

function scalar(value: Value): number {
  if (typeof value === 'number') return value;
  throw new Unsupported('ベクトル演算');
}

export function simulatePrior(document: ModelDocument, projection: ScoreProjection, seed = 7): PriorSimulation {
  const rng = new Rng(seed);
  const unsupported: string[] = [];
  const observation = projection.rows.find((row) => row.role === 'observation');
  const observationPlates = new Set(observation?.entity.plateIds ?? []);
  const predictor = projection.rows.find((row) => row.entity.kind === 'data' && row.entity.dataRole === 'predictor' && row.entity.plateIds.some((plateId) => observationPlates.has(plateId)));

  const parsed = new Map<string, ExprNode>();
  const parse = (key: string, source: string): ExprNode => {
    if (!parsed.has(key)) {
      const result = parseExpression(source);
      if (!result.ok) throw new Unsupported(result.error.message);
      parsed.set(key, result.ast);
    }
    return parsed.get(key)!;
  };

  const marginals: Record<string, number[]> = {};
  const joint: Record<string, number[]> = {};
  const globalRows = projection.rows.filter((row) => !row.entity.plateIds.some((plateId) => observationPlates.has(plateId)));
  const obsRows = projection.rows.filter((row) => row.entity.plateIds.some((plateId) => observationPlates.has(plateId)));
  for (const row of [...globalRows, ...obsRows]) {
    const entity = row.entity;
    if (entity.kind === 'random_variable' && !isSimulable(entity.distribution)) {
      unsupported.push(`${entity.symbol}: ${entity.distribution.distributionId}`);
    }
  }
  if (unsupported.length) return { marginals, joint, unsupported };

  const quantiles: number[][] = PROBES.map(() => []);
  const outcomeDraws: number[][] = PROBES.map(() => []);
  try {
    for (let draw = 0; draw < DRAWS; draw += 1) {
      const env = new Map<string, Value>();
      for (const index of Object.values(document.plates)) env.set(index.indexSymbol, 0);
      for (const row of globalRows) {
        const entity = row.entity;
        const members = entity.plateIds.length ? GROUPS : 0;
        const one = (): number => {
          if (entity.kind === 'random_variable') return sampleCall(entity.id, entity.distribution, env, parse, rng);
          if (entity.kind === 'deterministic') return scalar(evaluate(parse(entity.id, entity.expression.source), env));
          return 0;
        };
        if (entity.kind === 'data') continue;
        const value: Value = members ? Array.from({ length: members }, one) : one();
        env.set(entity.symbol, value);
        (marginals[entity.id] ??= []).push(...(typeof value === 'number' ? [value] : value));
        (joint[entity.id] ??= []).push(typeof value === 'number' ? value : value[0]!);
      }
      if (!observation) continue;
      // Groups are exchangeable, so probing group 0 keeps every joint draw aligned with alpha[0].
      const group = 0;
      PROBES.forEach((probe, probeIndex) => {
        const local = new Map(env);
        for (const row of obsRows) {
          const entity = row.entity;
          if (entity.kind === 'data') {
            local.set(entity.symbol, entity.dataRole === 'index' ? group : row === predictor ? probe : 0);
            continue;
          }
          const value = entity.kind === 'random_variable'
            ? sampleCall(entity.id, entity.distribution, local, parse, rng)
            : entity.kind === 'deterministic' ? scalar(evaluate(parse(entity.id, entity.expression.source), local)) : 0;
          local.set(entity.symbol, value);
          if (probeIndex === Math.floor(PROBES.length / 2) || !predictor) {
            (marginals[entity.id] ??= []).push(value);
            (joint[entity.id] ??= []).push(value);
          }
        }
        outcomeDraws[probeIndex]!.push(local.get(observation.entity.symbol) as number);
      });
    }
  } catch (error) {
    if (error instanceof Unsupported) return { marginals: {}, joint: {}, unsupported: [error.message] };
    throw error;
  }
  outcomeDraws.forEach((draws, index) => {
    const sorted = [...draws].sort((a, b) => a - b);
    quantiles[index] = [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => sorted[Math.floor(q * (sorted.length - 1))] ?? 0);
  });
  return {
    marginals,
    joint,
    fan: observation ? {
      predictor: predictor?.entity.symbol ?? '—',
      outcome: observation.entity.symbol,
      probes: PROBES,
      quantiles,
    } : undefined,
    unsupported,
  };
}

function sampleCall(
  entityId: string,
  call: DistributionCall,
  env: Map<string, Value>,
  parse: (key: string, source: string) => ExprNode,
  rng: Rng,
): number {
  const args: Record<string, number> = {};
  for (const [key, arg] of Object.entries(call.args)) {
    args[key] = scalar(evaluate(parse(`${entityId}:${key}:${arg.source}`, arg.source), env));
  }
  return SAMPLERS[call.distributionId]!(rng, args);
}

/** Gaussian KDE on a fixed grid, robust to heavy tails by clipping to quantiles. */
export function density(samples: number[], points = 96, range?: [number, number]): { xs: number[]; ys: number[]; lo: number; hi: number } {
  if (!samples.length) return { xs: [], ys: [], lo: 0, hi: 1 };
  const sorted = [...samples].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))]!;
  const [lo, hi] = range ?? [q(0.005), q(0.995)];
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const sd = Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n) || 1;
  const iqr = (q(0.75) - q(0.25)) / 1.34 || sd;
  const h = 0.9 * Math.min(sd, iqr) * Math.pow(n, -0.2) || 0.1;
  const xs: number[] = [];
  const ys: number[] = [];
  const nonNegative = sorted[0]! >= 0;
  for (let k = 0; k < points; k += 1) {
    const x = lo + ((hi - lo) * k) / (points - 1);
    let sum = 0;
    for (const value of sorted) {
      const z = (x - value) / h;
      if (z > -4 && z < 4) sum += Math.exp(-0.5 * z * z);
      if (nonNegative) {
        const mirror = (x + value) / h; // reflect at 0 so half-distributions keep their mode at 0
        if (mirror < 4) sum += Math.exp(-0.5 * mirror * mirror);
      }
    }
    xs.push(x);
    ys.push(sum / (n * h * Math.sqrt(2 * Math.PI)));
  }
  return { xs, ys, lo, hi };
}

/** Ratio of 90% interval widths per entity between two simulations (only meaningful shifts). */
export function intervalShifts(before: PriorSimulation, after: PriorSimulation, threshold = 0.08): Record<string, number> {
  const width = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return (sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0) - (sorted[Math.floor(0.05 * (sorted.length - 1))] ?? 0);
  };
  const out: Record<string, number> = {};
  for (const [id, values] of Object.entries(after.marginals)) {
    const previous = before.marginals[id];
    if (!previous?.length || !values.length) continue;
    const a = width(previous);
    const b = width(values);
    if (a > 0 && Math.abs(Math.log(b / a)) > threshold) out[id] = b / a;
  }
  return out;
}
