// The background ladder: whenever a model's current version has data that fits it,
// compute its posterior in the background — a fast approximation first, then MCMC —
// and attach each result as a run. Work for versions that are no longer current is
// cancelled. One job runs at a time; jobs live in memory, results live in the store.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentRunInput, type Job, type JobStage } from "../shared/contracts.ts";
import { approximationGaps, approximationTrusted, diagnosticWarnings } from "../shared/compare.ts";
import { datasetProblems, type Store } from "./store.ts";

const RANK: Record<JobStage, number> = { approximate: 0, quick: 1, mcmc: 2 };
const PHASES: Record<string, (s: JobStage) => string> = {
  compile: () => "Stan をコンパイル中",
  sample: (s) => ({ approximate: "近似（Pathfinder）を計算中", quick: "短い NUTS で目安を計算中", mcmc: "NUTS で計算中" })[s],
};
const ARGS: Record<JobStage, string[]> = {
  approximate: ["--method", "pathfinder"],
  quick: ["--draws", "200", "--warmup", "300", "--chains", "1", "--target-accept", "0.95"],
  mcmc: ["--draws", "1000", "--warmup", "1000", "--chains", "4", "--target-accept", "0.95"],
};

export function stanAvailable(): { ok: boolean; reason: string } {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const dir = join(home, ".cmdstan");
  const found = existsSync(dir) && readdirSync(dir).some((n) => n.startsWith("cmdstan-"));
  return found ? { ok: true, reason: "" } : { ok: false, reason: `CmdStan が ${dir} に見つかりません（README の「Stan の準備」）` };
}

export class Ladder {
  jobs: Job[] = [];
  enabled: boolean;
  reason: string;
  private store: Store;
  private workRoot: string;
  private child: { job: Job; proc: ChildProcess } | null = null;
  private notify: () => void;

  private launch: ((job: Job) => void) | null;

  // options.launch replaces the real Stan process (for tests); options.enabled forces the switch.
  constructor(store: Store, workRoot: string, notify: () => void, options: { launch?: (job: Job) => void; enabled?: boolean } = {}) {
    this.store = store;
    this.workRoot = workRoot;
    this.notify = notify;
    this.launch = options.launch ?? null;
    const avail = options.enabled === undefined ? stanAvailable() : { ok: options.enabled, reason: "test" };
    this.enabled = avail.ok && (options.enabled !== undefined || process.env.WORLDS_AUTO !== "0");
    this.reason = avail.ok ? (this.enabled ? "" : "WORLDS_AUTO=0 で止めています") : avail.reason;
    store.subscribe((e) => {
      if (e.kind === "version" || e.kind === "model" || e.kind === "dataset") this.plan();
    });
    this.plan();
  }

  setEnabled(on: boolean) {
    if (on && !stanAvailable().ok) return;
    this.enabled = on;
    this.reason = on ? "" : "一時停止中";
    if (!on && this.child) this.cancel(this.child.job, "一時停止");
    this.plan();
    this.notify();
  }

  // A failed job is not retried on its own; the person asks for it.
  retry(jobId: string) {
    this.jobs = this.jobs.filter((j) => !(j.id === jobId && j.status === "failed"));
    this.plan();
  }

  // Which (version, dataset, stage) should exist, given the store now.
  plan() {
    const s = this.store.state;
    const current = new Set(s.models.map((m) => m.currentVersionId));
    for (const j of this.jobs) {
      if ((j.status === "queued" || j.status === "running") && !current.has(j.versionId)) this.cancel(j, "版が新しくなったため止めました");
    }
    if (this.enabled) {
      for (const m of s.models) {
        const v = this.store.version(m.currentVersionId);
        const ds = [...s.datasets].reverse().find((d) => d.modelId === m.id && datasetProblems(v.spec, d).length === 0);
        if (!ds) continue;
        const runs = s.runs.filter((r) => r.versionId === v.id && r.datasetId === ds.id);
        const hasMcmc = runs.some((r) => r.fidelity === "mcmc");
        const approx = runs.filter((r) => r.fidelity === "approximate");
        const trusted = approx.some((r) => approximationTrusted(r.diagnostics));
        // Pathfinder first; if it fails its own check, a short NUTS chain gives the early picture instead.
        const wanted: JobStage[] = hasMcmc ? [] : [...(approx.length ? [] : ["approximate" as const]), ...(approx.length && !trusted ? ["quick" as const] : []), "mcmc"];
        for (const stage of wanted) {
          if (this.jobs.some((j) => j.versionId === v.id && j.datasetId === ds.id && j.stage === stage && j.status !== "cancelled")) continue;
          this.jobs.push({
            id: `job_${randomUUID().slice(0, 8)}`, modelId: m.id, versionId: v.id, datasetId: ds.id, stage,
            status: "queued", phase: "順番待ち", startedAt: null, finishedAt: null, message: "", runId: null,
          });
        }
      }
    }
    this.jobs = this.jobs.slice(-40);
    this.notify();
    this.pump();
  }

