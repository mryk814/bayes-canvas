import { useMemo } from "react";
import { IconArrowBackUp, IconCopy } from "@tabler/icons-react";
import { KIND_LABELS, type Knowledge, type ModelSpec, type Proposal, type State } from "../shared/contracts.ts";
import { compileSpec, diffSpecs, simulateWorlds } from "../shared/sim.ts";
import { post, useAction, type ApiError } from "./api.ts";
import { distTex, exprHtml, texHtml, texName } from "./tex.ts";
import { WorldPlot, sharedYDomain } from "./WorldPlot.tsx";

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

export function ModelSummary({ spec }: { spec: ModelSpec }) {
  const noise = spec.noise.family === "studentt" ? `\\operatorname{StudentT}_{${spec.noise.nu}}` : "\\operatorname{Normal}";
  return (
    <div className="model-summary">
      <h3>{spec.title}</h3>
      {spec.question && <p className="muted">{spec.question}</p>}
      <div className="formula" dangerouslySetInnerHTML={{ __html: texHtml(`${texName(spec.y.name)} \\sim ${noise}(\\mu, \\sigma_y)`) }} />
      <div className="formula">
        <span dangerouslySetInnerHTML={{ __html: texHtml("\\mu =") }} /> <span dangerouslySetInnerHTML={{ __html: exprHtml(spec.mean) }} />
      </div>
      <div className="formula">
        <span dangerouslySetInnerHTML={{ __html: texHtml("\\sigma_y =") }} /> <span dangerouslySetInnerHTML={{ __html: exprHtml(spec.noise.sigma) }} />
      </div>
      <table className="prior-table">
        <tbody>
          {spec.params.map((p) => (
            <tr key={p.name}>
              <th>{p.label}</th>
              <td dangerouslySetInnerHTML={{ __html: texHtml(`${texName(p.name)} \\sim ${distTex(p.prior)}`) }} />
              <td className="muted">{p.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
    const aw = simulateWorlds(a.compiled, seed, 6);
    const bw = b?.ok ? simulateWorlds(b.compiled, seed, 6) : [];
    return { ok: true as const, aw, bw, y: sharedYDomain([...aw, ...bw]) };
  }, [before, after, seed]);
  if (!result.ok) return <p className="error-note">この案は描けません: {result.problems.join(" / ")}</p>;
  const row = (label: string, spec: ModelSpec, worlds: typeof result.aw) => (
    <div className="sbs-row">
      <span className="sbs-label">{label}</span>
      <div className="sbs-worlds">
        {worlds.map((w) => (
          <WorldPlot key={w.index} spec={spec} worlds={[w]} yDomain={result.y} width={160} height={92} />
        ))}
      </div>
    </div>
  );
  return (
    <div className="sbs" aria-label="同じ seed で今の版と提案を比べる">
      {before && result.bw.length > 0 && row("いま", before, result.bw)}
      {row("提案", after, result.aw)}
      <p className="muted small">同じ seed・同じ縦軸で描いています。パラメータの数が変わると、同じ番号でも別の世界になります。</p>
    </div>
  );
}

export function ProposalCard({ proposal, state, seed }: { proposal: Proposal; state: State; seed: number }) {
  const { run, busy, error } = useAction();
  const current = state.versions.find((v) => v.id === state.currentVersionId) ?? null;
  const stale = proposal.baseVersionId !== state.currentVersionId;
  const sources = proposal.knowledgeIds.map((id) => state.knowledge.find((k) => k.id === id)).filter(Boolean) as Knowledge[];
  return (
    <article className="card proposal">
      <header>
        <span className="badge badge-proposal">提案</span>
        <h3>{proposal.summary}</h3>
      </header>
      {sources.length > 0 && (
        <p className="from-knowledge">
          根拠: {sources.map((k) => `「${k.statement}」`).join(" ")}
        </p>
      )}
      <SpecDiff before={current?.spec ?? null} after={proposal.spec} />
      <SideBySide before={current?.spec ?? null} after={proposal.spec} seed={seed} />
      {stale && <p className="warn-note">この提案は別の版を基にしています。採用するには Claude に今の版で出し直してもらってください。</p>}
      <ErrorNote error={error} />
      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy || stale} onClick={() => run(() => post(`/api/human/proposals/${proposal.id}/adopt`))}>
          この版を採用する
        </button>
        <button className="btn" disabled={busy} onClick={() => run(() => post(`/api/human/proposals/${proposal.id}/reject`))}>
          見送る
        </button>
      </div>
    </article>
  );
}

export function KnowledgeList({ state }: { state: State }) {
  const { run, busy, error } = useAction();
  const items = [...state.knowledge].reverse();
  const copy = () => {
    const md = state.knowledge
      .filter((k) => k.status === "confirmed")
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

export function VersionList({ state }: { state: State }) {
  const { run, busy, error } = useAction();
  const versions = [...state.versions].reverse();
  return (
    <div className="stack">
      <ErrorNote error={error} />
      {versions.map((v) => {
        const isCurrent = v.id === state.currentVersionId;
        const sources =
          v.origin.kind === "proposal"
            ? v.origin.knowledgeIds.map((id) => state.knowledge.find((k) => k.id === id)?.statement).filter(Boolean)
            : [];
        return (
          <article key={v.id} className={`card version ${isCurrent ? "is-current" : ""}`}>
            <header>
              <span className="num version-no">v{v.number}</span>
              {isCurrent && <span className="badge badge-current">いまの版</span>}
              <span className="muted small">{new Date(v.createdAt).toLocaleString("ja-JP")}</span>
            </header>
            <p>{v.summary}</p>
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
