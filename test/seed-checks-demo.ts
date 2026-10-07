// New synthetic-only data for saved-check UI/HTTP verification; never overwrites a file.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "../server/store.ts";
import { EXAMPLES } from "../shared/example.ts";
import { compileSpec, simulateWorld } from "../shared/sim.ts";
import { runSites } from "../shared/evidence-validation.ts";
import type { ModelVersion } from "../shared/contracts.ts";

export function seedChecksDemo(path: string) {
  if (!path || existsSync(path)) throw new Error("新規の検証データファイル名を指定してください。既存ファイルは上書きしません。");
  const store = new Store(resolve(path));
  const examples = EXAMPLES.map(example => {
    const model = store.startExample(example.id);
    const first = store.version(model.currentVersionId);
    const dataset = store.synthesize({ modelId: model.id, label: `保存検査検証専用・${example.label}`, note: "合成fixture。実験記録ではありません。", truth: first.spec, seed: 37, plates: {} });
    const attach = (version: ModelVersion, datasetId: string, seed: number) => {
      const compiled = compileSpec(version.spec);
      if (!compiled.ok) throw new Error(compiled.problems.join(" / "));
      const samples = Array.from({ length: 32 }, (_, k) => simulateWorld(compiled.compiled, seed, k));
      const draws = Object.fromEntries(runSites(version.spec).map(n => [n.name, samples.map(w => w.values[n.name])]));
      return store.attachRun({ versionId: version.id, datasetId, method: "prior生成 (UI検証fixture・推論未実行)", note: "操作検証専用。drawはpriorから生成した32本。診断値は未計算。推論を実行した証拠ではありません。", diagnostics: { chains: null, maxRhat: null, minEss: null, divergences: null }, draws });
    };
    const firstRun = attach(first, dataset.id, 81);
    store.createIntent({
      scene: { modelVersionId: first.id, runId: firstRun.id, seed: 9001 },
      marks: [{ kind: "range", world: null, from: 180, to: 260 }],
      utterance: "操作検証:高温側を検査したい",
    });
    const spec = structuredClone(first.spec);
    spec.nodes.find(node => node.name === "s20")!.dist!.args.mu = "480";
    const proposal = store.propose({ modelId: model.id, spec, summary: "操作検証用: s20のprior中心を480へ変更（推論未実行）", knowledgeIds: [] });
    const second = store.adopt(proposal.id);
    const secondRun = attach(second, dataset.id, 82);
    const foreignDataset = store.synthesize({ modelId: model.id, label: "別dataset拒否の検証用", note: "合成fixtureのみ", truth: second.spec, seed: 91, plates: {} });
    const foreignRun = attach(second, foreignDataset.id, 83);
    return { exampleId: example.id, model, dataset, first, second, firstRun, secondRun, foreignRun };
  });
  return { store, examples };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv[2];
  if (!path) throw new Error("新規の検証データファイル名を指定してください。");
  seedChecksDemo(path);
  console.log(`合成検証データ（推論未実行）: ${resolve(path)}`);
}
