import test from "node:test";
import assert from "node:assert/strict";
import { poolingCandidates, preparePooling, queryContrast } from "../shared/pooling.ts";
import { CURVE_EXAMPLE, OBSERVATION_EXAMPLE } from "../shared/example.ts";
import type { Dataset, ModelVersion, Run } from "../shared/contracts.ts";

function fixture() {
  const spec = structuredClone(OBSERVATION_EXAMPLE);
  const version: ModelVersion = { id: "v", modelId: "m", number: 1, createdAt: "", summary: "", origin: { kind: "example", exampleId: "test" }, spec };
  const dataset: Dataset = { id: "d", modelId: "m", createdAt: "", label: "test", provenance: "synthetic", note: "", plates: { specimen: 36, machine: 3 }, columns: { T: Array(36).fill(20), machine_of: Array.from({ length: 36 }, (_, i) => i % 2), recorded: Array(36).fill(5) } };
  const run: Run = { id: "r", modelId: "m", versionId: "v", datasetId: "d", method: "synthetic", createdAt: "", note: "", fidelity: "mcmc", origin: "agent", warnings: [], diagnostics: { maxRhat: null, minEss: null, chains: null, divergences: null, paretoK: null }, draws: Object.fromEntries(spec.nodes.filter(n => n.role === "param" || n.role === "latent").map(n => [n.name, Array.from({ length: 3 }, () => Array(n.plate ? dataset.plates[n.plate] : 1).fill(2))])) };
  run.draws.bias = [[1, 0, 4], [11, 10, 5], [21, 20, 6]];
  run.draws.tau_bias = [[2], [3], [4]];
  return { version, dataset, run };
}

test("discovery distinguishes shared group Normal from point models and censored or group-specific nodes", () => {
  const { version } = fixture();
  assert.deepEqual(poolingCandidates(version.spec).candidates.map(c => c.node), ["bias"]);
  assert.equal(poolingCandidates(CURVE_EXAMPLE).candidates.length, 0);
  assert.ok(poolingCandidates(CURVE_EXAMPLE).problems.length);
  const latentView = structuredClone(version);
  latentView.spec.view.y = "true_strength";
  const unsupported = poolingCandidates(latentView.spec);
  assert.equal(unsupported.candidates.length, 0);
  assert.ok(unsupported.problems.some(p => p.includes("観測")));
  version.spec.nodes.find(n => n.name === "bias")!.censorAbove = "3";
  assert.equal(poolingCandidates(version.spec).candidates.length, 0);
  delete version.spec.nodes.find(n => n.name === "bias")!.censorAbove;
  version.spec.nodes.find(n => n.name === "bias")!.dist!.args.mu = "true_strength[machine_of]";
  assert.equal(poolingCandidates(version.spec).candidates.length, 0);
});

test("prepared summaries preserve all joint rows and zero-count groups; contrasts use paired draws and strict >", () => {
  const { version, dataset, run } = fixture();
  const before = JSON.stringify({ version, dataset, run });
  const result = preparePooling(version, dataset, run, "bias");
  assert.ok(result.ok); if (!result.ok) return;
  assert.deepEqual(result.groups.map(g => g.count), [18, 18, 0]);
  assert.deepEqual(result.groups[0].interval, [2, 11, 20]);
  assert.deepEqual(result.center, [0, 0, 0]);
  assert.deepEqual(result.sigma, [2.1, 3, 3.9]);
  assert.deepEqual(result.rows.map(r => r.values), run.draws.bias);
  const difference = queryContrast(result, 0, 1, 1);
  assert.ok(difference.ok); if (!difference.ok) return;
  assert.deepEqual(difference.values, [1, 1, 1]);
  assert.deepEqual(difference.interval, [1, 1, 1]);
  assert.equal(difference.fraction, 0);
  const positive = queryContrast(result, 0, 1, 0);
  assert.ok(positive.ok); if (positive.ok) assert.equal(positive.fraction, 1);
  assert.equal(queryContrast(result, 0, 99, 0).ok, false);
  assert.equal(queryContrast(result, 0, 1, Infinity).ok, false);
  assert.equal(queryContrast(result, 0.5, 1, 0).ok, false);
  assert.equal(JSON.stringify({ version, dataset, run }), before);
});

