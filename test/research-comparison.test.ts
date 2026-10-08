import test from "node:test";
import assert from "node:assert/strict";
import { compareResearchConditions, researchUseGate, type ResearchConditions, type ResearchUse } from "../shared/research-comparison.ts";

const conditions: ResearchConditions = {
  model: "model-v1-sha", data: "data-sha", preprocessing: "identity-v1", task: "new-group",
  split: "held-groups-2-3", quantity: "strength-predictive-crps", unit: "MPa",
};
const use: ResearchUse = {
  purpose: "posterior", kind: "posterior-draws", completed: true, finite: true,
  matchesCurrentTarget: true, computation: "checked", prediction: "unknown", adoption: "undecided",
};

test("posterior comparison requires the same model; prediction permits distinct models for the same task", () => {
  assert.deepEqual(compareResearchConditions("posterior", conditions, { ...conditions }), { comparable: true, modelsDiffer: false, reasons: [] });
  const other = { ...conditions, model: "model-v2-sha" };
  assert.equal(compareResearchConditions("posterior", conditions, other).comparable, false);
  assert.deepEqual(compareResearchConditions("prediction", conditions, other), { comparable: true, modelsDiffer: true, reasons: [] });
});

test("every evaluation boundary rejects mismatches and missing fingerprints", () => {
  for (const field of ["data", "preprocessing", "task", "split", "quantity", "unit"] as const) {
    const verdict = compareResearchConditions("prediction", conditions, { ...conditions, [field]: "different" });
    assert.equal(verdict.comparable, false, field);
    assert.ok(verdict.reasons.some((r) => r.includes(field)));
  }
  for (const field of Object.keys(conditions)) {
    assert.equal(compareResearchConditions("prediction", conditions, { ...conditions, [field]: "  " }).comparable, false, field);
    const missing = { ...conditions }; delete (missing as Partial<ResearchConditions>)[field as keyof ResearchConditions];
    assert.equal(compareResearchConditions("posterior", conditions, missing).comparable, false, field);
  }
});

test("malformed and explicitly unknown conditions fail closed", () => {
  for (const bad of [null, undefined, {}, { ...conditions, data: "unknown" }, { ...conditions, unit: "不明" }, { ...conditions, split: 3 }]) {
    assert.equal(compareResearchConditions("prediction", bad as ResearchConditions, conditions).comparable, false);
  }
  assert.equal(compareResearchConditions("other" as "posterior", conditions, conditions).comparable, false);
  assert.equal(researchUseGate({ ...use, purpose: "other" } as unknown as ResearchUse).automatic, false);
  assert.equal(researchUseGate({ ...use, kind: "other" } as unknown as ResearchUse).automatic, false);
  assert.equal(researchUseGate({ ...use, finite: "true" } as unknown as ResearchUse).automatic, false);
});

test("unknown or concerning computation can be inspected but not automatically used for posterior reading, even if adopted", () => {
  assert.equal(researchUseGate(use).automatic, true);
  for (const computation of [undefined, "unknown", "concern"] as const) {
    const result = researchUseGate({ ...use, computation, adoption: "adopted" });
    assert.equal(result.inspectable, true); assert.equal(result.automatic, false);
    assert.ok(result.reasons.length > 0);
  }
});

test("prediction evidence is scoped to prediction and does not certify posterior computation", () => {
  assert.equal(researchUseGate({ ...use, computation: "concern", prediction: "checked" }).automatic, false);
  assert.equal(researchUseGate({ ...use, purpose: "prediction", kind: "point-estimate", computation: "unknown", prediction: "checked" }).automatic, true);
  for (const prediction of [undefined, "unknown", "concern"] as const) {
    assert.equal(researchUseGate({ ...use, purpose: "prediction", kind: "predictive-samples", prediction }).automatic, false);
  }
  for (const kind of ["posterior-draws", "approximate-posterior-draws", "bootstrap-replicates"] as const) {
    assert.equal(researchUseGate({ ...use, purpose: "prediction", kind, prediction: "checked" }).automatic, false);
  }
  assert.equal(researchUseGate({ ...use, purpose: "prediction", kind: "predictive-samples", prediction: "checked" }).automatic, true);
  assert.equal(researchUseGate({ ...use, adoption: undefined }).automatic, true);
  assert.equal(researchUseGate({ ...use, adoption: "unknown" } as unknown as ResearchUse).automatic, false);
});

test("result semantics, finite completion, freshness, and rejection remain independent gates", () => {
  for (const kind of ["point-estimate", "bootstrap-replicates", "predictive-samples"] as const) {
    const r = researchUseGate({ ...use, kind });
    assert.equal(r.inspectable, true); assert.equal(r.automatic, false, kind);
  }
  for (const patch of [{ completed: false }, { finite: false }, { finite: undefined }]) {
    const r = researchUseGate({ ...use, ...patch });
    assert.equal(r.inspectable, false); assert.equal(r.automatic, false);
  }
  for (const patch of [{ matchesCurrentTarget: false }, { matchesCurrentTarget: undefined }, { adoption: "rejected" as const }]) {
    const r = researchUseGate({ ...use, ...patch });
    assert.equal(r.inspectable, true); assert.equal(r.automatic, false);
  }
  const before = structuredClone(use); researchUseGate(use);
  assert.deepEqual(use, before);
});
