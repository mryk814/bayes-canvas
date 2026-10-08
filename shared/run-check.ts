import { SavedCheckSchema, type SavedCheck, type ModelVersion, type Dataset, type Run } from "./contracts.ts";
import { bindCheck, runCheck, type CheckPoint } from "./checks.ts";
import { runProblems } from "./evidence-validation.ts";
import { compileSpec, runInputs, simulateWorld } from "./sim.ts";

/** Explicit new-unit posterior predictive check; all supplied joint draws are used. */
export function evaluateSavedCheck(definition: SavedCheck, version: ModelVersion, dataset: Dataset, run: Run, seed: number) {
  const parsed = SavedCheckSchema.safeParse(definition);
  if (!parsed.success) throw new Error("検査定義が不正です。" + parsed.error.message);
  if (!Number.isSafeInteger(seed)) throw new Error("seedは安全な整数で指定してください。");
  if (definition.modelId !== version.modelId || dataset.modelId !== version.modelId || run.modelId !== version.modelId ||
      definition.datasetId !== dataset.id || run.datasetId !== dataset.id || run.versionId !== version.id) {
    throw new Error("検査・モデル版・データ・runの参照が一致しません。");
  }
  const spec = version.spec;
  const x = spec.data.find(column => column.name === definition.x);
  const y = spec.nodes.find(node => node.name === definition.y && node.role === "observed");
  const groupName = spec.view.group ?? null;
  const group = groupName ? spec.data.find(column => column.name === groupName) : null;
  if (spec.view.x !== definition.x || spec.view.y !== definition.y || groupName !== definition.groupColumn ||
      !x || !y || x.unit !== definition.xUnit || y.unit !== definition.yUnit || !y.plate || x.plate !== y.plate ||
      (groupName && (!group || group.plate !== y.plate || !group.indexOf)) ||
      (definition.groupIndex !== null && (!group?.indexOf || definition.groupIndex >= (dataset.plates[group.indexOf] ?? 0)))) {
    throw new Error("検査の列・単位・群・プレートの対応がこの版と一致しません。新しい検査を作成してください。");
  }
  const problems = runProblems(spec, dataset, run);
  if (problems.length) throw new Error(problems.join("\n"));
  const compilation = compileSpec(spec);
  if (!compilation.ok) throw new Error(compilation.problems.join("\n"));
  const c = compilation.compiled;
  const totalDraws = Object.values(run.draws)[0]?.length ?? 0;
  if (!totalDraws) throw new Error("保存runのdrawが空です。");
  const xs = dataset.columns[definition.x];
  const observedYs = dataset.columns[definition.y];
  const groups = groupName ? dataset.columns[groupName] : null;
  const points = (ys: number[]): CheckPoint[] => {
    if (ys.length !== xs.length || (groups && groups.length !== xs.length)) throw new Error("検査の列の行数が一致しません。");
    return ys.map((value, index) => ({ x: xs[index], y: value, group: groups ? String(groups[index]) : undefined }));
  };
  const context = { modelVersionId: version.id, datasetId: dataset.id, runId: run.id };
  const bound = bindCheck({ id: definition.id, label: definition.label, xMin: definition.xMin, xMax: definition.xMax,
    statistic: definition.statistic, threshold: definition.threshold, group: definition.groupIndex === null ? undefined : String(definition.groupIndex) }, context);
  const groupPlate = group?.indexOf ?? null;
  function* replications() {
    for (let k = 0; k < totalDraws; k++) {
      const inputs = runInputs(c, run, dataset, k);
      inputs.clamp = Object.fromEntries(Object.entries(inputs.clamp!).filter(([name]) => c.plateOf[name] === null || c.plateOf[name] === groupPlate));
      const world = simulateWorld(c, seed, k, inputs);
      if (world.broken) throw new Error(`複製draw ${k} に非有限または不正な値が生じました。除外せず検査を停止します。`);
      yield points(world.values[definition.y]);
    }
  }
  const result = runCheck(bound, { context, observed: points(observedYs), replicated: replications() });
  return { observedValue: result.observedValue, observedCount: result.observedCount,
    replicatedValues: [...result.replicatedValues], predictiveRange: [...result.predictiveRange] as [number, number], tailFraction: result.tailFraction };
}
