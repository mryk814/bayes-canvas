import { DIST_ARGS, ModelSpecSchema, type Family, type ModelSpec } from "./contracts.ts";
import { compileSpec, simulateWorld } from "./sim.ts";

export type PriorTarget = { nodeName: string; label: string; unit: string; family: Family; args: Record<string, number> };
const literal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function priorTargets(spec: ModelSpec): PriorTarget[] {
  const parsed = ModelSpecSchema.safeParse(spec);
  if (!parsed.success) return [];
  return parsed.data.nodes.flatMap(node => {
    if (node.role !== "param" || node.plate !== null || !node.dist || node.expr !== undefined || node.censorAbove !== undefined) return [];
    const names: readonly string[] = DIST_ARGS[node.dist.family], entries = Object.entries(node.dist.args);
    if (entries.length !== names.length || !names.every(name => Object.hasOwn(node.dist!.args, name)) ||
      entries.some(([, text]) => !literal.test(text.trim()) || !Number.isFinite(Number(text)))) return [];
    return [{ nodeName: node.name, label: node.label, unit: node.unit, family: node.dist.family,
      args: Object.fromEntries(names.map(name => [name, Number(node.dist!.args[name])])) }];
  });
}

function validDomain(family: Family, args: Record<string, number>): boolean {
  switch (family) {
    case "normal": case "lognormal": case "halfnormal": return args.sigma > 0;
    case "exponential": return args.rate > 0;
    case "uniform": return args.lower < args.upper;
    case "studentt": return args.nu > 0 && args.sigma > 0;
    case "gamma": return args.shape > 0 && args.rate > 0;
    case "beta": return args.a > 0 && args.b > 0;
    case "poisson": return args.rate >= 0;
    case "bernoulli": return args.p >= 0 && args.p <= 1;
    case "binomial": return Number.isSafeInteger(args.n) && args.n >= 0 && args.p >= 0 && args.p <= 1;
  }
}

export function buildPriorSpec(spec: ModelSpec, nodeName: string, args: Record<string, number>): ModelSpec {
  const target = priorTargets(spec).find(node => node.nodeName === nodeName);
  if (!target) throw new Error("対象は引数がすべて有限の数値リテラルであるscalar paramに限ります。式・プレート・潜在量・観測量は変更できません。");
  const names: readonly string[] = DIST_ARGS[target.family];
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length !== names.length ||
    !names.every(name => Object.hasOwn(args, name) && Number.isFinite(args[name]))) throw new Error("分布の引数名を過不足なく、有限の数値で指定してください。");
  if (!validDomain(target.family, args)) throw new Error(`${target.family}の引数が分布の定義域を満たしません。`);
  if (names.every(name => args[name] === target.args[name])) throw new Error("分布の引数が現在の定義と同じです。");
  const next = structuredClone(spec);
  next.nodes.find(node => node.name === nodeName)!.dist!.args = Object.fromEntries(names.map(name => [name, String(args[name])]));
  const compiled = compileSpec(next);
  if (!compiled.ok) throw new Error(compiled.problems.join(" / "));
  return next;
}

/** Validate exactly the six worlds shown by SideBySide; this is not a distribution-wide guarantee. */
export function validatePriorPreview(before: ModelSpec, after: ModelSpec, seed: number): void {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) throw new Error("seedは0〜2147483647の整数にしてください。");
  for (const [label, spec] of [["基点", before], ["候補", after]] as const) {
    const parsed = ModelSpecSchema.safeParse(spec);
    if (!parsed.success) throw new Error(`${label}のモデル形式が不正です。`);
    const result = compileSpec(parsed.data);
    if (!result.ok) throw new Error(`${label}: ${result.problems.join(" / ")}`);
    for (let index = 0; index < 6; index++) {
      const world = simulateWorld(result.compiled, seed, index);
      if (world.broken || Object.values(world.values).some(values => values.some(value => !Number.isFinite(value)))) {
        throw new Error(`${label}のプレビュー世界 ${index} に非有限または不正な値が生じました。`);
      }
    }
  }
}
