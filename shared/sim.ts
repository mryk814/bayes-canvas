// Forward simulation of generative programs. Pure and seeded: the same
// (spec, seed, index, inputs) always yields the same world, in the browser and on the server.
// Prior worlds simulate every node; posterior-predictive worlds clamp the
// unobserved nodes to one joint draw of a run and simulate only what is observed.
import { evaluate, isConstant, parseExpr, refs, ExprError, type Expr } from "./expr.ts";
import { DIST_ARGS, DISCRETE, ROLE_LABELS, type DataColumn, type Dist, type Family, type ModelNode, type ModelSpec } from "./contracts.ts";

export type World = {
  index: number;
  values: Record<string, number[]>;
  censored: Record<string, boolean[]>;
  broken: boolean;
};

type CNode = { node: ModelNode; args: Record<string, Expr>; expr: Expr | null; censor: Expr | null };
export type Compiled = {
  spec: ModelSpec;
  sizes: Record<string, number>;
  plateOf: Record<string, string | null>;
  data: DataColumn[];
  nodes: CNode[];
  unitPlate: string | null;
};

// ---------- randomness ----------------------------------------------------------------

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
  if (!(shape > 0)) return NaN;
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

function poisson(rng: Rng, rate: number) {
  if (!(rate >= 0)) return NaN;
  if (rate > 30) return Math.max(0, Math.round(rate + Math.sqrt(rate) * normal(rng)));
  const L = Math.exp(-rate);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export function sample(family: Family, a: Record<string, number>, rng: Rng): number {
  const pos = (v: number) => (v > 0 ? v : NaN);
  switch (family) {
    case "normal":
      return a.mu + pos(a.sigma) * normal(rng);
    case "lognormal":
      return Math.exp(a.mu + pos(a.sigma) * normal(rng));
    case "halfnormal":
      return Math.abs(pos(a.sigma) * normal(rng));
    case "exponential":
      return -Math.log(1 - rng()) / pos(a.rate);
    case "uniform":
      return a.lower < a.upper ? a.lower + (a.upper - a.lower) * rng() : NaN;
    case "studentt":
      return a.mu + pos(a.sigma) * (normal(rng) / Math.sqrt((2 * gamma(rng, pos(a.nu) / 2)) / a.nu));
    case "gamma":
      return gamma(rng, pos(a.shape)) / pos(a.rate);
    case "beta": {
      const x = gamma(rng, pos(a.a));
      return x / (x + gamma(rng, pos(a.b)));
    }
    case "poisson":
      return poisson(rng, a.rate);
    case "bernoulli":
      return a.p >= 0 && a.p <= 1 ? (rng() < a.p ? 1 : 0) : NaN;
    case "binomial": {
      const n = Math.round(a.n);
      if (!(n >= 0) || !(a.p >= 0 && a.p <= 1)) return NaN;
      if (n > 60) return Math.min(n, Math.max(0, Math.round(n * a.p + Math.sqrt(n * a.p * (1 - a.p)) * normal(rng))));
      let k = 0;
      for (let i = 0; i < n; i++) if (rng() < a.p) k++;
      return k;
    }
  }
}

// ---------- compile: what a schema cannot check -----------------------------------------

export function compileSpec(spec: ModelSpec): { ok: true; compiled: Compiled } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const sizes: Record<string, number> = {};
  for (const p of spec.plates) {
    if (p.name in sizes) problems.push(`プレート ${p.name} が重複しています`);
    sizes[p.name] = p.size;
  }
  const plateOf: Record<string, string | null> = {};
  const indexOf: Record<string, string | null> = {};
  const known = (name: string, plate: string | null, where: string) => {
    if (name in plateOf) problems.push(`名前 ${name} が重複しています`);
    if (plate !== null && !(plate in sizes)) problems.push(`${where} のプレート ${plate} がありません`);
    plateOf[name] = plate;
  };

  for (const d of spec.data) {
    known(d.name, d.plate, `データ ${d.name}`);
    indexOf[d.name] = d.indexOf;
    if (d.indexOf && !(d.indexOf in sizes)) problems.push(`データ ${d.name} が指すプレート ${d.indexOf} がありません`);
    if (d.generate.kind === "cycle" && !d.indexOf) problems.push(`データ ${d.name} の cycle は添字の列（indexOf）にだけ使えます`);
  }

  const parse = (label: string, source: string, ctx: string | null): Expr | null => {
    let e: Expr;
    try {
      e = parseExpr(source);
    } catch (err) {
      problems.push(`${label} を読めません: ${err instanceof ExprError ? err.message : String(err)}`);
      return null;
    }
    for (const r of refs(e)) {
      if (!r.index && isConstant(r.name)) continue;
      if (!(r.name in plateOf)) {
        problems.push(`${label} の ${r.name} は、それより前に定義されていません`);
        continue;
      }
      const target = plateOf[r.name];
      if (r.index) {
        if (!(r.index in indexOf) || indexOf[r.index] !== target || plateOf[r.index] !== ctx) {
          problems.push(`${label} の ${r.name}[${r.index}] は読めません。${r.index} は ${ctx ?? "スカラー"} 上で ${target} を指す添字の列である必要があります`);
        }
      } else if (target !== null && target !== ctx) {
        problems.push(
          ctx === null
            ? `${label} はスカラーなので、${target} ごとの値 ${r.name} は読めません`
            : `${label} の ${r.name} は ${target} ごとの値です。${r.name}[添字の列] の形で読んでください`,
        );
      }
    }
    return e;
  };

  const nodes: CNode[] = [];
  for (const n of spec.nodes) {
    const where = `${n.label}（${n.name}）`;
    const args: Record<string, Expr> = {};
    let ex: Expr | null = null;
    if (n.role === "deterministic") {
      if (!n.expr) problems.push(`${where} は計算ノードなので expr が必要です`);
      else ex = parse(`${where} の式`, n.expr, n.plate);
      if (n.dist) problems.push(`${where} は計算ノードなので dist は持てません`);
    } else {
      if (!n.dist) problems.push(`${where} には分布 dist が必要です`);
      else {
        const need = DIST_ARGS[n.dist.family] as readonly string[];
        for (const a of need) {
          if (!(a in n.dist.args)) problems.push(`${where} の ${n.dist.family} には ${a} が必要です`);
          else {
            const e = parse(`${where} の ${a}`, n.dist.args[a], n.plate);
            if (e) args[a] = e;
          }
        }
        for (const a of Object.keys(n.dist.args)) if (!need.includes(a)) problems.push(`${where} の ${n.dist.family} に ${a} という引数はありません`);
      }
    }
    const censor = n.censorAbove ? parse(`${where} の記録上限`, n.censorAbove, n.plate) : null;
    if (n.censorAbove && n.role !== "observed") problems.push(`記録上限は観測ノードにだけ付けられます（${where}）`);
    known(n.name, n.plate, where);
    nodes.push({ node: n, args, expr: ex, censor });
  }

  const v = spec.view;
  const unitPlate = plateOf[v.y] ?? null;
  if (!(v.y in plateOf)) problems.push(`表示の y ${v.y} がありません`);
  for (const [k, name] of [["x", v.x], ["line", v.line]] as const) {
    if (name === undefined) continue;
    if (!(name in plateOf)) problems.push(`表示の ${k} ${name} がありません`);
    else if (plateOf[name] !== unitPlate) problems.push(`表示の ${k} ${name} は y と同じプレートにしてください`);
  }
  if (v.group && (!(v.group in indexOf) || plateOf[v.group] !== unitPlate)) {
    problems.push(`表示の group ${v.group} は y と同じプレートの添字の列にしてください`);
  }

  if (problems.length) return { ok: false, problems };
  const compiled: Compiled = { spec, sizes, plateOf, data: spec.data, nodes, unitPlate };
  const probe = Array.from({ length: 40 }, (_, i) => simulateWorld(compiled, 1, i));
  const broken = probe.filter((w) => w.broken).length;
  if (broken > 20) problems.push(`40 世界中 ${broken} 世界で値が有限になりません（負の σ、log(負) など）`);
  return problems.length ? { ok: false, problems } : { ok: true, compiled };
}

