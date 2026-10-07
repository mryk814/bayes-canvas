import { ModelSpecSchema, type ModelSpec, type State } from "./contracts.ts";
import { refs } from "./expr.ts";
import { compileSpec } from "./sim.ts";

export type ImpactChange = {
  kind: "node" | "data" | "plate" | "view" | "metadata";
  name: string; label: string;
  before: string; after: string;
  downstream: string[]; observed: string[]; views: string[];
};
export type StructuralImpact = { ok: boolean; changes: ImpactChange[]; problems: string[] };
const unknown = (problem: string): StructuralImpact => ({ ok: false, changes: [], problems: [problem] });
const key = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const structure = ({ label, unit, note, ...rest }: { label?: string; unit?: string; note?: string; [name: string]: unknown }) => rest;

/** Union of reachability in each original graph, never a numeric or causal effect. */
export function structuralImpact(before: ModelSpec | null, after: ModelSpec): StructuralImpact {
  const graphs: { spec: ModelSpec; edges: Map<string, Set<string>> }[] = [];
  for (const raw of [before, after]) {
    if (raw === null) continue;
    const parsed = ModelSpecSchema.safeParse(raw);
    if (!parsed.success) return unknown("モデルの形式が不正なため影響先は不明です。");
    const compiled = compileSpec(parsed.data);
    if (!compiled.ok) return { ok: false, changes: [], problems: compiled.problems };
    const edges = new Map<string, Set<string>>();
    const edge = (from: string, to: string) => { if (!edges.has(from)) edges.set(from, new Set()); edges.get(from)!.add(to); };
    for (const d of compiled.compiled.data) { edge(`plate:${d.plate}`, d.name); if (d.indexOf) edge(`plate:${d.indexOf}`, d.name); }
    for (const n of compiled.compiled.nodes) {
      if (n.node.plate) edge(`plate:${n.node.plate}`, n.node.name);
      for (const expr of [...Object.values(n.args), n.expr, n.censor]) if (expr) {
        for (const ref of refs(expr)) { edge(ref.name, n.node.name); if (ref.index) edge(ref.index, n.node.name); }
      }
    }
    graphs.push({ spec: parsed.data, edges });
  }
  const changes: ImpactChange[] = [];
  function add(kind: ImpactChange["kind"], name: string, label: string, old: unknown, next: unknown) {
    const downstream = new Set<string>(), observed = new Set<string>(), views = new Set<string>();
    if (kind !== "metadata") for (const { spec, edges } of graphs) {
      const root = kind === "plate" ? `plate:${name}` : name;
      const reached = new Set<string>(kind === "view" ? [] : [root]);
      const queue = [...reached];
      for (let i = 0; i < queue.length; i++) for (const next of edges.get(queue[i]) ?? []) {
        if (!reached.has(next)) { reached.add(next); queue.push(next); }
      }
      for (const next of reached) if (next !== root) downstream.add(next);
      for (const node of spec.nodes) if (node.role === "observed" && reached.has(node.name)) observed.add(node.name);
      for (const [role, target] of Object.entries(spec.view)) {
        const changedRole = before?.view[role as keyof ModelSpec["view"]] !== after.view[role as keyof ModelSpec["view"]];
        if (kind === "view" ? changedRole : reached.has(target)) views.add(role);
      }
    }
    changes.push({ kind, name, label, before: old === undefined ? "なし" : JSON.stringify(old, null, 2),
      after: next === undefined ? "なし" : JSON.stringify(next, null, 2),
      downstream: [...downstream].sort(), observed: [...observed].sort(), views: [...views].sort() });
  }
  for (const [kind, collection] of [["node", "nodes"], ["data", "data"], ["plate", "plates"]] as const) {
    const old = new Map((before?.[collection] ?? []).map(item => [item.name, item]));
    const next = new Map(after[collection].map(item => [item.name, item]));
    for (const name of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(name), b = next.get(name);
      if (key(a) === key(b)) continue;
      add(!a || !b || key(structure(a)) !== key(structure(b)) ? kind : "metadata", name, (b ?? a)!.label, a, b);
    }
  }
  if (key(before?.view) !== key(after.view)) add("view", "view", "表示する量", before?.view, after.view);
  if (before && (before.title !== after.title || before.question !== after.question)) add("metadata", "model", "題・問い",
    { title: before.title, question: before.question }, { title: after.title, question: after.question });
  if (key(before?.questionContract) !== key(after.questionContract)) add("metadata", "questionContract", "問いの契約",
    before?.questionContract, after.questionContract);
  return { ok: true, changes, problems: [] };
}

export type AdoptionImpact = {
  versionId: string; versionNumber: number; sourceVersionId: string; baseVersionId: string | null;
  reverted: boolean; current: boolean; knowledgeIds: string[]; impact: StructuralImpact;
};

export function assumptionImpact(state: State, modelId: string) {
  const knowledge = state.knowledge.filter(k => k.modelId === modelId).map(k => ({
    knowledgeId: k.id, statement: k.statement, status: k.status, adoptions: [] as AdoptionImpact[],
  }));
  const problems: string[] = [];
  const model = state.models.find(m => m.id === modelId);
  if (!model) return { knowledge, problems: ["モデル参照が見つかりません。"] };
  for (const version of state.versions.filter(v => v.modelId === modelId)) {
    let source = version;
    let inconsistentRevert = false;
    const visited = new Set<string>();
    while (source.origin.kind === "revert" && !visited.has(source.id)) {
      visited.add(source.id);
      const targetId = source.origin.toVersionId;
      const target = state.versions.find(v => v.id === targetId && v.modelId === modelId);
      if (!target) break;
      if (key(source.spec) !== key(target.spec)) inconsistentRevert = true;
      source = target;
    }
    if (source.origin.kind === "revert") { problems.push(`版 ${version.id}: 戻し先が欠落または循環しています。`); continue; }
    if (source.origin.kind !== "proposal") {
      if (inconsistentRevert) problems.push(`版 ${version.id}: 戻し先のモデルと一致しません。`);
      continue;
    }
    const origin = source.origin;
    const proposal = state.proposals.find(p => p.id === origin.proposalId && p.modelId === modelId);
    const base = proposal?.baseVersionId ? state.versions.find(v => v.id === proposal.baseVersionId && v.modelId === modelId) : null;
    const known = new Set(knowledge.map(k => k.knowledgeId));
    let impact: StructuralImpact;
    if (inconsistentRevert || !proposal || proposal.status !== "adopted" || (proposal.baseVersionId && !base) ||
        origin.knowledgeIds.some(id => !known.has(id)) || key([...origin.knowledgeIds].sort()) !== key([...proposal.knowledgeIds].sort()) ||
        key(source.spec) !== key(proposal.spec) || key(version.spec) !== key(source.spec)) {
      impact = unknown(`版 ${version.id}: 根拠・提案・基点・戻し先の対応を確認できません。`);
    } else impact = structuralImpact(base?.spec ?? null, source.spec);
    if (!impact.ok) problems.push(...impact.problems);
    const adoption: AdoptionImpact = { versionId: version.id, versionNumber: version.number, sourceVersionId: source.id,
      baseVersionId: proposal?.baseVersionId ?? null, reverted: source.id !== version.id, current: version.id === model.currentVersionId,
      knowledgeIds: [...origin.knowledgeIds], impact };
    for (const item of knowledge) if (origin.knowledgeIds.includes(item.knowledgeId)) item.adoptions.push(adoption);
  }
  return { knowledge, problems: [...new Set(problems)] };
}
