// The single source of truth: one JSON file, written atomically, with the
// previous version kept as .bak. Every change goes through these functions.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AgentProposeInput,
  AgentReplyInput,
  HumanChooseInput,
  HumanFollowUpInput,
  HumanIntentInput,
  StateSchema,
  emptyState,
  type Intent,
  type ModelSpec,
  type ModelVersion,
  type State,
} from "../shared/contracts.ts";
import { compileSpec, simulateWorld, summarizeWorld } from "../shared/sim.ts";
import { EXAMPLE_SPEC } from "../shared/example.ts";
import type { z } from "zod";

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

  constructor(path: string) {
    this.path = path;
    this.state = this.load();
  }

  private load(): State {
    if (!existsSync(this.path)) return emptyState();
    const raw = readFileSync(this.path, "utf8");
    const parsed = StateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      // Refuse to start rather than overwrite a file we cannot read.
      throw new Error(
        `${this.path} を読めません。ファイルを直すか、別の場所へ移してから起動してください。\n${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  private commit(event: ChangeEvent) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
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

  current(): ModelVersion | null {
    return this.state.versions.find((v) => v.id === this.state.currentVersionId) ?? null;
  }

  private version(id: string): ModelVersion {
    const v = this.state.versions.find((x) => x.id === id);
    if (!v) throw new HttpError(404, `版 ${id} が見つかりません`);
    return v;
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

  // ---- human side ------------------------------------------------------------

  startExample() {
    if (this.state.versions.length) throw new HttpError(409, "すでにモデルがあります");
    return this.change(
      (d) => {
        const v: ModelVersion = {
          id: newId("ver"),
          number: 1,
          spec: EXAMPLE_SPEC,
          createdAt: now(),
          origin: { kind: "example" },
          summary: "模式例から始めました",
        };
        d.versions.push(v);
        d.currentVersionId = v.id;
        return v;
      },
      (v) => ({ kind: "version", id: v.id }),
    );
  }

  createIntent(input: z.infer<typeof HumanIntentInput>) {
    this.version(input.scene.modelVersionId);
    return this.change(
      (d) => {
        const intent: Intent = {
          id: newId("int"),
          createdAt: now(),
          scene: input.scene,
          marks: input.marks,
          thread: [{ from: "human", text: input.utterance, at: now() }],
          status: "pending",
          candidates: [],
          resolution: null,
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
          id: knowledgeId,
          createdAt: now(),
          kind: c.kind,
          statement: c.statement,
          intentId: i.id,
          scene: i.scene,
          marks: i.marks,
          status: "confirmed",
        });
        let proposalId: string | null = null;
        if (c.edit) {
          proposalId = newId("prp");
          d.proposals.push({
            id: proposalId,
            createdAt: now(),
            baseVersionId: d.currentVersionId,
            spec: c.edit.spec,
            summary: c.edit.summary,
            knowledgeIds: [knowledgeId],
            intentId: i.id,
            status: "proposed",
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
        if (p.baseVersionId !== d.currentVersionId) {
          throw new HttpError(409, "この提案は古い版を基にしています。Claude に今の版で出し直してもらってください");
        }
        this.compileOrThrow(p.spec, "提案");
        const v: ModelVersion = {
          id: newId("ver"),
          number: d.versions.length + 1,
          spec: p.spec,
          createdAt: now(),
          origin: { kind: "proposal", proposalId: p.id, knowledgeIds: p.knowledgeIds },
          summary: p.summary,
        };
        d.versions.push(v);
        d.currentVersionId = v.id;
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
    if (target.id === this.state.currentVersionId) throw new HttpError(409, "すでにこの版です");
    return this.change(
      (d) => {
        const v: ModelVersion = {
          id: newId("ver"),
          number: d.versions.length + 1,
          spec: target.spec,
          createdAt: now(),
          origin: { kind: "revert", toVersionId: target.id },
          summary: `v${target.number} に戻しました`,
        };
        d.versions.push(v);
        d.currentVersionId = v.id;
        return v;
      },
      (v) => ({ kind: "version", id: v.id }),
    );
  }

  // ---- agent side: can read everything, can only propose -----------------------

  overview() {
    const cur = this.current();
    return {
      currentVersion: cur ? { id: cur.id, number: cur.number, spec: cur.spec, summary: cur.summary } : null,
      versions: this.state.versions.map((v) => ({ id: v.id, number: v.number, summary: v.summary, origin: v.origin })),
      knowledge: this.state.knowledge,
      pendingIntents: this.state.intents.filter((i) => i.status === "pending").map((i) => i.id),
      openProposals: this.state.proposals
        .filter((p) => p.status === "proposed")
        .map((p) => ({ id: p.id, summary: p.summary, baseVersionId: p.baseVersionId })),
    };
  }

  pendingIntents() {
    return this.state.intents
      .filter((i) => i.status === "pending")
      .map((i) => {
        const v = this.version(i.scene.modelVersionId);
        const compiled = this.compileOrThrow(v.spec, "参照中");
        const worlds = [...new Set(i.marks.map((m) => m.world).filter((w): w is number => w !== null))];
        return {
          ...i,
          modelVersion: { id: v.id, number: v.number, isCurrent: v.id === this.state.currentVersionId, spec: v.spec },
          referencedWorlds: worlds.map((w) => summarizeWorld(compiled, simulateWorld(compiled, i.scene.seed, w))),
          note:
            "sketch の points は人の身振りであり観測データではありません。[x, y] はモデルの単位です。" +
            "意味は一つに決めず、候補として返してください。",
        };
      });
  }

  worlds(input: { versionId?: string; proposalId?: string; seed: number; from?: number; count?: number }) {
    let spec: ModelSpec;
    if (input.proposalId) {
      const p = this.state.proposals.find((x) => x.id === input.proposalId);
      if (!p) throw new HttpError(404, "提案が見つかりません");
      spec = p.spec;
    } else {
      const v = input.versionId ? this.version(input.versionId) : this.current();
      if (!v) throw new HttpError(409, "まだモデルがありません");
      spec = v.spec;
    }
    const compiled = this.compileOrThrow(spec, "対象");
    const from = input.from ?? 0;
    const count = Math.min(input.count ?? 12, 48);
    return Array.from({ length: count }, (_, k) => summarizeWorld(compiled, simulateWorld(compiled, input.seed, from + k)));
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
    const known = new Set(this.state.knowledge.map((k) => k.id));
    const unknown = input.knowledgeIds.filter((k) => !known.has(k));
    if (unknown.length) throw new HttpError(400, `知識 ${unknown.join(", ")} が見つかりません`);
    return this.change(
      (d) => {
        const p = {
          id: newId("prp"),
          createdAt: now(),
          baseVersionId: d.currentVersionId,
          spec: input.spec,
          summary: input.summary,
          knowledgeIds: input.knowledgeIds,
          intentId: null,
          status: "proposed" as const,
        };
        d.proposals.push(p);
        return p;
      },
      (p) => ({ kind: "proposal", id: p.id }),
    );
  }
}
