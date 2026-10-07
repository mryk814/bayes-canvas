// Synthetic-only fixture for world-view accounting. Existing files are rejected by seedChecksDemo.
import { seedChecksDemo } from "./seed-checks-demo.ts";

const path = process.argv[2];
if (!path) throw new Error("新規の検証データファイル名を指定してください。");
const { store, examples } = seedChecksDemo(path);
for (const example of examples) {
  const columns = structuredClone(example.dataset.columns);
  if (example.exampleId === "curve") columns.strength[0] = 100000;
  const dataset = store.attachDataset({ ...example.dataset, columns, label: "表示契約検証・合成データ", note: "表示検証専用。曲線例には軸外の点を確認するため強度100000を1件含む。実験記録ではない。" });
  const run = store.attachRun({ ...example.secondRun, datasetId: dataset.id,
    method: "prior生成（表示契約検証・4draw・推論未実行）",
    note: "既存の合成prior標本の先頭4本を使用。推論を実行した証拠ではない。",
    draws: Object.fromEntries(Object.entries(example.secondRun.draws).map(([name, rows]) => [name, rows.slice(0, 4)])),
  });
  console.log(JSON.stringify({ example: example.exampleId, datasetId: dataset.id, runId: run.id }));
}
