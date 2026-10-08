import { test } from "node:test";
import assert from "node:assert/strict";
import { createCapsule, readCapsule } from "../shared/capsule.ts";
import { ModelVersionSchema, DatasetSchema, RunSchema } from "../shared/contracts.ts";
import { datasetProblems, runProblems } from "../shared/evidence-validation.ts";

function fixture() {
  const version = ModelVersionSchema.parse({ id: "v1", modelId: "m1", number: 1, createdAt: "2026-10-08", origin: { kind: "example", exampleId: "test" }, summary: "test", spec: {
    title: "capsule test", plates: [{ name: "n", label: "rows", size: 2 }],
    data: [{ name: "x", label: "x", plate: "n", generate: { kind: "linspace", from: 0, to: 1 } }],
    nodes: [{ name: "a", label: "a", role: "param", dist: { family: "normal", args: { mu: 0, sigma: 1 } } },
      { name: "b", label: "b", role: "latent", plate: "n", dist: { family: "normal", args: { mu: "a", sigma: 1 } } },
      { name: "y", label: "y", role: "observed", plate: "n", dist: { family: "normal", args: { mu: "b", sigma: 1 } } }], view: { x: "x", y: "y" },
  } });
  const dataset = DatasetSchema.parse({ id: "d1", modelId: "m1", createdAt: "2026-10-08", label: "synthetic", provenance: "synthetic", plates: { n: 3 }, columns: { x: [0, 1, 2], y: [2, 3, 4] } });
  const run = RunSchema.parse({ id: "r1", modelId: "m1", versionId: "v1", datasetId: "d1", createdAt: "2026-10-08", method: "fixture", draws: { a: [[1], [2]], b: [[1, 2, 3], [2, 3, 4]] } });
  return { version, dataset, run };
}

test("capsule JSON roundtrip preserves model, dataset, run and joint draw rows without retaining inputs", () => {
  const { version, dataset, run } = fixture();
  const capsule = createCapsule(version, dataset, run);
  assert.equal(capsule.schema, "evidence-capsule@1");
  const read = readCapsule(JSON.parse(JSON.stringify(capsule)));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(read.capsule, capsule);
  run.draws.a[0][0] = 99;
  assert.equal(capsule.run.draws.a[0][0], 1);
  assert.equal(capsule.dataset.plates.n, 3); // Dataset sizes override prior sizes.
});

test("capsule rejects every mismatched reference and unknown schema", () => {
  for (const change of [
    (c: ReturnType<typeof createCapsule>) => { c.schema = "future" as typeof c.schema; },
    (c: ReturnType<typeof createCapsule>) => { c.dataset.modelId = "other"; },
    (c: ReturnType<typeof createCapsule>) => { c.run.modelId = "other"; },
    (c: ReturnType<typeof createCapsule>) => { c.run.versionId = "other"; },
    (c: ReturnType<typeof createCapsule>) => { c.run.datasetId = "other"; },
    (c: ReturnType<typeof createCapsule>) => { c.run.id = ""; },
  ]) {
    const f = fixture(); const capsule = createCapsule(f.version, f.dataset, f.run); change(capsule);
    assert.equal(readCapsule(capsule).ok, false);
  }
});

test("capsule refuses absent, extra, ragged, empty or non-finite draw arrays", () => {
  const invalid: Record<string, number[][]>[] = [ { a: [[1]] }, { a: [[1]], b: [[1, 2]] }, { a: [[1], [2]], b: [[1, 2, 3]] }, { a: [], b: [] }, { a: [[NaN]], b: [[1, 2, 3]] }, { a: [[1]], b: [[1, 2, 3]], y: [[2, 3, 4]] } ];
  for (const draws of invalid) {
    const f = fixture();
    assert.throws(() => createCapsule(f.version, f.dataset, { ...f.run, draws }));
  }
});

test("capsule rejects incompatible observed data and uncompileable models", () => {
  const f = fixture();
  const invalid: Record<string, number[]>[] = [{ x: [0, 1, 2] }, { x: [0], y: [2, 3, 4] }, { x: [0, 1, 2], y: [2, Infinity, 4] }];
  for (const columns of invalid) {
    assert.throws(() => createCapsule(f.version, { ...f.dataset, columns }, f.run));
  }
  assert.throws(() => createCapsule(f.version, { ...f.dataset, plates: {} }, f.run));
  f.version.spec.nodes[2].dist!.args.mu = "missing";
  assert.throws(() => createCapsule(f.version, f.dataset, f.run));
});

test("capsule validates index columns against the referenced dataset plate", () => {
  const f = fixture();
  f.version.spec.plates.push({ name: "g", label: "groups", size: 2 });
  f.version.spec.data.push({ name: "group", label: "group", unit: "", plate: "n", indexOf: "g", generate: { kind: "cycle" } });
  f.dataset.plates.g = 2;
  f.dataset.columns.group = [0, 1, 2];
  assert.throws(() => createCapsule(f.version, f.dataset, f.run));
  f.dataset.columns.group = [0, 1, 0];
  assert.equal(readCapsule(createCapsule(f.version, f.dataset, f.run)).ok, true);
});

test("read boundary reports errors for non-object or incomplete data", () => {
  for (const input of [null, [], "text", {}, { schema: "evidence-capsule@1" }]) {
    const result = readCapsule(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.problems.length > 0);
  }
});

test("shared evidence validation rejects non-finite typed inputs and excessive draw counts", () => {
  const f = fixture();
  f.dataset.columns.y[0] = NaN;
  assert.ok(datasetProblems(f.version.spec, f.dataset).some((p) => p.includes("有限")));
  f.dataset.columns.y[0] = 1;
  f.run.draws.a[0][0] = Infinity;
  assert.ok(runProblems(f.version.spec, f.dataset, f.run).some((p) => p.includes("有限")));
  f.run.draws = { a: Array.from({ length: 1001 }, () => [1]), b: Array.from({ length: 1001 }, () => [1, 2, 3]) };
  assert.ok(runProblems(f.version.spec, f.dataset, f.run).some((p) => p.includes("1〜1000")));
});