  private pump() {
    // one job at a time, judged by job state (plan can re-enter while a cancel finishes)
    if (!this.enabled || this.jobs.some((j) => j.status === "running")) return;
    const next = this.jobs.filter((j) => j.status === "queued").sort((a, b) => RANK[a.stage] - RANK[b.stage])[0];
    if (next) this.start(next);
  }

  private start(job: Job) {
    if (this.launch) {
      job.status = "running";
      job.startedAt = new Date().toISOString();
      return this.launch(job);
    }
    let bundle;
    try {
      bundle = this.store.inferenceBundle(job.versionId, job.datasetId, "stan");
    } catch (err) {
      return this.finish(job, "failed", err instanceof Error ? err.message : String(err));
    }
    const dir = join(this.workRoot, `${job.versionId}-${job.datasetId}`);
    mkdirSync(dir, { recursive: true });
    // Rewrite only what changed: a newer model.stan would make CmdStan compile again.
    for (const [name, content] of Object.entries(bundle.files)) {
      const file = join(dir, name);
      if (!existsSync(file) || readFileSync(file, "utf8") !== content) writeFileSync(file, content, "utf8");
    }
    writeFileSync(join(dir, "dataset.json"), JSON.stringify(bundle.dataset), "utf8");
    const out = join(dir, `run-${job.stage}.json`);
    const args = ["run", "--quiet", "--with", "cmdstanpy", "python", join(dir, "run_stan.py"), join(dir, "dataset.json"), out];
    args.push(...ARGS[job.stage]);
    // cmdstanpy finds ~/.cmdstan through HOME; a POSIX-style HOME (Git Bash) sends it astray.
    const env = { ...process.env, ...(process.platform === "win32" && process.env.USERPROFILE ? { HOME: process.env.USERPROFILE } : {}) };
    const proc = spawn("uv", args, { cwd: dir, env, windowsHide: true });
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.phase = "開始";
    this.child = { job, proc };
    this.notify();
    let tail = "";
    const read = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      tail = (tail + text).slice(-2000);
      for (const line of text.split(/\r?\n/)) {
        const m = /^STAGE (\w+)/.exec(line.trim());
        if (m && PHASES[m[1]]) {
          job.phase = PHASES[m[1]](job.stage);
          this.notify();
        }
      }
    };
    proc.stdout.on("data", read);
    proc.stderr.on("data", read);
    proc.on("error", (err) => {
      this.child = null;
      this.finish(job, "failed", `uv を起動できません: ${err.message}`);
    });
    proc.on("close", (code) => {
      if (this.child?.job === job) this.child = null;
      if (job.status !== "running") return this.pump();
      if (code !== 0) return this.finish(job, "failed", tail.trim().split(/\r?\n/).slice(-6).join("\n"));
      try {
        this.attach(job, JSON.parse(readFileSync(out, "utf8")));
        this.finish(job, "done", "");
      } catch (err) {
        this.finish(job, "failed", err instanceof Error ? err.message : String(err));
      }
    });
  }

  private attach(job: Job, json: unknown) {
    // read the runner's output through the contract first, so defaults (e.g. paretoK) are filled in
    const raw = AgentRunInput.parse(json);
    const spec = this.store.version(job.versionId).spec;
    let warnings: string[];
    if (job.stage === "approximate") {
      warnings = approximationTrusted(raw.diagnostics) ? ["近似（Pathfinder）。NUTS の結果が届くまでの目安です"] : diagnosticWarnings(raw.diagnostics);
    } else if (job.stage === "quick") {
      // one chain cannot check itself with R̂; it is an early picture, not a result
      raw.fidelity = "approximate";
      raw.method = `短い NUTS（${raw.method}）`;
      raw.diagnostics = { ...raw.diagnostics, maxRhat: null };
      warnings = ["短い NUTS（1 chain）。Pathfinder が信用できなかったので、本番の NUTS が届くまでの目安です"];
      if ((raw.diagnostics.divergences ?? 0) > 0) warnings.push(`発散が ${raw.diagnostics.divergences} 回`);
    } else {
      warnings = diagnosticWarnings(raw.diagnostics);
    }
    if (job.stage === "mcmc") {
      const approx = [...this.store.state.runs]
      .reverse()
      .find((r) => r.versionId === job.versionId && r.datasetId === job.datasetId && r.fidelity === "approximate" && approximationTrusted(r.diagnostics));
      if (approx) warnings.push(...approximationGaps(spec, approx, raw));
    }
    const run = this.store.attachRun({ ...raw, warnings }, "auto");
    job.runId = run.id;
  }

  private finish(job: Job, status: Job["status"], message: string) {
    job.status = status;
    job.message = message;
    job.finishedAt = new Date().toISOString();
    job.phase = status === "done" ? "完了" : status === "failed" ? "失敗" : "停止";
    // a finished stage can change what the next stage should be (e.g. a failed approximation adds "quick")
    this.plan();
  }

  private cancel(job: Job, why: string) {
    if (this.child?.job === job) {
      const { proc } = this.child;
      this.child = null;
      // kill the whole tree: uv → python → the compiled model
      if (proc.pid && process.platform === "win32") spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true });
      else proc.kill("SIGTERM");
    }
    if (job.status === "queued" || job.status === "running") this.finish(job, "cancelled", why);
  }
}
