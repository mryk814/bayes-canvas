import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, type ChangeEvent } from "../server/store.ts";
import { seedChecksDemo } from "./seed-checks-demo.ts";

function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "prior-proposal-")), "worlds.json");
  return { path, ...seedChecksDemo(path) };
}

test("prior proposal changes only selected arguments; adopt, reject, reload and revert preserve old evidence", () => {
  const { path, store, examples } = fixture();
  for (const f of examples) {
    const before = structuredClone(store.state);
    const proposal = store.proposePrior({ baseVersionId: f.second.id, nodeName: "s20", args: { mu: 510, sigma: 60 }, reason: "  高温域を見る前に基準強度を試す  " });
    const expected = structuredClone(f.second.spec);
    expected.nodes.find(n => n.name === "s20")!.dist!.args = { mu: "510", sigma: "60" };
    assert.deepEqual(proposal.spec, expected);
    assert.equal(proposal.baseVersionId, f.second.id);
    assert.deepEqual(proposal.knowledgeIds, []);
    assert.ok(proposal.summary.includes("s20")); assert.ok(proposal.summary.includes("高温域を見る前に基準強度を試す"));
    for (const key of ["models", "versions", "datasets", "runs", "checks", "checkResults", "knowledge", "intents"] as const) assert.deepEqual(store.state[key], before[key]);
    const adopted = store.adopt(proposal.id);
    assert.deepEqual(adopted.spec, expected);
    assert.deepEqual(store.state.runs, before.runs);
    const other = store.proposePrior({ baseVersionId: adopted.id, nodeName: "s20", args: { mu: 520, sigma: 60 }, reason: "別案" });
    store.reject(other.id);
    assert.equal(store.state.models.find(model => model.id === f.model.id)!.currentVersionId, adopted.id);
    assert.deepEqual(new Store(path).version(adopted.id).spec, expected);
    assert.deepEqual(store.revert(f.second.id).spec, f.second.spec);
    assert.deepEqual(store.state.datasets, before.datasets); assert.deepEqual(store.state.runs, before.runs);
  }
  assert.deepEqual(new Store(path).state, store.state);
});

test("invalid, identical and stale prior proposals leave memory, file and events unchanged", () => {
  const { path, store, examples } = fixture(), f = examples[0];
  const input = { baseVersionId: f.second.id, nodeName: "s20", args: { mu: 510, sigma: 60 }, reason: "変更理由" };
  const currentArgs = Object.fromEntries(Object.entries(f.second.spec.nodes.find(n => n.name === "s20")!.dist!.args).map(([k, v]) => [k, Number(v)]));
  const events: ChangeEvent[] = []; store.subscribe(event => events.push(event));
  const memory = structuredClone(store.state), disk = readFileSync(path, "utf8");
  for (const bad of [
    { ...input, spec: f.second.spec }, { ...input, modelId: f.model.id }, { ...input, reason: " " }, { ...input, reason: "x".repeat(2001) },
    { ...input, args: currentArgs }, { ...input, args: {} }, { ...input, args: { mu: "510", sigma: 60 } },
    { ...input, args: { mu: 510, sigma: -1 } }, { ...input, args: { mu: Infinity, sigma: 60 } },
    { ...input, args: { mu: 510, sigma: 60, extra: 1 } }, { ...input, nodeName: "missing" },
    { ...input, nodeName: "strength" }, { ...input, baseVersionId: f.first.id },
  ]) {
    assert.throws(() => store.proposePrior(bad));
    assert.deepEqual(store.state, memory); assert.equal(readFileSync(path, "utf8"), disk); assert.deepEqual(events, []);
  }
  assert.throws(() => store.proposePrior({ ...input, baseVersionId: f.first.id }), { status: 409 });
  assert.throws(() => store.proposePrior({ ...input, args: { mu: 510, sigma: -1 } }), { status: 400 });
});
