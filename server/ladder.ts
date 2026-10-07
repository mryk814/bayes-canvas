// The background ladder: whenever a model's current version has data that fits it,
// compute its posterior in the background — a fast approximation first, then NUTS —
// and attach each result as a run. Both run in one long-lived NumPyro worker
// (inference/worker.py), so the JAX import is paid once. Work for versions that are no
// longer current is cancelled. One job runs at a time; jobs live in memory, results in the store.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentRunInput, type Job, type JobStage } from "../shared/contracts.ts";
import { approximationGaps, approximationTrusted, diagnosticWarnings } from "../shared/compare.ts";
import { datasetProblems } from "../shared/evidence-validation.ts";
import type { Store } from "./store.ts";

const RANK: Record<JobStage, number> = { approximate: 0, mcmc: 1 };
const PHASES: Record<string, string> = {
  load: "モデルを読み込み中",
  optimize: "近似のために最適化中",
  check: "近似を検査中（Pareto k）",
  sample: "NUTS で計算中",
};
const OPTIONS: Record<JobStage, { method: "approx" | "nuts"; options: Record<string, unknown> }> = {
  approximate: { method: "approx", options: { seed: 0, keep: 400 } },
  mcmc: { method: "nuts", options: { draws: 1000, warmup: 1000, chains: 4, seed: 0, keep: 400, target_accept: 0.95 } },
};
const WORKER = resolve(import.meta.dirname, "..", "inference", "worker.py");

type Worker = { proc: ChildProcessWithoutNullStreams; buffer: string };

export class Ladder {
  jobs: Job[] = [];
  enabled: boolean;
  reason: string;
  private store: Store;
  private workRoot: string;
  private notify: () => void;
  private launch: ((job: Job) => void) | null;
  private worker: Worker | null = null;
  private outputs = new Map<string, string>();

  // options.launch replaces the real worker (for tests); options.enabled forces the switch.
  constructor(store: Store, workRoot: string, notify: () => void, options: { launch?: (job: Job) => void; enabled?: boolean } = {}) {
    this.store = store;
    this.workRoot = workRoot;
    this.notify = notify;
    this.launch = options.launch ?? null;
    this.enabled = options.enabled ?? process.env.WORLDS_AUTO !== "0";
    this.reason = this.enabled ? "" : "WORLDS_AUTO=0 で止めています";
    store.subscribe((e) => {
      if (e.kind === "version" || e.kind === "model" || e.kind === "dataset") this.plan();
    });
    this.plan();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.reason = on ? "" : "一時停止中";
    const running = this.jobs.find((j) => j.status === "running");
    if (!on && running) this.cancel(running, "一時停止");
    this.plan();
  }

  // A failed job is not retried on its own; the person asks for it.
  retry(jobId: string) {
    this.jobs = this.jobs.filter((j) => !(j.id === jobId && j.status === "failed"));
    this.plan();
  }

