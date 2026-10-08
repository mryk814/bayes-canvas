import { useEffect, useState } from "react";
import { IconPlayerPause, IconPlayerPlay, IconLoader2 } from "@tabler/icons-react";
import type { Job, Run, State } from "../shared/contracts.ts";
import { runShown } from "../shared/compare.ts";
import { splitShort } from "./Engine.tsx";
import { post, useAction, type LadderInfo } from "./api.ts";
import { ErrorNote } from "./Ledger.tsx";

export const STAGE_LABEL: Record<Job["stage"], string> = {
  approximate: "近似（ラプラス / ADVI）",
  mcmc: "NUTS",
  trial: "試走",
  calibrate: "較正（SBC）",
  holdout: "予測の採点",
};

function jobLabel(j: Job, state: State) {
  const alg = state.algorithms.find((a) => a.id === j.subject);
  if (j.stage === "mcmc") return alg ? alg.name : "NUTS";
  if (j.stage === "holdout") return `${STAGE_LABEL.holdout}（${splitShort(j.split ?? "records")}）：${alg?.name ?? (j.subject === "nuts" ? "NUTS" : "近似")}`;
  if (alg) return `${STAGE_LABEL[j.stage]}：${alg.name}`;
  return STAGE_LABEL[j.stage];
}

export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function elapsed(from: string | null, now: number) {
  if (!from) return "";
  const s = Math.max(0, Math.round((now - Date.parse(from)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// The most trustworthy finished run for the model's current version: the adopted algorithm's,
// then MCMC, then an approximation, newest first.
export function bestRun(state: State, modelId: string): Run | null {
  const model = state.models.find((m) => m.id === modelId);
  if (!model) return null;
  // an approximation that failed its own check, or an algorithm not adopted, is kept as a record but never shown as "the posterior"
  const runs = state.runs.filter((r) => r.versionId === model.currentVersionId && runShown(state.algorithms, r)).reverse();
  return runs.find((r) => !!r.algorithmId) ?? runs.find((r) => r.fidelity === "mcmc") ?? runs[0] ?? null;
}

export function LadderStatus({ ladder, state }: { ladder: LadderInfo; state: State }) {
  const running = ladder.jobs.find((j) => j.status === "running");
  const queued = ladder.jobs.filter((j) => j.status === "queued").length;
  const now = useNow(!!running);
  if (!ladder.enabled) {
    return (
      <span className="ladder-status off" title={ladder.reason}>
        裏の計算は停止中
      </span>
    );
  }
  if (!running) return null;
  const v = state.versions.find((x) => x.id === running.versionId);
  const m = state.models.find((x) => x.id === running.modelId);
  return (
    <span className="ladder-status on" title={`${m?.title ?? ""} v${v?.number ?? "?"}`} aria-live="polite">
      <IconLoader2 size={14} className="spin" />
      v{v?.number} · {running.phase} <span className="num">{elapsed(running.startedAt, now)}</span>
      {queued > 0 && <span className="muted"> · 待ち {queued}</span>}
    </span>
  );
}

export function JobList({ ladder, state, modelId }: { ladder: LadderInfo; state: State; modelId: string }) {
  const jobs = ladder.jobs.filter((j) => j.modelId === modelId).reverse();
  const now = useNow(jobs.some((j) => j.status === "running"));
  const { run, busy, error } = useAction();
  return (
    <section className="jobs" aria-label="裏の計算">
      <header className="jobs-head">
        <h3 className="section-title">裏の計算</h3>
        <button
          className="btn btn-quiet"
          disabled={busy || (!ladder.enabled && ladder.reason.startsWith("CmdStan"))}
          onClick={() => run(() => post("/api/human/ladder", { enabled: !ladder.enabled }))}
          title={ladder.reason || "版やデータが変わると、近似 → NUTS（採用したアルゴリズム）の順に事後分布を計算し、そのあと成績表を作ります"}
        >
          {ladder.enabled ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
          {ladder.enabled ? "一時停止" : "再開"}
        </button>
      </header>
      {!ladder.enabled && ladder.reason && <p className="warn-note">{ladder.reason}</p>}
      <ErrorNote error={error} />
      {jobs.length === 0 ? (
        <p className="empty-note">
          {ladder.enabled ? "いまの版に合うデータが付くと、ここで事後分布の計算が始まります。" : "停止中です。"}
        </p>
      ) : (
        <ol className="job-list">
          {jobs.slice(0, 10).map((j) => {
            const v = state.versions.find((x) => x.id === j.versionId);
            return (
              <li key={j.id} className={`job job-${j.status}`}>
                <span className="num">v{v?.number ?? "?"}</span>
                <span>{jobLabel(j, state)}</span>
                <span className={`badge job-badge-${j.status}`}>{j.status === "running" ? j.phase : { queued: "待ち", done: "完了", failed: "失敗", cancelled: "停止", running: "" }[j.status]}</span>
                <span className="num muted">{j.status === "running" ? elapsed(j.startedAt, now) : ""}</span>
                {j.message && <span className="job-message">{j.message}</span>}
                {j.status === "failed" && (
                  <button className="btn btn-quiet job-retry" disabled={busy} onClick={() => run(() => post(`/api/human/ladder/retry/${j.id}`))}>
                    やり直す
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
