import { useEffect, useMemo, useState } from "react";
import { IconCopy, IconDownload, IconPlus, IconPlugConnected, IconPlugConnectedX } from "@tabler/icons-react";
import type { Mark, SceneRef, State } from "../shared/contracts.ts";
import { EXAMPLES } from "../shared/example.ts";
import { compileSpec, datasetPoints, drawCount, runInputs, simulateWorld, viewPoints, type World } from "../shared/sim.ts";
import { post, useAction, useAppData, useStoredState } from "./api.ts";
import { DraftTray, IntentCard } from "./Conversation.tsx";
import { ErrorNote, EvidenceList, KnowledgeList, ModelSummary, ProposalCard, VersionList } from "./Ledger.tsx";
import { Stage, type Focus, type Source, type StageMode } from "./Stage.tsx";
import { sharedDomains, type Tool } from "./WorldPlot.tsx";
import { ModelTools } from "./ModelTools.tsx";

const WORLD_COUNT = 12;

type Draft = { scene: SceneRef | null; marks: Mark[]; utterance: string };
const EMPTY_DRAFT: Draft = { scene: null, marks: [], utterance: "" };

export function App() {
  const { data, live } = useAppData();
  if (data.status === "loading") return <div className="splash">読み込んでいます…</div>;
  if (data.status === "error") return <div className="splash error-note">{data.message}</div>;
  return <Workspace state={data.state} agentConnected={data.agentConnected} dataPath={data.dataPath} live={live} />;
}

type Tab = "talk" | "proposals" | "knowledge" | "evidence" | "model";

function Workspace({ state, agentConnected, dataPath, live }: { state: State; agentConnected: boolean; dataPath: string; live: boolean }) {
  const [modelId, setModelId] = useStoredState<string | null>("possible-worlds:model", null);
  const [creating, setCreating] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const model = state.models.find((m) => m.id === modelId) ?? state.models[state.models.length - 1] ?? null;
  const showEmpty = creating || !model;

  // Follow a model the person just created.
  const [knownModels, setKnownModels] = useState(state.models.length);
  useEffect(() => {
    if (state.models.length > knownModels) {
      setModelId(state.models[state.models.length - 1].id);
      setCreating(false);
    }
    if (state.models.length !== knownModels) setKnownModels(state.models.length);
  }, [state.models, knownModels, setModelId]);

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
          {state.models.length > 0 && (
            <select
              className="model-switch"
              aria-label="モデルを切り替える"
              value={showEmpty ? "" : model!.id}
              onChange={(e) => {
                setModelId(e.target.value);
                setCreating(false);
              }}
            >
              {showEmpty && <option value="">新しいモデル</option>}
              {state.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          )}
          {state.models.length > 0 && !showEmpty && (
            <button className="btn btn-quiet" onClick={() => setCreating(true)} title="新しいモデルを始める" aria-label="新しいモデルを始める">
              <IconPlus size={16} />
            </button>
          )}
        </div>
        <div className="topbar-right">
          {!showEmpty && <button className="btn btn-quiet" aria-pressed={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}>{toolsOpen ? "世界に戻る" : "問いの道具"}</button>}
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
      {showEmpty ? (
        <EmptyState state={state} onCancel={state.models.length ? () => setCreating(false) : null} />
      ) : (
        <ModelSession key={model!.id} state={state} modelId={model!.id} agentConnected={agentConnected} toolsOpen={toolsOpen}/>
      )}
    </div>
  );
}

// One selection owns both views; hiding a view preserves its unfinished inputs.
function ModelSession({ state, modelId, agentConnected, toolsOpen }: { state: State; modelId: string; agentConnected: boolean; toolsOpen: boolean }) {
  const [runId, setRunId] = useStoredState<string | null>(`possible-worlds:run:${modelId}`, null);
  return <>
    <div hidden={toolsOpen}><ModelWorkspace state={state} modelId={modelId} agentConnected={agentConnected} runId={runId} onRun={setRunId}/></div>
    <div hidden={!toolsOpen}><ModelTools state={state} modelId={modelId} runId={runId} onRun={setRunId} active={toolsOpen}/></div>
  </>;
}

