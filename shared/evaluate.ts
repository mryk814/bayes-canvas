// Report cards for inference: is an algorithm right (calibration against the app's own
// simulator), and does its posterior predict records it never saw (scored outside the
// Bayesian bookkeeping: CRPS, absolute error, 90% interval coverage). Pure, so the server
// and tests share it.
import { simulateWorld, runInputs, type Compiled } from "./sim.ts";

type DataLike = { plates: Record<string, number>; columns: Record<string, number[]> };
type RunLike = { draws: Record<string, number[][]> };

// ---------- calibration ------------------------------------------------------------------

// Which values the calibration tracks: every scalar parameter, the first few elements of plated
// ones, and a few sums of latent values. Marginal ranks alone pass an algorithm that draws
// integrated-out values independently and breaks their correlation; sums do not.
// Pairs across plates use the units one real record points at (its specimen and its machine),
// where the posterior ties them together.
export function calibrationTargets(c: Compiled, ds?: { columns: Record<string, number[]> }, perPlate = 3): string[] {
  const out: string[] = [];
  const plated: { name: string; plate: string }[] = [];
  for (const { node } of c.nodes) {
    if (node.role !== "param" && node.role !== "latent") continue;
    if (!node.plate) {
      out.push(node.name);
      continue;
    }
    const n = c.sizes[node.plate] ?? 0;
    for (let i = 0; i < Math.min(perPlate, n); i++) out.push(`${node.name}[${i}]`);
    if (n >= 2) out.push(`${node.name}[0]+${node.name}[1]`);
    if (n >= 1) plated.push({ name: node.name, plate: node.plate });
  }
  const obsPlate = holdoutPlate(c);
  const unitOf = (plate: string) => {
    if (plate === obsPlate) return 0;
    const col = c.data.find((d) => d.plate === obsPlate && d.indexOf === plate);
    return col && ds?.columns[col.name]?.length ? ds.columns[col.name][0] : 0;
  };
  for (let i = 0; i < plated.length; i++) {
    for (let j = i + 1; j < plated.length; j++) {
      const a = plated[i];
      const b = plated[j];
      out.push(`${a.name}[${unitOf(a.plate)}]+${b.name}[${unitOf(b.plate)}]`);
    }
  }
  return out;
}

// The value of a target ("a", "a[2]", "a[0]+b[0]") in one world.
export function targetValue(target: string, values: Record<string, number[]>) {
  return target.split("+").reduce((sum, term) => {
    const m = /^(.+)\[(\d+)\]$/.exec(term);
    return sum + (m ? values[m[1]][Number(m[2])] : values[term][0]);
  }, 0);
}

export type CalibrationSet = {
  plates: Record<string, number>;
  datasets: { columns: Record<string, number[]>; truth: Record<string, number> }[];
};

// Datasets simulated from the prior with the real data's known inputs and sizes, with the truth kept.
export function calibrationSets(c: Compiled, ds: DataLike, count: number, seed: number): CalibrationSet {
  const targets = calibrationTargets({ ...c, sizes: { ...c.sizes, ...ds.plates } }, ds);
  const data = Object.fromEntries(c.data.map((d) => [d.name, ds.columns[d.name]]));
  const observed = c.nodes.filter((n) => n.node.role === "observed").map((n) => n.node.name);
  const datasets: CalibrationSet["datasets"] = [];
  for (let i = 0; datasets.length < count && i < count * 5; i++) {
    const w = simulateWorld(c, seed, i, { sizes: ds.plates, data });
    if (w.broken) continue;
    const columns: Record<string, number[]> = { ...data };
    for (const name of observed) columns[name] = w.values[name];
    const truth: Record<string, number> = {};
    for (const t of targets) truth[t] = targetValue(t, w.values);
    datasets.push({ columns, truth });
  }
  return { plates: ds.plates, datasets };
}

// Regularized lower incomplete gamma P(a, x), for chi-square p-values.
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const lg = logGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lg);
  }
  // continued fraction for Q, then P = 1 - Q
  let b = x + 1 - a;
  let cc = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    cc = b + an / cc;
    if (Math.abs(cc) < 1e-300) cc = 1e-300;
    d = 1 / d;
    const del = d * cc;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lg) * h;
}

