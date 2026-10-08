import { useMemo, useState } from "react";
import type { Dataset, ModelVersion, Run } from "../shared/contracts.ts";
import { drawCount } from "../shared/sim.ts";
import { prepareShutter, applyShutter } from "../shared/shutter.ts";
import { WorldPlot } from "./WorldPlot.tsx";
import type { Domains } from "./WorldPlot.tsx";
import { shutterDomain } from "./shutter-domain.ts";
import { post, useAction } from "./api.ts";
import { ErrorNote } from "./Ledger.tsx";
import "./shutter.css";

type Props = { version: ModelVersion; dataset: Dataset | null; run: Run | null; currentVersionId: string };
const number = (text: string) => text.trim() ? Number(text) : NaN;
export function Shutter({ version, dataset, run, currentVersionId }: Props) {
  const [seedText, setSeedText] = useState("1");
  const [cursor, setCursor] = useState(0);
  const [capText, setCapText] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const [memo, setMemo] = useState("");
  const [sent, setSent] = useState(false);
  const action = useAction();
  const seed = number(seedText);
  // Changing the cap never enters this memo: the generated measurement noise stays fixed.
  const prepared = useMemo(() => prepareShutter(version, dataset, run, seed, cursor), [version, dataset, run, seed, cursor]);
  const count = run ? drawCount(run) : 16;
  const cap = capText === null ? null : number(capText);
  let problem = "";
  let trial = prepared.ok ? prepared.original : [];
  if (prepared.ok && cap !== null) {
    try { trial = applyShutter(prepared.raw, cap); }
    catch (error) { problem = error instanceof Error ? error.message : String(error); }
  }
  const allPoints = prepared.ok ? [...prepared.raw, ...prepared.original, ...trial] : [];
  const xDomain = shutterDomain(allPoints.map(point => point.x));
  const yDomain = shutterDomain(allPoints.map(point => point.y));
  const domains: Domains | null = xDomain && yDomain ? { x: xDomain, y: yDomain } : null;
  const sliderValues = prepared.ok ? [...prepared.raw, ...prepared.original].map(point => point.y) : [];
  const originalDomain = shutterDomain(sliderValues);
  const defaultCap = prepared.ok ? prepared.originalCaps.find(value => value !== null) ?? originalDomain?.[1] ?? prepared.raw[0]?.y ?? 0 : 0;
  const sliderValue = cap !== null && Number.isFinite(cap) ? cap : defaultCap;
  const sliderBounds = shutterDomain([...sliderValues, sliderValue]);
  const change = () => { setSent(false); action.clear(); };
  const send = async () => {
    if (!prepared.ok || problem || !memo.trim()) return;
    const text = [memo.trim(), "", "観測のシャッター（同じ生成測定値への仮想的な再記録）",
      `version=${version.id}; run=${run?.id ?? "prior"}; dataset=${dataset?.id ?? "なし"}; seed=${seed}; draw index=${cursor}; cap=${cap === null ? "元モデルの行ごとの上限" : cap}`,
      `量=${version.spec.view.y}; 単位=${prepared.labels.yUnit || "なし"}; 行数=${trial.length}; 試した記録の打ち切り=${trial.filter(point => point.censored).length}件。`,
      "実測値の復元でも、別尤度での再推論でもありません。モデル・Dataset・runは変更していません。"].join("\n");
    if (await action.run(() => post("/api/human/intents", { scene: { modelVersionId: version.id, runId: run?.id ?? null, seed }, marks: [], utterance: text }))) setSent(true);
  };
  return <section className="stack shutter" aria-label="観測のシャッター">
    <div><h2>上限で、記録はどう変わる？</h2><p className="muted">同じ生成測定値に別の上限を試します。上限操作では潜在量や測定ノイズを引き直しません。実測値の復元・再推論ではありません。</p></div>
    <p className="small">版 v{version.number} · {run ? `${run.method} · run ${run.id}` : "事前分布の生成世界"}</p>
    {version.id !== currentVersionId && <p className="warn-note">旧版を表示しています。現在のモデル版への置換はしていません。</p>}
    <fieldset className="card stack" disabled={action.busy}>
      <div className="tools-inline"><label>生成seed<input aria-label="シャッターのseed" type="number" step="1" value={seedText} onChange={event => { change(); setSeedText(event.target.value); }}/></label>
        <button className="btn" disabled={cursor === 0} onClick={() => { change(); setCursor(cursor - 1); }}>前の{run ? "draw" : "世界"}</button>
        <button className="btn" disabled={cursor >= count - 1} onClick={() => { change(); setCursor(cursor + 1); }}>次の{run ? "draw" : "世界"}</button>
      </div>
      <p>表示 {cursor + 1} / {count}（0始まりindex: {cursor}）。{run ? "全保存drawを順に選べます。測定値はこのdrawを使って生成します。" : "seedごとに16の生成世界を選べます。"}</p>
      <label>試す一定上限 {prepared.ok ? `(${prepared.labels.yUnit || "単位なし"})` : ""}<input aria-label="試す一定上限" type="number" step="any" value={capText ?? ""} placeholder="未指定ならモデル本来の上限" onChange={event => { change(); setCapText(event.target.value); }}/></label>
      {prepared.ok && (sliderBounds ? <input aria-label="試す上限のスライダー" type="range" step="any" min={sliderBounds[0]} max={sliderBounds[1]} value={sliderValue} onChange={event => { change(); setCapText(event.target.value); }}/> : <p className="warn-note">数値の幅が大きいためスライダーを停止しました。上限は数値欄で指定できます。</p>)}
      <div className="tools-inline"><button className="btn" onClick={() => { change(); setCapText(null); }}>元の記録へ戻す</button><span>{cap === null ? "モデル本来の上限を使用中" : "一定上限を試しています"}</span></div>
      <p className="small muted">値が上限を超えた行だけ上限値に置き換えます。等しい値は打ち切りに含めず、行も群も捨てません。元の上限は行ごとに異なる場合があります。</p>
    </fieldset>
    {!prepared.ok ? <p role="alert" className="error-note">{prepared.problems.join(" / ")}</p> : problem ? <p role="alert" className="error-note">{problem}</p> : <>
      {!domains && <p role="status" className="warn-note">数値の幅を描画用の軸で表せないため、図を停止しました。全行の数値は下の表で確認でき、条件と発言も保存できます。</p>}
      <p className="small muted">{domains ? "3枚とも全点を含む同じ軸範囲です。" : ""}横軸: {prepared.labels.x} {prepared.labels.xUnit}、縦軸: {prepared.labels.y} {prepared.labels.yUnit}。{prepared.labels.y}の生成測定値を比較しています。</p>
      <p className="small muted">通常の点は群ごとの色・形、▲は打ち切り。群番号は静止表で確認できます。</p>
      {domains && <div className="shutter-plots">{[
        { title: "上限前の生成測定値", points: prepared.raw }, { title: "モデル本来の記録", points: prepared.original }, { title: "試した上限の記録", points: trial },
      ].map(panel => <article className="card stack" key={panel.title}><h3>{panel.title}</h3><WorldPlot points={[panel.points]} domains={domains} width={340} height={250} detailed labels={{ x: `${prepared.labels.x} ${prepared.labels.xUnit}`, y: `${prepared.labels.y} ${prepared.labels.yUnit}` }}/><p className="small">全{panel.points.length}行 · 打ち切り{panel.points.filter(point => point.censored).length}行</p></article>)}</div>}
      {domains && <button className="btn" aria-expanded={table} onClick={() => setTable(!table)}>{table ? "静止表を閉じる" : "全行の静止表を開く"}</button>}
      {(table || !domains) && <div className="tools-table" tabIndex={0} role="region" aria-label="上限前後の全行表"><table><caption>全{trial.length}行。群と行添字は0始まり。値は丸めず表示。</caption><thead><tr><th>行添字</th><th>群</th><th>{prepared.labels.x}</th><th>上限前</th><th>元の上限</th><th>元の記録</th><th>元の打ち切り</th><th>試した記録</th><th>試した打ち切り</th></tr></thead><tbody>{prepared.raw.map((point, i) => <tr key={point.unit}><td>{point.unit}</td><td>{point.group ?? "なし"}</td><td>{point.x}</td><td>{point.y}</td><td>{prepared.originalCaps[i] ?? "なし"}</td><td>{prepared.original[i].y}</td><td>{prepared.original[i].censored ? "あり" : "なし"}</td><td>{trial[i].y}</td><td>{trial[i].censored ? "あり" : "なし"}</td></tr>)}</tbody></table></div>}
    </>}
    <div className="card stack"><label>記録の違いから気づいたこと<textarea value={memo} maxLength={2500} onChange={event => { change(); setMemo(event.target.value); }}/></label><button className="btn btn-primary" disabled={!memo.trim() || !prepared.ok || !!problem || action.busy || sent} onClick={send}>条件と発言を対話に残す</button>{sent && <p role="status">対話に保存しました。世界に戻って確認できます。</p>}<ErrorNote error={action.error}/></div>
  </section>;
}
