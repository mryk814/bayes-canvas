// The background ladder: whenever a model's current version has data that fits it,
// compute its posterior in the background — a fast approximation first, then NUTS (or the
// algorithm the person adopted for this version) — and attach each result as a run.
// Then it writes report cards: proposed algorithms are tried on the real data and calibrated
// on data simulated from the prior, and every method is scored on predicting held-out records.
// All of it runs in one long-lived NumPyro worker (inference/worker.py), so the JAX import is
// paid once. Work for versions that are no longer current is cancelled. One job runs at a time;
// jobs live in memory, results in the store.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentRunInput, type Job, type JobStage } from "../shared/contracts.ts";
import { approximationGaps, approximationTrusted, diagnosticWarnings } from "../shared/compare.ts";
import { calibrationSets, calibrationSummary, holdoutSplit, holdoutSplits, predictiveScores, seedOf, type SplitKind } from "../shared/evaluate.ts";
import { datasetProblems } from "../shared/evidence-validation.ts";
import type { Store } from "./store.ts";

const RANK: Record<JobStage, number> = { approximate: 0, mcmc: 1, trial: 2, calibrate: 3, holdout: 4 };
const PHASES: Record<string, string> = {
  load: "モデルを読み込み中",
  optimize: "近似のために最適化中",
  check: "近似を検査中（Pareto k）",
  sample: "サンプリング中",
  calibrate: "較正中",
};
const APPROX = { seed: 0, keep: 400 };
const FULL = { draws: 1000, warmup: 1000, chains: 4, seed: 0, keep: 400 };
// the held-out fits only feed a score, so they are lighter
const LIGHT = { draws: 500, warmup: 500, chains: 2, seed: 0, keep: 200 };
const NUTS_ACCEPT = 0.95;
export const CALIBRATION_REPS = 40;
const HOLDOUT_FRACTION = 0.2;
const WORKER = resolve(import.meta.dirname, "..", "inference", "worker.py");

