import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSavedCheck } from "../shared/run-check.ts";
import { CURVE_EXAMPLE, OBSERVATION_EXAMPLE } from "../shared/example.ts";
import { compileSpec, simulateWorld } from "../shared/sim.ts";
import { bindCheck, runCheck } from "../shared/checks.ts";
import type { Dataset, ModelVersion, Run, SavedCheck } from "../shared/contracts.ts";
import { SavedCheckSchema, HumanSaveCheckInput } from "../shared/contracts.ts";

function fixture(spec = CURVE_EXAMPLE) {
  const compiled = compileSpec(spec); if (!compiled.ok) throw new Error(compiled.problems.join());
  const worlds = [0, 1, 2, 3].map(k => simulateWorld(compiled.compiled, 73, k));
  const version: ModelVersion = { id: "v1", modelId: "m", number: 1, spec, createdAt: "", origin: { kind: "example", exampleId: "test" }, summary: "" };
  const dataset: Dataset = { id: "d", modelId: "m", createdAt: "", label: "test", provenance: "synthetic", note: "", plates: Object.fromEntries(spec.plates.map(p => [p.name, p.size])), columns: Object.fromEntries([...spec.data.map(d => d.name), spec.view.y].map(name => [name, worlds[0].values[name]])) };
  const run: Run = { id: "r", modelId: "m", versionId: "v1", datasetId: "d", method: "synthetic", createdAt: "", note: "", diagnostics: { maxRhat: null, minEss: null, chains: null, divergences: null }, draws: Object.fromEntries(spec.nodes.filter(n => n.role === "param" || n.role === "latent").map(n => [n.name, worlds.map(w => w.values[n.name])])) };
  const definition: SavedCheck = { id: "c", modelId: "m", datasetId: "d", createdAt: "", label: "check", xMin: 20, xMax: 300, statistic: "mean", x: spec.view.x, y: spec.view.y, xUnit: "°C", yUnit: "MPa", groupColumn: spec.view.group ?? null, groupIndex: null };
  return { definition, version, dataset, run };
}

test("both examples use every draw and direct observed rows with reproducible seeded replications", () => {
  for (const spec of [CURVE_EXAMPLE, OBSERVATION_EXAMPLE]) {
    const { definition: d, version: v, dataset: ds, run: r } = fixture(spec);
    const result = evaluateSavedCheck(d, v, ds, r, 9);
    assert.equal(result.replicatedValues.length, 4);
    assert.equal(result.observedCount, ds.columns[d.y].length);
    assert.ok(Math.abs(result.observedValue - ds.columns[d.y].reduce((a, b) => a + b, 0) / result.observedCount) < 1e-10);
    assert.deepEqual(result, evaluateSavedCheck(d, v, ds, r, 9));
    assert.notDeepEqual(result.replicatedValues, evaluateSavedCheck(d, v, ds, r, 10).replicatedValues);
  }
});

test("inclusive group interval and maximum select the same rows in observed and replicated evidence", () => {
  const { definition, version, dataset, run } = fixture(OBSERVATION_EXAMPLE);
  const d = { ...definition, xMin: dataset.columns.T[0], xMax: dataset.columns.T[3], groupIndex: 0, statistic: "max" as const };
  const result = evaluateSavedCheck(d, version, dataset, run, -1);
  assert.equal(result.observedCount, 2);
  assert.equal(result.observedValue, Math.max(dataset.columns.recorded[0], dataset.columns.recorded[3]));
});

test("sd contracts and run adapter retain population spread for the selected group across all draws", () => {
  const { definition, version, dataset, run } = fixture(OBSERVATION_EXAMPLE);
  const d = { ...definition, statistic: "sd" as const, xMin: dataset.columns.T[0], xMax: dataset.columns.T[3], groupIndex: 0 };
  assert.equal(SavedCheckSchema.parse(d).statistic, "sd");
  assert.equal(HumanSaveCheckInput.parse({ runId: run.id, label: "spread", xMin: d.xMin, xMax: d.xMax, statistic: "sd", groupIndex: 0, seed: 1 }).statistic, "sd");
  const result = evaluateSavedCheck(d, version, dataset, run, 9);
  assert.equal(result.observedCount, 2);
  assert.ok(Math.abs(result.observedValue - Math.abs(dataset.columns.recorded[0] - dataset.columns.recorded[3]) / 2) < 1e-10);
  assert.equal(result.replicatedValues.length, 4);
  assert.ok(result.replicatedValues.every(value => Number.isFinite(value) && value >= 0));
  const singleton = evaluateSavedCheck({ ...d, xMax: d.xMin }, version, dataset, run, 9);
  assert.equal(singleton.observedValue, 0);
  assert.deepEqual(singleton.replicatedValues, [0, 0, 0, 0]);
});

