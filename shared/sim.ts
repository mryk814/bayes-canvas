// Forward simulation of possible worlds. Pure and seeded: the same
// (spec, seed, index) always yields the same world, in the browser and on the server.
import { evaluate, freeNames, parseExpr, ExprError, type Expr } from "./expr.ts";
import type { Dist, ModelSpec } from "./contracts.ts";

export type World = {
  index: number;
  params: Record<string, number>;
  curve: [number, number][];
  obs: [number, number][];
  broken: boolean;
};

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(seed: number, index: number) {
  let h = 2166136261 ^ seed;
  h = Math.imul(h ^ index, 16777619);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return h ^ (h >>> 15);
}

type Rng = () => number;

function normal(rng: Rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function gamma(rng: Rng, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * Math.pow(rng(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleDist(d: Dist, rng: Rng): number {
  switch (d.family) {
    case "normal":
      return d.mu + d.sigma * normal(rng);
    case "lognormal":
      return Math.exp(d.mu + d.sigma * normal(rng));
    case "halfnormal":
      return Math.abs(d.sigma * normal(rng));
    case "exponential":
      return -Math.log(1 - rng()) / d.rate;
    case "uniform":
      return d.lower + (d.upper - d.lower) * rng();
    case "studentt":
      return d.mu + d.sigma * (normal(rng) / Math.sqrt((2 * gamma(rng, d.nu / 2)) / d.nu));
    case "gamma":
      return gamma(rng, d.shape) / d.rate;
    case "beta": {
      const a = gamma(rng, d.a);
      return a / (a + gamma(rng, d.b));
    }
  }
}

export function describeDist(d: Dist): string {
  switch (d.family) {
    case "normal":
      return `Normal(${d.mu}, ${d.sigma})`;
    case "lognormal":
      return `LogNormal(${d.mu}, ${d.sigma})`;
    case "halfnormal":
      return `HalfNormal(${d.sigma})`;
    case "exponential":
      return `Exponential(${d.rate})`;
    case "uniform":
      return `Uniform(${d.lower}, ${d.upper})`;
    case "studentt":
      return `StudentT(${d.nu}, ${d.mu}, ${d.sigma})`;
    case "gamma":
      return `Gamma(${d.shape}, ${d.rate})`;
    case "beta":
      return `Beta(${d.a}, ${d.b})`;
  }
}

export type Compiled = { spec: ModelSpec; mean: Expr; sigma: Expr };

// Checks what a schema cannot: formulas parse, names resolve, and the
// prior actually produces finite worlds. Returns problems in plain language.
export function compileSpec(spec: ModelSpec): { ok: true; compiled: Compiled } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const names = new Set<string>([spec.x.name]);
  for (const p of spec.params) {
    if (names.has(p.name)) problems.push(`名前 ${p.name} が重複しています`);
    names.add(p.name);
    if (p.prior.family === "uniform" && p.prior.lower >= p.prior.upper) {
      problems.push(`${p.name} の一様分布は lower < upper にしてください`);
    }
  }
  if (spec.x.min >= spec.x.max) problems.push("x の範囲は min < max にしてください");
  if (spec.noise.family === "studentt" && spec.noise.nu === undefined) {
    problems.push("studentt のノイズには nu が必要です");
  }

  const parse = (label: string, source: string): Expr | null => {
    try {
      const e = parseExpr(source);
      for (const n of freeNames(e)) if (!names.has(n)) problems.push(`${label} の ${n} はパラメータにも x にもありません`);
      return e;
    } catch (err) {
      problems.push(`${label} を読めません: ${err instanceof ExprError ? err.message : String(err)}`);
      return null;
    }
  };
  const mean = parse("平均の式", spec.mean);
  const sigma = parse("ノイズの式", spec.noise.sigma);
  if (problems.length || !mean || !sigma) return { ok: false, problems };

  const compiled = { spec, mean, sigma };
  const probe = Array.from({ length: 40 }, (_, i) => simulateWorld(compiled, 1, i));
  const broken = probe.filter((w) => w.broken).length;
  if (broken > 20) problems.push(`40 世界中 ${broken} 世界で値が有限になりません（負の σ、log(負) など）`);
  return problems.length ? { ok: false, problems } : { ok: true, compiled };
}

export function xGrid(spec: ModelSpec): number[] {
  const { min, max, points } = spec.x;
  return Array.from({ length: points }, (_, i) => min + ((max - min) * i) / (points - 1));
}

export function simulateWorld(c: Compiled, seed: number, index: number): World {
  const rng = mulberry32(hash(seed, index));
  const params: Record<string, number> = {};
  for (const p of c.spec.params) params[p.name] = sampleDist(p.prior, rng);
  const curve: [number, number][] = [];
  const obs: [number, number][] = [];
  let broken = false;
  for (const x of xGrid(c.spec)) {
    const env = { ...params, [c.spec.x.name]: x };
    const mu = evaluate(c.mean, env);
    const sd = evaluate(c.sigma, env);
    const eps = c.spec.noise.family === "studentt"
      ? normal(rng) / Math.sqrt((2 * gamma(rng, c.spec.noise.nu! / 2)) / c.spec.noise.nu!)
      : normal(rng);
    const y = mu + sd * eps;
    if (!Number.isFinite(mu) || !Number.isFinite(y) || !(sd >= 0)) broken = true;
    curve.push([x, mu]);
    obs.push([x, y]);
  }
  return { index, params, curve, obs, broken };
}

export function simulateWorlds(c: Compiled, seed: number, count: number): World[] {
  return Array.from({ length: count }, (_, i) => simulateWorld(c, seed, i));
}

// Compact numeric summary so the agent reads worlds as numbers, not pictures.
export function summarizeWorld(c: Compiled, w: World) {
  const ys = w.curve.map(([, y]) => y);
  const first = w.curve[0];
  const last = w.curve[w.curve.length - 1];
  let wiggles = 0;
  for (let i = 2; i < ys.length; i++) {
    if (Math.sign(ys[i] - ys[i - 1]) !== Math.sign(ys[i - 1] - ys[i - 2])) wiggles++;
  }
  const round = (v: number) => Number(v.toPrecision(4));
  return {
    world: w.index,
    params: Object.fromEntries(Object.entries(w.params).map(([k, v]) => [k, round(v)])),
    meanCurve: {
      atXmin: round(first[1]),
      atXmax: round(last[1]),
      min: round(Math.min(...ys)),
      max: round(Math.max(...ys)),
      directionChanges: wiggles,
    },
    observedRange: [round(Math.min(...w.obs.map((o) => o[1]))), round(Math.max(...w.obs.map((o) => o[1])))],
    broken: w.broken,
    xUnit: c.spec.x.unit,
    yUnit: c.spec.y.unit,
  };
}

// Semantic diff between two specs, in the vocabulary of the model rather than JSON paths.
export type SpecChange = { what: string; before: string; after: string };

export function diffSpecs(a: ModelSpec | null, b: ModelSpec): SpecChange[] {
  if (!a) return [{ what: "モデル", before: "なし", after: b.title }];
  const out: SpecChange[] = [];
  const cmp = (what: string, before: string, after: string) => {
    if (before !== after) out.push({ what, before, after });
  };
  cmp("題", a.title, b.title);
  cmp("x の範囲", `${a.x.name} ∈ [${a.x.min}, ${a.x.max}] ${a.x.unit}`, `${b.x.name} ∈ [${b.x.min}, ${b.x.max}] ${b.x.unit}`);
  cmp("平均の式", a.mean, b.mean);
  cmp("ノイズ", `${a.noise.family}, σ = ${a.noise.sigma}`, `${b.noise.family}, σ = ${b.noise.sigma}`);
  const before = new Map(a.params.map((p) => [p.name, p]));
  const after = new Map(b.params.map((p) => [p.name, p]));
  for (const [name, p] of after) {
    const q = before.get(name);
    if (!q) out.push({ what: `${name} を追加`, before: "—", after: describeDist(p.prior) });
    else cmp(`${name} の prior`, describeDist(q.prior), describeDist(p.prior));
  }
  for (const name of before.keys()) {
    if (!after.has(name)) out.push({ what: `${name} を削除`, before: describeDist(before.get(name)!.prior), after: "—" });
  }
  return out;
}
