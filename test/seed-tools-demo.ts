// Creates a NEW synthetic-only file for UI verification. Never points at the user's data.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../server/store.ts";
import { EXAMPLES } from "../shared/example.ts";
import { compileSpec, simulateWorld } from "../shared/sim.ts";
import { runSites } from "../shared/evidence-validation.ts";

const path = process.argv[2];
if (!path || existsSync(path)) throw new Error("新規の検証データファイル名を指定してください。既存ファイルは上書きしません。");
const store = new Store(resolve(path));
for (const example of EXAMPLES) {
  const model = store.startExample(example.id);
  const version = store.version(model.currentVersionId);
  const ds = store.synthesize({ modelId: model.id, label: `操作検証専用・${example.label}`, note: "合成fixture。実験記録ではありません。", truth: version.spec, seed: 37, plates: {} });
  const compiled = compileSpec(version.spec);
  if (!compiled.ok) throw new Error(compiled.problems.join(" / "));
  const samples = Array.from({ length: 32 }, (_, k) => simulateWorld(compiled.compiled, 81, k));
  const draws = Object.fromEntries(runSites(version.spec).map(n => [n.name, samples.map(w => w.values[n.name])]));
  store.attachRun({ versionId: version.id, datasetId: ds.id, method: "Stan NUTS (UI検証fixture・推論未実行)", note: "このrunは操作検証専用。drawはpriorから生成、診断値は手作りであり推論を実行した証拠ではありません。", diagnostics: { chains: 4, maxRhat: 1.08, minEss: 120, divergences: 3 }, draws });
}
console.log(`合成検証データ: ${resolve(path)}`);
