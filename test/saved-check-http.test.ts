import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedChecksDemo } from "./seed-checks-demo.ts";
import { Store } from "../server/store.ts";
import type { SavedCheck, SavedCheckResult } from "../shared/contracts.ts";

test("saved-check HTTP creates, reruns across versions and preserves history on rejected requests", { timeout: 15000 }, async () => {
  const path = join(mkdtempSync(join(tmpdir(), "checks-http-")), "worlds.json");
  const { examples } = seedChecksDemo(path);
  const fixture = examples.find(example => example.exampleId === "curve")!;
  const entry = new URL("../server/main.ts", import.meta.url).href;
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
    cwd: fileURLToPath(new URL("..", import.meta.url)), env: { ...process.env, PORT: "0", WORLDS_DATA: path },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
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
    const input = { runId: fixture.firstRun.id, label: "合成範囲の平均", xMin: 20, xMax: 300, statistic: "mean", groupIndex: null, seed: 41 };
    const created = await post("/api/human/checks", input);
    assert.equal(created.status, 200);
    const saved = await created.json() as { check: SavedCheck; result: SavedCheckResult };
    assert.equal(saved.result.runId, fixture.firstRun.id);
    assert.equal(saved.result.versionId, fixture.first.id);
    const rerun = await post(`/api/human/checks/${saved.check.id}/run`, { runId: fixture.secondRun.id, seed: 42 });
    assert.equal(rerun.status, 200);
    const secondResult = await rerun.json() as SavedCheckResult;
    assert.equal(secondResult.runId, fixture.secondRun.id);
    assert.equal(secondResult.versionId, fixture.second.id);
    assert.notEqual(secondResult.id, saved.result.id);
    const persisted = readFileSync(path, "utf8");
    const reloaded = new Store(path).state;
    assert.deepEqual(reloaded.checks, [saved.check]);
    assert.deepEqual(reloaded.checkResults, [saved.result, secondResult]);
    assert.equal(saved.result.replicatedValues.length, 32);
    assert.equal(secondResult.replicatedValues.length, 32);
    for (const invalid of [{ ...input, label: "" }, { ...input, seed: 1.5 }, { ...input, statistic: "median" }, { ...input, xMin: 400, xMax: 20 }]) {
      assert.equal((await post("/api/human/checks", invalid)).status, 400);
    }
    assert.equal((await post(`/api/human/checks/${saved.check.id}/run`, { runId: fixture.foreignRun.id, seed: 42 })).status, 400);
    assert.equal((await post("/api/human/checks/missing/run", { runId: fixture.firstRun.id, seed: 42 })).status, 404);
    assert.equal((await post("/api/human/checks", { ...input, runId: "missing" })).status, 404);
    assert.equal(readFileSync(path, "utf8"), persisted, "rejected requests must not change saved state");
  } finally {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
});
