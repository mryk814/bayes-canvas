import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.ts";
import type { Dataset } from "../shared/contracts.ts";

test("human CSV HTTP boundary saves only valid current-version datasets", { timeout: 15000 }, async () => {
  const path = join(mkdtempSync(join(tmpdir(), "csv-http-")), "worlds.json");
  const seed = new Store(path);
  const model = seed.startExample("curve");
  const other = seed.startExample("curve");
  const entry = new URL("../server/main.ts", import.meta.url).href;
  // Observe the actual listening socket so PORT=0 is race-free. The app routes
  // and Store run unchanged in their own process against this test's data file.
  const bootstrap = `
    import { Server } from 'node:net';
    const listen = Server.prototype.listen;
    Server.prototype.listen = function (...args) {
      this.once('listening', () => console.log('TEST_PORT=' + this.address().port));
      return listen.apply(this, args);
    };
    await import(${JSON.stringify(entry)});
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PORT: "0", WORLDS_DATA: path },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let logs = "";
  child.stderr.on("data", chunk => { logs += String(chunk); });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`test server did not start: ${logs}`)), 7000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`test server exited ${code}: ${logs}`)); });
      child.stdout.on("data", chunk => {
        logs += String(chunk);
        const match = logs.match(/TEST_PORT=(\d+)/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    const post = (route: string, body: unknown) => fetch(`http://127.0.0.1:${port}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const input = {
      modelId: model.id, versionId: model.currentVersionId,
      label: "HTTP合成検証", provenance: "synthetic", note: "test only",
      plates: { point: 2 }, columns: { T: [20, 40], strength: [400, 380] },
    };
    const response = await post("/api/human/datasets", input);
    assert.equal(response.status, 200);
    const dataset = await response.json() as Dataset;
    assert.equal(dataset.modelId, model.id);
    assert.deepEqual(dataset.columns, input.columns);
    assert.deepEqual(new Store(path).state.datasets, [dataset]);

    for (const invalid of [
      { ...input, label: "" },
      { ...input, provenance: "guess" },
      { ...input, columns: { T: [20, 40] } },
      { ...input, columns: { T: [20], strength: [400, 380] } },
      { ...input, columns: { T: [null, 40], strength: [400, 380] } },
    ]) assert.equal((await post("/api/human/datasets", invalid)).status, 400);
    assert.equal((await post("/api/human/datasets", { ...input, versionId: other.currentVersionId })).status, 409);
    assert.equal((await post("/api/human/datasets", { ...input, versionId: undefined })).status, 409);

    // Advance the model by adopting a proposal, then retry the stale preview.
    const proposalResponse = await post("/api/agent/proposals", {
      modelId: model.id, spec: seed.state.versions.find(v => v.id === model.currentVersionId)!.spec,
      summary: "HTTP stale-version test", knowledgeIds: [],
    });
    assert.equal(proposalResponse.status, 200);
    const proposal = await proposalResponse.json() as { id: string };
    assert.equal((await post(`/api/human/proposals/${proposal.id}/adopt`, {})).status, 200);
    assert.notEqual(new Store(path).state.models.find(m => m.id === model.id)!.currentVersionId, input.versionId);
    const stale = await post("/api/human/datasets", input);
    assert.equal(stale.status, 409);
    assert.match((await stale.json() as { error: string }).error, /版/);
    assert.deepEqual(new Store(path).state.datasets, [dataset], "rejected requests must not write datasets");
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  }
});
