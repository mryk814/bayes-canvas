import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { previewModelCsv } from "../shared/import-csv.ts";

function setup(example: string) {
  const path = join(mkdtempSync(join(tmpdir(), "csv-import-")), "worlds.json");
  const store = new Store(path);
  const model = store.startExample(example);
  return { path, store, version: store.state.versions.find(v => v.id === model.currentVersionId)! };
}
const options = { label: "試験CSV", provenance: "synthetic" as const, columns: { T: { source: "temp", unit: "K" }, strength: { source: "value", unit: "kPa" } } };
test("curve mapped CSV converts units and survives Store reload with provenance", () => {
  const { store, path, version } = setup("curve");
  const result = previewModelCsv(version, "temp,value\n293.15,400000\n313.15,390000", options);
  assert.deepEqual(result.errors, []);
  assert.ok(result.dataset);
  assert.deepEqual(result.dataset.columns, { T: [20, 40], strength: [400, 390] });
  assert.deepEqual(result.dataset.plates, { point: 2 });
  const saved = store.attachDataset(result.dataset);
  assert.deepEqual(new Store(path).state.datasets[0], saved);
  assert.match(saved.note, /temp/);
  assert.match(saved.note, /kPa/);
});
test("observation CSV retains group identity and previews category to index mapping", () => {
  const { store, version } = setup("observation");
  const result = previewModelCsv(version, "temp,value,group\n20,400, A\n30,380,A\n40,370, A", {
    ...options, columns: { T: { source: "temp", unit: "C" }, recorded: { source: "value", unit: "MPa" }, machine_of: { source: "group", unit: "" } },
  });
  assert.deepEqual(result.errors, []);
  assert.ok(result.dataset);
  assert.deepEqual(result.groups.machine_of, [" A", "A"]);
  assert.deepEqual(result.dataset.columns.machine_of, [0, 1, 0]);
  assert.deepEqual(result.dataset.plates, { specimen: 3, machine: 2 });
  store.attachDataset(result.dataset);
});
test("invalid numbers, unknown unit, missing mapping and multi-plate data block output", () => {
  const { version } = setup("curve");
  for (const text of ["temp,value\n,400", "temp,value\nNaN,400", "temp,value\n20,Infinity", "temp,value\n20"]) {
    assert.equal(previewModelCsv(version, text, options).dataset, null);
  }
  assert.equal(previewModelCsv(version, "temp,value\n20,400", { ...options, columns: { ...options.columns, T: { source: "temp", unit: "F" } } }).dataset, null);
  assert.equal(previewModelCsv(version, "temp,value\n20,400", { ...options, columns: {} }).dataset, null);
  const complex = structuredClone(version);
  complex.spec.plates.push({ name: "other", label: "別", size: 2 });
  complex.spec.nodes.find(n => n.role === "observed")!.plate = "other";
  assert.equal(previewModelCsv(complex, "temp,value\n20,400", options).dataset, null);
});
