import { ModelSpecSchema, type ModelVersion, type Dataset, type Run } from "./contracts.ts";
import { evaluate } from "./expr.ts";
import { runProblems } from "./evidence-validation.ts";
import { compileSpec, resolver, runInputs, simulateWorld, type ViewPoint } from "./sim.ts";

export function applyShutter(raw: readonly ViewPoint[], cap: number): ViewPoint[] {
  if (!Number.isFinite(cap)) throw new Error("試す上限は有限の数値にしてください。");
  if (raw.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.group !== null && !Number.isFinite(p.group)))) {
    throw new Error("生成測定値・横軸・群に非有限の値があります。");
  }
  return raw.map(p => ({ ...p, y: Math.min(p.y, cap), line: null, censored: p.y > cap }));
}

export function prepareShutter(version: ModelVersion, dataset: Dataset | null, run: Run | null, seed: number, index: number) {
  const fail = (...problems: string[]) => ({ ok: false as const, problems });
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(index) || index < 0) return fail("seedは安全な整数、標本位置は0以上の安全な整数にしてください。");
  if (Boolean(dataset) !== Boolean(run)) return fail("保存runと対応するDatasetを一緒に指定してください。");
  const parsed = ModelSpecSchema.safeParse(version.spec);
  if (!parsed.success) return fail("モデルの形式が不正です。");
  const spec = parsed.data;
  if (run && dataset) {
    if (run.versionId !== version.id || run.modelId !== version.modelId || dataset.modelId !== version.modelId || run.datasetId !== dataset.id) return fail("run・モデル版・Datasetの参照が一致しません。");
    const problems = runProblems(spec, dataset, run);
    if (problems.length) return fail(...problems);
  }
  const totalDraws = run ? Object.values(run.draws)[0]?.length ?? 0 : null;
  if (totalDraws !== null && index >= totalDraws) return fail("標本位置が保存runの範囲外です。丸めず停止しました。");
  const compiled = compileSpec(spec);
  if (!compiled.ok) return fail(...compiled.problems);
  const c = compiled.compiled;
  const targetIndex = c.nodes.findIndex(n => n.node.name === spec.view.y);
  const target = c.nodes[targetIndex];
  if (!target || target.node.role !== "observed") return fail("表示のyは観測ノードである必要があります。");
  // Compilation enforces definition order: only data and nodes strictly before y are stable here.
  const upstream = new Set([...c.data.map(d => d.name), ...c.nodes.slice(0, targetIndex).map(n => n.node.name)]);
  if (!upstream.has(spec.view.x) || (spec.view.group && !upstream.has(spec.view.group))) return fail("横軸と群は対象観測より前の入力・量に限定してください。");
  const rawSpec = structuredClone(spec);
  delete rawSpec.nodes[targetIndex].censorAbove;
  // Keep every earlier sample in order to preserve measurement noise; omit unrelated later nodes.
  const rawCompiled = { ...c, spec: rawSpec, nodes: c.nodes.slice(0, targetIndex + 1).map((n, i) => i === targetIndex ? { ...n, node: rawSpec.nodes[i], censor: null } : n) };
  try {
    const world = simulateWorld(rawCompiled, seed, index, run && dataset ? runInputs(c, run, dataset, index) : {});
    if (world.broken) return fail("上限処理前の世界に非有限または不正な値が生じました。");
    const at = (name: string, row: number) => world.values[name]?.[c.plateOf[name] === null ? 0 : row];
    const raw: ViewPoint[] = world.values[spec.view.y].map((y, unit) => ({ unit, x: at(spec.view.x, unit), y, line: null,
      group: spec.view.group ? at(spec.view.group, unit) : null, censored: false }));
    if (raw.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.group !== null && !Number.isFinite(p.group)))) return fail("生成測定値・横軸・群に非有限の値があります。");
    const originalCaps = raw.map(p => target.censor ? evaluate(target.censor, resolver(c, world.values, p.unit)) : null);
    if (originalCaps.some(cap => cap !== null && !Number.isFinite(cap))) return fail("モデル本来の上限式が有限の値になりません。");
    const original = raw.map((p, i) => { const cap = originalCaps[i]; return { ...p, y: cap === null ? p.y : Math.min(p.y, cap), censored: cap !== null && p.y > cap }; });
    const x = [...spec.data, ...spec.nodes].find(n => n.name === spec.view.x)!;
    return { ok: true as const, raw, original, originalCaps, totalDraws, seed, index,
      labels: { x: x.label, y: target.node.label, xUnit: x.unit, yUnit: target.node.unit } };
  } catch (error) { return fail(error instanceof Error ? error.message : "観測の準備に失敗しました。"); }
}
