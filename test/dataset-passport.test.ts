import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { previewModelCsv, type ImportOptions } from "../shared/import-csv.ts";
import { AgentDatasetInput } from "../shared/contracts.ts";
import { createCapsule, readCapsule } from "../shared/capsule.ts";
import { seedChecksDemo } from "./seed-checks-demo.ts";

const passport = { sampling: "  連続した2試料  ", instrument: "装置A、20°C", preprocessing: "欠測なし。前処理なし" };
const expected = { ...passport, sampling: passport.sampling.trim() };
const options = { label: "passport CSV", provenance: "synthetic" as const, columns: { T: { source: "temp", unit: "K" }, strength: { source: "value", unit: "kPa" } } };
const csv = "temp,value\n293.15,400000\n313.15,390000";
const invalid = [{}, { sampling: undefined }, { sampling: " " }, { instrument: "x".repeat(2001) }, { preprocessing: 1 }, { unknown: "x" }, { sampling: "x", unknown: "y" }, null];
function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "dataset-passport-")), "worlds.json");
  const { store, examples } = seedChecksDemo(path);
  return { path, store, f: examples[0] };
}

test("CSV passport accepts full and partial metadata, keeps it separate from note, and preserves absent compatibility", () => {
  const { f } = fixture();
  for (const [input, expectedPassport] of [[passport, expected], [{ instrument: "装置だけ記録" }, { instrument: "装置だけ記録" }]] as const) {
    const preview = previewModelCsv(f.second, csv, { ...options, passport: input });
    assert.deepEqual(preview.errors, []); assert.ok(preview.dataset);
    assert.deepEqual(preview.dataset.passport, expectedPassport);
    assert.deepEqual(preview.dataset.columns, { T: [20, 40], strength: [400, 390] });
    assert.ok(!preview.dataset.note.includes("装置"));
  }
  const absent = previewModelCsv(f.second, csv, options);
  assert.ok(absent.dataset); assert.equal(Object.hasOwn(absent.dataset, "passport"), false);
  for (const value of invalid) {
    const preview = previewModelCsv(f.second, csv, { ...options, passport: value } as unknown as ImportOptions);
    assert.equal(preview.dataset, null); assert.ok(preview.errors.some(e => e.includes("passport")));
  }
});

test("passport survives Store reload, overview and capsule create/read/import without altering old evidence", () => {
  const { path, store, f } = fixture();
  const previous = structuredClone(store.state.datasets);
  const preview = previewModelCsv(f.second, csv, { ...options, passport }); assert.ok(preview.dataset);
  const dataset = store.attachDataset(preview.dataset);
  assert.deepEqual(dataset.passport, expected);
  assert.deepEqual(store.state.datasets.slice(0, previous.length), previous);
  const run = store.attachRun({ ...f.secondRun, datasetId: dataset.id });
  const loaded = new Store(path);
  assert.deepEqual(loaded.state.datasets.find(d => d.id === dataset.id)!.passport, expected);
  const overview = loaded.overview().models.find(m => m.id === f.model.id)!;
  assert.deepEqual(overview.datasets.find(d => d.id === dataset.id)!.passport, expected);
  assert.equal(Object.hasOwn(overview.datasets.find(d => d.id === f.dataset.id)!, "passport"), false);
  const capsule = createCapsule(f.second, dataset, run);
  const read = readCapsule(JSON.parse(JSON.stringify(capsule)));
  assert.ok(read.ok); if (read.ok) assert.deepEqual(read.capsule.dataset.passport, expected);
  assert.deepEqual(loaded.importCapsule(capsule).dataset.passport, expected);
});

test("invalid passport never writes Store state or silently strips metadata", () => {
  const { path, store, f } = fixture();
  const disk = readFileSync(path, "utf8"), memory = structuredClone(store.state);
  for (const value of invalid) {
    const input = { ...f.dataset, passport: value };
    assert.equal(AgentDatasetInput.safeParse(input).success, false);
    assert.throws(() => store.attachDataset(input as unknown as Parameters<Store["attachDataset"]>[0]));
    assert.deepEqual(store.state, memory); assert.equal(readFileSync(path, "utf8"), disk);
  }
});
