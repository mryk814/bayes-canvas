// A deterministic, synthetic example. No app data or inference worker is touched.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { splitResearchRows, type ResearchRow, type ResearchSplitPlan } from "../shared/research-split.ts";
import { compareResearchConditions, researchUseGate, type ResearchConditions } from "../shared/research-comparison.ts";
import { missingnessSensitivity } from "../shared/missingness-sensitivity.ts";

const rows: ResearchRow[] = [
  { id: "a1", group: "A", time: 1, outcome: 10 },
  { id: "a2", group: "A", time: 2, outcome: 11 },
  { id: "a3", group: "A", time: 3, outcome: 12 },
  { id: "a4", group: "A", time: 4, outcome: 13 },
  { id: "b1", group: "B", time: 1, outcome: 30 },
  { id: "b2", group: "B", time: 2, outcome: 31 },
  { id: "b3", group: "B", time: 3, outcome: 32 },
  { id: "b4", group: "B", time: 4, outcome: 33 },
  { id: "c1", group: "C", time: 1, outcome: 100 },
  { id: "c2", group: "C", time: 4, outcome: 101 },
  { id: "c3", group: "C", time: 4, outcome: null },
];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function evaluate(plan: ResearchSplitPlan) {
  const split = splitResearchRows(rows, plan);
  const observed = split.train.filter((r): r is ResearchRow & { outcome: number } => r.outcome !== null);
  if (!observed.length) throw new Error("訓練側に観測値がありません");
  const sorted = observed.map(r => r.outcome).sort((a, b) => a - b);
  const fallback = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  const predictions = split.scoreable.map(row => {
    const group = observed.filter(r => r.group === row.group);
    const predicted = group.length ? group.reduce((sum, r) => sum + r.outcome, 0) / group.length : fallback;
    return { id: row.id, observed: row.outcome!, predicted, absoluteError: Math.abs(row.outcome! - predicted) };
  });
  const conditions: ResearchConditions = {
    model: "group-mean-with-training-median-fallback-v1", data: digest(rows),
    preprocessing: "no-imputation-training-observed-only-v1", task: split.target,
    split: digest({ train: split.train.map(r => r.id), test: split.test.map(r => r.id) }),
    quantity: "observed-test-outcome-MAE", unit: "MPa",
  };
  return {
    target: split.target, counts: split.counts, conditions,
    trainingRowIds: split.train.map(r => r.id), missingOutcomeIds: split.missingTestOutcome.map(r => r.id),
    predictions, mae: predictions.length ? predictions.reduce((sum, r) => sum + r.absoluteError, 0) / predictions.length : null,
  };
}

export function researchEvaluationDemo() {
  const existingGroups = evaluate({
    kind: "explicit", target: "既存の装置で次に測る値",
    trainIds: ["a1", "a2", "a3", "b1", "b2", "b3", "c1"], testIds: ["a4", "b4", "c2", "c3"],
  });
  const newGroup = evaluate({ kind: "group", target: "初めて見る装置で測る値", testGroups: ["C"] });
  const ready = { completed: true, finite: true, matchesCurrentTarget: true, adoption: "adopted" as const };
  return {
    scope: "合成データ上の点予測例。欠測機構の補正、汎化性能の保証、本体への接続は含まない。",
    existingGroups, newGroup,
    comparison: compareResearchConditions("prediction", existingGroups.conditions, newGroup.conditions),
    adoptedButUnchecked: researchUseGate({ ...ready, purpose: "posterior", kind: "posterior-draws", computation: "unknown" }),
    pointAsPosterior: researchUseGate({ ...ready, purpose: "posterior", kind: "point-estimate", computation: "checked" }),
    // 'checked' below is an explicit example input, not inferred from a low MAE.
    pointForPrediction: researchUseGate({ ...ready, purpose: "prediction", kind: "point-estimate", prediction: "checked" }),
    missingnessAssumptions: "別の合成例。欠測2行の基準条件付き平均を8 MPaと仮定し、δ MPaを加える。等重み、閾値10 MPa。補完データや事後確率ではなく、仮定別の期待値集計。",
    missingness: missingnessSensitivity([
      { id: "observed-1", outcome: 10 }, { id: "observed-2", outcome: 12 },
      { id: "missing-1", outcome: null, baselineMean: 8 }, { id: "missing-2", outcome: null, baselineMean: 8 },
    ], [-5, 0, 1, 5], 10),
    limits: ["MAEは観測された保留行だけの成績", "両成績は対象が違うので優劣を直接比較できない", "候補資格は最終結果や採用を意味しない"],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(JSON.stringify(researchEvaluationDemo(), null, 2));
}
