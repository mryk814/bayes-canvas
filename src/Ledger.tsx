import { useMemo } from "react";
import { IconArrowBackUp, IconCopy, IconEye } from "@tabler/icons-react";
import { KIND_LABELS, ROLE_LABELS, type Knowledge, type ModelSpec, type ModelVersion, type Proposal, type State } from "../shared/contracts.ts";
import { compileSpec, diffSpecs, drawCount, simulateWorlds, viewPoints } from "../shared/sim.ts";
import { post, useAction, type ApiError } from "./api.ts";
import { fmt } from "./format.ts";
import { nodeHtml } from "./tex.ts";
import { WorldPlot, sharedDomains } from "./WorldPlot.tsx";

export function ErrorNote({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <div className="error-note" role="alert">
      <strong>{error.message}</strong>
      {error.problems.length > 0 && (
        <ul>
          {error.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CapsuleOrigin({ version }: { version: ModelVersion }) {
  if (version.origin.kind !== "capsule") return null;
  const source = version.origin.source;
  return <aside className="card stack" aria-label="カプセルの取り込み元" style={{ overflowWrap: "anywhere", minWidth: 0 }}>
    <strong>カプセルから作った独立コピー · このモデルのv{version.number}</strong>
    <p className="small muted">元の提案・知識・巻き戻し履歴は復元していません。</p>
    <details>
      <summary style={{ minHeight: 44, padding: "10px 0", cursor: "pointer" }}>取り込み元の参照を確認</summary>
      <div className="stack">
        <p className="small">取り込み元モデル: {source.modelId} / 元の版: v{source.versionNumber}（{source.versionId}）</p>
        <p className="small">元Dataset: {source.datasetId} / 元run: {source.runId}</p>
        <p className="small">元の版の作成日時: {source.createdAt}</p>
        <p className="small muted">既存モデルを書き換えず、版・データ・runを新しいIDで保存しています。</p>
      </div>
    </details>
  </aside>;
}

export function ModelSummary({ spec }: { spec: ModelSpec }) {
  const groups: { key: string; title: string }[] = [
    { key: "", title: "全体で一つ" },
    ...spec.plates.map((p) => ({ key: p.name, title: `${p.label}ごと（既定 ${p.size}）` })),
  ];
  return (
    <div className="model-summary">
      <h3>{spec.title}</h3>
      {spec.question && <p className="muted">{spec.question}</p>}
      <QuestionContractSummary spec={spec}/>
      {spec.data.length > 0 && (
        <p className="small muted">
          既知の入力: {spec.data.map((d) => `${d.label}（${d.name}${d.indexOf ? ` → ${d.indexOf}` : ""}）`).join("、")}
        </p>
      )}
      {groups.map((g) => {
        const nodes = spec.nodes.filter((n) => (n.plate ?? "") === g.key);
        if (!nodes.length) return null;
        return (
          <div key={g.key} className="node-group">
            <h4>{g.title}</h4>
            <table className="prior-table">
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.name}>
                    <th>
                      <span className={`role-chip role-${n.role}`}>{ROLE_LABELS[n.role]}</span> {n.label}
                      {n.note && <div className="muted small">{n.note}</div>}
                    </th>
                    <td dangerouslySetInnerHTML={{ __html: nodeHtml(n) }} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export function QuestionContractSummary({ spec }: { spec: ModelSpec }) {
  const contract = spec.questionContract;
  if (!contract) return <p className="small muted">問いの契約（対象・量・判断）は未設定です。</p>;
  return <dl className="question-contract-summary">
    <dt>対象母集団・適用範囲</dt><dd>{contract.population}</dd>
    <dt>推定したい量・比較・単位</dt><dd>{contract.estimand}</dd>
    <dt>判断への使い方</dt><dd>{contract.decision}</dd>
  </dl>;
}

export function SpecDiff({ before, after }: { before: ModelSpec | null; after: ModelSpec }) {
  const changes = diffSpecs(before, after);
  if (!changes.length) return <p className="muted">モデルの差分はありません。</p>;
  return (
    <table className="diff-table">
      <thead>
        <tr>
          <th>変わるところ</th>
          <th>いま</th>
          <th>提案</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.what}>
            <th>{c.what}</th>
            <td className="mono before">{c.before}</td>
            <td className="mono after">{c.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Re-run the same seed under both specs, on one shared scale, so the change is the only difference.
export function SideBySide({ before, after, seed }: { before: ModelSpec | null; after: ModelSpec; seed: number }) {
  const result = useMemo(() => {
    const b = before ? compileSpec(before) : null;
    const a = compileSpec(after);
    if (!a.ok) return { ok: false as const, problems: a.problems };
    const ap = simulateWorlds(a.compiled, seed, 6).map((w) => viewPoints(a.compiled, w));
    const bp = b?.ok ? simulateWorlds(b.compiled, seed, 6).map((w) => viewPoints(b.compiled, w)) : [];
    return { ok: true as const, ap, bp, domains: sharedDomains([...ap, ...bp]) };
  }, [before, after, seed]);
  if (!result.ok) return <p className="error-note">この案は描けません: {result.problems.join(" / ")}</p>;
  const row = (label: string, pts: typeof result.ap) => (
    <div className="sbs-row">
      <span className="sbs-label">{label}</span>
      <div className="sbs-worlds">
        {pts.map((w, i) => (
          <WorldPlot key={i} points={[w]} domains={result.domains} width={160} height={92} />
        ))}
      </div>
    </div>
  );
  return (
    <div className="sbs" aria-label="同じ seed で今の版と提案を比べる">
      {result.bp.length > 0 && row("いま", result.bp)}
      {row("提案", result.ap)}
      <p className="muted small">同じ seed・同じ縦軸の prior の世界です。ノードの数や順が変わると、同じ番号でも別の世界になります。</p>
    </div>
  );
}

export function ProposalCard({ proposal, state, seed }: { proposal: Proposal; state: State; seed: number }) {
  const { run, busy, error } = useAction();
  const model = state.models.find((m) => m.id === proposal.modelId) ?? null;
  const current = model ? (state.versions.find((v) => v.id === model.currentVersionId) ?? null) : null;
  const stale = model !== null && proposal.baseVersionId !== model.currentVersionId;
  const sources = proposal.knowledgeIds.map((id) => state.knowledge.find((k) => k.id === id)).filter(Boolean) as Knowledge[];
  const invalidated = current ? state.runs.filter((r) => r.versionId === current.id) : [];
  return (
    <article className="card proposal">
      <header>
        <span className="badge badge-proposal">{model ? "変更の提案" : "新しいモデルの提案"}</span>
        <h3>{proposal.summary}</h3>
      </header>
      {sources.length > 0 && <p className="from-knowledge">根拠: {sources.map((k) => `「${k.statement}」`).join(" ")}</p>}
      <SpecDiff before={current?.spec ?? null} after={proposal.spec} />
      <SideBySide before={current?.spec ?? null} after={proposal.spec} seed={seed} />
      {invalidated.length > 0 && !stale && (
        <p className="warn-note">
          採用すると、今の版で計算した run {invalidated.length} 件は「旧版の結果」になります。新しい版で推論し直すまで、事後の世界は古い仮定のものです。
        </p>
      )}
      {stale && <p className="warn-note">この提案は別の版を基にしています。採用するには Claude に今の版で出し直してもらってください。</p>}
      <ErrorNote error={error} />
      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy || stale} onClick={() => run(() => post(`/api/human/proposals/${proposal.id}/adopt`))}>
          {model ? "この版を採用する" : "このモデルで始める"}
        </button>
        <button className="btn" disabled={busy} onClick={() => run(() => post(`/api/human/proposals/${proposal.id}/reject`))}>
          見送る
        </button>
      </div>
    </article>
  );
}

export function KnowledgeList({ state, modelId }: { state: State; modelId: string }) {
  const { run, busy, error } = useAction();
  const items = state.knowledge.filter((k) => k.modelId === modelId).reverse();
  const copy = () => {
    const md = items
      .filter((k) => k.status === "confirmed")
      .reverse()
      .map((k) => `- [${KIND_LABELS[k.kind]}] ${k.statement}`)
      .join("\n");
    void navigator.clipboard.writeText(md);
  };
  if (!items.length) {
    return <p className="empty-note">まだ知識はありません。世界を指して Claude に渡し、候補を選ぶとここに残ります。</p>;
  }
  return (
    <div className="stack">
      <div className="row-actions end">
        <button className="btn btn-quiet" onClick={copy}>
          <IconCopy size={16} /> Markdown でコピー
        </button>
      </div>
      <ErrorNote error={error} />
      {items.map((k) => {
        const usedIn = state.versions.filter((v) => v.origin.kind === "proposal" && v.origin.knowledgeIds.includes(k.id));
        return (
          <article key={k.id} className={`card knowledge ${k.status}`}>
            <header>
              <span className={`badge kind-${k.kind}`}>{KIND_LABELS[k.kind]}</span>
              {k.status === "withdrawn" && <span className="badge">取り下げ</span>}
              {k.scene?.runId && <span className="badge badge-posterior">事後の世界で指した</span>}
              {usedIn.map((v) => (
                <span key={v.id} className="badge badge-version">
                  v{v.number} に反映
                </span>
              ))}
            </header>
            <p>{k.statement}</p>
            <div className="row-actions end">
              <button
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => run(() => post(`/api/human/knowledge/${k.id}/${k.status === "confirmed" ? "withdraw" : "restore"}`))}
              >
                {k.status === "confirmed" ? "取り下げる" : "戻す"}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function EvidenceList({ state, modelId, onShowRun }: { state: State; modelId: string; onShowRun: (runId: string) => void }) {
  const model = state.models.find((m) => m.id === modelId)!;
  const datasets = state.datasets.filter((d) => d.modelId === modelId);
  const runs = state.runs.filter((r) => r.modelId === modelId).reverse();
  if (!datasets.length && !runs.length) {
    return (
      <p className="empty-note">
        データと推論の結果はまだありません。Claude Code に「データを付けて推論して」と頼むと、NumPyro で計算した結果がここに届きます。
      </p>
    );
  }
  return (
    <div className="stack">
      {runs.map((r) => {
        const v = state.versions.find((x) => x.id === r.versionId);
        const ds = datasets.find((d) => d.id === r.datasetId);
        const stale = r.versionId !== model.currentVersionId;
        const d = r.diagnostics;
        return (
          <article key={r.id} className="card run">
            <header>
              <span className="badge badge-posterior">run</span>
              <span className="num">v{v?.number}</span>
              {stale && <span className="badge badge-warn">旧版の結果</span>}
              <span className="muted small">{new Date(r.createdAt).toLocaleString("ja-JP")}</span>
            </header>
            <p className="small">
              {r.method} · {drawCount(r)} draws · データ「{ds?.label}」
            </p>
            <p className="small mono">
              R̂ ≤ {d.maxRhat === null ? "?" : fmt(d.maxRhat)} · ESS ≥ {d.minEss === null ? "?" : Math.round(d.minEss)} · 発散 {d.divergences ?? "?"}
            </p>
            <div className="row-actions end">
              <button className="btn btn-quiet" onClick={() => onShowRun(r.id)}>
                <IconEye size={16} /> この run の世界を見る
              </button>
            </div>
          </article>
        );
      })}
      {datasets.map((d) => (
        <article key={d.id} className="card dataset">
          <header>
            <span className={`badge ${d.provenance === "synthetic" ? "badge-illustrative" : "badge-data"}`}>{d.provenance === "synthetic" ? "合成データ" : "実データ"}</span>
            <strong>{d.label}</strong>
          </header>
          <p className="small muted">
            {Object.entries(d.plates)
              .map(([k, v]) => `${k} ${v}`)
              .join(" · ")}
            {d.note && ` · ${d.note}`}
          </p>
        </article>
      ))}
    </div>
  );
}

export function VersionList({ state, modelId }: { state: State; modelId: string }) {
  const { run, busy, error } = useAction();
  const model = state.models.find((m) => m.id === modelId)!;
  const versions = state.versions.filter((v) => v.modelId === modelId).reverse();
  return (
    <div className="stack">
      <ErrorNote error={error} />
      {versions.map((v) => {
        const isCurrent = v.id === model.currentVersionId;
        const sources = v.origin.kind === "proposal" ? v.origin.knowledgeIds.map((id) => state.knowledge.find((k) => k.id === id)?.statement).filter(Boolean) : [];
        return (
          <article key={v.id} className={`card version ${isCurrent ? "is-current" : ""}`}>
            <header>
              <span className="num version-no">v{v.number}</span>
              {isCurrent && <span className="badge badge-current">いまの版</span>}
              <span className="muted small">{new Date(v.createdAt).toLocaleString("ja-JP")}</span>
            </header>
            <p>{v.summary}</p>
            {v.origin.kind === "capsule" && <CapsuleOrigin version={v}/>}
            {sources.length > 0 && <p className="from-knowledge">根拠: {sources.map((s) => `「${s}」`).join(" ")}</p>}
            {!isCurrent && (
              <div className="row-actions end">
                <button className="btn btn-quiet" disabled={busy} onClick={() => run(() => post(`/api/human/versions/${v.id}/revert`))}>
                  <IconArrowBackUp size={16} /> この版に戻す
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
