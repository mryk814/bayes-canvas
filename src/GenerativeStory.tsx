import { useMemo, useRef, useState } from "react";
import { ROLE_LABELS, type ModelVersion, type State } from "../shared/contracts.ts";
import { buildGenerativeStory } from "../shared/generative-story.ts";
import { ErrorNote } from "./Ledger.tsx";
import { post, useAction } from "./api.ts";
import "./generative-story.css";

export function GenerativeStory({ state, modelId }: { state: State; modelId: string }) {
  const versions = state.versions.filter(version => version.modelId === modelId);
  const currentId = state.models.find(model => model.id === modelId)!.currentVersionId;
  const [versionId, setVersionId] = useState(currentId);
  const version = versions.find(item => item.id === versionId) ?? versions.find(item => item.id === currentId)!;
  return <section className="stack generative-story" aria-label="生成物語と式">
    <div><h2>文章と式で、同じ生成定義を辿る</h2><p className="muted">この版の定義を順に読み替えます。実際の生成履歴・因果の証明・事後標本の生成手順ではありません。</p></div>
    <label>生成定義を読むモデル版<select value={version.id} onChange={event => setVersionId(event.target.value)}>{versions.map(item => <option key={item.id} value={item.id}>v{item.number} · {item.id === currentId ? "現行版" : "旧版"}</option>)}</select></label>
    <p className="small muted">runの選択とは独立した定義の表示です。件数はこの版のプレート定義に従います。版を切り替えると、この道具の選択と未保存の発言を初期化します。</p>
    {version.id !== currentId && <p className="warn-note">旧版v{version.number}の定義を読んでいます。現在の版には置き換えていません。</p>}
    <StoryVersion key={version.id} version={version} isCurrent={version.id === currentId}/>
  </section>;
}

function StoryVersion({ version, isCurrent }: { version: ModelVersion; isCurrent: boolean }) {
  const story = useMemo(() => buildGenerativeStory(version.spec), [version.spec]);
  const [selectedName, setSelectedName] = useState("");
  const [detailAnchorName, setDetailAnchorName] = useState("");
  const [memo, setMemo] = useState("");
  const [sent, setSent] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const action = useAction();
  const steps = story.ok ? story.steps : [];
  const selected = steps.find(step => step.name === selectedName) ?? steps[0];
  const detailAnchor = steps.find(step => step.name === detailAnchorName) ?? steps[0];
  const destinations = selected ? steps.filter(step => step.references.includes(selected.name)) : [];
  const choose = (name: string) => { setSelectedName(name); setSent(false); action.clear(); };
  const openRow = (name: string) => { choose(name); setDetailAnchorName(name); };
  const followReference = (name: string) => { detailRef.current?.focus({ preventScroll: true }); choose(name); };
  const roleLabel = (role: "input" | keyof typeof ROLE_LABELS) => role === "input" ? "既知の入力" : ROLE_LABELS[role];
  const context = selected ? `生成定義への発言（実際の標本を指すものではありません）\nversion=${version.id}; v${version.number}; node=${selected.name}\n式: ${selected.formula}` : "";
  const utterance = `${memo.trim()}\n\n${context}`;
  if (!story.ok) return <p className="error-note" role="alert">{story.problems.join(" / ")}</p>;
  const detail = selected && <article className="card stack story-detail" ref={detailRef} tabIndex={-1} aria-labelledby={`story-detail-${version.id}`}>
      <h3 id={`story-detail-${version.id}`}>選択中: {selected.label} ({selected.name})</h3>
      <p className="small muted">v{version.number} · {isCurrent ? "現行版" : "旧版"}の定義</p>
      <a className="btn" href={`#story-${version.id}-${selected.name}`}>対応する生成行へ: {selected.label} ({selected.name})</a>
      <dl><dt>範囲</dt><dd>{selected.scope}</dd><dt>役割</dt><dd>{roleLabel(selected.role)}</dd><dt>単位</dt><dd>{selected.unit || "単位なし"}</dd><dt>注記</dt><dd>{selected.note || "なし"}</dd></dl>
      <p>{selected.narrative}</p><pre>{selected.formula}</pre>
      <div><h4>直接参照している量</h4><div className="story-links">{selected.references.length ? selected.references.map(name => <button className="btn" key={name} disabled={action.busy} onClick={() => followReference(name)}>{steps.find(step => step.name === name)?.label ?? name} ({name})</button>) : <p className="small muted">参照元なし（定数または入力の定義）</p>}</div></div>
      <div><h4>この量を直接参照する量</h4><div className="story-links">{destinations.length ? destinations.map(step => <button className="btn" key={step.name} disabled={action.busy} onClick={() => followReference(step.name)}>{step.label} ({step.name})</button>) : <p className="small muted">直接参照先なし</p>}</div></div>
      <p className="small muted">元の式の直接参照です。群添字の列も含みます。因果関係や効果の大きさは表していません。</p>
      <label>この定義について伝えたいこと<textarea rows={3} maxLength={2500} value={memo} disabled={action.busy} onChange={event => { setMemo(event.target.value); setSent(false); action.clear(); }}/></label>
      {utterance.length > 4000 && <p className="error-note">元の式と発言を合わせて4000文字以内にしてください。</p>}
      <button className="btn btn-primary" disabled={!memo.trim() || utterance.length > 4000 || action.busy || sent} onClick={async () => {
        if (await action.run(() => post("/api/human/intents", { scene: { modelVersionId: version.id, runId: null, seed: 1 }, marks: [], utterance }))) setSent(true);
      }}>選んだ定義と発言を対話に残す</button>
      {sent && <p role="status">この版の定義への発言を保存しました。世界に戻って確認できます。</p>}<ErrorNote error={action.error}/>
      <p className="small muted">保存するのは定義への発言です。新しいモデル版やデータ・runは作りません。</p>
    </article>;
  return <>
    {selected && <div className="story-navigation">
      <label>選択中の量<select value={selected.name} disabled={action.busy} onChange={event => openRow(event.target.value)}>{steps.map(step => <option key={step.name} value={step.name}>{step.label} ({step.name})</option>)}</select></label>
      <a className="btn" href={`#story-${version.id}-${selected.name}`}>選択行へ</a>
    </div>}
    <div className="story-pairs" aria-label="生成順の文章と式">
      {steps.map((step, i) => <div className="story-row" key={step.name} id={`story-${version.id}-${step.name}`}>
        <article className={`card story-step ${selected?.name === step.name ? "is-selected" : ""}`}>
          <header><span className="badge">{i + 1}</span><h3>{step.label} <span className="small">({step.name})</span></h3><span className="badge">{roleLabel(step.role)}</span></header>
          <div className="story-pair">
            <button className="story-select" aria-label={`${step.name}の文章を選択`} aria-pressed={selected?.name === step.name} disabled={action.busy} onClick={() => openRow(step.name)}><span className="story-side">文章</span><span>{step.narrative}</span></button>
            <button className="story-select" aria-label={`${step.name}の式を選択`} aria-pressed={selected?.name === step.name} disabled={action.busy} onClick={() => openRow(step.name)}><span className="story-side">式</span><code>{step.formula}</code></button>
          </div>
        </article>
        {detailAnchor?.name === step.name && detail}
      </div>)}
    </div>
  </>;
}
