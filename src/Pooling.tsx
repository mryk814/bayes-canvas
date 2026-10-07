import { useMemo, useState } from "react";
import type { Dataset, ModelVersion, Run } from "../shared/contracts.ts";
import { poolingCandidates, preparePooling, queryContrast } from "../shared/pooling.ts";
import { shutterDomain } from "./shutter-domain.ts";
import { post, useAction } from "./api.ts";
import { ErrorNote } from "./Ledger.tsx";
import "./pooling.css";

type Props = { version: ModelVersion; dataset: Dataset; run: Run; currentVersionId: string };
const numeric = (text: string) => text.trim() ? Number(text) : NaN;
const intervalText = (values: readonly number[]) => values.map(String).join(" / ");

export function Pooling({ version, dataset, run, currentVersionId }: Props) {
  const available = useMemo(() => poolingCandidates(version.spec), [version.spec]);
  const [node, setNode] = useState(available.candidates[0]?.node ?? "");
  const [groupA, setGroupA] = useState("0");
  const [groupB, setGroupB] = useState((dataset.plates[available.candidates[0]?.plate ?? ""] ?? 0) > 1 ? "1" : "0");
  const [threshold, setThreshold] = useState("0");
  const [memo, setMemo] = useState("");
  const [sent, setSent] = useState(false);
  const action = useAction();
  const prepared = useMemo(() => preparePooling(version, dataset, run, node), [version, dataset, run, node]);
  const contrast = useMemo(() => prepared.ok ? queryContrast(prepared, numeric(groupA), numeric(groupB), numeric(threshold)) : null, [prepared, groupA, groupB, threshold]);
  const intervals = prepared.ok ? [
    { label: "共有中心", count: null, interval: prepared.center },
    ...prepared.groups.map(group => ({ label: group.label, count: group.count, interval: group.interval })),
  ] : [];
  const domain = shutterDomain(intervals.flatMap(item => [item.interval[0], item.interval[2]]));
  const position = (value: number) => domain ? (value - domain[0]) / (domain[1] - domain[0]) * 100 : 0;
  const change = () => { setSent(false); action.clear(); };
  const send = async () => {
    if (!prepared.ok || !contrast?.ok || !memo.trim()) return;
    const a = prepared.groups.find(group => group.index === numeric(groupA))!;
    const b = prepared.groups.find(group => group.index === numeric(groupB))!;
    const text = [memo.trim(), "", "階層の共有先と群差（保存runの同じjoint drawによる比較）",
      `node=${node}; 群A=${a.index} (${a.label}, ${a.count}行); 群B=${b.index} (${b.label}, ${b.count}行); threshold=${threshold}; 単位=${prepared.node.unit || "なし"}`,
      `A−B > ${threshold}: ${contrast.fraction * 100}% / 全${contrast.drawCount}draw。差の5/50/95%点=${intervalText(contrast.interval)}。`,
      `Dataset=${dataset.id}; version=${version.id}; run=${run.id}; method=${run.method}`,
      "周辺区間と同drawの差を読んだ発言です。pooling効果・縮約率・因果効果を推定したものではなく、再推論やモデル変更はしていません。"].join("\n");
    if (await action.run(() => post("/api/human/intents", { scene: { modelVersionId: version.id, runId: run.id, seed: 1 }, marks: [], utterance: text }))) setSent(true);
  };
  return <section className="stack pooling" aria-label="階層の共有先と群差">
    <div><h2>どこを共有し、群はどう違う？</h2><p className="muted">保存された群の量と共有中心・群SDを読み、同じdrawの二群を比べます。共有中心への近さをpooling効果や縮約率とは呼びません。</p></div>
    <p className="small">v{version.number} · {run.method} · {run.id} · {dataset.label}</p>
    {version.id !== currentVersionId && <p className="warn-note">旧版の保存runです。現在の版に置き換えて計算していません。</p>}
    <p className="small muted">runの診断は「診断の次の一歩」で確認できます。独立群モデルとの適合比較や、pooling強度を変えた再推論は行っていません。</p>
    {!available.candidates.length ? <p className="empty-note">このモデルには対象となる群のNormal量がありません。{available.problems.join(" / ")}</p> : <>
      <label>群ごとの量<select value={node} disabled={action.busy} onChange={event => { change(); setNode(event.target.value); }}>{available.candidates.map(candidate => <option key={candidate.node} value={candidate.node}>{candidate.label} ({candidate.node})</option>)}</select></label>
      {!prepared.ok ? <p className="error-note" role="alert">{prepared.problems.join(" / ")}</p> : <>
        <article className="card stack">
          <h3>共有する分布と、各群の保存値</h3>
          <p>{prepared.node.node}[群] ∼ Normal(mu={prepared.node.mu}, sigma={prepared.node.sigma}) · {prepared.node.unit || "単位なし"}</p>
          <p className="small muted">棒の両端は5%・95%点、●は50%点です。各量の周辺区間で、同時90%領域ではありません。全{prepared.drawCount}drawを使用。観測行数は同じDatasetの群添字から数え、情報量とは同一視しません。</p>
          {domain ? <div className="pooling-intervals" aria-label="群と共有中心の周辺区間">
            <div className="pooling-axis"><span>{domain[0]}</span><span>{domain[1]}</span></div>
            {intervals.map(item => <div className="pooling-interval" key={item.label}>
              <strong>{item.label}{item.count === null ? "" : ` · 観測${item.count}行`}</strong>
              <div className="pooling-track" aria-hidden="true"><span className="pooling-span" style={{ left: `${position(item.interval[0])}%`, width: `${position(item.interval[2]) - position(item.interval[0])}%` }}/><span className="pooling-median" style={{ left: `${position(item.interval[1])}%` }}/></div>
              <span className="small pooling-values">5/50/95%: {intervalText(item.interval)}</span>
            </div>)}
          </div> : <p className="warn-note">数値の幅を描画用の軸で表せないため図を停止しました。区間の数値は下で確認できます。</p>}
          {!domain && intervals.map(item => <p key={item.label}>{item.label}{item.count === null ? "" : ` · 観測${item.count}行`} · {intervalText(item.interval)}</p>)}
          <p className="pooling-values">群SD（sigma）の5/50/95%: {intervalText(prepared.sigma)} {prepared.node.unit}</p>
          <p className="small muted">群SDはNormalが群の量に与える尺度です。観測の測定誤差とは区別します。0件の群も表示から除外しません。</p>
        </article>
        <article className="card stack">
          <h3>同じdrawの群A − 群B</h3>
          <fieldset disabled={action.busy} className="pooling-fields">
            <label>群A<select value={groupA} onChange={event => { change(); setGroupA(event.target.value); }}>{prepared.groups.map(group => <option key={group.index} value={group.index}>{group.label}</option>)}</select></label>
            <label>群B<select value={groupB} onChange={event => { change(); setGroupB(event.target.value); }}>{prepared.groups.map(group => <option key={group.index} value={group.index}>{group.label}</option>)}</select></label>
            <label>差の閾値 ({prepared.node.unit || "単位なし"})<input type="number" step="any" value={threshold} onChange={event => { change(); setThreshold(event.target.value); }}/></label>
          </fieldset>
          {contrast?.ok ? <>
            <p className="pooling-values">A−B の5/50/95%: {intervalText(contrast.interval)} {prepared.node.unit}</p>
            <p>差が {threshold} を厳密に超える割合: {(contrast.fraction * 100).toFixed(2)}%（全{contrast.drawCount}draw）</p>
            <p className="small muted">別々の群の区間を引いた値ではありません。同じ行のA−Bを計算しています。</p>
            <details><summary>全joint drawの数値表を読む</summary><div className="tools-table" role="region" aria-label="群差の全draw表（横スクロール）" tabIndex={0}><table><caption>行が同じdraw。数値は丸めず表示。単位: {prepared.node.unit || "なし"}</caption><thead><tr><th>draw</th><th>群A [{groupA}]</th><th>群B [{groupB}]</th><th>A−B</th><th>閾値超過</th><th>共有中心</th><th>群SD</th></tr></thead><tbody>{prepared.rows.map((row, i) => <tr key={row.index}><td>{row.index}</td><td>{row.values[numeric(groupA)]}</td><td>{row.values[numeric(groupB)]}</td><td>{contrast.values[i]}</td><td>{contrast.values[i] > numeric(threshold) ? "はい" : "いいえ"}</td><td>{row.center}</td><td>{row.sigma}</td></tr>)}</tbody></table></div></details>
          </> : <p role="alert" className="error-note">{contrast?.problems.join(" / ")}</p>}
        </article>
        <div className="card stack"><label>共有先と群差から気づいたこと<textarea value={memo} maxLength={2500} disabled={action.busy} onChange={event => { change(); setMemo(event.target.value); }}/></label><button className="btn btn-primary" disabled={!memo.trim() || !contrast?.ok || action.busy || sent} onClick={send}>条件と発言を対話に残す</button>{sent && <p role="status">対話に保存しました。世界に戻って確認できます。</p>}<ErrorNote error={action.error}/></div>
      </>}
    </>}
  </section>;
}
