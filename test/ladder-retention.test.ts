import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ladder } from "../server/ladder.ts";
import { Store } from "../server/store.ts";
import { CURVE_EXAMPLE } from "../shared/example.ts";

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ladder-retention-"));
  const path = join(directory, "worlds.json");
  t.after(() => {
    for (const file of [path, `${path}.bak`, `${path}.tmp`]) if (existsSync(file)) unlinkSync(file);
    rmdirSync(directory);
  });
  const store = new Store(path);
  const model = store.startExample("curve");
  store.synthesize({ modelId: model.id, label: "synthetic", note: "", truth: CURVE_EXAMPLE, seed: 1, plates: {} });
  const launched: string[] = [];
  const ladder = new Ladder(store, directory, () => {}, { enabled: true, launch: job => launched.push(job.id) });
  return { store, model, ladder, launched };
}

test("planning more than 60 active jobs preserves the running job and every queued job", t => {
  const { store, model, ladder, launched } = fixture(t);
  const first = launched[0];
  const initial = ladder.jobs.map(job => job.id);
  for (let i = 0; i < 22; i++) {
    store.proposeAlgorithm({ versionId: model.currentVersionId, name: `candidate ${i}`, note: "", code: 'NAME = "candidate"\ndef make(mod, sizes, options):\n    pass' });
  }
  assert.ok(ladder.jobs.length > 60);
  assert.deepEqual(launched, [first], "unfinished computation must remain the only launched job");
  for (const id of initial) assert.ok(ladder.jobs.some(job => job.id === id), `retain ${id}`);
  const ids = ladder.jobs.map(job => job.id);
  ladder.plan();
  assert.deepEqual(ladder.jobs.map(job => job.id), ids, "replanning must not duplicate or replace active jobs");
});

test("history retains the newest 60 terminal jobs without evicting active jobs", t => {
  const { ladder, launched } = fixture(t);
  const activeIds = ladder.jobs.map(job => job.id);
  const template = ladder.jobs[0];
  for (let i = 0; i < 75; i++) {
    ladder.jobs.push({ ...template, id: `history_${i}`, status: (["done", "failed", "cancelled"] as const)[i % 3] });
  }
  ladder.plan();
  assert.deepEqual(ladder.jobs.filter(job => job.status === "queued" || job.status === "running").map(job => job.id), activeIds);
  assert.deepEqual(ladder.jobs.filter(job => job.id.startsWith("history_")).map(job => job.id), Array.from({ length: 60 }, (_, i) => `history_${i + 15}`));
  assert.equal(launched.length, 1);
});
