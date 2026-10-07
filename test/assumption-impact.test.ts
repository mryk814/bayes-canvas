import { test } from "node:test";
import assert from "node:assert/strict";
import { structuralImpact, assumptionImpact } from "../shared/assumption-impact.ts";
import { CURVE_EXAMPLE, OBSERVATION_EXAMPLE } from "../shared/example.ts";
import { emptyState } from "../shared/contracts.ts";

test("parameter changes trace downstream observations and view roles, metadata does not", () => {
  const after = structuredClone(CURVE_EXAMPLE);
  after.nodes.find(n => n.name === "s20")!.dist!.args.mu = "500";
  after.nodes.find(n => n.name === "sigma")!.note = "explanation only";
  const impact = structuralImpact(CURVE_EXAMPLE, after);
  assert.equal(impact.ok, true);
  const parameter = impact.changes.find(c => c.name === "s20")!;
  assert.ok(parameter.downstream.includes("strength"));
  assert.deepEqual(parameter.observed, ["strength"]);
  assert.ok(parameter.views.includes("y"));
  const metadata = impact.changes.find(c => c.name === "sigma")!;
  assert.equal(metadata.kind, "metadata");
  assert.deepEqual(metadata.observed, []);
});

test("input generation, plate size and indexing dependencies trace correctly", () => {
  const after = structuredClone(OBSERVATION_EXAMPLE);
  after.data.find(d => d.name === "machine_of")!.generate = { kind: "values", values: [0] };
  after.plates.find(p => p.name === "machine")!.size = 4;
  const impact = structuralImpact(OBSERVATION_EXAMPLE, after);
  assert.equal(impact.ok, true);
  assert.ok(impact.changes.find(c => c.name === "machine_of")!.observed.includes("recorded"));
  assert.ok(impact.changes.find(c => c.name === "machine")!.observed.includes("recorded"));
});

test("censor threshold dependencies reach the recorded observation and y view, not latent strength", () => {
  const before = structuredClone(OBSERVATION_EXAMPLE);
  before.nodes.unshift({ name: "limit", label: "記録上限", unit: "MPa", plate: null, role: "deterministic", expr: "520", note: "" });
  before.nodes.find(n => n.name === "recorded")!.censorAbove = "limit";
  const after = structuredClone(before);
  after.nodes.find(n => n.name === "limit")!.expr = "500";
  const impact = structuralImpact(before, after);
  assert.equal(impact.ok, true);
  assert.equal(impact.changes.length, 1);
  const change = impact.changes[0];
  assert.equal(change.name, "limit");
  assert.deepEqual(change.downstream, ["recorded"]);
  assert.deepEqual(change.observed, ["recorded"]);
  assert.deepEqual(change.views, ["y"]);
  assert.equal(change.downstream.includes("true_strength"), false);
});

test("removed nodes retain the old dependency path; invalid specs report unknown", () => {
  const after = structuredClone(CURVE_EXAMPLE);
  after.nodes = after.nodes.filter(n => n.name !== "s20");
  for (const n of after.nodes) if (n.expr) n.expr = n.expr.replaceAll("s20", "400");
  const impact = structuralImpact(CURVE_EXAMPLE, after);
  assert.equal(impact.ok, true);
  assert.ok(impact.changes.find(c => c.name === "s20")!.observed.includes("strength"));
  after.nodes.find(n => n.name === "strength")!.dist!.args.mu = "unknown";
  assert.equal(structuralImpact(CURVE_EXAMPLE, after).ok, false);
});

test("view-only changes name only the changed display role and have no numeric downstream", () => {
  const after = structuredClone(CURVE_EXAMPLE);
  after.view.line = after.view.y;
  const change = structuralImpact(CURVE_EXAMPLE, after).changes[0];
  assert.equal(change.kind, "view");
  assert.deepEqual(change.views, ["line"]);
  assert.deepEqual(change.observed, []);
  assert.deepEqual(change.downstream, []);
});

test("change records carry their exact before and after entries, including metadata and removals", () => {
  const before = structuredClone(CURVE_EXAMPLE);
  const after = structuredClone(before);
  after.title = "new title";
  after.nodes.find(n => n.name === "sigma")!.note = "new explanation";
  after.nodes = after.nodes.filter(n => n.name !== "s20");
  for (const n of after.nodes) if (n.expr) n.expr = n.expr.replaceAll("s20", "400");
  const changes = structuralImpact(before, after).changes;
  const sigma = changes.find(c => c.name === "sigma")!;
  assert.equal(sigma.before, JSON.stringify(before.nodes.find(n => n.name === "sigma"), null, 2));
  assert.equal(sigma.after, JSON.stringify(after.nodes.find(n => n.name === "sigma"), null, 2));
  assert.equal(changes.find(c => c.name === "s20")!.after, "なし");
  assert.equal(changes.find(c => c.name === "model")!.after, JSON.stringify({ title: after.title, question: after.question }, null, 2));
});