// ---------- simulate -----------------------------------------------------------------------

function generate(d: DataColumn, n: number, sizes: Record<string, number>): number[] {
  const g = d.generate;
  switch (g.kind) {
    case "linspace":
      return Array.from({ length: n }, (_, i) => (n === 1 ? g.from : g.from + ((g.to - g.from) * i) / (n - 1)));
    case "uniform": {
      const rng = mulberry32(hash(7919, n));
      return Array.from({ length: n }, () => g.lower + (g.upper - g.lower) * rng());
    }
    case "cycle":
      return Array.from({ length: n }, (_, i) => i % (d.indexOf ? sizes[d.indexOf] : n));
    case "values":
      return Array.from({ length: n }, (_, i) => g.values[i % g.values.length]);
  }
}

export type SimInputs = {
  sizes?: Record<string, number>;
  data?: Record<string, number[]>;
  clamp?: Record<string, number[]>;
};

export function resolver(c: Compiled, values: Record<string, number[]>, i: number) {
  return (name: string, index: string | null) => {
    const arr = values[name];
    if (!arr) return NaN;
    if (c.plateOf[name] === null) return arr[0];
    if (index) return arr[values[index][i]];
    return arr[i];
  };
}

export function simulateWorld(c: Compiled, seed: number, index: number, inputs: SimInputs = {}): World {
  const rng = mulberry32(hash(seed, index));
  const sizes = { ...c.sizes, ...inputs.sizes };
  const values: Record<string, number[]> = {};
  const censored: Record<string, boolean[]> = {};
  let broken = false;
  for (const d of c.data) {
    const n = sizes[d.plate];
    values[d.name] = inputs.data?.[d.name] ?? generate(d, n, sizes);
    if (d.indexOf) {
      const m = sizes[d.indexOf];
      if (values[d.name].some((v) => !Number.isInteger(v) || v < 0 || v >= m)) broken = true;
    }
  }
  for (const cn of c.nodes) {
    const { node } = cn;
    const n = node.plate ? sizes[node.plate] : 1;
    const out = new Array<number>(n);
    const cens = new Array<boolean>(n).fill(false);
    const fixed = inputs.clamp?.[node.name];
    for (let i = 0; i < n; i++) {
      const env = resolver(c, values, i);
      let v: number;
      if (fixed) v = fixed[i];
      else if (cn.expr) v = evaluate(cn.expr, env);
      else {
        const a: Record<string, number> = {};
        for (const [k, e] of Object.entries(cn.args)) a[k] = evaluate(e, env);
        v = sample(node.dist!.family, a, rng);
      }
      if (cn.censor && !fixed) {
        const cap = evaluate(cn.censor, env);
        if (v > cap) {
          v = cap;
          cens[i] = true;
        }
      }
      if (!Number.isFinite(v)) broken = true;
      out[i] = v;
    }
    values[node.name] = out;
    if (cn.censor) censored[node.name] = cens;
  }
  return { index, values, censored, broken };
}

