import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedChecksDemo } from "./seed-checks-demo.ts";
import { Store } from "../server/store.ts";
import { diffSpecs } from "../shared/sim.ts";
import { createCapsule, readCapsule } from "../shared/capsule.ts";
import { ModelSpecSchema } from "../shared/contracts.ts";

const contract = { population: "この材料の試料", estimand: "200°Cでの平均記録強度（MPa）", decision: "探索のため。合否判定には使わない" };
function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "question-contract-")), "worlds.json");
  const { store, examples } = seedChecksDemo(path);
  return { path, store, f: examples[0] };
}

test("question proposal changes only purpose, then existing adopt/reject/revert retain version-bound evidence and metadata", () => {
  const { path, store, f } = fixture();
  const before = structuredClone(store.state);
  const proposal = store.proposeQuestionContract({ baseVersionId: f.second.id, question: "  200°Cの記録値はどれくらいか  ", questionContract: { ...contract, population: "  この材料の試料  " } });
  assert.equal(proposal.baseVersionId, f.second.id);
  assert.equal(proposal.status, "proposed");
  assert.deepEqual(proposal.spec, { ...f.second.spec, question: "200°Cの記録値はどれくらいか", questionContract: contract });
  for (const key of ["models", "versions", "datasets", "runs", "checks", "checkResults", "knowledge", "intents"] as const) assert.deepEqual(store.state[key], before[key]);
  const adopted = store.adopt(proposal.id);
  assert.deepEqual(adopted.spec.questionContract, contract);
  assert.deepEqual(store.state.runs, before.runs);
  const other = store.proposeQuestionContract({ baseVersionId: adopted.id, question: "別の問い", questionContract: contract });
  store.reject(other.id);
  assert.equal(store.state.models.find(m => m.id === f.model.id)!.currentVersionId, adopted.id);
  const loaded = new Store(path);
  assert.deepEqual(loaded.version(adopted.id).spec.questionContract, contract);
  assert.deepEqual(loaded.overview().models.find(m => m.id === f.model.id)!.currentVersion.spec.questionContract, contract);
  const run = loaded.attachRun({ ...f.secondRun, versionId: adopted.id });
  const capsule = createCapsule(adopted, f.dataset, run);
  const read = readCapsule(JSON.parse(JSON.stringify(capsule)));
  assert.ok(read.ok); if (read.ok) assert.deepEqual(read.capsule.modelVersion.spec.questionContract, contract);
  assert.deepEqual(loaded.importCapsule(capsule).version.spec.questionContract, contract);
  assert.equal(loaded.revert(f.second.id).spec.questionContract, undefined);
  assert.deepEqual(loaded.revert(adopted.id).spec.questionContract, contract);
  assert.equal(ModelSpecSchema.parse(f.second.spec).questionContract, undefined);
});

test("invalid, stale and identical question proposals preserve memory and disk", () => {
  const { path, store, f } = fixture();
  const input = { baseVersionId: f.second.id, question: "問い", questionContract: contract };
  const version = store.adopt(store.proposeQuestionContract(input).id);
  const current = { ...input, baseVersionId: version.id };
  const disk = readFileSync(path, "utf8"), memory = structuredClone(store.state);
  for (const invalid of [input, current, { ...current, question: " " }, { ...current, question: "x".repeat(2001) },
    { ...current, questionContract: { ...contract, estimand: "" } }, { ...current, questionContract: { ...contract, decision: "x".repeat(2001) } },
    { ...current, questionContract: { ...contract, extra: "ignored?" } }, { ...current, spec: f.second.spec }, { ...current, modelId: f.model.id }]) {
    assert.throws(() => store.proposeQuestionContract(invalid));
    assert.deepEqual(store.state, memory);
    assert.equal(readFileSync(path, "utf8"), disk);
  }
  assert.throws(() => store.proposeQuestionContract(input), { status: 409 });
});

test("semantic diff exposes question and all three contract fields including removal", () => {
  const { f } = fixture();
  const next = { ...f.second.spec, question: "新しい問い", questionContract: contract };
  const added = diffSpecs(f.second.spec, next);
  assert.equal(added.length, 4);
  for (const value of [next.question, ...Object.values(contract)]) assert.ok(added.some(change => change.after === value));
  const removed = diffSpecs(next, f.second.spec);
  for (const value of Object.values(contract)) assert.ok(removed.some(change => change.before === value && change.after === "なし"));
  assert.equal(diffSpecs(next, { ...next, questionContract: { ...contract, decision: "次の実験を選ぶ" } }).length, 1);
  for (const text of ["なし", "未設定"]) {
    const withText = { ...f.second.spec, questionContract: { population: text, estimand: text, decision: text } };
    assert.equal(diffSpecs(f.second.spec, withText).length, 3);
    assert.equal(diffSpecs(withText, f.second.spec).length, 3);
  }
});
