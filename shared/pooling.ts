import { ModelSpecSchema, type ModelSpec, type ModelVersion, type Dataset, type Run } from "./contracts.ts";
import { evaluate, refs, type Expr } from "./expr.ts";
import { compileSpec } from "./sim.ts";
import { runProblems } from "./evidence-validation.ts";

export type PoolingCandidate = { node: string; label: string; unit: string; plate: string; groupColumn: string; mu: string; sigma: string };
export type PoolingInterval = [number, number, number];
export type PreparedPooling = {
  ok: true; node: PoolingCandidate; drawCount: number;
  groups: { index: number; label: string; count: number; interval: PoolingInterval }[];
  center: PoolingInterval; sigma: PoolingInterval;
  rows: { index: number; values: number[]; center: number; sigma: number }[];
};
const fail = (...problems: string[]) => ({ ok: false as const, problems });

function discover(spec: ModelSpec) {
  const parsed = ModelSpecSchema.safeParse(spec);
  if (!parsed.success) return fail("モデルの形式が不正です。");
  const compiled = compileSpec(parsed.data);
  if (!compiled.ok) return compiled;
  const c = compiled.compiled;
  if (!c.nodes.some(n => n.node.name === spec.view.y && n.node.role === "observed")) return fail("表示のyは観測ノードである必要があります。潜在量や入力の行数を観測件数として扱いません。");
  const group = c.data.find(d => d.name === spec.view.group);
  if (!group?.indexOf || group.plate !== c.plateOf[spec.view.y]) return fail("表示の群列は観測行と対応し、群プレートを指す添字列である必要があります。");
  const safe = new Map<string, boolean>();
  const shared = (expr: Expr): boolean => refs(expr).every(ref => {
    if (ref.index) return false;
    if (safe.has(ref.name)) return safe.get(ref.name)!;
    const source = c.nodes.find(n => n.node.name === ref.name);
    if (!source || source.node.plate !== null || source.node.role === "observed") return false;
    // Compilation already enforces acyclic definition order. Inspect every ancestor.
    const valid = [...Object.values(source.args), ...(source.expr ? [source.expr] : []), ...(source.censor ? [source.censor] : [])].every(shared);
    safe.set(ref.name, valid);
    return valid;
  });
  const candidates: PoolingCandidate[] = c.nodes.filter(n =>
    (n.node.role === "param" || n.node.role === "latent") && n.node.plate === group.indexOf &&
    n.node.dist?.family === "normal" && !n.censor && shared(n.args.mu) && shared(n.args.sigma)
  ).map(({ node }) => ({ node: node.name, label: node.label, unit: node.unit, plate: group.indexOf!, groupColumn: group.name, mu: node.dist!.args.mu, sigma: node.dist!.args.sigma }));
  return { ok: true as const, compiled: c, candidates };
}

export function poolingCandidates(spec: ModelSpec): { candidates: PoolingCandidate[]; problems: string[] } {
  const found = discover(spec);
  if (!found.ok) return { candidates: [], problems: found.problems };
  return { candidates: found.candidates, problems: found.candidates.length ? [] : ["共有scalar・定数の中心とSDを持つ、上限処理のない群Normalパラメーター／潜在量がありません。"] };
}

function interval(values: number[]): PoolingInterval {
  const sorted = [...values].sort((a, b) => a - b);
  return [0.05, 0.5, 0.95].map(p => {
    const at = (sorted.length - 1) * p, lo = Math.floor(at), f = at - lo;
    return sorted[lo] * (1 - f) + sorted[Math.ceil(at)] * f;
  }) as PoolingInterval;
}

export function preparePooling(version: ModelVersion, dataset: Dataset | null, run: Run | null, node: string): PreparedPooling | ReturnType<typeof fail> {
  if (!dataset || !run) return fail("対応するDatasetと保存runを選んでください。priorの群差はここでは計算しません。");
  if (run.versionId !== version.id || run.modelId !== version.modelId || dataset.modelId !== version.modelId || run.datasetId !== dataset.id) return fail("run・モデル版・Datasetの参照が一致しません。");
  const found = discover(version.spec);
  if (!found.ok) return found;
  const candidate = found.candidates.find(c => c.node === node);
  if (!candidate) return fail("この量は共有scalar・定数を持つ群Normalの対象ではありません。");
  const problems = runProblems(version.spec, dataset, run);
  if (problems.length) return fail(...problems);
  const target = found.compiled.nodes.find(n => n.node.name === node)!;
  const rows: PreparedPooling["rows"] = [];
  try {
    for (let index = 0; index < run.draws[node].length; index++) {
      const cache = new Map<string, number>();
      const resolve = (name: string): number => {
        if (cache.has(name)) return cache.get(name)!;
        const n = found.compiled.nodes.find(n => n.node.name === name)!;
        const value = n.expr ? evaluate(n.expr, resolve) : run.draws[name][index][0];
        if (!Number.isFinite(value)) throw new Error(`draw ${index}: 共有量 ${name} が有限ではありません。`);
        cache.set(name, value);
        return value;
      };
      const center = evaluate(target.args.mu, resolve), sigma = evaluate(target.args.sigma, resolve);
      if (!Number.isFinite(center) || !Number.isFinite(sigma) || sigma <= 0) return fail(`draw ${index}: 共有中心は有限、群SDは正の有限値である必要があります。`);
      rows.push({ index, values: [...run.draws[node][index]], center, sigma });
    }
  } catch (error) { return fail(error instanceof Error ? error.message : "共有量を評価できません。"); }
  const counts = Array(dataset.plates[candidate.plate]).fill(0) as number[];
  for (const index of dataset.columns[candidate.groupColumn]) counts[index]++;
  const label = version.spec.plates.find(p => p.name === candidate.plate)!.label;
  return { ok: true, node: candidate, drawCount: rows.length, rows,
    groups: counts.map((count, index) => ({ index, label: `${label} [${index}]`, count, interval: interval(rows.map(row => row.values[index])) })),
    center: interval(rows.map(row => row.center)), sigma: interval(rows.map(row => row.sigma)) };
}

export function queryContrast(prepared: PreparedPooling, a: number, b: number, threshold: number) {
  if (![a, b].every(i => Number.isInteger(i) && i >= 0 && i < prepared.groups.length) || !Number.isFinite(threshold)) return fail("群の添字と有限の閾値を指定してください。");
  const values = prepared.rows.map(row => row.values[a] - row.values[b]);
  if (!values.length || values.some(value => !Number.isFinite(value))) return fail("同じdrawの群差が有限値として表現できません。");
  return { ok: true as const, values, drawCount: values.length, interval: interval(values), fraction: values.filter(value => value > threshold).length / values.length };
}
