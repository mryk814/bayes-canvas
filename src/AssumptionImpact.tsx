import { useMemo, useState } from "react";
import { KIND_LABELS, type State } from "../shared/contracts.ts";
import { assumptionImpact } from "../shared/assumption-impact.ts";

const changeKinds = { node: "量・式", data: "既知の入力", plate: "繰り返しの単位", view: "表示", metadata: "説明" };
const viewRoles: Record<string, string> = { x: "横軸", y: "縦軸", line: "曲線", group: "群分け" };

export function AssumptionImpact({ state, modelId }: { state: State; modelId: string }) {
  const report = useMemo(() => assumptionImpact(state, modelId), [state, modelId]);
  const [knowledgeId, setKnowledgeId] = useState("");
  const [versionId, setVersionId] = useState("");
  const selected = report.knowledge.find(k => k.knowledgeId === knowledgeId) ?? report.knowledge[0];
  const knowledge = state.knowledge.find(k => k.id === selected?.knowledgeId);
  const model = state.models.find(m => m.id === modelId)!;
  const adoption = selected?.adoptions.find(a => a.versionId === versionId)
    ?? selected?.adoptions.find(a => a.versionId === model.currentVersionId) ?? selected?.adoptions.at(-1);
  const version = state.versions.find(v => v.id === adoption?.versionId);
  const source = state.versions.find(v => v.id === adoption?.sourceVersionId);
  const before = state.versions.find(v => v.id === adoption?.baseVersionId);
  const label = (name: string) => {
    const item = source?.spec.nodes.find(n => n.name === name) ?? source?.spec.data.find(d => d.name === name)
      ?? before?.spec.nodes.find(n => n.name === name) ?? before?.spec.data.find(d => d.name === name);
    return item ? `${item.label} (${name})` : name;
  };
  return <section className="stack assumption-impact" aria-label="仮定の影響先">
    <div><h2>この知識は、どこに使われたか</h2><p className="muted">人が確かめた知識から、採用した版と変更箇所を辿ります。</p></div>
    {report.problems.length > 0 && <div className="warn-note"><strong>参照を確認できない履歴があります</strong><ul>{report.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
    {!selected || !knowledge ? <p className="empty-note">まだ知識がありません。世界を指して候補を確かめると、ここから使われた版を辿れます。</p> : <>
      <label>辿る知識<select value={selected.knowledgeId} onChange={e => { setKnowledgeId(e.target.value); setVersionId(""); }}>
        {report.knowledge.map(k => <option key={k.knowledgeId} value={k.knowledgeId}>{k.status === "withdrawn" ? "取り下げ · " : ""}{k.statement}</option>)}
      </select></label>
      <article className="card stack">
        <header><span className="badge">{KIND_LABELS[knowledge.kind]}</span><span className="badge">{knowledge.status === "withdrawn" ? "取り下げ済み" : "確定した知識"}</span></header>
        <p>{knowledge.statement}</p>
        {knowledge.status === "withdrawn" && <p className="warn-note">この知識は取り下げられています。採用済みのモデルは自動では変わらず、過去の根拠として履歴に残ります。</p>}
        {!selected.adoptions.length ? <p className="muted">この知識を根拠に採用した版はありません。知識の確定だけではモデルは変わりません。</p> : <label>採用・継承した版<select value={adoption?.versionId ?? ""} onChange={e => setVersionId(e.target.value)}>
          {selected.adoptions.map(a => <option key={a.versionId} value={a.versionId}>v{a.versionNumber}{a.versionId === model.currentVersionId ? " · いまの版" : " · 旧版"}{a.reverted ? " · 戻した版から継承" : " · 提案を採用"}</option>)}
        </select></label>}
      </article>
      {adoption && version && <article className="card stack">
        <header><span className="badge badge-version">v{version.number}</span><span className="badge">{version.id === model.currentVersionId ? "いまの版" : "旧版"}</span><h3>{version.summary}</h3></header>
        {adoption.reverted && <p>v{source?.number ?? "?"}に戻して引き継いだ根拠です。下は元の採用時の変更です。</p>}
        <p className="small muted">比較: {before ? `v${before.number}` : adoption.impact.ok && adoption.baseVersionId === null ? "新規モデル" : "変更前の版が不明"} → v{source?.number ?? "?"}。参照: {adoption.sourceVersionId}</p>
        <div><h4>この変更を支える知識</h4><ul>{adoption.knowledgeIds.map(id => {
          const k = state.knowledge.find(item => item.id === id && item.modelId === modelId);
          return <li key={id}>{k?.statement ?? `参照不明: ${id}`}{k?.status === "withdrawn" ? "（取り下げ済み）" : ""}</li>;
        })}</ul><p className="small muted">提案全体の根拠です。どの発言が個々の変更を決めたかは、この記録だけでは分かりません。</p></div>
        {!adoption.impact.ok ? <div className="warn-note">影響先は不明です。{adoption.impact.problems.join(" / ")}</div> : <>
          <div><h4>変更から辿れる先</h4><p className="small muted">変更前後の式の参照を辿った一覧です。効果の大きさや因果効果は計算していません。</p></div>
          {!adoption.impact.changes.length && <p className="muted">モデルの変更はありません。</p>}
          {adoption.impact.changes.map((change, i) => <section className="impact-change" key={`${change.kind}:${change.name}:${i}`}>
            <h4>{changeKinds[change.kind]} · {change.label} ({change.name})</h4>
            {change.kind === "metadata" && <p className="small muted">名前・単位・注記などの記述だけが変わりました。式の構造は変わっていません。</p>}
            <dl><dt>下流の量</dt><dd>{change.downstream.length ? change.downstream.map(label).join("、") : "なし"}</dd>
              <dt>届く観測</dt><dd>{change.observed.length ? change.observed.map(label).join("、") : "なし"}</dd>
              <dt>届く表示</dt><dd>{change.views.length ? change.views.map(role => viewRoles[role] ?? role).join("、") : "なし"}</dd></dl>
            <details><summary>{change.label}の変更前後を読む</summary><div className="impact-definitions">
              <div><h5>変更前</h5><pre>{change.before}</pre></div>
              <div><h5>変更後</h5><pre>{change.after}</pre></div>
            </div></details>
          </section>)}
        </>}
      </article>}
    </>}
  </section>;
}
