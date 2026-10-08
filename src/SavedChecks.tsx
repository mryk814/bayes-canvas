import { useState } from "react";
import type { Dataset, ModelVersion, Run, SavedCheck, State } from "../shared/contracts.ts";
import { post, useAction } from "./api.ts";
import { ErrorNote } from "./Ledger.tsx";
import { savedCheckIntervals } from "./check-intervals.ts";

const numberText = (value: number) => Number.isFinite(value) ? value.toPrecision(5) : "—";
const statisticLabels = { mean: "平均", max: "最大値", sd: "標準偏差（Nで割る）", exceedance: "閾値を超える割合" };
const sdExplanation = "標準偏差 = √(Σ(y−平均)² / N)。Nは選択した記録の件数で、1件なら0です。区間内の傾向・群差・打ち切りも含む記録値のばらつきで、測定誤差だけを推定した値ではありません。単位は元のyと同じです。";
const exceedanceExplanation = "選択した記録のうち、y > 閾値となる件数を全件数Nで割ります。等しい値は含めません。上限処理後の記録の割合で、潜在的な上限超過確率ではありません。履歴の「上側割合」は複製統計量が観測統計量以上になる割合（同値込み）で、この記録の超過割合とは別です。";
const resultText = (value: number, statistic: string) => statistic === "exceedance" ? `${numberText(value * 100)}%` : numberText(value);