test("question contracts add, change and remove exact metadata without numeric impact", () => {
  const contract = { population: "対象の試料", estimand: "温度による平均強度差 MPa", decision: "今回は記述のみ" };
  const withContract = { ...structuredClone(CURVE_EXAMPLE), questionContract: contract };
  const revised = { ...withContract, question: "新しい問い", questionContract: { ...contract, decision: "追加測定の判断に使う" } };
  for (const [before, after] of [[CURVE_EXAMPLE, withContract], [withContract, revised], [withContract, CURVE_EXAMPLE], [null, withContract]] as const) {
    const impact = structuralImpact(before, after);
    assert.equal(impact.ok, true);
    const change = impact.changes.find(c => c.name === "questionContract");
    assert.ok(change);
    assert.equal(change.kind, "metadata");
    assert.equal(change.before, before && "questionContract" in before ? JSON.stringify(before.questionContract, null, 2) : "なし");
    assert.equal(change.after, "questionContract" in after ? JSON.stringify(after.questionContract, null, 2) : "なし");
    assert.deepEqual(change.downstream, []);
    assert.deepEqual(change.observed, []);
    assert.deepEqual(change.views, []);
  }
  const questionChange = structuralImpact(withContract, revised).changes.find(c => c.name === "model")!;
  assert.equal(questionChange.kind, "metadata");
  assert.deepEqual(questionChange.downstream, []);
  assert.equal(JSON.parse(questionChange.after).question, revised.question);
  assert.deepEqual(structuralImpact(withContract, structuredClone(withContract)).changes, []);
});

function stateFixture() {
  const state = emptyState();
  const common = { modelId: "m", createdAt: "", summary: "" };
  state.models.push({ id: "m", title: "m", currentVersionId: "v3", createdAt: "" });
  state.knowledge.push(...["k1", "k2"].map(id => ({ id, modelId: "m", createdAt: "", kind: "hypothesis" as const, statement: id, intentId: null, scene: null, marks: [], status: "confirmed" as const })));
  const after = structuredClone(CURVE_EXAMPLE); after.nodes[0].dist!.args.mu = "500";
  state.versions.push({ ...common, id: "v1", number: 1, spec: CURVE_EXAMPLE, origin: { kind: "example", exampleId: "curve" } },
    { ...common, id: "v2", number: 2, spec: after, origin: { kind: "proposal", proposalId: "p", knowledgeIds: ["k1", "k2"] } },
    { ...common, id: "v3", number: 3, spec: after, origin: { kind: "revert", toVersionId: "v2" } });
  state.proposals.push({ id: "p", modelId: "m", createdAt: "", baseVersionId: "v1", spec: after, summary: "", knowledgeIds: ["k1", "k2"], intentId: null, status: "adopted" });
  return state;
}

test("adoption retains joint grounds and traces reverts to the source proposal", () => {
  const state = stateFixture();
  const report = assumptionImpact(state, "m");
  assert.deepEqual(report.problems, []);
  const adoptions = report.knowledge[0].adoptions;
  assert.deepEqual(adoptions.map(a => a.versionId), ["v2", "v3"]);
  assert.deepEqual(adoptions[0].knowledgeIds, ["k1", "k2"]);
  assert.equal(adoptions[1].sourceVersionId, "v2");
  assert.equal(adoptions[1].baseVersionId, "v1");
  assert.equal(adoptions[1].reverted, true);
  assert.equal(adoptions[1].current, true);
});

test("withdrawing knowledge preserves historical adoption and metadata references", () => {
  const state = stateFixture();
  state.knowledge[0].status = "withdrawn";
  const report = assumptionImpact(state, "m");
  assert.equal(report.knowledge[0].status, "withdrawn");
  assert.equal(report.knowledge[0].adoptions.length, 2);
  assert.equal(report.knowledge[0].adoptions[0].impact.ok, true);
});

test("missing or foreign references and revert cycles never fabricate known impact", () => {
  for (const mode of ["missing", "foreign", "cycle"]) {
    const state = stateFixture();
    if (mode === "missing") state.proposals = [];
    if (mode === "foreign") state.proposals[0].modelId = "foreign";
    if (mode === "cycle") state.versions[2].origin = { kind: "revert", toVersionId: "v3" };
    const report = assumptionImpact(state, "m");
    assert.ok(report.problems.length > 0);
    if (mode !== "cycle") assert.ok(report.knowledge[0].adoptions.every(a => !a.impact.ok));
  }
  assert.deepEqual(assumptionImpact(stateFixture(), "foreign").knowledge, []);
});

test("a matching final revert cannot hide an inconsistent intermediate revert", () => {
  const state = stateFixture();
  const adopted = structuredClone(state.versions[1].spec);
  state.versions[2].spec = structuredClone(adopted);
  state.versions[2].spec.nodes[0].dist!.args.mu = "900";
  state.versions.push({ ...state.versions[2], id: "v4", number: 4, spec: adopted, origin: { kind: "revert", toVersionId: "v3" } });
  state.models[0].currentVersionId = "v4";
  const report = assumptionImpact(state, "m");
  const final = report.knowledge[0].adoptions.find(a => a.versionId === "v4");
  assert.ok(final);
  assert.equal(final.impact.ok, false);
  assert.ok(report.problems.length > 0);
});
