import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.ts";
import { seedChecksDemo } from "./seed-checks-demo.ts";

test("human prior endpoint restricts input, preserves evidence and uses existing adoption", { timeout: 15000 }, async () => {
  const path = join(mkdtempSync(join(tmpdir(), "prior-http-")), "worlds.json");
  const { examples } = seedChecksDemo(path), f = examples[0];
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
    const post = (body: unknown, route = "/api/human/prior-proposals") => fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const input = { baseVersionId: f.second.id, nodeName: "s20", args: { mu: 510, sigma: 60 }, reason: "  基準強度を試す  " };
    const before = new Store(path).state;
    const created = await post(input); assert.equal(created.status, 200);
    const proposal = await created.json(); assert.equal(proposal.status, "proposed");
    const proposed = new Store(path).state;
    for (const key of ["models", "versions", "datasets", "runs"] as const) assert.deepEqual(proposed[key], before[key]);
    const disk = readFileSync(path, "utf8");
    for (const invalid of [{ ...input, spec: f.second.spec }, { ...input, modelId: f.model.id }, { ...input, reason: " " }, { ...input, reason: "x".repeat(2001) },
      { ...input, args: { mu: 510, sigma: 0 } }, { ...input, args: { mu: "510", sigma: 60 } }, { ...input, args: { mu: 510, sigma: 60, extra: 1 } },
      { ...input, nodeName: "strength" }, { ...input, args: { mu: null, sigma: 60 } }]) assert.equal((await post(invalid)).status, 400);
    assert.equal((await post({ ...input, baseVersionId: f.first.id })).status, 409);
    assert.equal(readFileSync(path, "utf8"), disk);
    const adopted = await post({}, `/api/human/proposals/${proposal.id}/adopt`); assert.equal(adopted.status, 200);
    const version = await adopted.json();
    assert.equal((await post(input)).status, 409);
    assert.equal((await post({ ...input, baseVersionId: version.id })).status, 400);
    const loaded = new Store(path);
    assert.equal(loaded.version(version.id).spec.nodes.find(n => n.name === "s20")!.dist!.args.mu, "510");
    assert.deepEqual(loaded.state.runs, before.runs); assert.deepEqual(loaded.state.datasets, before.datasets);
  } finally { if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; } }
});