test("new-unit replicas ignore individual latent draws but retain group and scalar draws", () => {
  const { definition, version, dataset, run } = fixture(OBSERVATION_EXAMPLE);
  const baseline = evaluateSavedCheck(definition, version, dataset, run, 9);
  const changed = structuredClone(run);
  changed.draws.true_strength = changed.draws.true_strength.map(row => row.map(() => -1e6));
  assert.deepEqual(evaluateSavedCheck(definition, version, dataset, changed, 9), baseline);
  changed.draws.bias = changed.draws.bias.map(row => row.map(() => -1e6));
  assert.notDeepEqual(evaluateSavedCheck(definition, version, dataset, changed, 9).replicatedValues, baseline.replicatedValues);
  const scalarChanged = structuredClone(run);
  scalarChanged.draws.s20 = scalarChanged.draws.s20.map(() => [-1e6]);
  assert.notDeepEqual(evaluateSavedCheck(definition, version, dataset, scalarChanged, 9).replicatedValues, baseline.replicatedValues);
});

test("same-signature new version is allowed; reference, unit, group and view mismatches are rejected", () => {
  const { definition: d, version: v, dataset: ds, run: r } = fixture();
  assert.doesNotThrow(() => evaluateSavedCheck(d, { ...v, id: "v2", number: 2 }, ds, { ...r, versionId: "v2" }, 1));
  for (const patch of [{ modelId: "other" }, { datasetId: "other" }, { x: "other" }, { yUnit: "kPa" }, { groupColumn: "other" }, { groupIndex: 0 }]) {
    assert.throws(() => evaluateSavedCheck({ ...d, ...patch }, v, ds, r, 1));
  }
  assert.throws(() => evaluateSavedCheck(d, v, ds, { ...r, versionId: "wrong" }, 1));
});

test("empty intervals, malformed rows, nonfinite values and noninteger seeds reject rather than dropping rows", () => {
  const { definition: d, version: v, dataset: ds, run: r } = fixture();
  assert.throws(() => evaluateSavedCheck({ ...d, xMin: 999, xMax: 1000 }, v, ds, r, 1));
  assert.throws(() => evaluateSavedCheck(d, v, ds, r, 0.5));
  for (const values of [[1], ds.columns.strength.map(() => NaN)]) assert.throws(() => evaluateSavedCheck(d, v, { ...ds, columns: { ...ds.columns, strength: values } }, r, 1));
  assert.throws(() => evaluateSavedCheck(d, v, ds, { ...r, draws: { ...r.draws, sigma: [[1]] } }, 1));
  const broken = structuredClone(r);
  broken.draws.sigma[2] = [-1];
  assert.throws(() => evaluateSavedCheck(d, v, ds, broken, 1), /複製draw 2/);
});

test("replications are summarized as they arrive, without retaining every point array", () => {
  const context = { modelVersionId: "v", datasetId: "d", runId: "r" };
  const bound = bindCheck({ id: "c", label: "stream", xMin: 0, xMax: 1, statistic: "mean" }, context);
  const points = [{ x: 0, y: 0 }];
  function* replications() {
    for (let value = 1; value <= 4; value++) { points[0].y = value; yield points; }
  }
  const result = runCheck(bound, { context, observed: [{ x: 0, y: 2 }], replicated: replications() });
  assert.deepEqual(result.replicatedValues, [1, 2, 3, 4]);
  assert.equal(result.tailFraction, 0.75);
  assert.throws(() => runCheck(bound, { context, observed: [{ x: 0, y: 2 }], replicated: [][Symbol.iterator]() }), /replication/i);
});

test("exceedance uses capped recorded observations and every replicated draw with strict equality excluded", () => {
  const { definition, version, dataset, run } = fixture(OBSERVATION_EXAMPLE);
  dataset.columns.recorded = dataset.columns.recorded.map(() => 520);
  const d = { ...definition, statistic: "exceedance" as const, threshold: 520 };
  const result = evaluateSavedCheck(d, version, dataset, run, 9);
  assert.equal(result.observedValue, 0);
  assert.deepEqual(result.replicatedValues, [0, 0, 0, 0]);
  assert.deepEqual(result.predictiveRange, [0, 0]);
  assert.equal(result.tailFraction, 1);
  assert.equal(evaluateSavedCheck({ ...d, threshold: 519 }, version, dataset, run, 9).observedValue, 1);
  for (const invalid of [{ ...d, threshold: undefined }, { ...d, threshold: Infinity }, { ...definition, threshold: 520 }]) {
    assert.equal(SavedCheckSchema.safeParse(invalid).success, false);
    assert.throws(() => evaluateSavedCheck(invalid, version, dataset, run, 9));
  }
});