export function SavedChecks({ state, modelId, version, dataset, run }: { state: State; modelId: string; version: ModelVersion; dataset: Dataset | null; run: Run | null }) {
  const checks = state.checks.filter(c => c.modelId === modelId);
  const [checkId, setCheckId] = useState("");
  const selected = checks.find(c => c.id === checkId) ?? null;
  const [seed, setSeed] = useState("9001");
  const action = useAction();
  const [message, setMessage] = useState("");
  const results = selected ? state.checkResults.filter(r => r.checkId === selected.id) : [];
  const currentVersionId = state.models.find(m => m.id === modelId)!.currentVersionId;
  return <section className="stack" aria-label="保存検査">
    <div><h2>この違和感を、次の版でも確かめる</h2><p className="muted">区間と集計の仕方を保存し、別のrunで明示的に再実行します。過去の結果はそのまま残ります。</p></div>
    {run && dataset ? <CheckForm key={run.id} state={state} version={version} dataset={dataset} run={run} onSaved={id => { setCheckId(id); setMessage("検査と最初の結果を保存しました。"); }}/>
      : <p className="empty-note">検査を作るには根拠にするrunを選んでください。保存済みの履歴は下で読めます。</p>}
    <section className="card stack" aria-label="保存した検査の履歴">
      <h3>同じ検査の履歴</h3>
      <label>保存した検査<select value={checkId} disabled={action.busy} onChange={e => { setCheckId(e.target.value); setMessage(""); action.clear(); }}><option value="">検査を選んでください</option>{checks.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      {!checks.length && <p className="muted">まだ検査がありません。上で定義して保存できます。</p>}
      {selected && <>
        <p>{selected.x}: {selected.xMin}〜{selected.xMax} {selected.xUnit}（両端を含む）／{selected.groupIndex === null ? "全群" : `${selected.groupColumn}[${selected.groupIndex}]`}／{selected.y}の{statisticLabels[selected.statistic]} ({selected.statistic === "exceedance" ? "%" : selected.yUnit})</p>
        {selected.statistic === "sd" && <p className="small muted">{sdExplanation}</p>}
        {selected.statistic === "exceedance" && <><p>保存した記録の閾値: {selected.threshold} {selected.yUnit || "単位なし"}。この閾値を変えずに再実行します。</p><p className="small muted">{exceedanceExplanation}</p></>}
        <p className="small muted">データ: {state.datasets.find(d => d.id === selected.datasetId)?.label ?? selected.datasetId}。同じデータ・列名・単位・群列のrunだけ再実行できます。対応が変わった場合は新しい検査を作ってください。</p>
        <div className="tools-inline"><label>再実行のseed<input type="number" step="1" value={seed} disabled={action.busy} onChange={e => setSeed(e.target.value)}/></label><button className="btn" disabled={!run || action.busy || !seed.trim() || !Number.isSafeInteger(Number(seed))} onClick={() => { setMessage(""); return action.run(async () => {
          await post(`/api/human/checks/${selected.id}/run`, { runId: run!.id, seed: Number(seed) });
          setMessage("同じ定義で再実行した結果を追加しました。");
        }); }}>選択runで再実行して履歴に追加</button></div>
        {run && <p className="small">追加先: v{version.number} · {run.id}{run.versionId !== currentVersionId ? " · 旧版" : ""}</p>}
        <div className="tools-table" role="region" aria-label="検査履歴の表（横スクロール）" tabIndex={0}><table><caption>結果は上書きせず、実行順に並びます</caption><thead><tr><th>版 / run</th><th>観測値 / 件数</th><th>複製の90%区間</th><th>上側割合</th><th>複製数 / seed</th></tr></thead><tbody>{results.map(r => <tr key={r.id}>
          <td>v{state.versions.find(v => v.id === r.versionId)?.number}{r.versionId !== currentVersionId ? "（旧版）" : ""}<br/>{r.runId}</td><td>{resultText(r.observedValue, selected.statistic)} / {r.observedCount}</td><td>{resultText(r.predictiveRange[0], selected.statistic)}〜{resultText(r.predictiveRange[1], selected.statistic)}</td><td>{(r.tailFraction * 100).toFixed(1)}%</td><td>{r.replicatedValues.length} / {r.seed}</td>
        </tr>)}</tbody></table></div>
        {results.map(r => <details key={r.id}><summary>複製値を読む · {r.runId} · {r.createdAt}</summary><p className="small">保存結果 {r.id} / データ {r.datasetId}</p><pre className="check-values">{r.replicatedValues.map(value => resultText(value, selected.statistic)).join(", ")}</pre></details>)}
      </>}
      <ErrorNote error={action.error}/>{message && <p role="status">{message}</p>}
    </section>
    <p className="small muted">複製は新しい観測個体を想定します。スカラーと群の量は各drawに固定し、ほかのプレートの潜在量と観測は再生成します。上側割合は複製統計量が観測値以上になった割合で、モデルの合否や校正済みp値ではありません。検査をたくさん選ぶほど、偶然の不一致も増えます。</p>
  </section>;
}

function CheckForm({ state, version, dataset, run, onSaved }: { state: State; version: ModelVersion; dataset: Dataset; run: Run; onSaved: (id: string) => void }) {
  const view = version.spec.view;
  const xs = dataset.columns[view.x] ?? [];
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState(xs.length ? String(Math.min(...xs)) : "");
  const [to, setTo] = useState(xs.length ? String(Math.max(...xs)) : "");
  const [group, setGroup] = useState("");
  const [statistic, setStatistic] = useState("mean");
  const [threshold, setThreshold] = useState("");
  const yUnit = version.spec.nodes.find(node => node.name === view.y)?.unit ?? "";
  const [seed, setSeed] = useState("9001");
  const action = useAction();
  const groups = view.group ? [...new Set(dataset.columns[view.group] ?? [])].sort((a,b) => a-b) : [];
  const marks = savedCheckIntervals(state,version.modelId,version.id,dataset.id);
  const valid = label.trim() && from.trim() && to.trim() && seed.trim() && Number.isFinite(Number(from)) && Number.isFinite(Number(to)) && Number(from) <= Number(to) && Number.isSafeInteger(Number(seed)) && (statistic !== "exceedance" || (threshold.trim() && Number.isFinite(Number(threshold))));
  return <section className="card stack" aria-label="新しい保存検査">
    <h3>区間から検査を作る</h3>
    <p className="small">v{version.number} · {dataset.label} · x={view.x} / y={view.y}。選択runの全drawを使い、同じ区間・群・統計量で観測と複製を比べます。</p>
    <fieldset className="stack" disabled={action.busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    {marks.length > 0 && <label>保存済みの指示から区間を使う<select defaultValue="" onChange={e => {
      const item = marks.find(m => m.id === e.target.value); if (!item) return;
      setFrom(String(Math.min(item.mark.from,item.mark.to))); setTo(String(Math.max(item.mark.from,item.mark.to)));
      setGroup(item.mark.kind === "bin" && item.mark.group !== null ? String(item.mark.group) : "");
    }}><option value="">手入力する</option>{marks.map(item => <option key={item.id} value={item.id}>{item.mark.from}〜{item.mark.to} · {item.mark.kind === "bin" ? `群 ${item.mark.group ?? "全体"}` : "範囲"} · {item.id}</option>)}</select></label>}
    <label>検査の名前<input value={label} maxLength={120} onChange={e => setLabel(e.target.value)} placeholder="高温側の平均が合うか"/></label>
    <div className="tools-inline"><label>区間の下端<input type="number" value={from} onChange={e => setFrom(e.target.value)}/></label><label>区間の上端<input type="number" value={to} onChange={e => setTo(e.target.value)}/></label></div>
    <div className="tools-inline check-fields"><label>対象の群<select value={group} onChange={e => setGroup(e.target.value)}><option value="">全群</option>{groups.map(g => <option key={g} value={g}>{view.group}[{g}]</option>)}</select></label><label>集計する統計量<select value={statistic} onChange={e => setStatistic(e.target.value)}>{Object.entries(statisticLabels).map(([value, text]) => <option key={value} value={value}>{value === "sd" ? "標準偏差" : text}</option>)}</select></label><label>複製生成のseed<input type="number" step="1" value={seed} onChange={e => setSeed(e.target.value)}/></label></div>
    {statistic === "sd" && <p className="small muted">{sdExplanation}</p>}
    {statistic === "exceedance" && <><label>記録の閾値 ({yUnit || "単位なし"})<input type="number" step="any" value={threshold} onChange={e => setThreshold(e.target.value)}/></label><p className="small muted">{exceedanceExplanation}</p></>}
    <button className="btn btn-primary" disabled={!valid || action.busy} onClick={() => action.run(async () => {
      const response = await post<{check: SavedCheck}>("/api/human/checks", {runId:run.id,label:label.trim(),xMin:Number(from),xMax:Number(to),groupIndex:group === "" ? null : Number(group),statistic,seed:Number(seed), ...(statistic === "exceedance" ? { threshold: Number(threshold) } : {})});
      onSaved(response.check.id);
    })}>{action.busy ? "計算しています…" : "この定義で検査して保存"}</button><ErrorNote error={action.error}/>
    </fieldset>
  </section>;
}
