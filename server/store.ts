// The single source of truth: one JSON file, written atomically, with the
// previous version kept as .bak. Every change goes through these functions.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  AgentDatasetInput,
  AgentProposeInput,
  AgentReplyInput,
  AgentRunInput,
  AgentSynthesizeInput,
  HumanChooseInput,
  HumanFollowUpInput,
  HumanIntentInput,
  HumanSaveCheckInput,
  HumanRerunCheckInput,
  StateSchema,
  emptyState,
  type Dataset,
  type Intent,
  type Model,
  type ModelSpec,
  type ModelVersion,
  type Run,
  type SceneRef,
  type SavedCheck,
  type SavedCheckResult,
  type State,
} from "../shared/contracts.ts";
import { identifiability } from "../shared/identify.ts";
import { bandWorlds, binnedCheck, functionBand, shapeArgs } from "../shared/shape.ts";
import { anatomy, compileSpec, runInputs, simulateWorld, summarizeWorld, type Compiled, type World } from "../shared/sim.ts";
import { EXAMPLES } from "../shared/example.ts";
import { numpyroScript } from "../shared/codegen.ts";
import { stanProgram } from "../shared/stan.ts";
import { migrate } from "./migrate.ts";
import { datasetProblems, runProblems } from "../shared/evidence-validation.ts";
import { evaluateSavedCheck } from "../shared/run-check.ts";
import { readCapsule } from "../shared/capsule.ts";

export class HttpError extends Error {
  status: number;
  problems: string[];
  constructor(status: number, message: string, problems: string[] = []) {
    super(message);
    this.status = status;
    this.problems = problems;
  }
}

const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const now = () => new Date().toISOString();

export type ChangeEvent = { kind: string; id?: string };

export class Store {
  path: string;
  state: State;
  private listeners = new Set<(e: ChangeEvent) => void>();
  private compiledCache = new Map<string, Compiled>();

  constructor(path: string) {
    this.path = path;
    this.state = this.load();
  }

  private load(): State {
    if (!existsSync(this.path)) return emptyState();
    const raw = migrate(JSON.parse(readFileSync(this.path, "utf8")));
    const parsed = StateSchema.safeParse(raw);
    if (!parsed.success) {
      // Refuse to start rather than overwrite a file we cannot read.
      throw new Error(`${this.path} を読めません。ファイルを直すか、別の場所へ移してから起動してください。\n${parsed.error.message}`);
    }
    return parsed.data;
  }

