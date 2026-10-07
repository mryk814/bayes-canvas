import { test } from "node:test";
import assert from "node:assert/strict";
import { JOINT_FIXTURES, queryJoint } from "../lab/joint.ts";
import type { JointDataset } from "../lab/joint.ts";

test("negative dependence uses the same draw and includes endpoint draws", () => {
  const fixture = JOINT_FIXTURES[0];
  const result = queryJoint(fixture.dataset, fixture.conditions);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.totalDraws, 8);
  assert.deepEqual(result.marginals.map((m) => m.probability), [0.5, 0.5]);
  assert.equal(result.joint.probability, 0);
  assert.deepEqual(result.matchedDrawIds, []);
  assert.equal(result.modelRef, fixture.dataset.modelRef);
  assert.equal(result.runRef, fixture.dataset.runRef);
  assert.ok(fixture.dataset.draws.every(({ values }) => values.individual > 0 && values.measurement > 0));
});

test("extreme tails remain in the denominator", () => {
  const result = queryJoint({ modelRef: "tail", runRef: "tail-run", draws: [-1e100, 0, 1e100].map((x, i) => ({ id: String(i), values: { x } })) }, [{ variable: "x", op: "gt", threshold: 1 }]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.totalDraws, 3);
    assert.equal(result.joint.probability, 1 / 3);
    assert.deepEqual(result.matchedDrawIds, ["2"]);
  }
});

test("positive dependence yields a joint probability distinct from the marginal product", () => {
  const fixture = JOINT_FIXTURES[1];
  const result = queryJoint(fixture.dataset, fixture.conditions);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.marginals.map((m) => m.count), [4, 4]);
  assert.equal(result.joint.count, 4);
  assert.equal(result.joint.probability, fixture.expectedJointProbability);
  assert.deepEqual(result.matchedDrawIds, ["ce-5", "ce-6", "ce-7", "ce-8"]);
});

test("threshold boundaries honor strict and inclusive comparisons", () => {
  const dataset: JointDataset = { modelRef: "m", runRef: "r", draws: [-1, 0, 1].map((x, i) => ({ id: String(i), values: { x } })) };
  for (const [op, count] of [["gt", 1], ["gte", 2], ["lt", 1], ["lte", 2]] as const) {
    const result = queryJoint(dataset, [{ variable: "x", op, threshold: 0 }]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.joint.count, count);
  }
});

test("empty draws, missing/non-finite values and invalid provenance reject the query", () => {
  const fixture = JOINT_FIXTURES[0];
  for (const patch of [
    { draws: [] },
    { draws: [{ id: "missing", values: {} }] },
    ...[NaN, Infinity, -Infinity].map((x) => ({ draws: [{ id: "bad", values: { individual: x, measurement: 1 } }] })),
    { modelRef: "" },
    { runRef: " " },
    { draws: [fixture.dataset.draws[0], fixture.dataset.draws[0]] },
  ]) {
    const result = queryJoint({ ...fixture.dataset, ...patch }, fixture.conditions);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.length > 0);
  }
});

test("invalid or empty conditions cannot silently produce a probability", () => {
  const fixture = JOINT_FIXTURES[0];
  for (const conditions of [[], [{ variable: "individual", op: "gt" as const, threshold: NaN }], [{ variable: "", op: "gt" as const, threshold: 0 }]]) {
    assert.equal(queryJoint(fixture.dataset, conditions).ok, false);
  }
});

test("input draws remain unmodified", () => {
  const fixture = structuredClone(JOINT_FIXTURES[1]);
  const before = structuredClone(fixture);
  queryJoint(fixture.dataset, fixture.conditions);
  assert.deepEqual(fixture, before);
});
