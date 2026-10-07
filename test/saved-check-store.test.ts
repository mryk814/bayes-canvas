import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { compileSpec, simulateWorld } from "../shared/sim.ts";
import { runSites } from "../shared/evidence-validation.ts";

function setup() {
  const path = join(mkdtempSync(join(tmpdir(), "saved-check-")), "worlds.json");
  const store = new Store(path);
  const model = store.startExample("curve");
  const version = store.version(model.currentVersionId);
  const dataset = store.synthesize({ modelId: model.id, label: "synthetic", note: "test", truth: version.spec, seed: 13, plates: {} });
  function runFor(versionId: string) {
    const spec = store.version(versionId).spec;
    const c = compileSpec(spec); if (!c.ok) throw new Error(c.problems.join());
    const worlds = Array.from({ length: 4 }, (_, k) => simulateWorld(c.compiled, 14, k));
    return store.attachRun({ versionId, datasetId: dataset.id, method: "test", note: "", diagnostics: { chains: null, minEss: null, maxRhat: null, divergences: null }, draws: Object.fromEntries(runSites(spec).map(n => [n.name, worlds.map(w => w.values[n.name])])) });
  }
  const run = runFor(version.id);
  return { path, store, model, version, dataset, run, runFor };
}
const input = { label: "全区間平均", xMin: -1000, xMax: 1000, statistic: "mean" as const, groupIndex: null, seed: 7 };

test("save and explicit rerun append version-bound results and survive reload", () => {
  const f = setup();
  const saved = f.store.saveCheck({ ...input, runId: f.run.id });
  assert.equal(saved.check.datasetId, f.dataset.id);
  assert.equal(saved.result.versionId, f.version.id);
  assert.equal(saved.result.replicatedValues.length, 4);
  const expected = f.dataset.columns.strength.reduce((a, b) => a + b, 0) / f.dataset.columns.strength.length;
  assert.ok(Math.abs(saved.result.observedValue - expected) < 1e-9);
  const past = structuredClone(saved.result);
  const proposal = f.store.propose({ modelId: f.model.id, spec: f.version.spec, summary: "next version", knowledgeIds: [] });
  const version2 = f.store.adopt(proposal.id);
  const run2 = f.runFor(version2.id);
  const next = f.store.rerunCheck(saved.check.id, { runId: run2.id, seed: 7 });
  assert.equal(next.versionId, version2.id);
  assert.notEqual(next.id, past.id);
  assert.deepEqual(f.store.state.checkResults[0], past);
  const loaded = new Store(f.path);
  assert.equal(loaded.state.checks.length, 1);
  assert.equal(loaded.state.checkResults.length, 2);
  assert.deepEqual(loaded.state.checkResults[0], past);
});

test("invalid or mismatched checks do not change memory or disk", () => {
  const f = setup();
  const saved = f.store.saveCheck({ ...input, runId: f.run.id });
  const before = readFileSync(f.path, "utf8");
  for (const invalid of [{ ...input, xMin: 9999, xMax: 10000 }, { ...input, xMin: 1001 }, { ...input, groupIndex: 0 }, { ...input, label: "" }]) {
    assert.throws(() => f.store.saveCheck({ ...invalid, runId: f.run.id }));
    assert.equal(readFileSync(f.path, "utf8"), before);
    assert.equal(f.store.state.checks.length, 1);
  }
  const foreign = f.store.startExample("curve");
  const dataset = f.store.synthesize({ modelId: foreign.id, label: "foreign", note: "", truth: f.version.spec, seed: 13, plates: {} });
  const run = f.store.attachRun({ ...f.run, versionId: foreign.currentVersionId, datasetId: dataset.id });
  const unchanged = readFileSync(f.path, "utf8");
  assert.throws(() => f.store.rerunCheck(saved.check.id, { runId: run.id, seed: 7 }));
  assert.equal(readFileSync(f.path, "utf8"), unchanged);
});

test("@2 migration adds empty check collections in memory without touching the source file", () => {
  const f = setup();
  const { checks, checkResults, ...state } = f.store.state;
  const old = JSON.stringify({ ...state, schema: "possible-worlds@2" });
  writeFileSync(f.path, old);
  const loaded = new Store(f.path);
  assert.equal(loaded.state.schema, "possible-worlds@3");
  assert.deepEqual(loaded.state.checks, []);
  assert.deepEqual(loaded.state.checkResults, []);
  assert.deepEqual(loaded.state.runs, f.store.state.runs);
  assert.equal(readFileSync(f.path, "utf8"), old);
});

test("agent overview exposes model-scoped check definitions and referenced result summaries", () => {
  const f = setup();
  const { check, result } = f.store.saveCheck({ ...input, runId: f.run.id });
  const other = f.store.startExample("curve");
  const overview = f.store.overview();
  const own = overview.models.find(m => m.id === f.model.id)!;
  const foreign = overview.models.find(m => m.id === other.id)!;
  assert.deepEqual(own.checks, [check]);
  const { replicatedValues, ...summary } = result;
  assert.deepEqual(own.checkResults, [{ ...summary, replicationCount: replicatedValues.length }]);
  assert.deepEqual(foreign.checks, []);
  assert.deepEqual(foreign.checkResults, []);
  assert.equal("replicatedValues" in own.checkResults[0], false);
  assert.deepEqual(f.store.state.checkResults[0], result, "overview must retain the full stored evidence");
});

test("sd checks persist their statistic, rerun on the same dataset across versions and appear in agent overview", () => {
  const f = setup();
  const saved = f.store.saveCheck({ ...input, label: "区間の記録値の標準偏差", statistic: "sd", runId: f.run.id });
  assert.equal(saved.check.statistic, "sd");
  assert.ok(Number.isFinite(saved.result.observedValue));
  assert.ok(saved.result.observedValue > 0);
  const ys = f.dataset.columns.strength;
  const mean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const expected = Math.sqrt(ys.reduce((sum, value) => sum + (value - mean) ** 2, 0) / ys.length);
  assert.ok(Math.abs(saved.result.observedValue - expected) < 1e-9);
  assert.equal(saved.result.replicatedValues.length, 4);
  const before = structuredClone(saved.result);
  const nextSpec = structuredClone(f.version.spec);
  nextSpec.nodes.find(n => n.name === "sigma")!.dist!.args.sigma = "80";
  const proposal = f.store.propose({ modelId: f.model.id, spec: nextSpec, summary: "spread revision", knowledgeIds: [] });
  const nextVersion = f.store.adopt(proposal.id);
  const nextRun = f.runFor(nextVersion.id);
  const next = f.store.rerunCheck(saved.check.id, { runId: nextRun.id, seed: 7 });
  assert.equal(next.datasetId, saved.result.datasetId);
  assert.equal(next.versionId, nextVersion.id);
  assert.equal(next.observedValue, saved.result.observedValue);
  assert.notDeepEqual(next.replicatedValues, saved.result.replicatedValues);
  const loaded = new Store(f.path);
  assert.deepEqual(loaded.state.checks, [saved.check]);
  assert.deepEqual(loaded.state.checkResults, [before, next]);
  const overview = loaded.overview().models.find(m => m.id === f.model.id)!;
  assert.equal(overview.checks[0].statistic, "sd");
  assert.equal(overview.checkResults.length, 2);
  assert.equal(overview.checkResults[1].runId, nextRun.id);
  assert.equal(overview.checkResults[1].replicationCount, 4);
  for (const statistic of ["mean", "max"] as const) {
    assert.equal(loaded.saveCheck({ ...input, statistic, runId: nextRun.id }).check.statistic, statistic);
  }
});
