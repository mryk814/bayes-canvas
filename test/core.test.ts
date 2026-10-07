import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, parseExpr } from "../shared/expr.ts";
import { compileSpec, diffSpecs, simulateWorld } from "../shared/sim.ts";
import { EXAMPLE_SPEC } from "../shared/example.ts";
import { HttpError, Store } from "../server/store.ts";

test("expressions follow precedence and reject unknown functions", () => {
  assert.equal(evaluate(parseExpr("2 + 3 * 4 ^ 2"), {}), 50);
  assert.equal(evaluate(parseExpr("-2 ^ 2"), {}), -4);
  assert.equal(evaluate(parseExpr("max(a, 3) / 2"), { a: 7 }), 3.5);
  assert.throws(() => parseExpr("system(1)"), /使えません/);
  assert.throws(() => parseExpr("1 +"), /途中/);
});

test("worlds are reproducible from (spec, seed, index)", () => {
  const r = compileSpec(EXAMPLE_SPEC);
  assert.ok(r.ok);
  const a = simulateWorld(r.compiled, 42, 3);
  const b = simulateWorld(r.compiled, 42, 3);
  const c = simulateWorld(r.compiled, 43, 3);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.params, c.params);
});

test("compileSpec explains unresolved names and broken priors", () => {
  const bad = compileSpec({ ...EXAMPLE_SPEC, mean: "s20 + k * T" });
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.problems.join() : "", /k はパラメータにも x にもありません/);
  const broken = compileSpec({ ...EXAMPLE_SPEC, noise: { family: "normal", sigma: "-sigma - 1" } });
  assert.equal(broken.ok, false);
});

test("diffSpecs speaks in model terms", () => {
  const next = structuredClone(EXAMPLE_SPEC);
  next.params[1].prior = { family: "normal", mu: -0.5, sigma: 0.3 };
  const changes = diffSpecs(EXAMPLE_SPEC, next);
  assert.deepEqual(changes.map((c) => c.what), ["slope の prior"]);
});

function freshStore() {
  return new Store(join(mkdtempSync(join(tmpdir(), "worlds-")), "worlds.json"));
}

test("the full loop: point → candidates → choose → adopt → reload", () => {
  const store = freshStore();
  const v1 = store.startExample();
  const intent = store.createIntent({
    scene: { modelVersionId: v1.id, seed: 7 },
    marks: [{ kind: "verdict", world: 2, verdict: "implausible" }],
    utterance: "高温で強度が上がるのはおかしい",
  });

  const [pending] = store.pendingIntents();
  assert.equal(pending.id, intent.id);
  assert.equal(pending.referencedWorlds[0].world, 2);

  const next = structuredClone(EXAMPLE_SPEC);
  next.params[1].prior = { family: "normal", mu: -0.6, sigma: 0.3 };
  store.reply({
    intentId: intent.id,
    message: "",
    candidates: [
      { label: "下がる向きの prior", kind: "prior_knowledge", statement: "温度が上がると強度は下がる", reasoning: "", edit: { spec: next, summary: "slope を負に寄せる" } },
      { label: "測定の問題", kind: "hypothesis", statement: "高温側の測定が不安定", reasoning: "" },
    ],
  });
  const answered = store.state.intents[0];
  assert.equal(answered.status, "answered");

  const { knowledgeId, proposalId } = store.choose(intent.id, { candidateId: answered.candidates[0].id });
  assert.ok(proposalId);
  const v2 = store.adopt(proposalId!);
  assert.equal(v2.number, 2);
  assert.deepEqual(v2.origin, { kind: "proposal", proposalId, knowledgeIds: [knowledgeId] });

  // survives a restart
  const reloaded = new Store(store.path);
  assert.equal(reloaded.state.currentVersionId, v2.id);
  assert.equal(reloaded.state.knowledge[0].statement, "温度が上がると強度は下がる");
  assert.equal(reloaded.state.intents[0].status, "resolved");
});

test("stale proposals are refused", () => {
  const store = freshStore();
  const v1 = store.startExample();
  const a = store.propose({ spec: EXAMPLE_SPEC, summary: "A", knowledgeIds: [] });
  const b = store.propose({ spec: EXAMPLE_SPEC, summary: "B", knowledgeIds: [] });
  store.adopt(a.id);
  assert.throws(() => store.adopt(b.id), (e: unknown) => e instanceof HttpError && e.status === 409);
  assert.notEqual(store.state.currentVersionId, v1.id);
});

test("invalid agent edits are rejected without changing state", () => {
  const store = freshStore();
  const v1 = store.startExample();
  const intent = store.createIntent({ scene: { modelVersionId: v1.id, seed: 1 }, marks: [], utterance: "?" });
  const before = JSON.stringify(store.state);
  assert.throws(
    () =>
      store.reply({
        intentId: intent.id,
        message: "",
        candidates: [{ label: "x", kind: "constraint", statement: "x", reasoning: "", edit: { spec: { ...EXAMPLE_SPEC, mean: "nope(" }, summary: "x" } }],
      }),
    HttpError,
  );
  assert.equal(JSON.stringify(store.state), before);
});

test("an unreadable data file stops startup instead of being overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "worlds-"));
  const path = join(dir, "worlds.json");
  writeFileSync(path, JSON.stringify({ schema: "something-else" }));
  assert.throws(() => new Store(path), /読めません/);
  assert.equal(readFileSync(path, "utf8"), JSON.stringify({ schema: "something-else" }));
});
