import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseRun } from "../shared/diagnose.ts";
import type { Run } from "../shared/contracts.ts";

const run: Run = { id: "r1", modelId: "m1", versionId: "v1", datasetId: "d1", createdAt: "2026-10-08", method: "NumPyro NUTS 4x1000 non-centred accept 0.8", note: "", draws: {}, diagnostics: { chains: 4, maxRhat: 1.01, minEss: 400, divergences: 0 } };
const statuses = (value: Run) => Object.fromEntries(diagnoseRun(value, "v1").checks.map(check => [check.id, check.status]));

test("existing threshold boundaries are guidance, never an inference approval", () => {
  assert.deepEqual(statuses(run), { chains: "within-guide", rhat: "within-guide", ess: "within-guide", divergences: "within-guide" });
  assert.match(diagnoseRun(run, "v1").summary, /保証しません/);
  const bad = { ...run, diagnostics: { chains: 4, maxRhat: 1.011, minEss: 399, divergences: 1 } };
  assert.deepEqual(statuses(bad), { chains: "within-guide", rhat: "attention", ess: "attention", divergences: "attention" });
  assert.ok(diagnoseRun(bad, "v1").checks.every(check => check.next.length > 0));
});

test("missing, invalid and non-finite diagnostics never read as within-guide", () => {
  for (const value of [null, NaN, Infinity, -1]) {
    const diagnostics = { chains: value, maxRhat: value, minEss: value, divergences: value };
    assert.ok(Object.values(statuses({ ...run, diagnostics })).every(status => status === "unavailable"));
  }
  assert.equal(statuses({ ...run, diagnostics: { ...run.diagnostics, maxRhat: 0 } }).rhat, "unavailable");
  assert.equal(statuses({ ...run, diagnostics: { ...run.diagnostics, chains: 2.5, divergences: 0.5 } }).divergences, "unavailable");
});

test("one chain cannot substantiate between-chain agreement", () => {
  const result = statuses({ ...run, diagnostics: { ...run.diagnostics, chains: 1 } });
  assert.equal(result.chains, "attention");
  assert.equal(result.rhat, "unavailable");
});

test("unknown and non-MCMC methods do not inherit NUTS diagnostic rules", () => {
  for (const method of ["ADVI", "prior simulation", "unknown NUTS", "Stan optimizer", "NumPyro NUTS-like approximation"]) {
    const result = diagnoseRun({ ...run, method }, "v1");
    assert.equal(result.supportedMethod, false);
    assert.ok(result.checks.every(check => check.status === "not-applicable"));
  }
  assert.equal(diagnoseRun({ ...run, method: "Stan NUTS 4x1000 accept 0.8" }, "v1").supportedMethod, true);
});

test("references and old-version status survive read-only diagnosis", () => {
  const snapshot = structuredClone(run);
  const result = diagnoseRun(run, "v2");
  assert.equal(result.stale, true);
  assert.equal(result.runId, "r1");
  assert.equal(result.versionId, "v1");
  assert.equal(result.datasetId, "d1");
  assert.deepEqual(run, snapshot);
});
