import { test } from "node:test";
import assert from "node:assert/strict";
import { applyShutter, prepareShutter } from "../shared/shutter.ts";
import { CURVE_EXAMPLE, OBSERVATION_EXAMPLE } from "../shared/example.ts";
import { compileSpec, simulateWorld, viewPoints } from "../shared/sim.ts";
import type { Dataset, ModelSpec, ModelVersion, Run } from "../shared/contracts.ts";

const version = (spec: ModelSpec): ModelVersion => ({ id: "v", modelId: "m", number: 1, spec, createdAt: "", summary: "", origin: { kind: "example", exampleId: "test" } });

test("shutter preserves row identities and treats equality as uncensored without mutating raw", () => {
  const raw = [4, 5, 6].map((y, unit) => ({ unit, x: unit, y, line: null, group: unit % 2, censored: false }));
  const snapshot = structuredClone(raw);
  assert.deepEqual(applyShutter(raw, 5).map(p => [p.unit, p.y, p.censored]), [[0, 4, false], [1, 5, false], [2, 5, true]]);
  assert.deepEqual(applyShutter(raw, 100), raw);
  assert.deepEqual(raw, snapshot);
  assert.throws(() => applyShutter(raw, Infinity));
});

test("prior preparation is reproducible, matches original recording, and preserves both examples", () => {
  for (const spec of [CURVE_EXAMPLE, OBSERVATION_EXAMPLE]) {
    const snapshot = structuredClone(spec);
    const prepared = prepareShutter(version(spec), null, null, 7, 2);
    assert.equal(prepared.ok, true); if (!prepared.ok) continue;
    const c = compileSpec(spec); if (!c.ok) throw new Error(c.problems.join());
    const original = viewPoints(c.compiled, simulateWorld(c.compiled, 7, 2)).map(p => ({ ...p, line: null }));
    assert.deepEqual(prepared.original, original);
    assert.deepEqual(prepared, prepareShutter(version(spec), null, null, 7, 2));
    assert.deepEqual(spec, snapshot);
    assert.equal(prepared.totalDraws, null);
  }
});

test("original caps are evaluated separately for every row", () => {
  const spec = structuredClone(CURVE_EXAMPLE);
  spec.nodes.find(n => n.name === "strength")!.censorAbove = "T + 100";
  const result = prepareShutter(version(spec), null, null, 7, 0);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual(result.originalCaps, result.raw.map(p => p.x + 100));
  assert.deepEqual(result.original.map(p => p.y), result.raw.map(p => Math.min(p.y, p.x + 100)));
});

test("run preparation validates references and exact index, preserving evidence", () => {
  const spec = CURVE_EXAMPLE; const v = version(spec);
  const c = compileSpec(spec); if (!c.ok) throw new Error(c.problems.join());
  const world = simulateWorld(c.compiled, 5, 0);
  const dataset: Dataset = { id: "d", modelId: "m", createdAt: "", label: "test", provenance: "synthetic", note: "", plates: { point: spec.plates[0].size }, columns: { T: world.values.T, strength: world.values.strength } };
  const run: Run = { id: "r", modelId: "m", versionId: "v", datasetId: "d", createdAt: "", method: "test", note: "", fidelity: "mcmc", origin: "agent", warnings: [], diagnostics: { chains: null, maxRhat: null, minEss: null, divergences: null, paretoK: null }, draws: Object.fromEntries(spec.nodes.filter(n => n.role === "param").map(n => [n.name, [world.values[n.name]]])) };
  const snapshot = structuredClone({ dataset, run });
  assert.equal(prepareShutter(v, dataset, run, 7, 0).ok, true);
  for (const index of [-1, 0.5, 1, Infinity]) assert.equal(prepareShutter(v, dataset, run, 7, index).ok, false);
  assert.equal(prepareShutter(v, dataset, { ...run, versionId: "other" }, 7, 0).ok, false);
  assert.equal(prepareShutter(v, null, run, 7, 0).ok, false);
  assert.equal(prepareShutter(v, dataset, null, 7, 0).ok, false);
  assert.deepEqual({ dataset, run }, snapshot);
});

test("dependent x and non-finite original caps are rejected", () => {
  const spec = structuredClone(CURVE_EXAMPLE);
  spec.nodes.push({ name: "later", label: "later", unit: "", plate: "point", role: "deterministic", expr: "strength + 1", note: "" });
  spec.view.x = "later";
  assert.equal(prepareShutter(version(spec), null, null, 7, 0).ok, false);
  spec.view.x = "T";
  spec.nodes.find(n => n.name === "strength")!.censorAbove = "1 / 0";
  assert.equal(prepareShutter(version(spec), null, null, 7, 0).ok, false);
  assert.equal(prepareShutter(version(CURVE_EXAMPLE), null, null, NaN, 0).ok, false);
});

test("only the target censor is removed and finite censor cannot conceal infinite raw measurements", () => {
  const spec = structuredClone(CURVE_EXAMPLE);
  const y = spec.nodes.find(n => n.name === "strength")!;
  spec.nodes.splice(spec.nodes.indexOf(y), 0, { name: "upstream", label: "upstream", unit: "MPa", plate: "point", role: "observed", dist: { family: "normal", args: { mu: "1000", sigma: "1" } }, censorAbove: "100", note: "" });
  y.dist!.args.mu = "upstream";
  y.dist!.args.sigma = "0.01";
  y.censorAbove = "50";
  const prepared = prepareShutter(version(spec), null, null, 7, 0);
  assert.equal(prepared.ok, true); if (!prepared.ok) return;
  assert.ok(prepared.raw.every(p => p.y > 99 && p.y < 101));
  assert.ok(prepared.original.every(p => p.y === 50 && p.censored));
  y.dist!.args.mu = "1 / 0";
  assert.equal(prepareShutter(version(spec), null, null, 7, 0).ok, false);
});
