// How this version is inferred, and how well: the held-out prediction scores of every method,
// and a report card for each algorithm an agent wrote for this version. The person reads the
// evidence and adopts or not; nobody needs to read the code.
// Kept apart on purpose: checks of the computation (calibration, agreement with NUTS, the fit's
// own diagnostics), prediction of held-out records, and the person's decision. Scores are only
// compared within one dataset, one split and one observed quantity.
import { IconCheck, IconX, IconArrowBackUp } from "@tabler/icons-react";
import type { Algorithm, Evaluation, Run, State } from "../shared/contracts.ts";
import { flaggedValues, pairedDifference, speedup, predictiveVerdict, splitLabel } from "../shared/evaluate.ts";
import { post, useAction } from "./api.ts";
import { ErrorNote } from "./Ledger.tsx";
import { fmt } from "./format.ts";

type Holdout = Extract<Evaluation, { kind: "holdout" }>;
type Fit = Extract<Evaluation, { kind: "fit" }>;
type Calibration = Extract<Evaluation, { kind: "calibration" }>;

function subjectLabel(subject: string, state: State) {
  if (subject === "approximate") return "近似（ラプラス / ADVI）";
  if (subject === "nuts") return "NUTS";
  return state.algorithms.find((a) => a.id === subject)?.name ?? subject;
}

function essPerSecond(d: Run["diagnostics"]) {
  return d.minEss && d.seconds ? d.minEss / d.seconds : null;
}

// Three significant digits: scores this noisy do not deserve more.
function short(v: number) {
  return Number(v.toPrecision(3)).toString();
}

export function splitShort(split: string) {
  return split === "records" ? "見た対象の次の記録" : `まだ見ていない ${split.slice("groups:".length)}`;
}

export function EngineReport({ state, modelId }: { state: State; modelId: string }) {
  const model = state.models.find((m) => m.id === modelId);
  if (!model) return null;
  const versionId = model.currentVersionId;
  const evals = state.evaluations.filter((e) => e.versionId === versionId);
  // only the newest dataset's cards: scores on different data are not comparable
  const datasetId = evals.at(-1)?.datasetId ?? null;
  const current = evals.filter((e) => e.datasetId === datasetId);
  const algorithms = state.algorithms.filter((a) => a.versionId === versionId).reverse();
  const nuts = [...state.runs].reverse().find((r) => r.versionId === versionId && r.datasetId === datasetId && r.fidelity === "mcmc" && !r.algorithmId) ?? null;
  const holdouts = current.filter((e): e is Holdout => e.kind === "holdout");
  if (!holdouts.length && !algorithms.length) return null;
  const splits = [...new Set(holdouts.map((h) => h.split))].sort((a, b) => (a === "records" ? -1 : b === "records" ? 1 : a.localeCompare(b)));
  const dataset = state.datasets.find((d) => d.id === datasetId);
  return (
    <section className="engine" aria-label="推論の成績表">
      <h3 className="section-title">推論の成績表</h3>
      {dataset && <p className="small muted">データ「{dataset.label}」での成績です。</p>}
      {splits.map((split) => (
        <Prediction key={split} split={split} holdouts={holdouts.filter((h) => h.split === split)} state={state} />
      ))}
      {algorithms.map((a) => (
        <AlgorithmCard key={a.id} algorithm={a} state={state} evals={current.filter((e) => e.subject === a.id)} nuts={nuts} holdouts={holdouts} splits={splits} />
      ))}
    </section>
  );
}

