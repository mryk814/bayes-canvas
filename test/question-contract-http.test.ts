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

test("human question-contract endpoint proposes only, rejects stale/extra/empty fields without writes, then adopts", { timeout: 15000 }, async () => {
  const path = join(mkdtempSync(join(tmpdir(), "question-http-")), "worlds.json");
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
    const post = (body: unknown, route = "/api/human/question-contracts") => fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const input = { baseVersionId: f.second.id, question: "  何を推定するか  ", questionContract: { population: "対象材料", estimand: "平均強度（MPa）", decision: "探索のみ" } };
    const created = await post(input); assert.equal(created.status, 200);
    const proposal = await created.json();
    assert.equal(proposal.status, "proposed");
    assert.equal(new Store(path).state.models.find(m => m.id === f.model.id)!.currentVersionId, f.second.id);
    const disk = readFileSync(path, "utf8");
    for (const invalid of [{ ...input, spec: f.second.spec }, { ...input, question: "" }, { ...input, questionContract: { ...input.questionContract, population: " " } }, { ...input, questionContract: { ...input.questionContract, extra: "x" } }]) assert.equal((await post(invalid)).status, 400);
    assert.equal((await post({ ...input, baseVersionId: f.first.id })).status, 409);
    assert.equal(readFileSync(path, "utf8"), disk);
    const adopted = await post({}, `/api/human/proposals/${proposal.id}/adopt`); assert.equal(adopted.status, 200);
    const version = await adopted.json();
    assert.equal((await post(input)).status, 409);
    assert.equal((await post({ ...input, baseVersionId: version.id })).status, 400);
    const loaded = new Store(path);
    assert.deepEqual(loaded.version(version.id).spec.questionContract, input.questionContract);
    assert.equal(loaded.state.runs.find(r => r.id === f.secondRun.id)!.versionId, f.second.id);
  } finally { if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; } }
});
