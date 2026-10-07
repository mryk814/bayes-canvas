import { useState } from "react";
import type { State } from "../shared/contracts.ts";
import { RunJoint } from "./RunJoint.tsx";
import { ImportCsv } from "./ImportCsv.tsx";
import { Capsule } from "./Capsule.tsx";
import { Diagnostics } from "./Diagnostics.tsx";
import { SavedChecks } from "./SavedChecks.tsx";
import { AssumptionImpact } from "./AssumptionImpact.tsx";
import { Shutter } from "./Shutter.tsx";
import { Pooling } from "./Pooling.tsx";
import "./tools.css";

export function ModelTools({ state, modelId, runId, onRun, active }: { state: State; modelId: string; runId: string | null; onRun: (id: string | null) => void; active: boolean }) {
  const model = state.models.find(m => m.id === modelId)!;
  const current = state.versions.find(v => v.id === model.currentVersionId)!;
  const runs = state.runs.filter(r => r.modelId === modelId);
  const [tool, setTool] = useState("joint");
  const run = runs.find(r => r.id === runId) ?? null;
  const version = run ? state.versions.find(v => v.id === run.versionId) ?? null : current;
  const dataset = run ? state.datasets.find(d => d.id === run.datasetId) ?? null : null;
  const ready = run && version && dataset;
  return <main className="model-tools">
    <header className="tools-heading"><div><p className="eyebrow">問いを確かめる道具</p><h1>{model.title}</h1><p className="muted">モデルの量と保存した証拠を使って、次に確かめたいことを残します。</p></div></header>
    <nav className="tools-nav" aria-label="モデルの道具">{[["joint","同時条件"],["csv","CSV取り込み"],["diagnostics","診断の次の一歩"],["capsule","証拠カプセル"],["checks","保存検査"],["assumptions","仮定の影響先"],["shutter","観測のシャッター"],["pooling","階層の共有先"]].map(([id,label]) => <button className={`btn ${tool === id ? "btn-primary" : ""}`} key={id} aria-pressed={tool === id} onClick={() => setTool(id)}>{label}</button>)}</nav>
    {tool !== "csv" && tool !== "assumptions" && <div className="card tools-source"><label>根拠にするrun<select aria-label="道具で使うrun" value={runId ?? ""} onChange={e => onRun(e.target.value || null)}><option value="">run未選択（世界は事前分布）</option>{runs.map(r => { const v = state.versions.find(v => v.id === r.versionId); return <option key={r.id} value={r.id}>v{v?.number} · {r.method} · {r.id}{r.versionId !== current.id ? " · 旧版" : ""}</option>; })}</select></label>{ready && <p className="small muted">版 v{version.number} · {dataset.label} ({dataset.provenance === "synthetic" ? "合成データ" : "実データ"}) · {run.note}</p>}</div>}
    <div hidden={tool !== "csv"}><ImportCsv version={current}/></div>
    <div hidden={tool !== "joint"}>{ready ? <RunJoint key={run.id} version={version} dataset={dataset} run={run} currentVersionId={current.id} active={active && tool === "joint"}/> : <p className="empty-note">保存されたrunとそのデータを選んでください。まだない場合はCSVを取り込み、Claude Codeから推論結果を付けてください。</p>}</div>
    <div hidden={tool !== "diagnostics"}>{run ? <Diagnostics run={run} currentVersionId={current.id}/> : <p className="empty-note">診断するrunを選んでください。</p>}</div>
    <div hidden={tool !== "capsule"}><Capsule version={version ?? current} dataset={dataset} run={run}/></div>
    <div hidden={tool !== "checks"}><SavedChecks state={state} modelId={modelId} version={version ?? current} dataset={dataset} run={run}/></div>
    <div hidden={tool !== "assumptions"}><AssumptionImpact state={state} modelId={modelId}/></div>
    <div hidden={tool !== "shutter"}><Shutter key={`${version?.id}:${run?.id ?? "prior"}`} version={version ?? current} dataset={dataset} run={run} currentVersionId={current.id}/></div>
    <div hidden={tool !== "pooling"}>{ready ? <Pooling key={run.id} version={version} dataset={dataset} run={run} currentVersionId={current.id}/> : <p className="empty-note">階層の共有先を読むには、保存されたrunを選んでください。</p>}</div>
  </main>;
}
