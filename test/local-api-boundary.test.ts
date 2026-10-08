import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.ts";

test("local API rejects foreign browser origins, rebinding hosts and simple POST before mutation", { timeout: 15000 }, async () => {
  const path = join(mkdtempSync(join(tmpdir(), "local-api-")), "worlds.json");
  const store = new Store(path);
  store.startExample("curve");
  const original = readFileSync(path, "utf8");
  const entry = new URL("../server/main.ts", import.meta.url).href;
  const bootstrap = `import { Server } from 'node:net'; const listen = Server.prototype.listen;
    Server.prototype.listen = function (...args) { this.once('listening', () => console.log('TEST_PORT=' + this.address().port)); return listen.apply(this, args); };
    await import(${JSON.stringify(entry)});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PORT: "0", WORLDS_DATA: path, WORLDS_AUTO: "0" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "";
  child.stderr.on("data", chunk => { logs += String(chunk); });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server startup: ${logs}`)), 7000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`server exit ${code}: ${logs}`)); });
      child.stdout.on("data", chunk => { logs += String(chunk); const match = logs.match(/TEST_PORT=(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
    });
    const origin = `http://127.0.0.1:${port}`;
    const call = (headers: Record<string, string>, method = "POST", route = "/api/human/example") => new Promise<number>((resolve, reject) => {
      const req = request(`${origin}${route}`, { method, headers }, res => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
      req.on("error", reject);
      req.end(method === "POST" ? JSON.stringify({ exampleId: "curve" }) : undefined);
    });
    const rejectedHeaders: Record<string, string>[] = [
      { Origin: "http://unrelated.invalid", "Content-Type": "text/plain" },
      { Origin: "null", "Content-Type": "application/json" },
      { Origin: "http://unrelated.invalid", "Content-Type": "application/json" },
      { Host: `rebinding.invalid:${port}`, "Content-Type": "application/json" },
      { "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" },
    ];
    for (const headers of rejectedHeaders) assert.equal(await call(headers), 403);
    assert.equal(await call({ "Content-Type": "text/plain" }), 415);
    assert.equal(await call({}), 415);
    assert.equal(await call({ Origin: "http://unrelated.invalid" }, "GET", "/api/state"), 403);
    assert.equal(await call({ Host: `rebinding.invalid:${port}` }, "GET", "/api/export"), 403);
    assert.equal(readFileSync(path, "utf8"), original, "rejected requests never write data");
    assert.equal(await call({ Origin: origin, "Content-Type": "application/json; charset=utf-8" }), 200);
    assert.equal(await call({ "Content-Type": "application/json" }), 200, "native MCP/CLI has no Origin");
    assert.equal(new Store(path).state.models.length, 3);
  } finally {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
});