type Worker = { proc: ChildProcessWithoutNullStreams; buffer: string };
type Task = { method: "approx" | "nuts" | "custom" | "sbc"; dataset: string; options: Record<string, unknown> };
type DataLike = { id: string; plates: Record<string, number>; columns: Record<string, number[]> };

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

  // options.launch replaces the real worker (for tests, which then call settle); options.enabled forces the switch.
  constructor(store: Store, workRoot: string, notify: () => void, options: { launch?: (job: Job) => void; enabled?: boolean } = {}) {
    this.store = store;
    this.workRoot = workRoot;
    this.notify = notify;
    this.launch = options.launch ?? null;
    this.enabled = options.enabled ?? process.env.WORLDS_AUTO !== "0";
    this.reason = this.enabled ? "" : "WORLDS_AUTO=0 で止めています";
    store.subscribe((e) => {
      if (e.kind === "version" || e.kind === "model" || e.kind === "dataset" || e.kind === "algorithm") this.plan();
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

  // Which (version, dataset, stage, subject) should exist, given the store now.
  plan() {
    const s = this.store.state;
    const current = new Set(s.models.map((m) => m.currentVersionId));
    for (const j of this.jobs) {
      if (j.status !== "queued" && j.status !== "running") continue;
      if (!current.has(j.versionId)) this.cancel(j, "版が新しくなったため止めました");
      else if (j.subject.startsWith("alg_") && s.algorithms.find((a) => a.id === j.subject)?.status === "rejected") {
        this.cancel(j, "アルゴリズムが却下されたため止めました");
      }
    }
    if (this.enabled) for (const m of s.models) this.planVersion(m.id, m.currentVersionId);
    this.jobs = this.jobs.slice(-60);
    this.notify();
    this.pump();
  }

  private planVersion(modelId: string, versionId: string) {
    const s = this.store.state;
    const v = this.store.version(versionId);
    const ds = [...s.datasets].reverse().find((d) => d.modelId === modelId && datasetProblems(v.spec, d).length === 0);
    if (!ds) return;
    const runs = s.runs.filter((r) => r.versionId === v.id && r.datasetId === ds.id);
    const algorithms = s.algorithms.filter((a) => a.versionId === v.id && a.status !== "rejected");
    const adopted = algorithms.find((a) => a.status === "adopted");
    const evaluated = (subject: string, kind: string, split: string | null = null) =>
      s.evaluations.some(
        (e) => e.versionId === v.id && e.datasetId === ds.id && e.subject === subject && e.kind === kind && (e.kind !== "holdout" || e.split === split),
      );
    const wanted: { stage: JobStage; subject: string; split?: string }[] = [];

    if (!runs.some((r) => r.fidelity === "mcmc" || r.fidelity === "approximate")) wanted.push({ stage: "approximate", subject: "approximate" });
    if (!runs.some((r) => r.fidelity === "mcmc" && (adopted ? r.algorithmId === adopted.id : true))) {
      wanted.push({ stage: "mcmc", subject: adopted?.id ?? "nuts" });
    }
    const nutsRun = runs.find((r) => r.fidelity === "mcmc" && !r.algorithmId);
    for (const a of algorithms) {
      const fit = s.evaluations.find((e) => e.versionId === v.id && e.datasetId === ds.id && e.subject === a.id && e.kind === "fit");
      // a trial that ran before NUTS had nothing to compare with; run it again once NUTS is there
      const stale = fit?.kind === "fit" && fit.reference === null && !!nutsRun;
      if (stale) this.jobs = this.jobs.filter((j) => !(j.versionId === v.id && j.stage === "trial" && j.subject === a.id && j.status === "done"));
      if (!fit || stale) wanted.push({ stage: "trial", subject: a.id });
      if (!evaluated(a.id, "calibration")) wanted.push({ stage: "calibrate", subject: a.id });
    }
    const c = this.store.compiled(v.id);
    for (const split of holdoutSplits(c)) {
      if (!holdoutSplit(c, ds, split, HOLDOUT_FRACTION, seedOf(ds.id))) continue;
      for (const subject of ["approximate", "nuts", ...algorithms.map((a) => a.id)]) {
        if (!evaluated(subject, "holdout", split)) wanted.push({ stage: "holdout", subject, split });
      }
    }
    for (const { stage, subject, split = null } of wanted) {
      const same = (j: Job) => j.versionId === v.id && j.datasetId === ds.id && j.stage === stage && j.subject === subject && j.split === split;
      if (this.jobs.some((j) => same(j) && j.status !== "cancelled")) continue;
      this.jobs.push({
        id: `job_${randomUUID().slice(0, 8)}`, modelId, versionId: v.id, datasetId: ds.id, stage, subject, split,
        status: "queued", phase: "順番待ち", startedAt: null, finishedAt: null, message: "", runId: null,
      });
    }
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
    let task: Task;
    let dir: string;
    try {
      const bundle = this.store.inferenceBundle(job.versionId, job.datasetId, "numpyro");
      dir = join(this.workRoot, `${job.versionId}-${job.datasetId}`);
      mkdirSync(dir, { recursive: true });
      const files: Record<string, string> = { ...bundle.files, "dataset.json": JSON.stringify(bundle.dataset) };
      if (job.subject.startsWith("alg_")) files[`${job.subject}.py`] = this.store.algorithm(job.subject).code;
      for (const [name, content] of Object.entries(files)) {
        const file = join(dir, name);
        if (!existsSync(file) || readFileSync(file, "utf8") !== content) writeFileSync(file, content, "utf8");
      }
      task = this.task(job, dir, bundle.dataset);
    } catch (err) {
      return this.finish(job, "failed", err instanceof Error ? err.message : String(err));
    }
    const out = join(dir, `run-${job.stage}-${job.subject}${job.split ? `-${job.split.replace(":", "-")}` : ""}.json`);
    this.outputs.set(job.id, out);
    this.ensureWorker().proc.stdin.write(
      JSON.stringify({ id: job.id, script: join(dir, "model.py"), dataset: task.dataset, out, method: task.method, options: task.options }) + "\n",
    );
    this.notify();
  }

  // What the worker runs for a job, writing any derived dataset it needs.
  private task(job: Job, dir: string, dataset: DataLike): Task {
    const real = join(dir, "dataset.json");
    const alg = job.subject.startsWith("alg_") ? join(dir, `${job.subject}.py`) : null;
    const fit = (options: Record<string, unknown>): Pick<Task, "method" | "options"> =>
      job.subject === "approximate"
        ? { method: "approx", options: APPROX }
        : alg
          ? { method: "custom", options: { ...options, algorithm: alg } }
          : { method: "nuts", options: { ...options, target_accept: NUTS_ACCEPT } };
    const c = this.store.compiled(job.versionId);
    switch (job.stage) {
      case "approximate":
      case "mcmc":
      case "trial":
        return { dataset: real, ...fit(FULL) };
      case "calibrate": {
        const file = join(dir, "calibration.json");
        if (!existsSync(file)) writeFileSync(file, JSON.stringify(calibrationSets(c, dataset, CALIBRATION_REPS, seedOf(dataset.id))), "utf8");
        return { method: "sbc", dataset: file, options: { algorithm: alg, draws: 500, warmup: 500, thin: 5, target_accept: NUTS_ACCEPT } };
      }
      case "holdout": {
        const split = holdoutSplit(c, dataset, job.split as SplitKind, HOLDOUT_FRACTION, seedOf(dataset.id));
        if (!split) throw new Error("取っておく記録を選べません");
        const file = join(dir, `train-${job.split!.replace(":", "-")}.json`);
        writeFileSync(file, JSON.stringify({ id: dataset.id, ...split.train }), "utf8");
        return { dataset: file, ...fit(LIGHT) };
      }
    }
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
    const stage = /^STAGE (\w+)\s*(.*)$/.exec(line);
    if (stage) {
      job.phase = [PHASES[stage[1]] ?? stage[1], stage[2]].filter(Boolean).join(" ");
      return this.notify();
    }
    const done = /^DONE (\S+)/.exec(line);
    if (done && done[1] === job.id) return this.settle(job.id, JSON.parse(readFileSync(this.outputs.get(job.id)!, "utf8")));
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

  // The worker finished a job: turn its output into a run or a report card.
  settle(jobId: string, json: unknown) {
    const job = this.jobs.find((j) => j.id === jobId && j.status === "running");
    if (!job) return;
    try {
      this.complete(job, json);
      this.finish(job, "done", "");
    } catch (err) {
      this.finish(job, "failed", err instanceof Error ? err.message : String(err));
    }
  }

  private complete(job: Job, json: unknown) {
    const spec = this.store.version(job.versionId).spec;
    const base = { versionId: job.versionId, datasetId: job.datasetId, subject: job.subject };
    if (job.stage === "calibrate") {
      const r = json as { ranks: Record<string, number[]>; draws: number; divergences: number[]; seconds: number };
      const summary = calibrationSummary(r.ranks, r.draws);
      this.store.recordEvaluation({
        ...base, kind: "calibration", method: this.store.algorithm(job.subject).name, reps: r.divergences.length, draws: r.draws,
        params: summary.params, divergences: r.divergences.reduce((a, b) => a + b, 0), seconds: r.seconds, biasDetected: summary.biasDetected,
      });
      return;
    }
    // read the worker's output through the contract first, so defaults are filled in
    const raw = AgentRunInput.parse(json);
    if (job.stage === "holdout") {
      const ds = this.store.state.datasets.find((d) => d.id === job.datasetId)!;
      const c = this.store.compiled(job.versionId);
      const split = holdoutSplit(c, ds, job.split as SplitKind, HOLDOUT_FRACTION, seedOf(ds.id))!;
      const scores = predictiveScores(c, raw, ds, split.plate, split.held);
      // the held-out fits are light (2 chains x 500), so they are judged by R-hat, divergences and a lower ESS bar
      const d = raw.diagnostics;
      const trusted = job.subject === "approximate"
        ? approximationTrusted(d)
        : (d.maxRhat ?? 99) <= 1.01 && (d.divergences ?? 0) === 0 && (d.minEss ?? 0) >= 100;
      this.store.recordEvaluation({
        ...base, kind: "holdout", method: raw.method, split: split.split, plate: split.plate, held: split.held.length, scores, trusted,
        seconds: raw.diagnostics.seconds ?? null,
      });
      return;
    }
    if (job.stage === "trial") {
      const ref = [...this.store.state.runs]
        .reverse()
        .find((r) => r.versionId === job.versionId && r.datasetId === job.datasetId && r.fidelity === "mcmc" && !r.algorithmId);
      this.store.recordEvaluation({
        ...base, kind: "fit", method: raw.method, diagnostics: raw.diagnostics,
        gaps: ref ? approximationGaps(spec, ref, raw) : [], reference: ref?.id ?? null,
      });
      return;
    }
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
    const algorithmId = job.subject.startsWith("alg_") ? job.subject : null;
    job.runId = this.store.attachRun({ ...raw, warnings, algorithmId }, "auto").id;
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
