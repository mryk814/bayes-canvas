import type { Run } from "./contracts.ts";
import { PARETO_K_LIMIT } from "./compare.ts";

export type DiagnosticCheck = {
  id: "chains" | "rhat" | "ess" | "divergences" | "paretoK";
  title: string;
  status: "attention" | "unavailable" | "within-guide" | "not-applicable";
  value: number | null;
  reason: string;
  next: string;
};

export function diagnoseRun(run: Run, currentVersionId: string) {
  // Only the NUTS exporters owned by this application have known diagnostic semantics.
  const supportedMethod = /^(?:NumPyro|Stan) NUTS(?:\s|$)/.test(run.method);
  const d = run.diagnostics;
  const finite = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value);
  const chainsValid = finite(d.chains) && Number.isInteger(d.chains) && d.chains >= 1;
  const checks: DiagnosticCheck[] = [];
  const add = (id: DiagnosticCheck["id"], title: string, value: number | null, valid: boolean, attention: boolean, reason: string, next: string) => {
    checks.push({
      id, title, value: finite(value) ? value : null,
      status: !supportedMethod ? "not-applicable" : !valid ? "unavailable" : attention ? "attention" : "within-guide",
      reason: !supportedMethod ? "このmethodの診断の意味は未対応です。NUTS用の目安を適用しません。" : reason,
      next: !supportedMethod ? "計算に使った手法と、その手法が出力する診断を確認してください。" : next,
    });
  };
  add("chains", "鎖数", d.chains, chainsValid, d.chains === 1,
    !chainsValid ? "鎖数が欠落または不正です。" : d.chains === 1 ? "1鎖では鎖間の一致を確認できません。" : `${d.chains}鎖の記録があります。`,
    !chainsValid ? "runの出力元で、実際に計算した鎖数を確認してください。" : "各鎖が別の初期値から計算されたか、設定と記録を確認してください。");
  const rhatValid = finite(d.maxRhat) && d.maxRhat > 0 && chainsValid && d.chains! >= 2;
  add("rhat", "最大 R̂", d.maxRhat, rhatValid, d.maxRhat! > 1.01,
    !rhatValid ? "有限の正のR̂と2鎖以上の記録が揃わず、鎖間の一致を評価できません。" : d.maxRhat! > 1.01 ? "R̂が案内の目安1.01を超えています。鎖間の不一致を調べてください。" : "R̂は案内の目安1.01以下です。",
    !rhatValid ? "元の推論出力で鎖数・R̂の計算対象・欠落理由を確認してください。" : "変数別のR̂と鎖ごとの軌跡を確認し、離れた領域や混ざりにくい変数を探してください。");
  const essValid = finite(d.minEss) && d.minEss >= 0;
  add("ess", "最小 ESS", d.minEss, essValid, d.minEss! < 400,
    !essValid ? "ESSが欠落または不正です。" : d.minEss! < 400 ? "ESSが案内の目安400未満です。推定のばらつきを確認してください。" : "ESSは案内の目安400以上です。",
    "変数別ESS・自己相関・Monte Carlo標準誤差を確認してください。R̂や発散に問題がある場合、標本数を増やすだけでは解決しません。");
  const divergencesValid = finite(d.divergences) && Number.isInteger(d.divergences) && d.divergences >= 0;
  add("divergences", "発散数", d.divergences, divergencesValid, d.divergences! > 0,
    !divergencesValid ? "発散数が欠落または不正です。0件とは扱いません。" : d.divergences! > 0 ? "発散が記録されています。探索しにくい領域がないか確認してください。" : "記録された発散は0件です。",
    !divergencesValid ? "元の推論出力に発散の件数が含まれるか確認してください。" : "発散した標本の位置と変数の組を確認してください。尺度・事前分布・パラメータ化を見直す候補を検討し、変更時は別runで比較してください。");
  if (run.fidelity === "approximate") {
    // The background ladder's approximations (Laplace / ADVI) carry their own check instead of chain diagnostics.
    const k = d.paretoK;
    const kValid = finite(k);
    checks.push({
      id: "paretoK", title: "Pareto k（近似の検査）", value: kValid ? k : null,
      status: !kValid ? "unavailable" : k > PARETO_K_LIMIT ? "attention" : "within-guide",
      reason: !kValid ? "近似の検査値が記録されていません。近似の質を評価できません。" : k > PARETO_K_LIMIT ? `Pareto kが目安${PARETO_K_LIMIT}を超えています。近似は事後分布の形を捉えていません。` : `Pareto kは目安${PARETO_K_LIMIT}以下です。`,
      next: !kValid || k > PARETO_K_LIMIT ? "この近似は表示や判断に使わず、同じ版・データのNUTSの結果を待つか確認してください。" : "近似です。尾や相関の強い組はNUTSの結果と比べてください。",
    });
  }
  return {
    runId: run.id, versionId: run.versionId, datasetId: run.datasetId,
    stale: run.versionId !== currentVersionId, supportedMethod, checks,
    summary: "これらは計算を調べるための目安です。目安内でも、推論の正確さやモデルの正しさを保証しません。自動修正は行いません。",
  };
}