test("shared scalar deterministic expressions use the same draw without sampling", () => {
  const { version, dataset, run } = fixture();
  version.spec.nodes.splice(5, 0, { name: "shared_scale", label: "scale", unit: "MPa", plate: null, role: "deterministic", expr: "tau_bias * 2", note: "" });
  version.spec.nodes.find(n => n.name === "bias")!.dist!.args.sigma = "shared_scale";
  const result = preparePooling(version, dataset, run, "bias");
  assert.ok(result.ok); if (!result.ok) return;
  assert.deepEqual(result.rows.map(r => r.sigma), [4, 6, 8]);
  assert.deepEqual(result.rows.map(r => r.values), run.draws.bias);
  const capped = structuredClone(version);
  capped.spec.nodes.find(n => n.name === "shared_scale")!.censorAbove = "3";
  const rejected = preparePooling(capped, dataset, run, "bias");
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.ok(rejected.problems.some(p => p.includes("記録上限は観測ノードにだけ")));
  version.spec.nodes.splice(4, 0, { name: "reading", label: "reading", unit: "MPa", plate: null, role: "observed", dist: { family: "normal", args: { mu: "0", sigma: "1" } }, note: "" });
  version.spec.nodes.find(n => n.name === "shared_scale")!.expr = "reading + 1";
  assert.equal(poolingCandidates(version.spec).candidates.length, 0);
});

test("prior, foreign evidence, malformed draws, nonfinite values and nonpositive shared scales stop", () => {
  const { version, dataset, run } = fixture();
  assert.equal(preparePooling(version, null, null, "bias").ok, false);
  for (const patch of [{ versionId: "foreign" }, { modelId: "foreign" }, { datasetId: "foreign" }]) assert.equal(preparePooling(version, dataset, { ...run, ...patch }, "bias").ok, false);
  assert.equal(preparePooling(version, { ...dataset, modelId: "foreign" }, run, "bias").ok, false);
  for (const value of [0, -1, Infinity, NaN]) {
    const broken = structuredClone(run); broken.draws.tau_bias[1][0] = value;
    assert.equal(preparePooling(version, dataset, broken, "bias").ok, false);
  }
  const broken = structuredClone(run); broken.draws.bias[1] = [1];
  assert.equal(preparePooling(version, dataset, broken, "bias").ok, false);
  run.draws.bias[0] = [1e308, -1e308, 0];
  const result = preparePooling(version, dataset, run, "bias");
  assert.ok(result.ok); if (!result.ok) return;
  assert.equal(queryContrast(result, 0, 1, 0).ok, false);
});

test("invalid shared expressions and unrelated corrupt evidence cannot produce partial success", () => {
  const { version, dataset, run } = fixture();
  const bias = version.spec.nodes.find(n => n.name === "bias")!;
  for (const [argument, expression] of [["mu", "1 / 0"], ["sigma", "0"], ["sigma", "-2"], ["sigma", "sqrt(-1)"]]) {
    const changed = structuredClone(version);
    changed.spec.nodes.find(n => n.name === "bias")!.dist!.args[argument] = expression;
    assert.equal(preparePooling(changed, dataset, run, "bias").ok, false);
  }
  const corrupt = structuredClone(run); corrupt.draws.s20[1][0] = NaN;
  assert.equal(preparePooling(version, dataset, corrupt, "bias").ok, false);
  const invalidData = structuredClone(dataset); invalidData.columns.machine_of[0] = 3;
  assert.equal(preparePooling(version, invalidData, run, "bias").ok, false);
  // A valid group-specific mu is still outside the shared-scalar contract.
  version.spec.nodes.splice(5, 0, { ...structuredClone(bias), name: "group_center", label: "group center" });
  bias.dist!.args.mu = "group_center";
  assert.equal(poolingCandidates(version.spec).candidates.some(c => c.node === "bias"), false);
});
