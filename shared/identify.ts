// Identifiability Lens: what the data taught, which quantities move together,
// and two draws from opposite ends of a ridge. Deterministic, computed from the
// run's joint draws and from prior draws of the same spec. A correlation or a
// 2-D picture is a hint about local structure, not a proof of (non-)identifiability.
import type { ModelNode } from "./contracts.ts";
import { simulateWorld, type Compiled } from "./sim.ts";

const POSITIVE = new Set(["halfnormal", "exponential", "gamma", "lognormal"]);

export type ParamTeaching = {
  name: string;
  label: string;
  unit: string;
  logScale: boolean;
  prior: [number, number, number];
  posterior: [number, number, number];
  // 1 − posterior variance / prior variance, on the log scale for positive quantities
  contraction: number;
};

export type Ridge = { a: string; b: string; rho: number };

export type Lens = { params: ParamTeaching[]; ridges: Ridge[]; draws: number };

function quantiles(xs: number[]): [number, number, number] {
  const s = [...xs].sort((p, q) => p - q);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return [at(0.05), at(0.5), at(0.95)];
}

function variance(xs: number[]) {
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  return xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length - 1);
}

function ranks(xs: number[]) {
  const order = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(xs.length);
  order.forEach(([, i], k) => (r[i] = k));
  return r;
}

export function spearman(a: number[], b: number[]) {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = (n - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - ma);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - ma) ** 2;
  }
  return num / Math.sqrt(da * db);
}

const scalarSampled = (c: Compiled) =>
  c.nodes.map((cn) => cn.node).filter((n: ModelNode) => n.plate === null && (n.role === "param" || n.role === "latent"));

export function identifiability(c: Compiled, run: { draws: Record<string, number[][]> }, priorDraws = 400): Lens {
  const nodes = scalarSampled(c).filter((n) => run.draws[n.name]);
  const prior: Record<string, number[]> = Object.fromEntries(nodes.map((n) => [n.name, []]));
  for (let i = 0; i < priorDraws; i++) {
    const w = simulateWorld(c, 7_331, i);
    for (const n of nodes) prior[n.name].push(w.values[n.name][0]);
  }
  const post = Object.fromEntries(nodes.map((n) => [n.name, run.draws[n.name].map((row) => row[0])]));
  const params: ParamTeaching[] = nodes.map((n) => {
    const logScale = POSITIVE.has(n.dist?.family ?? "");
    const t = (xs: number[]) => (logScale ? xs.filter((v) => v > 0).map(Math.log) : xs);
    const vp = variance(t(prior[n.name]));
    const vq = variance(t(post[n.name]));
    return {
      name: n.name,
      label: n.label,
      unit: n.unit,
      logScale,
      prior: quantiles(prior[n.name]),
      posterior: quantiles(post[n.name]),
      contraction: vp > 0 ? 1 - vq / vp : 0,
    };
  });
  const ridges: Ridge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const rho = spearman(post[nodes[i].name], post[nodes[j].name]);
      if (Math.abs(rho) >= 0.5) ridges.push({ a: nodes[i].name, b: nodes[j].name, rho });
    }
  }
  ridges.sort((p, q) => Math.abs(q.rho) - Math.abs(p.rho));
  return { params, ridges, draws: Object.values(post)[0]?.length ?? 0 };
}

// Two draws from opposite ends of the ridge between a and b (5th and 95th
// percentile along it, so single outliers do not stand in for the ridge).
export function ridgeEnds(run: { draws: Record<string, number[][]> }, a: string, b: string, rho: number): [number, number] {
  const ra = ranks(run.draws[a].map((r) => r[0]));
  const rb = ranks(run.draws[b].map((r) => r[0]));
  // A negative ridge runs from (a high, b low) to (a low, b high); a positive one from low-low to high-high.
  const along = ra.map((v, i) => (rho < 0 ? v - rb[i] : v + rb[i]));
  const order = along.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
  const pick = (p: number) => order[Math.round(p * (order.length - 1))][1];
  return [pick(0.05), pick(0.95)];
}
