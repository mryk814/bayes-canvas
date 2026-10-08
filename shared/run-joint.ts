import type { Dataset, ModelVersion, Run } from "./contracts.ts";
import { compileSpec } from "./sim.ts";
import { runProblems, runSites } from "./evidence-validation.ts";
import { queryJoint } from "./joint.ts";
import type { JointCondition } from "./joint.ts";

export type RunCondition = { node: string; index: number; op: JointCondition["op"]; threshold: number };

/** A view over joint rows, never resampling individual columns or modifying the run. */
export function queryRunJoint(version: ModelVersion, dataset: Dataset, run: Run, conditions: RunCondition[]) {
  const problems: string[] = [];
  if (run.versionId !== version.id || run.datasetId !== dataset.id || run.modelId !== version.modelId || dataset.modelId !== version.modelId) {
    problems.push("run・版・データセットの参照が一致しません。");
  }
  const compiled = compileSpec(version.spec);
  if (!compiled.ok) problems.push(...compiled.problems);
  problems.push(...runProblems(version.spec, dataset, run));
  const sites = runSites(version.spec);
  const quantities = conditions.map(c => {
    const site = sites.find(n => n.name === c.node);
    const size = site?.plate ? dataset.plates[site.plate] : 1;
    if (!site || !Number.isInteger(c.index) || c.index < 0 || c.index >= size) problems.push(`量 ${c.node}[${c.index}] はこのrunで選択できません。`);
    return { key: `${c.node}[${c.index}]`, label: site ? `${site.label}${site.plate ? ` [${c.index}]` : ""}` : c.node, unit: site?.unit ?? "", node: c.node, index: c.index };
  });
  if (!sites.length) problems.push("この版には問い合わせ可能なパラメータ・潜在変数がありません。");
  if (problems.length) return { ok: false as const, problems };
  const count = run.draws[sites[0].name].length;
  const jointDataset = {
    modelRef: version.id,
    runRef: run.id,
    draws: Array.from({ length: count }, (_, k) => ({ id: String(k), values: Object.fromEntries(quantities.map(q => [q.key, run.draws[q.node][k][q.index]])) })),
  };
  const result = queryJoint(jointDataset, conditions.map((c, i) => ({ variable: quantities[i].key, op: c.op, threshold: c.threshold })));
  if (!result.ok) return { ok: false as const, problems: result.errors };
  return { ok: true as const, datasetId: dataset.id, dataset: jointDataset, quantities, result };
}
