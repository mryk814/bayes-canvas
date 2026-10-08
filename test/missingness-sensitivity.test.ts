import test from "node:test";
import assert from "node:assert/strict";
import { missingnessSensitivity, type SensitivityRow } from "../shared/missingness-sensitivity.ts";

const rows: SensitivityRow[] = [
  { id: "observed", outcome: 10, weight: 2 },
  { id: "missing", outcome: null, baselineMean: 20, weight: 3 },
];

test("weighted delta scenarios shift only missing expectations and use a strict mean threshold", () => {
  const result = missingnessSensitivity(rows, [-10, 0, 10], 16);
  assert.deepEqual(result.scenarios, [
    { delta: -10, weightedMean: 10, exceedsThreshold: false },
    { delta: 0, weightedMean: 16, exceedsThreshold: false },
    { delta: 10, weightedMean: 22, exceedsThreshold: true },
  ]);
  assert.deepEqual(result.counts, { total: 2, observed: 1, missing: 1 });
  assert.equal(result.totalWeight, 5);
  assert.equal(result.observedWeight, 2);
  assert.equal(result.missingWeight, 3);
  assert.equal(result.missingWeightFraction, 0.6);
  assert.equal(result.observedOnlyMean, 10);
  assert.equal(result.threshold, 16);
});

test("all-missing scenarios require baselines but have no observed-only estimate", () => {
  const result = missingnessSensitivity([{ id: "a", outcome: null, baselineMean: 2 }, { id: "b", outcome: null, baselineMean: 4 }], [0, 3], 4);
  assert.equal(result.observedOnlyMean, null);
  assert.equal(result.missingWeightFraction, 1);
  assert.equal(result.observedWeight, 0);
  assert.deepEqual(result.scenarios.map(s => s.weightedMean), [3, 6]);
  assert.throws(() => missingnessSensitivity([{ id: "a", outcome: null }], [0], 4), /基準/);
});

test("all-observed means do not change with delta and optional weights default to one", () => {
  const result = missingnessSensitivity([{ id: "a", outcome: -2 }, { id: "b", outcome: 8 }], [-100, 0, 100], 3);
  assert.equal(result.totalWeight, 2);
  assert.equal(result.missingWeightFraction, 0);
  assert.equal(result.observedOnlyMean, 3);
  assert.deepEqual(result.scenarios.map(s => s.weightedMean), [3, 3, 3]);
  assert.ok(result.scenarios.every(s => !s.exceedsThreshold));
});

test("rejects empty inputs, duplicate IDs, nonfinite values and nonpositive weights", () => {
  assert.throws(() => missingnessSensitivity([], [0], 0));
  assert.throws(() => missingnessSensitivity(rows, [], 0));
  assert.throws(() => missingnessSensitivity([rows[0], rows[0]], [0], 0), /重複/);
  assert.throws(() => missingnessSensitivity([{ id: " ", outcome: 0 }], [0], 0));
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => missingnessSensitivity([{ id: "a", outcome: value }], [0], 0));
    assert.throws(() => missingnessSensitivity([{ id: "a", outcome: null, baselineMean: value }], [0], 0));
    assert.throws(() => missingnessSensitivity([{ id: "a", outcome: 0, weight: value }], [0], 0));
    assert.throws(() => missingnessSensitivity(rows, [value], 0));
    assert.throws(() => missingnessSensitivity(rows, [0], value));
  }
  for (const weight of [0, -1]) assert.throws(() => missingnessSensitivity([{ id: "a", outcome: 0, weight }], [0], 0));
});

test("rejects overflow in shifted expectations, weighted values, sums and total weights", () => {
  assert.throws(() => missingnessSensitivity([{ id: "a", outcome: null, baselineMean: 1e308 }], [1e308], 0), /有限/);
  assert.throws(() => missingnessSensitivity([{ id: "a", outcome: 1e308, weight: 2 }], [0], 0), /有限/);
  assert.throws(() => missingnessSensitivity([{ id: "a", outcome: 1e308 }, { id: "b", outcome: 1e308 }], [0], 0), /有限/);
  assert.throws(() => missingnessSensitivity([{ id: "a", outcome: 0, weight: 1e308 }, { id: "b", outcome: 0, weight: 1e308 }], [0], 0), /有限/);
});

test("preserves input rows and scenario order without writing imputed observations", () => {
  const input = structuredClone(rows), before = structuredClone(input), deltas = [10, -10, 10];
  const result = missingnessSensitivity(input, deltas, 15);
  assert.deepEqual(input, before);
  assert.equal(input[1].outcome, null);
  assert.deepEqual(result.scenarios.map(s => s.delta), deltas);
  result.scenarios[0].delta = 99;
  assert.deepEqual(deltas, [10, -10, 10]);
});