// Posterior-predictive inputs for joint draw k: the dataset's plates and known inputs,
// with every sampled unobserved node clamped to the run's values.
export function runInputs(
  c: Compiled,
  run: { draws: Record<string, number[][]> },
  dataset: { plates: Record<string, number>; columns: Record<string, number[]> },
  k: number,
): SimInputs {
  return {
    sizes: dataset.plates,
    data: Object.fromEntries(c.data.map((d) => [d.name, dataset.columns[d.name]])),
    clamp: Object.fromEntries(Object.entries(run.draws).map(([name, draws]) => [name, draws[Math.min(k, draws.length - 1)]])),
  };
}

export function drawCount(run: { draws: Record<string, number[][]> }) {
  return Object.values(run.draws)[0]?.length ?? 0;
}

export function simulateWorlds(c: Compiled, seed: number, count: number, inputs?: SimInputs): World[] {
  return Array.from({ length: count }, (_, i) => simulateWorld(c, seed, i, inputs));
}

// ---------- reading a world ------------------------------------------------------------

export type ViewPoint = { unit: number; x: number; y: number; line: number | null; group: number | null; censored: boolean };

export function viewPoints(c: Compiled, w: World): ViewPoint[] {
  const v = c.spec.view;
  const ys = w.values[v.y] ?? [];
  return ys.map((y, i) => ({
    unit: i,
    x: w.values[v.x]?.[c.plateOf[v.x] === null ? 0 : i],
    y,
    line: v.line ? w.values[v.line][c.plateOf[v.line] === null ? 0 : i] : null,
    group: v.group ? w.values[v.group][i] : null,
    censored: w.censored[v.y]?.[i] ?? false,
  }));
}