function logGamma(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

export function chiSquareP(stat: number, dof: number) {
  return 1 - gammaP(dof / 2, stat / 2);
}

// Two-sided normal tail.
function normalP(z: number) {
  // Abramowitz–Stegun 7.1.26 for erfc
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erfc = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return Math.min(1, erfc);
}

// Uniformity of ranks 0..L per tracked value, by three tests: the histogram (chi-square, any
// shape), the mean rank (the posterior sits to one side of the truth), and the spread of ranks
// (a hump: the posterior is too wide; a U: too narrow — what broken correlation produces in a
// sum). Each value's p is the smallest of the three, times three; the verdict uses a Bonferroni
// cut over values so that many tracked values do not fail by chance.
// Family-wise: about 1 in 20 calibrations of a correct algorithm raises a concern by chance.
export const CALIBRATION_ALPHA = 0.05;

export function flaggedValues<T extends { p: number }>(params: T[], alpha = CALIBRATION_ALPHA) {
  return params.filter((p) => p.p < alpha / Math.max(1, params.length));
}

export function calibrationSummary(ranks: Record<string, number[]>, L: number, alpha = CALIBRATION_ALPHA) {
  const names = Object.keys(ranks);
  const params = names.map((name) => {
    const r = ranks[name];
    const n = r.length;
    const bins = Math.max(3, Math.min(10, Math.floor(n / 5)));
    const hist = new Array<number>(bins).fill(0);
    for (const v of r) hist[Math.min(bins - 1, Math.floor((v * bins) / (L + 1)))]++;
    const expected = n / bins;
    const stat = hist.reduce((s, h) => s + (h - expected) ** 2 / expected, 0);
    const u = r.map((v) => (v + 0.5) / (L + 1) - 0.5);
    const mean = u.reduce((s, x) => s + x, 0) / n;
    const spread = u.reduce((s, x) => s + x * x, 0) / n;
    const pLocation = normalP(mean / Math.sqrt(1 / 12 / n));
    const pSpread = normalP((spread - 1 / 12) / Math.sqrt(1 / 180 / n));
    const p = Math.min(1, 3 * Math.min(chiSquareP(stat, bins - 1), pLocation, pSpread));
    return { name, p, hist };
  });
  const biasDetected = flaggedValues(params, alpha).length > 0;
  return { params, biasDetected };
}

// ---------- held-out prediction ----------------------------------------------------------
// Two different questions, never ranked together:
//   records          predict further records of units already seen (records held out at random)
//   groups:<plate>   predict records of units never seen (every record of some units held out)

export type SplitKind = "records" | `groups:${string}`;

export function splitLabel(split: string) {
  if (split === "records") return "記録の 20% をランダムに取っておく（すでに見た対象の、次の記録の予測）";
  const g = split.slice("groups:".length);
  return `${g} の 20% を記録ごと丸ごと取っておく（まだ見ていない ${g} の予測）`;
}

// The plate the observations live on; records are held out along it.
export function holdoutPlate(c: Compiled): string | null {
  const obs = c.nodes.find((n) => n.node.role === "observed" && n.node.plate);
  return obs?.node.plate ?? null;
}

// The splits this model allows: records, and one group split per index column on the observation plate.
export function holdoutSplits(c: Compiled): SplitKind[] {
  const plate = holdoutPlate(c);
  if (!plate || c.data.some((d) => d.indexOf === plate)) return [];
  const groups = c.data.filter((d) => d.plate === plate && d.indexOf).map((d) => `groups:${d.indexOf}` as SplitKind);
  return ["records", ...new Set(groups)];
}

function shuffled(n: number, seed: number) {
  const idx = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

export function seedOf(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type Split = { split: SplitKind; plate: string; train: DataLike; held: number[] };

// Keep the rest of the records for fitting; hold out the chosen ones. Null when this model does
// not allow the split, or it leaves too little on either side.
export function holdoutSplit(c: Compiled, ds: DataLike, split: SplitKind, fraction = 0.2, seed = 1): Split | null {
  const plate = holdoutPlate(c);
  if (!plate || !holdoutSplits(c).includes(split)) return null;
  const n = ds.plates[plate];
  let held: number[];
  if (split === "records") {
    held = shuffled(n, seed).slice(0, Math.floor(n * fraction));
  } else {
    const group = split.slice("groups:".length);
    const col = c.data.find((d) => d.plate === plate && d.indexOf === group)!;
    const chosen = new Set(shuffled(ds.plates[group], seed).slice(0, Math.floor(ds.plates[group] * fraction)));
    held = ds.columns[col.name].flatMap((g, i) => (chosen.has(g) ? [i] : []));
  }
  held.sort((a, b) => a - b);
  if (held.length < 1 || n - held.length < 2) return null;
  const heldSet = new Set(held);
  const onPlate = new Set([
    ...c.data.filter((d) => d.plate === plate).map((d) => d.name),
    ...c.nodes.filter((x) => x.node.role === "observed" && x.node.plate === plate).map((x) => x.node.name),
  ]);
  const columns: Record<string, number[]> = {};
  for (const [name, col] of Object.entries(ds.columns)) columns[name] = onPlate.has(name) ? col.filter((_, i) => !heldSet.has(i)) : col;
  return { split, plate, train: { plates: { ...ds.plates, [plate]: n - held.length }, columns }, held };
}

function crps(samples: number[], y: number) {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  let e1 = 0;
  let e2 = 0;
  for (let i = 0; i < n; i++) {
    e1 += Math.abs(s[i] - y);
    e2 += (2 * (i + 1) - n - 1) * s[i];
  }
  return e1 / n - e2 / (n * n);
}

function quantile(sorted: number[], q: number) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export type NodeScore = { node: string; unit: string; rows: number; crps: number; mae: number; coverage90: number; width90: number; rowCrps: (number | null)[] };

// Score a run fitted on the training split at predicting the held-out records, one score per
// observed quantity (their units differ, so they are never averaged together). Nodes on the
// held-out plate are resimulated (their draws were for the training rows); everything else is
// clamped to the run's joint draws.
export function predictiveScores(c: Compiled, run: RunLike, ds: DataLike, plate: string, held: number[], draws = 200, seed = 7): NodeScore[] {
  const observed = c.nodes.filter((n) => n.node.role === "observed" && n.node.plate === plate).map((n) => n.node);
  const total = Math.min(draws, Object.values(run.draws)[0]?.length ?? 0);
  const preds: Record<string, number[][]> = Object.fromEntries(observed.map((o) => [o.name, held.map(() => [] as number[])]));
  const onPlate = new Set(c.nodes.filter((n) => n.node.plate === plate).map((n) => n.node.name));
  for (let k = 0; k < total; k++) {
    const inputs = runInputs(c, run, ds, k);
    for (const name of Object.keys(inputs.clamp ?? {})) if (onPlate.has(name)) delete inputs.clamp![name];
    const w = simulateWorld(c, seed, k, inputs);
    if (w.broken) continue;
    for (const o of observed) held.forEach((row, j) => preds[o.name][j].push(w.values[o.name][row]));
  }
  return observed.map((o) => {
    let sCrps = 0;
    let sAbs = 0;
    let hits = 0;
    let width = 0;
    let count = 0;
    const rowCrps: (number | null)[] = [];
    held.forEach((row, j) => {
      const xs = preds[o.name][j];
      const y = ds.columns[o.name][row];
      if (!xs.length || !Number.isFinite(y)) {
        rowCrps.push(null);
        return;
      }
      const sorted = [...xs].sort((a, b) => a - b);
      const lo = quantile(sorted, 0.05);
      const hi = quantile(sorted, 0.95);
      const c = crps(xs, y);
      rowCrps.push(c);
      sCrps += c;
      sAbs += Math.abs(quantile(sorted, 0.5) - y);
      if (y >= lo && y <= hi) hits++;
      width += hi - lo;
      count++;
    });
    if (!count) throw new Error(`${o.name} の予測を作れませんでした（世界がすべて壊れました）`);
    return { node: o.name, unit: o.unit, rows: count, crps: sCrps / count, mae: sAbs / count, coverage90: hits / count, width90: width / count, rowCrps };
  });
}

// ---------- what the card says ------------------------------------------------------------

export function speedup(candidate: { minEss: number | null; seconds: number | null }, reference: { minEss: number | null; seconds: number | null }) {
  if (!candidate.minEss || !candidate.seconds || !reference.minEss || !reference.seconds) return null;
  return candidate.minEss / candidate.seconds / (reference.minEss / reference.seconds);
}

// Paired comparison of two methods on the same held-out records: mean CRPS difference and its
// standard error. With a few dozen records, small differences are within noise.
export function pairedDifference(a: (number | null)[], b: (number | null)[]) {
  const d = a.flatMap((x, i) => {
    const y = b[i];
    return x !== null && y !== null && y !== undefined ? [x - y] : [];
  });
  const n = d.length;
  if (n < 2) return null;
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  return { mean, se: sd / Math.sqrt(n), n };
}

type Scored = { crps: number; rowCrps: (number | null)[] };

// A method against the best-scoring one on the same split and quantity: "as good" when the
// paired difference is within two standard errors, or within 5%.
export function predictiveVerdict(mine: Scored, best: Scored) {
  const ratio = mine.crps / best.crps;
  const diff = pairedDifference(mine.rowCrps, best.rowCrps);
  const withinNoise = diff ? diff.mean <= 2 * diff.se : false;
  return { ratio, diff, asGood: ratio <= 1.05 || withinNoise };
}
