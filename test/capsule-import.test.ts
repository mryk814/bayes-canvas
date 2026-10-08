import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.ts";
import { createCapsule, readCapsule } from "../shared/capsule.ts";
import { seedChecksDemo } from "./seed-checks-demo.ts";

function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "capsule-import-")), "worlds.json");
  const { store, examples } = seedChecksDemo(path);
  const f = examples[1];
  return { path, store, capsule: createCapsule(f.second, f.dataset, f.secondRun) };
}

test("capsule import appends an independent v1 with preserved evidence and source, even for colliding IDs", () => {
  const { path, store, capsule } = fixture();
  const before = structuredClone(store.state), inputBefore = structuredClone(capsule);
  const events: unknown[] = []; store.subscribe(event => events.push(event));
  const result = store.importCapsule(capsule);
  const { model, version, dataset, run } = result;
  assert.equal(events.length, 1);
  assert.notEqual(model.id, capsule.modelVersion.modelId);
  assert.notEqual(version.id, capsule.modelVersion.id);
  assert.notEqual(dataset.id, capsule.dataset.id);
  assert.notEqual(run.id, capsule.run.id);
  assert.equal(model.title, capsule.modelVersion.spec.title + "（カプセルのコピー）");
  assert.equal(model.currentVersionId, version.id);
  assert.equal(version.number, 1);
  assert.deepEqual(version.spec, capsule.modelVersion.spec);
  assert.deepEqual(version.origin, { kind: "capsule", source: { modelId: capsule.modelVersion.modelId, versionId: capsule.modelVersion.id, versionNumber: capsule.modelVersion.number, datasetId: capsule.dataset.id, runId: capsule.run.id, createdAt: capsule.modelVersion.createdAt } });
  assert.ok(version.summary.includes(capsule.modelVersion.summary));
  assert.ok(version.summary.includes(capsule.modelVersion.id));
  assert.deepEqual(dataset, { ...capsule.dataset, id: dataset.id, modelId: model.id });
  assert.deepEqual(run, { ...capsule.run, id: run.id, modelId: model.id, versionId: version.id, datasetId: dataset.id });
  for (const [key, values] of Object.entries(before)) {
    if (Array.isArray(values)) assert.deepEqual((store.state[key as keyof typeof before] as unknown[]).slice(0, values.length), values);
  }
  for (const key of ["intents", "knowledge", "proposals", "checks", "checkResults"] as const) assert.deepEqual(store.state[key], before[key]);
  assert.deepEqual(capsule, inputBefore);
  const again = store.importCapsule(capsule);
  for (const key of ["model", "version", "dataset", "run"] as const) assert.notEqual(again[key].id, result[key].id);
  const loaded = new Store(path);
  assert.deepEqual(loaded.state, store.state);
  const exported = createCapsule(loaded.version(version.id), loaded.state.datasets.find(d => d.id === dataset.id)!, loaded.state.runs.find(r => r.id === run.id)!);
  assert.equal(readCapsule(JSON.parse(JSON.stringify(exported))).ok, true);
  assert.deepEqual(exported.modelVersion.origin, version.origin);
  const overview = loaded.overview().models.find(m => m.id === model.id)!;
  assert.deepEqual(overview.versions[0].origin, version.origin);
  assert.equal(overview.runs[0].datasetId, dataset.id);
  assert.deepEqual(loaded.worldOf({ modelVersionId: version.id, runId: run.id, seed: 1 }, 0).world,
    loaded.worldOf({ modelVersionId: capsule.modelVersion.id, runId: capsule.run.id, seed: 1 }, 0).world);
});

test("rejected capsules leave memory, disk and notifications unchanged", () => {
  const { path, store, capsule } = fixture();
  const memory = structuredClone(store.state), disk = readFileSync(path, "utf8");
  let events = 0; store.subscribe(() => events++);
  const brokenRef = structuredClone(capsule); brokenRef.run.versionId = "missing";
  const brokenDraw = structuredClone(capsule); brokenDraw.run.draws.bias[0][0] = Infinity;
  const brokenExpr = structuredClone(capsule); brokenExpr.modelVersion.spec.nodes[0].dist!.args.mu = "unknown";
  for (const raw of [null, {}, brokenRef, brokenDraw, brokenExpr]) {
    assert.throws(() => store.importCapsule(raw), { status: 400 });
    assert.deepEqual(store.state, memory);
    assert.equal(readFileSync(path, "utf8"), disk);
  }
  assert.equal(events, 0);
});

test("failed capsule file write leaves memory, disk and notifications unchanged", () => {
  const { path, store, capsule } = fixture();
  const memory = structuredClone(store.state), disk = readFileSync(path, "utf8");
  let events = 0; store.subscribe(() => events++);
  mkdirSync(path + ".tmp");
  assert.throws(() => store.importCapsule(capsule));
  assert.deepEqual(store.state, memory);
  assert.equal(readFileSync(path, "utf8"), disk);
  assert.equal(events, 0);
});

test("human capsule HTTP imports into an empty store, rejects invalid evidence, and persists a copy", { timeout: 15000 }, async () => {
  const { capsule } = fixture();
  const path = join(mkdtempSync(join(tmpdir(), "capsule-http-")), "worlds.json");
  const entry = new URL("../server/main.ts", import.meta.url).href;
  const bootstrap = `import { Server } from 'node:net'; const listen = Server.prototype.listen;
    Server.prototype.listen = function (...args) { this.once('listening', () => console.log('TEST_PORT=' + this.address().port)); return listen.apply(this, args); };
    await import(${JSON.stringify(entry)});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], { cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...process.env, PORT: "0", WORLDS_DATA: path }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let logs = ""; child.stderr.on("data", chunk => { logs += String(chunk); });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`test server did not start: ${logs}`)), 7000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`test server exited ${code}: ${logs}`)); });
      child.stdout.on("data", chunk => { logs += String(chunk); const match = logs.match(/TEST_PORT=(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    });
    const post = (body: unknown, route = "/api/human/capsules") => fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const response = await post(capsule);
    assert.equal(response.status, 200);
    const imported = await response.json() as ReturnType<Store["importCapsule"]>;
    const loaded = new Store(path);
    assert.deepEqual(loaded.state.models, [imported.model]);
    assert.deepEqual(loaded.state.versions, [imported.version]);
    assert.deepEqual(loaded.state.datasets, [imported.dataset]);
    assert.deepEqual(loaded.state.runs, [imported.run]);
    const persisted = readFileSync(path, "utf8");
    const bad = structuredClone(capsule); bad.run.datasetId = "missing";
    assert.equal((await post(bad)).status, 400);
    assert.equal((await post(capsule, "/api/agent/capsules")).status, 404);
    assert.equal(readFileSync(path, "utf8"), persisted);
  } finally {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
});
