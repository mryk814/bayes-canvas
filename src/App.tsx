import { useMemo, useState } from "react";
import { IconCopy, IconDownload, IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";
import type { Mark, SceneRef, State } from "../shared/contracts.ts";
import { compileSpec, simulateWorlds } from "../shared/sim.ts";
import { post, useAction, useAppData, useStoredState } from "./api.ts";
import { DraftTray, IntentCard } from "./Conversation.tsx";
import { ErrorNote, KnowledgeList, ModelSummary, ProposalCard, VersionList } from "./Ledger.tsx";
import { Stage, type Focus } from "./Stage.tsx";
import { sharedYDomain, type Tool } from "./WorldPlot.tsx";

const WORLD_COUNT = 12;

type Draft = { scene: SceneRef | null; marks: Mark[]; utterance: string };
const EMPTY_DRAFT: Draft = { scene: null, marks: [], utterance: "" };

export function App() {
  const { data, live } = useAppData();
  if (data.status === "loading") return <div className="splash">読み込んでいます…</div>;
  if (data.status === "error") return <div className="splash error-note">{data.message}</div>;
  return <Workspace state={data.state} agentConnected={data.agentConnected} dataPath={data.dataPath} live={live} />;
}

type Tab = "talk" | "proposals" | "knowledge" | "model";

function Workspace({ state, agentConnected, dataPath, live }: { state: State; agentConnected: boolean; dataPath: string; live: boolean }) {
  const current = state.versions.find((v) => v.id === state.currentVersionId) ?? null;
  const [seed, setSeed] = useStoredState("possible-worlds:seed", 1);
  const [draft, setDraft] = useStoredState<Draft>("possible-worlds:draft", EMPTY_DRAFT);
  const [focus, setFocus] = useState<Focus>(null);
  const [tool, setTool] = useState<Tool>("look");
  const [showObs, setShowObs] = useState(true);
  const [tab, setTab] = useState<Tab>("talk");
  const send = useAction();

  const compiled = useMemo(() => (current ? compileSpec(current.spec) : null), [current]);
  const worlds = useMemo(() => (compiled?.ok ? simulateWorlds(compiled.compiled, seed, WORLD_COUNT) : []), [compiled, seed]);
  const yDomain = useMemo(() => sharedYDomain(worlds), [worlds]);

  const scene: SceneRef | null = current ? { modelVersionId: current.id, seed } : null;
  const draftMatches = draft.scene === null || (scene !== null && draft.scene.modelVersionId === scene.modelVersionId && draft.scene.seed === scene.seed);
  const stageMarks = draftMatches ? draft.marks : [];

  const addMark = (m: Mark) => {
    if (!scene) return;
    setDraft((d) => {
      const base = d.scene ? d : { ...d, scene };
      if (m.kind === "verdict") {
        const existing = base.marks.find((x) => x.kind === "verdict" && x.world === m.world);
        const others = base.marks.filter((x) => !(x.kind === "verdict" && x.world === m.world));
        const same = existing?.kind === "verdict" && existing.verdict === m.verdict;
        return { ...base, marks: same ? others : [...others, m] };
      }
      return { ...base, marks: [...base.marks, m] };
    });
  };

  const sendDraft = () =>
    send.run(async () => {
      if (!scene) return;
      await post("/api/human/intents", { scene: draft.scene ?? scene, marks: draft.marks, utterance: draft.utterance });
      setDraft(EMPTY_DRAFT);
      setTab("talk");
    });

  const intents = [...state.intents].reverse();
  const open = intents.filter((i) => i.status === "pending" || i.status === "answered");
  const closed = intents.filter((i) => i.status === "resolved" || i.status === "dismissed");
  const proposals = state.proposals.filter((p) => p.status === "proposed");
  const answered = state.intents.filter((i) => i.status === "answered").length;
  const confirmed = state.knowledge.filter((k) => k.status === "confirmed").length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22">
              <circle cx="7" cy="12" r="4.2" />
              <circle cx="14" cy="9" r="3.2" />
              <circle cx="18" cy="15" r="2.4" />
            </svg>
          </span>
          <h1>Possible Worlds</h1>
          {current && (
            <span className="topbar-model">
              <span className="num">v{current.number}</span> {current.spec.title}
            </span>
          )}
        </div>
        <div className="topbar-right">
          {!live && <span className="badge badge-warn">サーバーとの接続が切れています</span>}
          <span className={`agent-status ${agentConnected ? "on" : "off"}`} title={agentConnected ? "MCP ブリッジが接続中" : "Claude Code の MCP ブリッジが未接続"}>
            {agentConnected ? <IconPlugConnected size={16} /> : <IconPlugConnectedX size={16} />}
            <span className="agent-status-text">{agentConnected ? "Claude Code 接続中" : "Claude Code 未接続"}</span>
          </span>
          <a className="btn btn-quiet" href="/api/export" title={`保存場所: ${dataPath}`}>
            <IconDownload size={16} /> 書き出す
          </a>
        </div>
      </header>

      {!current ? (
        <EmptyState proposals={proposals.length > 0} state={state} seed={seed} />
      ) : (
        <main className="layout">
          {compiled && !compiled.ok ? (
            <div className="error-note">いまの版を描けません: {compiled.problems.join(" / ")}</div>
          ) : (
            <Stage
              spec={current.spec}
              versionNumber={current.number}
              seed={seed}
              worlds={worlds}
              yDomain={yDomain}
              marks={stageMarks}
              focus={focus}
              tool={tool}
              showObs={showObs}
              reseedBlocked={draft.marks.length > 0}
              onFocus={(f) => {
                setFocus(f);
                setTool(f === "all" ? "sketch" : "look");
              }}
              onTool={setTool}
              onShowObs={setShowObs}
              onReseed={() => {
                setSeed(Math.floor(Math.random() * 1e6));
                setFocus(null);
              }}
              onMark={addMark}
            />
          )}

          <aside className="side">
            <nav className="tabs" role="tablist">
              <TabButton id="talk" tab={tab} onTab={setTab} label="対話" count={answered} />
              <TabButton id="proposals" tab={tab} onTab={setTab} label="提案" count={proposals.length} />
              <TabButton id="knowledge" tab={tab} onTab={setTab} label="知識" count={confirmed} quiet />
              <TabButton id="model" tab={tab} onTab={setTab} label="モデルと版" />
            </nav>
            <div className="tab-body">
              {tab === "talk" && (
                <div className="stack">
                  {!draftMatches && draft.marks.length > 0 && (
                    <p className="warn-note">
                      このメモは別の版または seed の世界を指しています。そのまま渡すと、指した時点の世界として Claude に伝わります。
                    </p>
                  )}
                  <DraftTray
                    spec={current.spec}
                    marks={draft.marks}
                    utterance={draft.utterance}
                    onUtterance={(u) => setDraft((d) => ({ ...d, utterance: u }))}
                    onRemove={(i) => setDraft((d) => ({ ...d, marks: d.marks.filter((_, k) => k !== i) }))}
                    onClear={() => setDraft(EMPTY_DRAFT)}
                    onSend={sendDraft}
                    busy={send.busy}
                    error={send.error}
                  />
                  {open.map((i) => (
                    <IntentCard key={i.id} intent={i} state={state} agentConnected={agentConnected} />
                  ))}
                  {closed.length > 0 && (
                    <details className="history">
                      <summary>済んだ対話 {closed.length} 件</summary>
                      <div className="stack">
                        {closed.map((i) => (
                          <IntentCard key={i.id} intent={i} state={state} agentConnected={agentConnected} />
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
              {tab === "proposals" && (
                <div className="stack">
                  {proposals.length === 0 && <p className="empty-note">開いている提案はありません。候補を選ぶか、Claude Code に変更を頼むとここに届きます。</p>}
                  {proposals.map((p) => (
                    <ProposalCard key={p.id} proposal={p} state={state} seed={seed} />
                  ))}
                </div>
              )}
              {tab === "knowledge" && <KnowledgeList state={state} />}
              {tab === "model" && (
                <div className="stack">
                  <ModelSummary spec={current.spec} />
                  <h3 className="section-title">版の履歴</h3>
                  <VersionList state={state} />
                </div>
              )}
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}

function TabButton({ id, tab, onTab, label, count, quiet }: { id: Tab; tab: Tab; onTab: (t: Tab) => void; label: string; count?: number; quiet?: boolean }) {
  return (
    <button role="tab" aria-selected={tab === id} className={`tab ${tab === id ? "is-on" : ""}`} onClick={() => onTab(id)}>
      {label}
      {count ? <span className={`tab-count num ${quiet ? "quiet" : ""}`}>{count}</span> : null}
    </button>
  );
}

const START_PHRASE = "Possible Worlds に、温度と材料強度のモデルを提案してください";

function EmptyState({ proposals, state, seed }: { proposals: boolean; state: State; seed: number }) {
  const { run, busy, error } = useAction();
  const open = state.proposals.filter((p) => p.status === "proposed");
  return (
    <main className="empty">
      <div className="empty-inner">
        <h2>まだモデルがありません</h2>
        <p>
          Claude Code にモデルを提案してもらうか、模式例から始めます。モデルが決まると、その prior から生まれる世界がここに並びます。
        </p>
        <div className="copy-line">
          <code>{START_PHRASE}</code>
          <button className="btn btn-quiet" onClick={() => void navigator.clipboard.writeText(START_PHRASE)}>
            <IconCopy size={16} /> コピー
          </button>
        </div>
        <ErrorNote error={error} />
        <button className="btn" disabled={busy} onClick={() => run(() => post("/api/human/example"))}>
          模式例で始める
        </button>
        {proposals && (
          <div className="stack">
            {open.map((p) => (
              <ProposalCard key={p.id} proposal={p} state={state} seed={seed} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
