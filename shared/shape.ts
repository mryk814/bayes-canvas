// Shape Lens: the shape the model gives a quantity along the x axis, and what the
// data can say about it. Two separate things on purpose:
//   functionBand — the model's own function (an argument of the observation, e.g. its
//                  mean or its spread) evaluated per record across draws. A sketch on it is
//                  the person's belief about the shape, not data.
//   binnedCheck  — a posterior predictive check: one statistic per x-bin, computed the same
//                  way on the data and on replicates for new units. Bins are small; with many
//                  bins some fall outside by chance.
import { evaluate } from "./expr.ts";
import { resolver, runInputs, simulateWorld, viewPoints, type Compiled, type SimInputs, type World } from "./sim.ts";

type RunLike = { draws: Record<string, number[][]> };
type DataLike = { plates: Record<string, number>; columns: Record<string, number[]> };

export type ShapeArg = { arg: string; label: string; stat: "mean" | "sd" };

const ARG_LABELS: Record<string, string> = {
  mu: "平均",
  sigma: "ばらつき（標準偏差）",
  rate: "率",
  p: "確率",
  nu: "裾の重さ",
  lower: "下限",
  upper: "上限",
  shape: "形",
};

export function shapeArgs(c: Compiled): ShapeArg[] {
  const y = c.nodes.find((n) => n.node.name === c.spec.view.y);
  if (!y || !y.node.dist) return [];
  return Object.keys(y.args).map((arg) => ({ arg, label: ARG_LABELS[arg] ?? arg, stat: arg === "sigma" ? "sd" : "mean" }));
}

export type BandPoint = { unit: number; x: number; group: number | null; q: [number, number, number, number, number] };

function q5(xs: number[]): [number, number, number, number, number] {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (p: number) => s[Math.round(p * (s.length - 1))];
  return [at(0.05), at(0.25), at(0.5), at(0.75), at(0.95)];
}

// The worlds a band is computed over: prior draws, or posterior draws clamped to the run.
export function bandWorlds(c: Compiled, run: RunLike | null, ds: DataLike | null, count = 200): World[] {
  if (!run || !ds) return Array.from({ length: count }, (_, i) => simulateWorld(c, 4_242, i));
  const K = Object.values(run.draws)[0]?.length ?? 0;
  const step = Math.max(1, Math.floor(K / count));
  const out: World[] = [];
  for (let k = 0; k < K; k += step) out.push(simulateWorld(c, 4_242, k, runInputs(c, run, ds, k)));
  return out;
}

export function functionBand(c: Compiled, worlds: World[], arg: string, group: number | null): BandPoint[] {
  const y = c.nodes.find((n) => n.node.name === c.spec.view.y)!;
  const e = y.args[arg];
  const base = viewPoints(c, worlds[0]);
  const units = base.filter((p) => group === null || p.group === group);
  return units
    .map((p) => ({
      unit: p.unit,
      x: p.x,
      group: p.group,
      q: q5(worlds.map((w) => evaluate(e, resolver(c, w.values, p.unit)))),
    }))
    .sort((a, b) => a.x - b.x);
}

export type CheckBin = { lo: number; hi: number; n: number; data: number; rep: [number, number, number]; p: number };

function statOf(kind: "mean" | "sd", xs: number[], ys: number[]) {
  const n = ys.length;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  if (kind === "mean") return n >= 1 ? my : NaN;
  if (n < 3) return NaN;
  // spread around the bin's own straight line, so a trend inside the bin is not counted as spread
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  return Math.sqrt(ys.reduce((s, v, i) => s + (v - my - b * (xs[i] - mx)) ** 2, 0) / (n - 2));
}

// Replicates are for new units: scalars and the group plate keep the draw's values,
// every other latent (e.g. each specimen's true strength) is drawn anew.
export function binnedCheck(c: Compiled, run: RunLike, ds: DataLike, kind: "mean" | "sd", group: number | null, bins = 6, draws = 200): CheckBin[] {
  const groupPlate = c.spec.view.group ? (c.data.find((d) => d.name === c.spec.view.group)?.indexOf ?? null) : null;
  const K = Object.values(run.draws)[0]?.length ?? 0;
  const step = Math.max(1, Math.floor(K / draws));
  const first = simulateWorld(c, 9_001, 0, runInputs(c, run, ds, 0));
  const data = viewPoints(c, first).map((p, i) => ({ ...p, y: ds.columns[c.spec.view.y][i] }));
  const xs = data.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const edges = Array.from({ length: bins + 1 }, (_, b) => x0 + ((x1 - x0) * b) / bins);
  const member = (p: { x: number; group: number | null }, b: number) =>
    (group === null || p.group === group) && p.x >= edges[b] && (b === bins - 1 ? p.x <= edges[b + 1] : p.x < edges[b + 1]);
  const reps: number[][] = Array.from({ length: bins }, () => []);
  for (let k = 0; k < K; k += step) {
    const inputs: SimInputs = runInputs(c, run, ds, k);
    inputs.clamp = Object.fromEntries(Object.entries(inputs.clamp!).filter(([name]) => c.plateOf[name] === null || c.plateOf[name] === groupPlate));
    const pts = viewPoints(c, simulateWorld(c, 9_001, k, inputs));
    for (let b = 0; b < bins; b++) {
      const sel = pts.filter((p) => member(p, b));
      reps[b].push(statOf(kind, sel.map((p) => p.x), sel.map((p) => p.y)));
    }
  }
  return edges.slice(0, -1).map((lo, b) => {
    const sel = data.filter((p) => member(p, b));
    const d = statOf(kind, sel.map((p) => p.x), sel.map((p) => p.y));
    const r = reps[b].filter(Number.isFinite).sort((p, q) => p - q);
    const at = (p: number) => r[Math.round(p * (r.length - 1))];
    return {
      lo,
      hi: edges[b + 1],
      n: sel.length,
      data: d,
      rep: r.length ? [at(0.05), at(0.5), at(0.95)] : [NaN, NaN, NaN],
      p: r.length && Number.isFinite(d) ? r.filter((v) => v >= d).length / r.length : NaN,
    };
  });
}
