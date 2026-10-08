import { useState } from "react";
import type { ModelVersion, Proposal, State } from "../shared/contracts.ts";
import { post, useAction } from "./api.ts";
import { ErrorNote, ProposalCard, QuestionContractSummary } from "./Ledger.tsx";

const draftFrom = (version: ModelVersion) => ({ baseVersionId: version.id, question: version.spec.question,
  population: version.spec.questionContract?.population ?? "", estimand: version.spec.questionContract?.estimand ?? "", decision: version.spec.questionContract?.decision ?? "" });

export function QuestionContract({ state, modelId }: { state: State; modelId: string }) {
  const versions = state.versions.filter(version => version.modelId === modelId);
  const current = versions.find(version => version.id === state.models.find(model => model.id === modelId)!.currentVersionId)!;
  const [selectedId, setSelectedId] = useState(current.id);
  const selected = versions.find(version => version.id === selectedId) ?? current;
  const [draft, setDraft] = useState(() => draftFrom(current));
  const [created, setCreated] = useState<Proposal | null>(null);
  const action = useAction();
  const proposals = state.proposals.filter(proposal => proposal.modelId === modelId && proposal.status === "proposed");
  if (created && !state.proposals.some(proposal => proposal.id === created.id)) proposals.push(created);
  const stale = draft.baseVersionId !== current.id;
  const valid = [draft.question, draft.population, draft.estimand, draft.decision].every(value => value.trim().length >= 1 && value.trim().length <= 2000);
  const loadCurrent = () => { setDraft(draftFrom(current)); setSelectedId(current.id); action.clear(); };
  return <section className="stack question-contract" aria-label="問いの契約">
    <div><h2>何を知り、何に使う？</h2><p className="muted">対象・推定したい量・判断への使い方を、その版の目的として記録します。識別性や因果解釈、判断の最適性を保証するものではありません。</p></div>
    <label>契約を読むモデル版<select value={selected.id} disabled={action.busy} onChange={event => setSelectedId(event.target.value)}>{versions.map(version => <option key={version.id} value={version.id}>v{version.number} · {version.id === current.id ? "現行版" : "旧版"}</option>)}</select></label>
    <p className="small muted">世界や道具のrun選択とは独立して、ここで選んだモデル版の目的を表示します。</p>
    <article className="card stack"><h3>v{selected.number} の問いと契約</h3><p className="question-contract-text">{selected.spec.question || "問いは未設定です。"}</p><QuestionContractSummary spec={selected.spec}/></article>
    {selected.id !== current.id && <p className="warn-note">旧版は読み取り専用です。提案の基点には現在の版を使用してください。</p>}
    {stale && <p className="warn-note">編集中に現在の版が変わりました。下書きは保持していますが、この基点からは提案できません。</p>}
    {(stale || selected.id !== current.id) && <button className="btn" disabled={action.busy} onClick={loadCurrent}>編集中の内容を置き換え、最新版を読み込む</button>}
    {selected.id === draft.baseVersionId && <article className="card stack">
      <h3>v{versions.find(version => version.id === draft.baseVersionId)?.number} を基点に変更を提案</h3>
      <fieldset className="stack" disabled={action.busy || stale || selected.id !== current.id}>
        <label>問いの一文<textarea rows={2} maxLength={2000} value={draft.question} onChange={event => setDraft({ ...draft, question: event.target.value })}/></label>
        <label>対象母集団・適用範囲<textarea rows={3} maxLength={2000} value={draft.population} onChange={event => setDraft({ ...draft, population: event.target.value })} placeholder="どの対象・条件・期間に適用する問いか"/></label>
        <label>推定したい量・比較・単位<textarea rows={3} maxLength={2000} value={draft.estimand} onChange={event => setDraft({ ...draft, estimand: event.target.value })} placeholder="何を、何と比べ、どの単位で知りたいか"/></label>
        <label>判断への使い方<textarea rows={3} maxLength={2000} value={draft.decision} onChange={event => setDraft({ ...draft, decision: event.target.value })} placeholder="判断にどう使うか。判断に使わない場合はその旨"/></label>
        <p className="small muted">各項目は1〜2000文字。提案を作るだけではモデル版は変わりません。数式・データ・表示は基点の版から保持します。</p>
        <button className="btn btn-primary" disabled={!valid} onClick={() => action.run(async () => {
          const proposal = await post<Proposal>("/api/human/question-contracts", { baseVersionId: draft.baseVersionId, question: draft.question.trim(), questionContract: { population: draft.population.trim(), estimand: draft.estimand.trim(), decision: draft.decision.trim() } });
          setCreated(proposal);
        })}>{action.busy ? "提案を作っています…" : "問いと契約の変更を提案"}</button>
      </fieldset>
      <ErrorNote error={action.error}/>
    </article>}
    <section className="stack" aria-label="このモデルの未採用提案"><h3>差分を確かめ、採用する</h3><p className="small muted">このモデルの未採用提案をすべて表示します。問いの契約以外の変更提案も含まれます。採用・見送りは下のボタンで明示的に決めます。</p>
      {proposals.length ? proposals.map(proposal => <ProposalCard key={proposal.id} proposal={proposal} state={state} seed={1}/>) : <p className="empty-note">未採用の提案はありません。採用・見送りの記録は保存されます。</p>}
    </section>
  </section>;
}
