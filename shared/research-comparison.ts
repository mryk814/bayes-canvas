// Independent research testbed contracts. No algorithm selection or app state mutation.
export type ResearchConditions = {
  // Include model-specific fitted preprocessing in this model/pipeline identity.
  model: string;
  data: string;
  // Shared observation-table preparation; not each estimator's fitted transforms.
  preprocessing: string;
  // Includes the question/estimand, prediction population, and evaluation purpose.
  task: string;
  // Include held-out row/group identities and split policy, or an explicit full-data token.
  split: string;
  // Include the statistic/scoring rule, not just a column name.
  quantity: string;
  // Use "1" for dimensionless quantities.
  unit: string;
};

export function compareResearchConditions(
  mode: "posterior" | "prediction",
  a: Partial<ResearchConditions> | null | undefined,
  b: Partial<ResearchConditions> | null | undefined,
) {
  const reasons: string[] = [];
  if (mode !== "posterior" && mode !== "prediction") reasons.push("比較の用途が不明です");
  const fields = ["model", "data", "preprocessing", "task", "split", "quantity", "unit"] as const;
  let modelsDiffer = false;
  for (const field of fields) {
    const left = a?.[field], right = b?.[field];
    const known = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && !["unknown", "不明"].includes(v.trim().toLowerCase());
    if (!known(left) || !known(right)) {
      reasons.push(`${field}: 比較条件が不足しています`);
      continue;
    }
    if (left === right) continue;
    if (field === "model") modelsDiffer = true;
    if (field !== "model" || mode !== "prediction") reasons.push(`${field}: 比較条件が一致しません`);
  }
  return { comparable: reasons.length === 0, modelsDiffer, reasons };
}

type Check = "checked" | "concern" | "unknown";
export type ResearchUse = {
  purpose: "posterior" | "prediction";
  kind: "posterior-draws" | "approximate-posterior-draws" | "point-estimate" | "bootstrap-replicates" | "predictive-samples";
  completed?: boolean;
  finite?: boolean;
  matchesCurrentTarget?: boolean;
  // Caller aggregates evidence and binds it to these exact results/conditions.
  // This helper does not calculate diagnostics or certify the evidence itself.
  computation?: Check;
  prediction?: Check;
  // Omission means undecided, not adopted. Adoption is not required for eligibility.
  adoption?: "adopted" | "undecided" | "rejected";
};

// `automatic` is eligibility within this purpose, not proof, ranking, or final approval.
// `inspectable` concerns numeric results only. Logs and failure reasons remain readable.
// Predictive evidence for a point estimator cannot certify a posterior distribution.
export function researchUseGate(result: ResearchUse) {
  const reasons: string[] = [];
  const inspectable = result.completed === true && result.finite === true;
  if (result.completed !== true) reasons.push("計算の完了が確認できません");
  if (result.finite !== true) reasons.push("結果の有限性が確認できません");
  if (result.matchesCurrentTarget !== true) reasons.push("現在の対象との条件一致が確認できません");
  if (result.adoption === "rejected") reasons.push("ユーザーが見送った結果です");
  else if (result.adoption !== undefined && !["adopted", "undecided"].includes(result.adoption)) reasons.push("採用状態が不明です");
  const kinds = ["posterior-draws", "approximate-posterior-draws", "point-estimate", "bootstrap-replicates", "predictive-samples"];
  if (!kinds.includes(result.kind)) reasons.push("結果の種類が不明です");
  if (result.purpose === "posterior") {
    if (!["posterior-draws", "approximate-posterior-draws"].includes(result.kind)) reasons.push("この結果は事後標本ではありません");
    if (result.computation !== "checked") reasons.push("この結果の計算検査が未確認、または懸念があります");
  } else if (result.purpose === "prediction") {
    if (!["point-estimate", "predictive-samples"].includes(result.kind)) reasons.push("予測の結果への変換が必要です");
    if (result.prediction !== "checked") reasons.push("この用途の予測評価が未確認、または懸念があります");
  } else reasons.push("結果を使う用途が不明です");
  return { inspectable, automatic: reasons.length === 0, reasons };
}