  stop() {
    this.killWorker();
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
        if (runs.some((r) => r.fidelity === "mcmc")) continue;
        const wanted: JobStage[] = runs.some((r) => r.fidelity === "approximate") ? ["mcmc"] : ["approximate", "mcmc"];
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
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.phase = "開始";
    if (this.launch) return this.launch(job);
    let bundle;
    try {
      bundle = this.store.inferenceBundle(job.versionId, job.datasetId, "numpyro");
    } catch (err) {
      return this.finish(job, "failed", err instanceof Error ? err.message : String(err));
    }
    const dir = join(this.workRoot, `${job.versionId}-${job.datasetId}`);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(bundle.files)) {
      const file = join(dir, name);
      if (!existsSync(file) || readFileSync(file, "utf8") !== content) writeFileSync(file, content, "utf8");
    }
    writeFileSync(join(dir, "dataset.json"), JSON.stringify(bundle.dataset), "utf8");
    const out = join(dir, `run-${job.stage}.json`);
    this.outputs.set(job.id, out);
    const { method, options } = OPTIONS[job.stage];
    this.ensureWorker().proc.stdin.write(
      JSON.stringify({ id: job.id, script: join(dir, "model.py"), dataset: join(dir, "dataset.json"), out, method, options }) + "\n",
    );
    this.notify();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
    const proc = spawn("uv", ["run", "--quiet", "--with", "numpyro", "--with", "jax", "python", WORKER], { env, windowsHide: true });
    const worker: Worker = { proc, buffer: "" };
    this.worker = worker;
    const onText = (chunk: Buffer) => {
      worker.buffer += chunk.toString("utf8");
      let cut: number;
      while ((cut = worker.buffer.indexOf("\n")) >= 0) {
        const line = worker.buffer.slice(0, cut).trim();
        worker.buffer = worker.buffer.slice(cut + 1);
        this.onLine(line);
      }
    };
    proc.stdout.on("data", onText);
    let stderr = "";
    proc.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString("utf8")).slice(-1500)));
    proc.on("error", (err) => this.onWorkerExit(worker, `uv を起動できません: ${err.message}`));
    proc.on("close", (code) => this.onWorkerExit(worker, `NumPyro ワーカーが止まりました（${code}）\n${stderr.trim().split(/\r?\n/).slice(-4).join("\n")}`));
    return worker;
  }

  private onLine(line: string) {
    const job = this.jobs.find((j) => j.status === "running");
    if (!job) return;
    const stage = /^STAGE (\w+)/.exec(line);
    if (stage) {
      job.phase = PHASES[stage[1]] ?? stage[1];
      return this.notify();
    }
    const done = /^DONE (\S+)/.exec(line);
    if (done && done[1] === job.id) {
      try {
        this.attach(job, JSON.parse(readFileSync(this.outputs.get(job.id)!, "utf8")));
        this.finish(job, "done", "");
      } catch (err) {
        this.finish(job, "failed", err instanceof Error ? err.message : String(err));
      }
      return;
    }
    const error = /^ERROR (\S+) (.*)$/.exec(line);
    if (error && error[1] === job.id) {
      const message = (JSON.parse(error[2]) as string).trim().split(/\r?\n/).slice(-4).join("\n");
      this.finish(job, "failed", message);
    }
  }

  private onWorkerExit(worker: Worker, message: string) {
    if (this.worker !== worker) return;
    this.worker = null;
    const job = this.jobs.find((j) => j.status === "running");
    if (job) this.finish(job, "failed", message);
  }

  private killWorker() {
    const w = this.worker;
    if (!w) return;
    this.worker = null;
    // kill the whole tree: uv → python
    if (w.proc.pid && process.platform === "win32") spawn("taskkill", ["/PID", String(w.proc.pid), "/T", "/F"], { windowsHide: true });
    else w.proc.kill("SIGTERM");
  }

  private attach(job: Job, json: unknown) {
    // read the worker's output through the contract first, so defaults are filled in
    const raw = AgentRunInput.parse(json);
    const spec = this.store.version(job.versionId).spec;
    let warnings: string[];
    if (job.stage === "approximate") {
      warnings = approximationTrusted(raw.diagnostics) ? [`近似（${raw.method}）。NUTS の結果が届くまでの目安です`] : diagnosticWarnings(raw.diagnostics);
    } else {
      warnings = diagnosticWarnings(raw.diagnostics);
      const approx = [...this.store.state.runs]
        .reverse()
        .find((r) => r.versionId === job.versionId && r.datasetId === job.datasetId && r.fidelity === "approximate" && approximationTrusted(r.diagnostics));
      if (approx) warnings.push(...approximationGaps(spec, approx, raw));
    }
    job.runId = this.store.attachRun({ ...raw, warnings }, "auto").id;
  }

  private finish(job: Job, status: Job["status"], message: string) {
    job.status = status;
    job.message = message;
    job.finishedAt = new Date().toISOString();
    job.phase = status === "done" ? "完了" : status === "failed" ? "失敗" : "停止";
    this.plan();
  }

  private cancel(job: Job, why: string) {
    // the worker runs one job; stopping it is the only way to stop that job
    if (job.status === "running" && !this.launch) this.killWorker();
    if (job.status === "queued" || job.status === "running") this.finish(job, "cancelled", why);
  }
}