  private commit(next: State, event: ChangeEvent) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(next), "utf8");
    if (existsSync(this.path)) copyFileSync(this.path, `${this.path}.bak`);
    renameSync(tmp, this.path);
    this.state = next;
    for (const l of this.listeners) l(event);
  }

  // Mutate a draft; only a fully successful change is saved and published.
  private change<T>(fn: (draft: State) => T, event: (result: T) => ChangeEvent): T {
    const draft = structuredClone(this.state);
    const result = fn(draft);
    this.commit(StateSchema.parse(draft), event(result));
    return result;
  }

  subscribe(fn: (e: ChangeEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---- lookups -------------------------------------------------------------

  private model(id: string, s: State = this.state): Model {
    const m = s.models.find((x) => x.id === id);
    if (!m) throw new HttpError(404, `モデル ${id} が見つかりません`);
    return m;
  }

  version(id: string): ModelVersion {
    const v = this.state.versions.find((x) => x.id === id);
    if (!v) throw new HttpError(404, `版 ${id} が見つかりません`);
    return v;
  }

  private run(id: string): Run {
    const r = this.state.runs.find((x) => x.id === id);
    if (!r) throw new HttpError(404, `run ${id} が見つかりません`);
    return r;
  }

  private dataset(id: string): Dataset {
    const d = this.state.datasets.find((x) => x.id === id);
    if (!d) throw new HttpError(404, `データセット ${id} が見つかりません`);
    return d;
  }

  private intent(draft: State, id: string): Intent {
    const i = draft.intents.find((x) => x.id === id);
    if (!i) throw new HttpError(404, `意図 ${id} が見つかりません`);
    return i;
  }

  private compileOrThrow(spec: ModelSpec, label: string) {
    const r = compileSpec(spec);
    if (!r.ok) throw new HttpError(400, `${label}のモデルに問題があります`, r.problems);
    return r.compiled;
  }

  private compiled(versionId: string): Compiled {
    let c = this.compiledCache.get(versionId);
    if (!c) {
      c = this.compileOrThrow(this.version(versionId).spec, "参照中");
      this.compiledCache.set(versionId, c);
    }
    return c;
  }

  // The world the person saw: a prior draw, or one joint draw of a run with simulated observations.
  worldOf(scene: SceneRef, index: number): { compiled: Compiled; world: World; dataset: Dataset | null } {
    const compiled = this.compiled(scene.modelVersionId);
    if (!scene.runId) return { compiled, world: simulateWorld(compiled, scene.seed, index), dataset: null };
    const run = this.run(scene.runId);
    const dataset = this.dataset(run.datasetId);
    return { compiled, world: simulateWorld(compiled, scene.seed, index, runInputs(compiled, run, dataset, index)), dataset };
  }

  // ---- human side ------------------------------------------------------------

  importCapsule(raw: unknown) {
    const read = readCapsule(raw);
    if (!read.ok) throw new HttpError(400, "カプセルを取り込めません", read.problems);
    const source = read.capsule;
    return this.change(d => {
      const modelId = newId("mdl"), createdAt = now();
      const version: ModelVersion = {
        id: newId("ver"), modelId, number: 1, spec: source.modelVersion.spec, createdAt,
        origin: { kind: "capsule", source: {
          modelId: source.modelVersion.modelId, versionId: source.modelVersion.id, versionNumber: source.modelVersion.number,
          datasetId: source.dataset.id, runId: source.run.id, createdAt: source.modelVersion.createdAt,
        } },
        summary: `カプセルから独立コピー: ${source.modelVersion.modelId} / ${source.modelVersion.id} (v${source.modelVersion.number})。提案・知識・版履歴は含みません。\n元の概要: ${source.modelVersion.summary}`,
      };
      const model: Model = { id: modelId, title: version.spec.title + "（カプセルのコピー）", createdAt, currentVersionId: version.id };
      const dataset: Dataset = { ...source.dataset, id: newId("ds"), modelId };
      const run: Run = { ...source.run, id: newId("run"), modelId, versionId: version.id, datasetId: dataset.id };
      d.models.push(model); d.versions.push(version); d.datasets.push(dataset); d.runs.push(run);
      return { model, version, dataset, run };
    }, result => ({ kind: "model", id: result.model.id }));
  }

  startExample(exampleId: string) {
    const ex = EXAMPLES.find((e) => e.id === exampleId);
    if (!ex) throw new HttpError(404, `例 ${exampleId} はありません`);
    return this.change(
      (d) => {
        const modelId = newId("mdl");
        const v: ModelVersion = {
          id: newId("ver"), modelId, number: 1, spec: ex.spec, createdAt: now(),
          origin: { kind: "example", exampleId }, summary: `模式例「${ex.label}」から始めました`,
        };
        const model: Model = { id: modelId, title: ex.spec.title, createdAt: now(), currentVersionId: v.id };
        d.models.push(model);
        d.versions.push(v);
        return model;
      },
      (m) => ({ kind: "model", id: m.id }),
    );
  }

  createIntent(input: z.infer<typeof HumanIntentInput>) {
    const v = this.version(input.scene.modelVersionId);
    if (input.scene.runId && this.run(input.scene.runId).versionId !== v.id) throw new HttpError(400, "run と版が対応していません");
    return this.change(
      (d) => {
        const intent: Intent = {
          id: newId("int"), modelId: v.modelId, createdAt: now(), scene: input.scene, marks: input.marks,
          thread: [{ from: "human", text: input.utterance, at: now() }], status: "pending", candidates: [], resolution: null,
        };
        d.intents.push(intent);
        return intent;
      },
      (i) => ({ kind: "intent.pending", id: i.id }),
    );
  }

  followUp(id: string, input: z.infer<typeof HumanFollowUpInput>) {
    return this.change(
      (d) => {
        const i = this.intent(d, id);
        if (i.status === "resolved") throw new HttpError(409, "この意図はすでに確定しています");
        i.thread.push({ from: "human", text: input.text, at: now() });
        i.status = "pending";
        i.candidates = [];
        return i;
      },
      (i) => ({ kind: "intent.pending", id: i.id }),
    );
  }

  choose(id: string, input: z.infer<typeof HumanChooseInput>) {
    return this.change(
      (d) => {
        const i = this.intent(d, id);
        if (i.status !== "answered") throw new HttpError(409, "選べる候補がありません");
        const c = i.candidates.find((x) => x.id === input.candidateId);
        if (!c) throw new HttpError(404, "候補が見つかりません");
        const knowledgeId = newId("kn");
        d.knowledge.push({
          id: knowledgeId, modelId: i.modelId, createdAt: now(), kind: c.kind, statement: c.statement,
          intentId: i.id, scene: i.scene, marks: i.marks, status: "confirmed",
        });
        let proposalId: string | null = null;
        if (c.edit) {
          proposalId = newId("prp");
          d.proposals.push({
            id: proposalId, modelId: i.modelId, createdAt: now(), baseVersionId: this.model(i.modelId, d).currentVersionId,
            spec: c.edit.spec, summary: c.edit.summary, knowledgeIds: [knowledgeId], intentId: i.id, status: "proposed",
          });
        }
        i.status = "resolved";
        i.resolution = { candidateId: c.id, knowledgeId, proposalId };
        return { knowledgeId, proposalId };
      },
      () => ({ kind: "intent.resolved", id }),
    );
  }

  setIntentDismissed(id: string, dismissed: boolean) {
    return this.change(
      (d) => {
        const i = this.intent(d, id);
        if (dismissed) {
          if (i.status === "resolved") throw new HttpError(409, "確定済みの意図は取り下げられません。知識の側で取り下げてください");
          i.status = "dismissed";
        } else {
          if (i.status !== "dismissed") throw new HttpError(409, "取り下げられていません");
          i.status = i.candidates.length ? "answered" : "pending";
        }
        return i;
      },
      () => ({ kind: "intent", id }),
    );
  }

  setKnowledgeWithdrawn(id: string, withdrawn: boolean) {
    return this.change(
      (d) => {
        const k = d.knowledge.find((x) => x.id === id);
        if (!k) throw new HttpError(404, "知識が見つかりません");
        k.status = withdrawn ? "withdrawn" : "confirmed";
        return k;
      },
      () => ({ kind: "knowledge", id }),
    );
  }

  adopt(id: string) {
    return this.change(
      (d) => {
        const p = d.proposals.find((x) => x.id === id);
        if (!p) throw new HttpError(404, "提案が見つかりません");
        if (p.status !== "proposed") throw new HttpError(409, "この提案はもう決着しています");
        this.compileOrThrow(p.spec, "提案");
        let model: Model;
        if (p.modelId === null) {
          model = { id: newId("mdl"), title: p.spec.title, createdAt: now(), currentVersionId: "" };
          d.models.push(model);
          p.modelId = model.id;
        } else {
          model = this.model(p.modelId, d);
          if (p.baseVersionId !== model.currentVersionId) {
            throw new HttpError(409, "この提案は古い版を基にしています。Claude に今の版で出し直してもらってください");
          }
        }
        const v: ModelVersion = {
          id: newId("ver"),
          modelId: model.id,
          number: d.versions.filter((x) => x.modelId === model.id).length + 1,
          spec: p.spec,
          createdAt: now(),
          origin: { kind: "proposal", proposalId: p.id, knowledgeIds: p.knowledgeIds },
          summary: p.summary,
        };
        d.versions.push(v);
        model.currentVersionId = v.id;
        model.title = p.spec.title;
        p.status = "adopted";
        return v;
      },
      (v) => ({ kind: "version", id: v.id }),
    );
  }

  reject(id: string) {
    return this.change(
      (d) => {
        const p = d.proposals.find((x) => x.id === id);
        if (!p) throw new HttpError(404, "提案が見つかりません");
        if (p.status !== "proposed") throw new HttpError(409, "この提案はもう決着しています");
        p.status = "rejected";
        return p;
      },
      () => ({ kind: "proposal", id }),
    );
  }

  revert(toVersionId: string) {
    const target = this.version(toVersionId);
    if (this.model(target.modelId).currentVersionId === target.id) throw new HttpError(409, "すでにこの版です");
    return this.change(
      (d) => {
        const model = this.model(target.modelId, d);
        const v: ModelVersion = {
          id: newId("ver"),
          modelId: model.id,
          number: d.versions.filter((x) => x.modelId === model.id).length + 1,
          spec: target.spec,
          createdAt: now(),
          origin: { kind: "revert", toVersionId: target.id },
          summary: `v${target.number} に戻しました`,
        };
        d.versions.push(v);
        model.currentVersionId = v.id;
        model.title = target.spec.title;
        return v;
      },
      (v) => ({ kind: "version", id: v.id }),
    );
  }

  // ---- agent side: can read everything, can only propose or attach evidence ----

  overview() {
    const s = this.state;
    return {
      models: s.models.map((m) => {
        const cur = this.version(m.currentVersionId);
        return {
          id: m.id,
          title: m.title,
          currentVersion: { id: cur.id, number: cur.number, spec: cur.spec, summary: cur.summary },
          versions: s.versions.filter((v) => v.modelId === m.id).map((v) => ({ id: v.id, number: v.number, summary: v.summary, origin: v.origin })),
          knowledge: s.knowledge.filter((k) => k.modelId === m.id),
          checks: s.checks.filter((check) => check.modelId === m.id),
          checkResults: s.checkResults.filter((result) => result.modelId === m.id).map(({ replicatedValues, ...summary }) => ({
            ...summary, replicationCount: replicatedValues.length,
          })),
          datasets: s.datasets.filter((x) => x.modelId === m.id).map((x) => ({ id: x.id, label: x.label, provenance: x.provenance, note: x.note, plates: x.plates })),
          runs: s.runs
            .filter((r) => r.modelId === m.id)
            .map((r) => ({
              id: r.id, versionId: r.versionId, datasetId: r.datasetId, method: r.method, diagnostics: r.diagnostics,
              draws: Object.values(r.draws)[0]?.length ?? 0, stale: r.versionId !== m.currentVersionId,
            })),
        };
      }),
      pendingIntents: s.intents.filter((i) => i.status === "pending").map((i) => i.id),
      openProposals: s.proposals
        .filter((p) => p.status === "proposed")
        .map((p) => ({ id: p.id, modelId: p.modelId, summary: p.summary, baseVersionId: p.baseVersionId })),
    };
  }

  pendingIntents() {
    return this.state.intents
      .filter((i) => i.status === "pending")
      .map((i) => {
        const v = this.version(i.scene.modelVersionId);
        const worlds = [
          ...new Set(
            i.marks.flatMap((m) => (m.kind === "ridge" ? m.worlds : m.kind === "shape" || m.kind === "bin" ? [] : [m.world])).filter((w): w is number => w !== null),
          ),
        ];
        const run = i.scene.runId ? this.run(i.scene.runId) : null;
        const referencedWorlds = worlds.map((w) => {
          const { compiled, world } = this.worldOf(i.scene, w);
          return summarizeWorld(compiled, world);
        });
        const opened = i.marks.flatMap((m) => {
          if (m.kind !== "point" && m.kind !== "layer") return [];
          const { compiled, world, dataset } = this.worldOf(i.scene, m.world);
          const y = compiled.spec.view.y;
          return [{ mark: m, dataValue: dataset ? (dataset.columns[y]?.[m.unit] ?? null) : null, layers: anatomy(compiled, world, y, m.unit) }];
        });
        const lens =
          run && i.marks.some((m) => m.kind === "ridge") ? identifiability(this.compiled(i.scene.modelVersionId), run) : null;
        const shapes = i.marks.flatMap((m) => {
          if (m.kind !== "shape" && m.kind !== "bin") return [];
          const c = this.compiled(i.scene.modelVersionId);
          const ds = run ? this.dataset(run.datasetId) : null;
          const band = functionBand(c, bandWorlds(c, run, ds, 120), m.arg, m.group);
          // a few points along x are enough for the agent; the person sees the full band
          const step = Math.max(1, Math.floor(band.length / 8));
          const arg = shapeArgs(c).find((a) => a.arg === m.arg);
          return [{
            mark: m,
            modelBand: band.filter((_, k) => k % step === 0).map((b) => ({ x: b.x, q05: b.q[0], q50: b.q[2], q95: b.q[4] })),
            check: run && ds && arg ? binnedCheck(c, run, ds, arg.stat, m.group, 6, 120) : null,
          }];
        });
        return {
          ...i,
          shapes: shapes.length
            ? {
                items: shapes,
                note: "modelBand はモデルが観測の引数に与えている関数（draw 間の 5/50/95%）。shape の points は人が信じる形のなぞり線で、データではない。check は区間ごとの事後予測チェック（新しい個体での複製と同じ統計量）。区間が小さいので偶然外れる区間が出る。",
              }
            : null,
          identifiability: lens && {
            ...lens,
            note: "contraction = 1 − 事後分散/事前分散（正の量は対数尺度）。0 に近い量はデータでほとんど絞られておらず prior が値を決めている。ridges は事後 draw の順位相関。局所的な手がかりで、識別可能性の証明ではない",
          },
          modelVersion: { id: v.id, number: v.number, isCurrent: this.model(v.modelId).currentVersionId === v.id, spec: v.spec },
          source: run
            ? {
                kind: "posterior_predictive", runId: run.id, method: run.method, datasetId: run.datasetId,
                note: "world k は run の joint draw k。観測ノードは draw から再シミュレーションした値。dataValue が実際のデータ",
              }
            : { kind: "prior", note: "world k は prior からの模擬。実データではありません" },
          referencedWorlds,
          opened,
          note:
            "sketch の points は人の身振りであり観測データではありません。[x, y] は view の単位です。" +
            "point / layer は観測点を開いて指したもの。layers はその値を生んだ祖先で、潜在の値は真値ではなく、この世界での値です。" +
            "意味は一つに決めず、候補として返してください。",
        };
      });
  }

  worlds(input: { versionId?: string; proposalId?: string; runId?: string; seed: number; from?: number; count?: number }) {
    const from = input.from ?? 0;
    const count = Math.min(input.count ?? 12, 48);
    if (input.proposalId) {
      const p = this.state.proposals.find((x) => x.id === input.proposalId);
      if (!p) throw new HttpError(404, "提案が見つかりません");
      const compiled = this.compileOrThrow(p.spec, "提案");
      return Array.from({ length: count }, (_, k) => summarizeWorld(compiled, simulateWorld(compiled, input.seed, from + k)));
    }
    let scene: SceneRef;
    if (input.runId) scene = { modelVersionId: this.run(input.runId).versionId, seed: input.seed, runId: input.runId };
    else if (input.versionId) scene = { modelVersionId: input.versionId, seed: input.seed, runId: null };
    else throw new HttpError(400, "versionId・proposalId・runId のどれかを指定してください");
    return Array.from({ length: count }, (_, k) => {
      const { compiled, world } = this.worldOf(scene, from + k);
      return summarizeWorld(compiled, world);
    });
  }

  reply(input: z.infer<typeof AgentReplyInput>) {
    for (const [n, c] of input.candidates.entries()) {
      if (c.edit) this.compileOrThrow(c.edit.spec, `候補 ${n + 1} `);
    }
    if (!input.message.trim() && input.candidates.length === 0) {
      throw new HttpError(400, "message か candidates のどちらかが必要です");
    }
    return this.change(
      (d) => {
        const i = this.intent(d, input.intentId);
        if (i.status !== "pending") throw new HttpError(409, `この意図は ${i.status} です。pending のものにだけ返答できます`);
        if (input.message.trim()) i.thread.push({ from: "agent", text: input.message, at: now() });
        i.candidates = input.candidates.map((c) => ({ ...c, id: newId("cand") }));
        // A message without candidates is a question back to the person.
        i.status = "answered";
        return i;
      },
      (i) => ({ kind: "intent.answered", id: i.id }),
    );
  }

  propose(input: z.infer<typeof AgentProposeInput>) {
    this.compileOrThrow(input.spec, "提案");
    const base = input.modelId ? this.model(input.modelId).currentVersionId : null;
    const known = new Set(this.state.knowledge.map((k) => k.id));
    const unknown = input.knowledgeIds.filter((k) => !known.has(k));
    if (unknown.length) throw new HttpError(400, `知識 ${unknown.join(", ")} が見つかりません`);
    return this.change(
      (d) => {
        const p = {
          id: newId("prp"), modelId: input.modelId, createdAt: now(), baseVersionId: base, spec: input.spec,
          summary: input.summary, knowledgeIds: input.knowledgeIds, intentId: null, status: "proposed" as const,
        };
        d.proposals.push(p);
        return p;
      },
      (p) => ({ kind: "proposal", id: p.id }),
    );
  }

  attachDataset(input: z.infer<typeof AgentDatasetInput>) {
    const m = this.model(input.modelId);
    const problems = datasetProblems(this.version(m.currentVersionId).spec, input);
    if (problems.length) throw new HttpError(400, "データが今の版と合いません", problems);
    return this.change(
      (d) => {
        const ds: Dataset = { ...input, id: newId("ds"), createdAt: now() };
        d.datasets.push(ds);
        return ds;
      },
      (ds) => ({ kind: "dataset", id: ds.id }),
    );
  }

  // Fake-data simulation: generate from a stated truth, then check whether inference recovers it.
  synthesize(input: z.infer<typeof AgentSynthesizeInput>) {
    const m = this.model(input.modelId);
    const spec = this.version(m.currentVersionId).spec;
    const truth = this.compileOrThrow(input.truth, "真の生成過程");
    const sizes = { ...truth.sizes, ...input.plates };
    const w = simulateWorld(truth, input.seed, 0, { sizes });
    if (w.broken) throw new HttpError(400, "真の生成過程から有限の値が得られませんでした");
    const columns: Record<string, number[]> = {};
    for (const d of spec.data) if (w.values[d.name]) columns[d.name] = w.values[d.name];
    for (const n of spec.nodes.filter((x) => x.role === "observed")) if (w.values[n.name]) columns[n.name] = w.values[n.name];
    return this.attachDataset({
      modelId: m.id,
      label: input.label,
      provenance: "synthetic",
      note: [input.note, `seed ${input.seed} で生成`].filter(Boolean).join(" · "),
      plates: Object.fromEntries(spec.plates.map((p) => [p.name, sizes[p.name] ?? p.size])),
      columns,
    });
  }

  inferenceBundle(versionId: string, datasetId: string, backend: "stan" | "numpyro") {
    const v = this.version(versionId);
    const ds = this.dataset(datasetId);
    const problems = datasetProblems(v.spec, ds);
    if (problems.length) throw new HttpError(400, "データがこの版と合いません", problems);
    const dataset = { id: ds.id, plates: ds.plates, columns: ds.columns };
    if (backend === "stan") {
      const { files, warnings } = stanProgram(v.spec, v.id);
      return { backend, files, entry: "run_stan.py", uvWith: ["cmdstanpy"], warnings, dataset };
    }
    const { code, warnings } = numpyroScript(v.spec, v.id);
    return { backend, files: { "model.py": code }, entry: "model.py", uvWith: ["numpyro", "jax"], warnings, dataset };
  }

  attachRun(input: z.infer<typeof AgentRunInput>) {
    const v = this.version(input.versionId);
    const ds = this.dataset(input.datasetId);
    if (ds.modelId !== v.modelId) throw new HttpError(400, "データセットと版が別のモデルです");
    const problems = runProblems(v.spec, ds, input);
    if (problems.length) throw new HttpError(400, "run が版・データと合いません", problems);
    return this.change(
      (d) => {
        const run: Run = { ...input, id: newId("run"), modelId: v.modelId, createdAt: now() };
        d.runs.push(run);
        return run;
      },
      (r) => ({ kind: "run", id: r.id }),
    );
  }

  private checkResult(check: SavedCheck, runId: string, seed: number): SavedCheckResult {
    const run = this.run(runId);
    const version = this.version(run.versionId);
    const dataset = this.dataset(run.datasetId);
    if (check.modelId !== version.modelId || check.modelId !== run.modelId || check.datasetId !== dataset.id) {
      throw new HttpError(400, "保存検査は同じモデル・データセットのrunで再実行してください");
    }
    try {
      const values = evaluateSavedCheck(check, version, dataset, run, seed);
      return { ...values, id: newId("check_result"), checkId: check.id, modelId: version.modelId, versionId: version.id, datasetId: dataset.id, runId: run.id, createdAt: now(), seed };
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "検査を計算できませんでした");
    }
  }

  saveCheck(raw: z.infer<typeof HumanSaveCheckInput>) {
    const input = HumanSaveCheckInput.parse(raw);
    const run = this.run(input.runId);
    const version = this.version(run.versionId);
    const dataset = this.dataset(run.datasetId);
    const view = version.spec.view;
    const x = version.spec.data.find(d => d.name === view.x);
    const y = version.spec.nodes.find(n => n.name === view.y && n.role === "observed");
    const group = version.spec.data.find(d => d.name === view.group);
    if (!x || !y || !Object.hasOwn(dataset.columns, view.x) || !Object.hasOwn(dataset.columns, view.y)) {
      throw new HttpError(400, "検査にはデータセットの直接の入力x列と観測y列が必要です");
    }
    if (input.groupIndex !== null && (!group?.indexOf || !Object.hasOwn(dataset.columns, group.name))) {
      throw new HttpError(400, "群の選択には既知の添字入力列が必要です");
    }
    const check: SavedCheck = {
      id: newId("check"), modelId: version.modelId, datasetId: dataset.id, createdAt: now(),
      label: input.label, xMin: input.xMin, xMax: input.xMax, statistic: input.statistic,
      ...(input.threshold === undefined ? {} : { threshold: input.threshold }),
      x: view.x, y: view.y, xUnit: x.unit, yUnit: y.unit,
      groupColumn: view.group ?? null, groupIndex: input.groupIndex,
    };
    const result = this.checkResult(check, run.id, input.seed);
    return this.change(draft => {
      draft.checks.push(check);
      draft.checkResults.push(result);
      return { check, result };
    }, () => ({ kind: "check", id: check.id }));
  }

  rerunCheck(checkId: string, raw: z.infer<typeof HumanRerunCheckInput>) {
    const input = HumanRerunCheckInput.parse(raw);
    const check = this.state.checks.find(c => c.id === checkId);
    if (!check) throw new HttpError(404, "保存検査が見つかりません");
    const result = this.checkResult(check, input.runId, input.seed);
    return this.change(draft => {
      draft.checkResults.push(result);
      return result;
    }, () => ({ kind: "check.result", id: result.id }));
  }
}