function ModelWorkspace({ state, modelId, agentConnected, runId, onRun }: { state: State; modelId: string; agentConnected: boolean; runId: string | null; onRun: (id: string | null) => void }) {
  const model = state.models.find((m) => m.id === modelId)!;
  const current = state.versions.find((v) => v.id === model.currentVersionId)!;
  const [seed, setSeed] = useStoredState(`possible-worlds:seed:${modelId}`, 1);
  const [draft, setDraft] = useStoredState<Draft>(`possible-worlds:draft:${modelId}`, EMPTY_DRAFT);
  const [focus, setFocus] = useState<Focus>(null);
  const [opened, setOpened] = useState<number | null>(null);
  useEffect(() => { setFocus(null); setOpened(null); }, [runId]);
  const [tool, setTool] = useState<Tool>("look");
  const [showObs, setShowObs] = useState(true);
  const [tab, setTab] = useState<Tab>("talk");
  const [mode, setMode] = useState<StageMode>("worlds");
  const send = useAction();

  const run = state.runs.find((r) => r.id === runId && r.modelId === modelId) ?? null;
  const dataset = run ? (state.datasets.find((d) => d.id === run.datasetId) ?? null) : null;
  // A run is shown with the version it was computed for, never silently with the current one.
  const viewVersion = run ? (state.versions.find((v) => v.id === run.versionId) ?? current) : current;
  const source: Source = run && dataset ? { kind: "run", run, dataset, stale: run.versionId !== current.id } : { kind: "prior" };

  const compiled = useMemo(() => compileSpec(viewVersion.spec), [viewVersion]);
  const worlds: World[] = useMemo(() => {
    if (!compiled.ok) return [];
    const c = compiled.compiled;
    if (!run || !dataset) return Array.from({ length: WORLD_COUNT }, (_, i) => simulateWorld(c, seed, i));
    const K = drawCount(run);
    const picks = [...new Set(Array.from({ length: Math.min(WORLD_COUNT, K) }, (_, j) => Math.round((j * (K - 1)) / Math.max(1, WORLD_COUNT - 1))))];
    return picks.map((k) => simulateWorld(c, seed, k, runInputs(c, run, dataset, k)));
  }, [compiled, seed, run, dataset]);
  const points = useMemo(() => (compiled.ok ? worlds.map((w) => viewPoints(compiled.compiled, w)) : []), [compiled, worlds]);
  const data = useMemo(
    () => (compiled.ok && dataset && worlds[0] ? datasetPoints(compiled.compiled, dataset, worlds[0]) : []),
    [compiled, worlds, dataset],
  );
  const domains = useMemo(() => sharedDomains(points, data), [points, data]);

  const scene: SceneRef = { modelVersionId: viewVersion.id, seed, runId: run?.id ?? null };
  const draftMatches =
    draft.scene === null ||
    (draft.scene.modelVersionId === scene.modelVersionId && draft.scene.seed === scene.seed && draft.scene.runId === scene.runId);
  const stageMarks = draftMatches ? draft.marks : [];

  const addMark = (m: Mark) => {
    setDraft((d) => {
      const base = d.scene ? d : { ...d, scene };
      const same = (x: Mark) =>
        (m.kind === "verdict" && x.kind === "verdict" && x.world === m.world) ||
        (m.kind === "point" && x.kind === "point" && x.world === m.world && x.unit === m.unit) ||
        (m.kind === "layer" && x.kind === "layer" && x.world === m.world && x.unit === m.unit && x.node === m.node) ||
        (m.kind === "ridge" && x.kind === "ridge" && x.a === m.a && x.b === m.b) ||
        (m.kind === "bin" && x.kind === "bin" && x.arg === m.arg && x.group === m.group && x.from === m.from);
      if (m.kind === "verdict" || m.kind === "point" || m.kind === "layer" || m.kind === "ridge" || m.kind === "bin") {
        const existing = base.marks.find(same);
        const others = base.marks.filter((x) => !same(x));
        const toggledOff = !!existing && (existing.kind !== "verdict" || (m.kind === "verdict" && existing.verdict === m.verdict));
        return { ...base, marks: toggledOff ? others : [...others, m] };
      }
      return { ...base, marks: [...base.marks, m] };
    });
  };

  const sendDraft = () =>
    send.run(async () => {
      await post("/api/human/intents", { scene: draft.scene ?? scene, marks: draft.marks, utterance: draft.utterance });
      setDraft(EMPTY_DRAFT);
      setTab("talk");
    });

  const intents = state.intents.filter((i) => i.modelId === modelId).reverse();
  const open = intents.filter((i) => i.status === "pending" || i.status === "answered");
  const closed = intents.filter((i) => i.status === "resolved" || i.status === "dismissed");
  const proposals = state.proposals.filter((p) => p.status === "proposed" && p.modelId === modelId);
  const answered = intents.filter((i) => i.status === "answered").length;
  const confirmed = state.knowledge.filter((k) => k.modelId === modelId && k.status === "confirmed").length;
  const runs = state.runs.filter((r) => r.modelId === modelId);
  const runOptions = runs
    .slice()
    .reverse()
    .map((r) => {
      const v = state.versions.find((x) => x.id === r.versionId);
      return { id: r.id, label: `事後 · v${v?.number} · ${r.method}${r.versionId !== current.id ? " · 旧版" : ""}` };
    });
  const freshRuns = runs.filter((r) => r.versionId === current.id).length;
  const showRun = (id: string | null) => {
    onRun(id);
    setFocus(null);
    setOpened(null);
  };

  return (
    <main className="layout">
      {!compiled.ok ? (
        <div className="error-note">この版を描けません: {compiled.problems.join(" / ")}</div>
      ) : (
        <Stage
          compiled={compiled.compiled}
          versionNumber={viewVersion.number}
          seed={seed}
          source={source}
          runOptions={runOptions}
          worlds={worlds}
          points={points}
          data={data}
          domains={domains}
          marks={stageMarks}
          focus={focus}
          tool={tool}
          showObs={showObs}
          reseedBlocked={draft.marks.length > 0}
          opened={opened}
          mode={!run && mode === "lens" ? "worlds" : mode}
          onMode={setMode}
          onSource={showRun}
          onFocus={(f) => {
            setFocus(f);
            setOpened(null);
            setTool(f === "all" ? "sketch" : "look");
          }}
          onTool={setTool}
          onShowObs={setShowObs}
          onReseed={() => {
            setSeed(Math.floor(Math.random() * 1e6));
            setFocus(null);
            setOpened(null);
          }}
          onMark={addMark}
          onOpen={setOpened}
        />
      )}

      <aside className="side">
        <nav className="tabs" role="tablist">
          <TabButton id="talk" tab={tab} onTab={setTab} label="対話" count={answered} />
          <TabButton id="proposals" tab={tab} onTab={setTab} label="提案" count={proposals.length} />
          <TabButton id="knowledge" tab={tab} onTab={setTab} label="知識" count={confirmed} quiet />
          <TabButton id="evidence" tab={tab} onTab={setTab} label="推論" count={freshRuns} quiet />
          <TabButton id="model" tab={tab} onTab={setTab} label="モデル" />
        </nav>
        <div className="tab-body">
          {tab === "talk" && (
            <div className="stack">
              {!draftMatches && draft.marks.length > 0 && (
                <p className="warn-note">このメモは別の版・seed・run の世界を指しています。そのまま渡すと、指した時点の世界として Claude に伝わります。</p>
              )}
              <DraftTray
                spec={viewVersion.spec}
                posterior={source.kind === "run"}
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
          {tab === "knowledge" && <KnowledgeList state={state} modelId={modelId} />}
          {tab === "evidence" && <EvidenceList state={state} modelId={modelId} onShowRun={showRun} />}
          {tab === "model" && (
            <div className="stack">
              <ModelSummary spec={current.spec} />
              <h3 className="section-title">版の履歴</h3>
              <VersionList state={state} modelId={modelId} />
            </div>
          )}
        </div>
      </aside>
    </main>
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

const START_PHRASE = "Possible Worlds に、私の問題に合うモデルを提案してください。";

function EmptyState({ state, onCancel }: { state: State; onCancel: (() => void) | null }) {
  const { run, busy, error } = useAction();
  const proposals = state.proposals.filter((p) => p.status === "proposed" && p.modelId === null);
  return (
    <main className="empty">
      <div className="empty-inner">
        <h2>新しいモデルを始める</h2>
        <p>Claude Code に問題を話してモデルを提案してもらうか、模式例から始めます。</p>
        <div className="copy-line">
          <code>{START_PHRASE}</code>
          <button className="btn btn-quiet" onClick={() => void navigator.clipboard.writeText(START_PHRASE)}>
            <IconCopy size={16} /> コピー
          </button>
        </div>
        <ErrorNote error={error} />
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex.id} className="example" disabled={busy} onClick={() => run(() => post("/api/human/example", { exampleId: ex.id }))}>
              <strong>{ex.label}</strong>
              <span className="muted small">{ex.summary}</span>
            </button>
          ))}
        </div>
        {proposals.length > 0 && (
          <div className="stack">
            <h3 className="section-title">Claude からの新しいモデルの提案</h3>
            {proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} state={state} seed={1} />
            ))}
          </div>
        )}
        {onCancel && (
          <button className="btn btn-quiet" onClick={onCancel}>
            戻る
          </button>
        )}
      </div>
    </main>
  );
}
