import { useMemo, useRef, useState } from "react";
import type { Dataset, Model, ModelVersion, Run } from "../shared/contracts.ts";
import { createCapsule, readCapsule, type CapsuleRead } from "../shared/capsule.ts";
import { post, useAction } from "./api.ts";
import { ErrorNote } from "./Ledger.tsx";

export function Capsule({ version, dataset, run }: { version: ModelVersion | null; dataset: Dataset | null; run: Run | null }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<CapsuleRead | null>(null);
  const [saved, setSaved] = useState("");
  const action = useAction();
  const saving = useRef(false);
  const exported = useMemo(() => {
    if (!version || !dataset || !run) return { text: "", error: "runを選ぶと、対応するモデル版・データ・runをひとまとめに表示できます。" };
    try {
      return { text: JSON.stringify(createCapsule(version, dataset, run), null, 2), error: "" };
    } catch (error) {
      return { text: "", error: error instanceof Error ? error.message : "選択した証拠を検証できませんでした。" };
    }
  }, [version, dataset, run]);
  function verify() {
    action.clear(); setSaved("");
    try {
      setResult(readCapsule(JSON.parse(input)));
    } catch {
      setResult({ ok: false, problems: ["JSONを読めません。括弧やカンマ、引用符を確認してください。"] });
    }
  }
  async function importVerified() {
    if (!result?.ok || saving.current) return;
    saving.current = true;
    try {
      await action.run(async () => {
        const imported = await post<{ model: Model; run: Run }>("/api/human/capsules", result.capsule);
        setSaved(`独立したモデル「${imported.model.title}」とrun ${imported.run.id}を保存しました。`);
        setResult(null);
      });
    } finally { saving.current = false; }
  }
  return <section className="stack" aria-label="証拠カプセル" style={{ overflowWrap: "anywhere", minWidth: 0 }}>
    {version && <div className="card stack">
      <h3>証拠をひとまとめに</h3>
      <p className="muted">モデル版・観測データ・同時標本を、同じJSONで持ち出せます。</p>
      {exported.error ? <p role="status">{exported.error}</p> : <>
        <p className="small muted">v{version.number} · {dataset?.label} · run {run?.id}</p>
        <label className="field"><span>選択した証拠のJSON（読み取り専用）</span>
          <textarea rows={8} readOnly value={exported.text} spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
        </label>
        <p className="small muted">JSON欄を選択してコピーできます。観測データを含むため、共有先に渡してよい内容か確認してください。</p>
      </>}
    </div>}
    <div className="card stack">
      <h3>受け取った証拠を確かめる</h3>
      <label className="field"><span>証拠カプセルのJSONを貼り付け</span>
        <textarea rows={7} value={input} spellCheck={false} disabled={action.busy} onChange={(event) => { setInput(event.target.value); setResult(null); setSaved(""); action.clear(); }} />
      </label>
      <div className="row-actions"><button className="btn" disabled={!input.trim() || action.busy} onClick={verify}>内容と参照を検証</button></div>
      <div aria-live="polite">
        {result?.ok && <div className="stack">
          <strong>内容と参照の整合を確認しました</strong>
          <p>{result.capsule.modelVersion.spec.title} · v{result.capsule.modelVersion.number}</p>
          <p className="small">モデル {result.capsule.modelVersion.modelId} / 版 {result.capsule.modelVersion.id}</p>
          <p>データ: {result.capsule.dataset.label}（{result.capsule.dataset.provenance === "real" ? "実データ" : "合成データ"}）</p>
          <p className="small">データID {result.capsule.dataset.id} / run {result.capsule.run.id}</p>
          <p>方法: {result.capsule.run.method} · 同時標本 {Object.values(result.capsule.run.draws)[0]?.length ?? 0} 行</p>
          <p className="small muted">新しいIDのモデル・版・データ・runを作ります。既存の記録は上書きせず、元の提案・知識・巻き戻し履歴は復元しません。同じJSONを再度取り込むと別コピーになります。</p>
          <button className="btn btn-primary" disabled={action.busy} onClick={importVerified}>{action.busy ? "保存しています…" : "独立したモデルとして保存"}</button>
        </div>}
        {result && !result.ok && <div className="error-note" role="alert"><strong>証拠を確認できません</strong><ul>{result.problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul></div>}
      </div>
      <ErrorNote error={action.error}/>{saved && <p role="status">{saved}</p>}
      <p className="small muted">検証だけでは保存しません。検証後の保存ボタンで独立コピーを作ります。署名による改ざん検出や、推論の再実行・結果の正しさを保証するものではありません。</p>
    </div>
  </section>;
}