// Fitted without some records, scored on predicting them: methods judged by what people use
// them for, outside the posterior's own bookkeeping. One table per observed quantity.
function Prediction({ split, holdouts, state }: { split: string; holdouts: Holdout[]; state: State }) {
  const order = ["approximate", "nuts"];
  const rows = [...holdouts].sort((a, b) => {
    const ia = order.indexOf(a.subject);
    const ib = order.indexOf(b.subject);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
  });
  const nodes = [...new Set(rows.flatMap((r) => r.scores.map((s) => s.node)))];
  return (
    <div className="card engine-prediction">
      <p className="small">
        <strong>予測：{splitShort(split)}</strong> — {splitLabel(split)}。残りで推論し、取っておいた {rows[0].held} 件をどれだけ当てられるかを採点しました。
      </p>
      {nodes.map((node) => {
        const scored = rows.flatMap((r) => {
          const s = r.scores.find((x) => x.node === node);
          return s ? [{ r, s }] : [];
        });
        const bestScore = scored.reduce((a, b) => (b.s.crps < a.s.crps ? b : a)).s;
        const unit = scored[0]?.s.unit;
        const approx = scored.find((x) => x.r.subject === "approximate");
        const verdict = approx ? predictiveVerdict(approx.s, bestScore) : null;
        return (
          <div key={node}>
            <table className="engine-table">
              <caption className="small muted">
                {node}
                {unit && `（${unit}）`} · {scored[0]?.s.rows ?? 0} 件で採点
              </caption>
              <thead>
                <tr>
                  <th>方法</th>
                  <th title="連続順位確率スコア。予測分布全体のずれ。小さいほど良い">CRPS</th>
                  <th title="同じ記録どうしで比べた、最良の方法との CRPS の差と標準誤差。差が標準誤差の 2 倍より小さければ偶然の範囲（灰色）">最良との差</th>
                  <th title="予測の中央値と実際の値の差の平均">誤差</th>
                  <th title="予測の 90% 区間に実際の値が入った割合。90% に近いのが良い">90%区間</th>
                  <th title="取っておいた記録を除いて推論したときの計算時間">秒</th>
                </tr>
              </thead>
              <tbody>
                {scored.map(({ r, s }) => {
                  const diff = s === bestScore ? null : pairedDifference(s.rowCrps, bestScore.rowCrps);
                  const beyond = diff !== null && diff.mean > 2 * diff.se;
                  return (
                    <tr key={r.id} className={s === bestScore ? "is-best" : ""}>
                      <th scope="row">
                        {subjectLabel(r.subject, state)}
                        {!r.trusted && <span className="badge badge-warn">自己検査に懸念</span>}
                      </th>
                      <td className="num">{short(s.crps)}</td>
                      <td className="num">
                        {s === bestScore ? (
                          "—"
                        ) : diff ? (
                          <span className={beyond ? "" : "muted"} title={beyond ? "偶然の範囲を超えた差" : "偶然の範囲"}>
                            +{short(diff.mean)} ± {short(diff.se)}
                          </span>
                        ) : (
                          "?"
                        )}
                      </td>
                      <td className="num">{short(s.mae)}</td>
                      <td className="num">{Math.round(s.coverage90 * 100)}%</td>
                      <td className="num">{r.seconds === null ? "?" : Math.round(r.seconds)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {approx && !approx.r.trusted && approx.s === bestScore && (
              <p className="small engine-verdict">
                近似は自分の検査（Pareto k）に懸念があり、パラメータの値を読むには使えません。それでもこの予測では最も良い成績でした（ほかとの差は「最良との差」の列）。この用途なら、近似で足りるかもしれません。
              </p>
            )}
            {approx && !approx.r.trusted && approx.s !== bestScore && verdict?.asGood && (
              <p className="small engine-verdict">
                近似は自分の検査（Pareto k）に懸念があり、パラメータの値を読むには使えません。それでもこの予測では、最良との差が偶然の範囲か 5% 以内です（CRPS が最良の {fmt(verdict.ratio)} 倍）。この用途なら、近似で足りるかもしれません。
              </p>
            )}
            {approx && !approx.r.trusted && verdict && !verdict.asGood && (
              <p className="small engine-verdict">近似は自分の検査に懸念があり、この予測でも劣ります（CRPS が最良の {fmt(verdict.ratio)} 倍）。</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AlgorithmCard({
  algorithm: a, state, evals, nuts, holdouts, splits,
}: { algorithm: Algorithm; state: State; evals: Evaluation[]; nuts: Run | null; holdouts: Holdout[]; splits: string[] }) {
  const { run, busy, error } = useAction();
  const fit = evals.find((e): e is Fit => e.kind === "fit");
  const cal = evals.find((e): e is Calibration => e.kind === "calibration");
  const ratio = fit && nuts ? speedup(fit.diagnostics, nuts.diagnostics) : null;
  const flagged = cal ? flaggedValues(cal.params) : [];
  const status = { proposed: "提案", adopted: "採用中", rejected: "却下" }[a.status];
  return (
    <article className={`card engine-alg engine-alg-${a.status}`}>
      <header>
        <span className={`badge ${a.status === "adopted" ? "badge-current" : a.status === "rejected" ? "badge-warn" : "badge-proposal"}`}>{status}</span>
        <strong>{a.name}</strong>
      </header>
      {a.note && <p className="small">{a.note}</p>}
      <dl className="engine-checks">
        <dt>速さ</dt>
        <dd>
          {!fit ? (
            <span className="muted">未計測（実データでの試走を待っています）</span>
          ) : (
            <>
              {fit.diagnostics.seconds != null && <>{Math.round(fit.diagnostics.seconds)} 秒 · </>}
              ESS ≥ {fit.diagnostics.minEss === null ? "?" : Math.round(fit.diagnostics.minEss)} · 発散 {fit.diagnostics.divergences ?? "?"} · R̂ ≤{" "}
              {fit.diagnostics.maxRhat === null ? "?" : fmt(fit.diagnostics.maxRhat)}
              {ratio !== null && (
                <div className={ratio >= 1 ? "engine-good" : "engine-bad"}>
                  1 秒あたりの有効サンプル数は NUTS の {ratio >= 10 ? Math.round(ratio) : fmt(ratio)} 倍
                  {essPerSecond(nuts!.diagnostics) !== null && (
                    <span className="muted">（{fmt(essPerSecond(fit.diagnostics)!)} 対 {fmt(essPerSecond(nuts!.diagnostics)!)}）</span>
                  )}
                </div>
              )}
            </>
          )}
        </dd>
        <dt>計算の検査</dt>
        <dd>
          {!cal ? (
            <span className="muted">未検査（事前分布から作ったデータで、真の値を当てられるかの較正を待っています）</span>
          ) : (
            <>
              <div className={cal.biasDetected ? "engine-bad" : "engine-good"}>
                {cal.biasDetected ? (
                  <>
                    懸念あり：較正で偏りを検出しました（{flagged.map((p) => p.name).join("、")}）。
                  </>
                ) : (
                  <>
                    較正で偏りは検出されませんでした（{cal.reps} 組 × {cal.params.length} 量）。正しさの証明ではなく、この規模で見つからなかったという記録です。
                  </>
                )}
              </div>
              <div className="engine-ranks" aria-label="真の値の順位の分布（平らなら偏りなし）">
                {cal.params.map((p) => (
                  <RankBars key={p.name} name={p.name} hist={p.hist} bad={flagged.includes(p)} />
                ))}
              </div>
            </>
          )}
          {fit && fit.gaps.length > 0 && (
            <ul className="small engine-gaps">
              {fit.gaps.map((g) => (
                <li key={g}>実データで NUTS とずれています：{g}</li>
              ))}
            </ul>
          )}
          {fit && fit.reference && fit.gaps.length === 0 && <div className="small muted">実データでは、NUTS の結果との目立ったずれはありません。</div>}
        </dd>
        <dt>予測</dt>
        <dd>
          {splits.length === 0 && <span className="muted">採点を待っています</span>}
          {splits.map((split) => {
            const mine = holdouts.find((h) => h.subject === a.id && h.split === split);
            const ref = holdouts.find((h) => h.subject === "nuts" && h.split === split);
            return (
              <div key={split} className="small">
                {splitShort(split)}：
                {!mine ? (
                  <span className="muted">採点を待っています</span>
                ) : (
                  mine.scores.map((s) => {
                    const r = ref?.scores.find((x) => x.node === s.node);
                    return (
                      <span key={s.node}>
                        {s.node} CRPS {fmt(s.crps)} · 90% 区間 {Math.round(s.coverage90 * 100)}%
                        {r && <span className="muted">（NUTS は {fmt(r.crps)} · {Math.round(r.coverage90 * 100)}%）</span>}{" "}
                      </span>
                    );
                  })
                )}
              </div>
            );
          })}
        </dd>
      </dl>
      <ErrorNote error={error} />
      <div className="row-actions end">
        <details className="engine-code">
          <summary className="small muted">コード（読まなくても判断できるようにしています）</summary>
          <pre className="mono small">{a.code}</pre>
        </details>
        {a.status !== "adopted" && (
          <button className="btn" disabled={busy} onClick={() => run(() => post(`/api/human/algorithms/${a.id}/adopt`))} title="この版の NUTS の代わりに使います">
            <IconCheck size={16} /> 採用
          </button>
        )}
        {a.status === "adopted" && (
          <button className="btn btn-quiet" disabled={busy} onClick={() => run(() => post(`/api/human/algorithms/${a.id}/undecide`))}>
            <IconArrowBackUp size={16} /> 採用をやめる
          </button>
        )}
        {a.status !== "rejected" && (
          <button className="btn btn-quiet" disabled={busy} onClick={() => run(() => post(`/api/human/algorithms/${a.id}/reject`))}>
            <IconX size={16} /> 却下
          </button>
        )}
      </div>
      {a.status !== "rejected" && !cal && <p className="warn-note small">まだ計算の検査を受けていません。採用はできますが、検査の代わりにはなりません。</p>}
      {a.status !== "rejected" && cal?.biasDetected && <p className="warn-note small">較正で偏りが見つかっています。採用すると、間違った事後分布を見ることになるかもしれません。</p>}
    </article>
  );
}

function RankBars({ name, hist, bad }: { name: string; hist: number[]; bad: boolean }) {
  const max = Math.max(...hist, 1);
  const w = 6;
  return (
    <span className={`engine-rank ${bad ? "is-bad" : ""}`} title={`${name}: ${hist.join(" ")}`}>
      <svg width={hist.length * w} height={18} aria-hidden="true">
        {hist.map((h, i) => (
          <rect key={i} x={i * w} y={18 - (h / max) * 18} width={w - 1} height={(h / max) * 18} />
        ))}
      </svg>
      <span className="mono">{name}</span>
    </span>
  );
}
