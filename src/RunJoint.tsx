import { useEffect, useMemo, useState } from "react";
import type { Dataset, ModelVersion, Run } from "../shared/contracts.ts";
import { runSites } from "../shared/evidence-validation.ts";
import { queryRunJoint } from "../shared/run-joint.ts";
import { post, useAction } from "./api.ts";
import { ErrorNote } from "./Ledger.tsx";

type Selection = { node: string; index: string; threshold: string; op: "gt" | "gte" | "lt" | "lte" };
const numeric = (value: string) => value.trim() ? Number(value) : NaN;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function RunJoint({ version, dataset, run, currentVersionId, active }: { version: ModelVersion; dataset: Dataset; run: Run; currentVersionId: string; active: boolean }) {
  const sites = runSites(version.spec);
  const [selections, setSelections] = useState<Selection[]>([0, 1].map(i => ({ node: sites[i]?.name ?? sites[0]?.name ?? "", index: "0", threshold: "0", op: "gt" })));
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [table, setTable] = useState(false);
  const [utterance, setUtterance] = useState("");
  const [sent, setSent] = useState(false);
  const action = useAction();
  const query = useMemo(() => queryRunJoint(version, dataset, run, selections.map(s => ({ ...s, index: numeric(s.index), threshold: numeric(s.threshold) }))), [version, dataset, run, selections]);
  const count = query.ok ? query.result.totalDraws : 0;
  useEffect(() => {
    if (!active || !playing || !count) return;
    const timer = setInterval(() => setCursor(k => (k + 1) % count), 1000);
    return () => clearInterval(timer);
  }, [active, playing, count]);
  useEffect(() => { if (!active) setPlaying(false); }, [active]);
  useEffect(() => {
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  const change = (i: number, patch: Partial<Selection>) => { setPlaying(false); setSent(false); setSelections(selections.map((s, j) => i === j ? { ...s, ...patch } : s)); };
  const selected = query.ok ? query.dataset.draws[cursor % count] : null;
  const send = async () => {
    if (!query.ok || !selected) return;
    setPlaying(false);
    const text = [utterance.trim(), "\n同時条件（保存runの全joint drawに対する問い合わせ）:", ...query.quantities.map((q, i) => `${q.label} (${q.node}[${q.index}]) ${selections[i].op} ${selections[i].threshold} ${q.unit}`), `成立 ${query.result.joint.count}/${count}。指したdraw index=${selected.id}。dataset=${dataset.id}。表示操作からの知識表明であり観測の追加ではありません。`].join("\n");
    const ok = await action.run(() => post("/api/human/intents", { scene: { modelVersionId: version.id, runId: run.id, seed: 1 }, marks: [], utterance: text }));
    if (ok) setSent(true);
  };
  return <section className="stack" aria-label="保存runの同時条件">
    <div><h2>この二つは、一緒に起きる？</h2><p className="muted small">保存runの全標本を使います。旧版・診断不良のrunでも値を隠さず、根拠とともに表示します。</p></div>
    {run.versionId !== currentVersionId && <p className="warn-note">旧版の結果です。現在のモデル版に置き換えて計算していません。</p>}
    <div className="tools-columns">
      <div className="card stack"><h3>同じ標本に、二つの条件</h3>{selections.map((s, i) => <fieldset className="query-condition" key={i}><legend>条件 {i + 1}</legend><label>量<select value={s.node} onChange={e => change(i, { node: e.target.value, index: "0" })}>{sites.map(n => <option key={n.name} value={n.name}>{n.label} / {n.name} ({n.unit || "単位なし"})</option>)}</select></label>{sites.find(n => n.name === s.node)?.plate && <label>要素の添字（0始まり）<input type="number" min="0" value={s.index} onChange={e => change(i, { index: e.target.value })}/></label>}<div className="tools-inline"><label>比較<select value={s.op} onChange={e => change(i, { op: e.target.value as Selection["op"] })}><option value="gt">より大きい &gt;</option><option value="gte">以上 ≥</option><option value="lt">より小さい &lt;</option><option value="lte">以下 ≤</option></select></label><label>閾値<input type="number" value={s.threshold} onChange={e => change(i, { threshold: e.target.value })}/></label></div></fieldset>)}</div>
      <div className="card stack">{!query.ok ? <div role="alert" className="error-note">{query.problems.join(" / ")}</div> : <>
        <div className="joint-answer"><span>両方を満たす標本</span><strong>{query.result.joint.count}<small> / {count}</small></strong><span>{percent(query.result.joint.probability)}</span></div>
        {query.result.marginals.map((m, i) => <p className="small" key={i}>条件{i + 1}だけなら {percent(m.probability)}</p>)}
        <p className="small muted">同じ行の成立を数えています。周辺の割合の積ではありません。保存されたdrawだけの割合で、Monte Carlo誤差の評価は別途必要です。</p>
        <div className="tools-inline"><button className="btn" onClick={() => setPlaying(!playing)}>{playing ? "停止" : "再生"}</button><button className="btn" onClick={() => { setPlaying(false); setCursor((cursor + 1) % count); }}>一段進む</button><button className="btn" onClick={() => { setPlaying(false); setTable(!table); }}>{table ? "標本表示に戻す" : "全標本の静止表"}</button></div>
        <label>標本 {cursor + 1} / {count}<input className="query-scrub" aria-label="保存標本の位置" type="range" min="0" max={count - 1} value={cursor} onChange={e => { setPlaying(false); setCursor(Number(e.target.value)); }}/></label>
        {selected && !table && <div className="joint-values" aria-live={playing ? "off" : "polite"}>{query.quantities.map((q, i) => <div key={i}><span>{q.label}</span><strong>{selected.values[q.key].toPrecision(5)}</strong><small>{q.unit}</small></div>)}<p>{query.result.matchedDrawIds.includes(selected.id) ? "✓ 両方成立" : "− 同時には不成立"} · draw {selected.id}</p></div>}
        {table && <div className="tools-table"><table><caption>同じ行が同じdraw。全{count}標本</caption><thead><tr><th>draw</th>{query.quantities.map((q, i) => <th key={i}>{q.label} {q.unit}</th>)}<th>同時成立</th></tr></thead><tbody>{query.dataset.draws.map(d => <tr key={d.id}><td>{d.id}</td>{query.quantities.map((q, i) => <td key={i}>{String(d.values[q.key])}</td>)}<td>{query.result.matchedDrawIds.includes(d.id) ? "成立" : "不成立"}</td></tr>)}</tbody></table></div>}
        <p className="small muted">再生は保存標本の順送りです。現象時間や推論の収束過程ではありません。開始時は停止し、静止表とキーボードによる位置選択でも同じ内容を読めます。</p>
      </>}</div>
    </div>
    <div className="card stack"><label>この条件について伝えたいこと<textarea value={utterance} onChange={e => { setUtterance(e.target.value); setSent(false); }} maxLength={2500}/></label><div className="tools-inline"><button className="btn btn-primary" disabled={!utterance.trim() || !query.ok || action.busy || sent} onClick={send}>条件と発言を対話に残す</button>{sent && <span role="status">対話に保存しました。世界に戻って候補を確認できます。</span>}</div><ErrorNote error={action.error}/><p className="small muted">モデルを変えず、既存の意図として参照と発言を保存します。条件は本文に明記し、専用の図形markには変換しません。</p></div>
  </section>;
}
