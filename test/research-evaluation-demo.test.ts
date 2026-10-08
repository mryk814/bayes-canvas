import test from "node:test";
import assert from "node:assert/strict";
import { researchEvaluationDemo } from "../experiments/research-evaluation.ts";

test("evaluation demo preserves missing rows and distinguishes new-group and existing-group prediction", () => {
  const result = researchEvaluationDemo();
  assert.equal(result.existingGroups.counts.test, 4);
  assert.equal(result.existingGroups.counts.scoreable, 3);
  assert.equal(result.existingGroups.counts.missingTestOutcome, 1);
  assert.equal(result.newGroup.counts.test, 3);
  assert.equal(result.newGroup.counts.scoreable, 2);
  assert.equal(result.newGroup.counts.missingTestOutcome, 1);
  assert.equal(result.existingGroups.mae, 5 / 3);
  assert.equal(result.newGroup.mae, 79);
  assert.equal(result.comparison.comparable, false);
  assert.equal(result.adoptedButUnchecked.automatic, false);
  assert.equal(result.pointAsPosterior.automatic, false);
  assert.equal(result.pointForPrediction.automatic, true);
  assert.equal(result.missingness.observedOnlyMean, 11);
  assert.equal(result.missingness.missingWeightFraction, 0.5);
  assert.deepEqual(result.missingness.scenarios, [
    { delta: -5, weightedMean: 7, exceedsThreshold: false },
    { delta: 0, weightedMean: 9.5, exceedsThreshold: false },
    { delta: 1, weightedMean: 10, exceedsThreshold: false },
    { delta: 5, weightedMean: 12, exceedsThreshold: true },
  ]);
});
