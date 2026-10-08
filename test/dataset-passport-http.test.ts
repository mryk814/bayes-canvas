import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.ts";

test("human and agent Dataset HTTP preserve passports, reject invalid metadata without writes, and retain absent input", { timeout: 15000 }, async () => {
  const path = join(mkdtempSync(join(tmpdir(), "passport-http-")), "worlds.json");
  const initial = new Store(path), model = initial.startExample("curve");
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
    const post = (body: unknown, route: string) => fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const input = { modelId: model.id, versionId: model.currentVersionId, label: "passport", provenance: "synthetic", note: "unchanged note", plates: { point: 2 }, columns: { T: [20, 40], strength: [400, 390] } };
    for (const route of ["/api/human/datasets", "/api/agent/datasets"]) {
      const response = await post({ ...input, passport: { sampling: "  2試料  " } }, route); assert.equal(response.status, 200);
      const dataset = await response.json(); assert.deepEqual(dataset.passport, { sampling: "2試料" }); assert.equal(dataset.note, input.note);
      assert.deepEqual(new Store(path).state.datasets.find(d => d.id === dataset.id)!.passport, dataset.passport);
      const overview = await (await fetch(`http://127.0.0.1:${port}/api/agent/overview`)).json();
      assert.deepEqual(overview.models[0].datasets.find((d: { id: string }) => d.id === dataset.id).passport, dataset.passport);
      const preserved = readFileSync(path, "utf8");
      for (const passport of [{}, { sampling: " " }, { instrument: 1 }, { preprocessing: "x".repeat(2001) }, { sampling: "x", unexpected: "y" }, null]) {
        assert.equal((await post({ ...input, passport }, route)).status, 400);
        assert.equal(readFileSync(path, "utf8"), preserved);
      }
    }
    const old = await post(input, "/api/human/datasets"); assert.equal(old.status, 200);
    assert.equal(Object.hasOwn(await old.json(), "passport"), false);
  } finally { if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; } }
});