// The dataset as drawn in a world: x, y, group, and whether the record hit its limit.
export function datasetPoints(c: Compiled, ds: { columns: Record<string, number[]> }, w: World): ViewPoint[] {
  const v = c.spec.view;
  const ys = ds.columns[v.y];
  if (!ys) return [];
  const xs = ds.columns[v.x] ?? w.values[v.x];
  const yNode = c.nodes.find((n) => n.node.name === v.y);
  return ys.map((y, i) => {
    let censored = false;
    if (yNode?.censor) censored = y >= evaluate(yNode.censor, resolver(c, w.values, i)) - 1e-9;
    return { unit: i, x: xs?.[i] ?? NaN, y, line: null, group: v.group ? (ds.columns[v.group]?.[i] ?? null) : null, censored };
  });
}

export type Layer = {
  name: string;
  label: string;
  unit: string;
  role: "data" | ModelNode["role"];
  plate: string | null;
  element: number | null;
  value: number;
  censored: boolean;
  how: string;
  reads: string[];
};

const r4 = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(4)) : v);

// Observation Passport: every value that fed one node at one element, in generation order.
export function anatomy(c: Compiled, w: World, nodeName: string, unit: number): Layer[] {
  const byName = new Map(c.nodes.map((cn) => [cn.node.name, cn]));
  const dataByName = new Map(c.data.map((d) => [d.name, d]));
  const seen = new Map<string, Layer>();
  const elementFor = (name: string, ctxPlate: string | null, ctxEl: number | null, index: string | null) => {
    if (c.plateOf[name] === null) return null;
    if (index && ctxEl !== null) return w.values[index][ctxEl];
    return ctxEl;
  };
  const visit = (name: string, element: number | null) => {
    const key = `${name}@${element}`;
    if (seen.has(key)) return;
    const d = dataByName.get(name);
    const el = element ?? 0;
    if (d) {
      seen.set(key, {
        name, label: d.label, unit: d.unit, role: "data", plate: d.plate, element, value: w.values[name][el], censored: false,
        how: d.indexOf ? `${d.indexOf} の番号` : "既知の入力", reads: [],
      });
      return;
    }
    const cn = byName.get(name);
    if (!cn) return;
    const exprs = cn.expr ? [cn.expr] : Object.values(cn.args);
    if (cn.censor) exprs.push(cn.censor);
    const reads: string[] = [];
    for (const e of exprs) {
      for (const r of refs(e)) {
        if (!r.index && isConstant(r.name)) continue;
        if (r.index) visit(r.index, element);
        visit(r.name, elementFor(r.name, cn.node.plate, element, r.index));
        if (!reads.includes(r.name)) reads.push(r.name);
      }
    }
    const env = resolver(c, w.values, el);
    let how: string;
    if (cn.expr) how = `= ${cn.node.expr}`;
    else {
      const a = Object.entries(cn.args).map(([k, e]) => `${k}=${r4(evaluate(e, env))}`);
      how = `${cn.node.dist!.family}(${a.join(", ")})`;
    }
    if (cn.censor) how += ` · 記録上限 ${r4(evaluate(cn.censor, env))}`;
    seen.set(key, {
      name, label: cn.node.label, unit: cn.node.unit, role: cn.node.role, plate: cn.node.plate, element,
      value: w.values[name][el], censored: w.censored[name]?.[el] ?? false, how, reads,
    });
  };
  visit(nodeName, c.plateOf[nodeName] === null ? null : unit);
  const order = [...c.data.map((d) => d.name), ...c.nodes.map((n) => n.node.name)];
  return [...seen.values()].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

// Compact numeric summary so the agent reads worlds as numbers, not pictures.
export function summarizeWorld(c: Compiled, w: World) {
  const scalars: Record<string, number> = {};
  const plated: Record<string, { min: number; mean: number; max: number }> = {};
  for (const cn of c.nodes) {
    const vs = w.values[cn.node.name];
    if (cn.node.plate === null) scalars[cn.node.name] = r4(vs[0]);
    else plated[cn.node.name] = { min: r4(Math.min(...vs)), mean: r4(vs.reduce((s, v) => s + v, 0) / vs.length), max: r4(Math.max(...vs)) };
  }
  const censoredCount = Object.fromEntries(Object.entries(w.censored).map(([k, v]) => [k, v.filter(Boolean).length]));
  return { world: w.index, scalars, plated, censoredCount, broken: w.broken };
}

// ---------- describing a model ---------------------------------------------------------

export function describeDist(d: Dist): string {
  return `${d.family}(${Object.entries(d.args).map(([k, v]) => `${k}=${v}`).join(", ")})`;
}

export function describeNode(n: ModelNode): string {
  const where = n.plate ? `[${n.plate}]` : "";
  const body = n.role === "deterministic" ? `= ${n.expr}` : `~ ${describeDist(n.dist!)}`;
  return `${n.name}${where} ${body}${n.censorAbove ? ` (記録上限 ${n.censorAbove})` : ""}`;
}

export function isDiscrete(n: ModelNode) {
  return n.dist ? DISCRETE.includes(n.dist.family) : false;
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
  const plates = (s: ModelSpec) => new Map(s.plates.map((p) => [p.name, `${p.label} × ${p.size}`]));
  diffMaps(out, "プレート", plates(a), plates(b));
  const data = (s: ModelSpec) => new Map(s.data.map((d) => [d.name, `${d.plate}${d.indexOf ? ` → ${d.indexOf}` : ""} · ${d.generate.kind}`]));
  diffMaps(out, "データ", data(a), data(b));
  const nodes = (s: ModelSpec) => new Map(s.nodes.map((n) => [n.name, `${ROLE_LABELS[n.role]} · ${describeNode(n)}`]));
  diffMaps(out, "", nodes(a), nodes(b));
  const view = (s: ModelSpec) => `x=${s.view.x}, y=${s.view.y}${s.view.line ? `, line=${s.view.line}` : ""}${s.view.group ? `, group=${s.view.group}` : ""}`;
  cmp("表示", view(a), view(b));
  return out;
}

function diffMaps(out: SpecChange[], prefix: string, a: Map<string, string>, b: Map<string, string>) {
  const p = prefix ? `${prefix} ` : "";
  for (const [k, v] of b) {
    const old = a.get(k);
    if (old === undefined) out.push({ what: `${p}${k} を追加`, before: "—", after: v });
    else if (old !== v) out.push({ what: `${p}${k}`, before: old, after: v });
  }
  for (const [k, v] of a) if (!b.has(k)) out.push({ what: `${p}${k} を削除`, before: v, after: "—" });
}
