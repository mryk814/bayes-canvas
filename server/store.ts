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
  StateSchema,
  emptyState,
  type Dataset,
  type Intent,
  type Model,
  type ModelSpec,
  type ModelVersion,
  type Run,
  type SceneRef,
  type State,
} from "../shared/contracts.ts";
import { anatomy, compileSpec, runInputs, simulateWorld, summarizeWorld, type Compiled, type World } from "../shared/sim.ts";
import { EXAMPLES } from "../shared/example.ts";
import { numpyroScript } from "../shared/codegen.ts";
import { stanProgram } from "../shared/stan.ts";
import { migrate } from "./migrate.ts";

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

// Which nodes a run must carry: everything unobserved that is sampled.
export function runSites(spec: ModelSpec) {
  return spec.nodes.filter((n) => n.role === "param" || n.role === "latent");
}

// A dataset fits a spec when every known input and every observation is present with the right length.
export function datasetProblems(spec: ModelSpec, ds: Pick<Dataset, "plates" | "columns">): string[] {
  const problems: string[] = [];
  for (const p of spec.plates) if (!(p.name in ds.plates)) problems.push(`データにプレート ${p.name} の大きさがありません`);
  const need = [
    ...spec.data.map((d) => ({ name: d.name, plate: d.plate as string | null, indexOf: d.indexOf })),
    ...spec.nodes.filter((n) => n.role === "observed").map((n) => ({ name: n.name, plate: n.plate, indexOf: null as string | null })),
  ];
  for (const c of need) {
    const col = ds.columns[c.name];
    const size = c.plate ? ds.plates[c.plate] : 1;
    if (!col) problems.push(`データに列 ${c.name} がありません`);
    else if (col.length !== size) problems.push(`列 ${c.name} の長さ ${col.length} が ${c.plate} の大きさ ${size} と合いません`);
    else if (c.indexOf) {
      const m = ds.plates[c.indexOf] ?? 0;
      if (col.some((v) => !Number.isInteger(v) || v < 0 || v >= m)) problems.push(`添字の列 ${c.name} は 0〜${m - 1} の整数にしてください`);
    }
  }
  return problems;
}

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

  private commit(event: ChangeEvent) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state), "utf8");
    if (existsSync(this.path)) copyFileSync(this.path, `${this.path}.bak`);
    renameSync(tmp, this.path);
    for (const l of this.listeners) l(event);
  }

  // Mutate a draft; only a fully successful change is saved and published.
  private change<T>(fn: (draft: State) => T, event: (result: T) => ChangeEvent): T {
    const draft = structuredClone(this.state);
    const result = fn(draft);
    this.state = StateSchema.parse(draft);
    this.commit(event(result));
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
        const worlds = [...new Set(i.marks.map((m) => m.world).filter((w): w is number => w !== null))];
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
        return {
          ...i,
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
    const problems = datasetProblems(v.spec, ds);
    const sites = runSites(v.spec);
    let k: number | null = null;
    for (const n of sites) {
      const draws = input.draws[n.name];
      const size = n.plate ? ds.plates[n.plate] : 1;
      if (!draws) {
        problems.push(`draws に ${n.name} がありません`);
        continue;
      }
      if (k === null) k = draws.length;
      if (draws.length !== k) problems.push(`${n.name} の draw 数 ${draws.length} が他と揃っていません（${k}）`);
      if (draws.some((row) => row.length !== size)) problems.push(`${n.name} の各 draw は長さ ${size} にしてください`);
    }
    if (k !== null && (k < 1 || k > 1000)) problems.push("draw 数は 1〜1000 にしてください");
    for (const name of Object.keys(input.draws)) {
      if (!sites.some((n) => n.name === name)) problems.push(`${name} はこの版のパラメータ・潜在変数ではありません`);
    }
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
}
