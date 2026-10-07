// Entry point: wires the store to HTTP. The browser uses /api/human/*, the MCP
// bridge uses /api/agent/*. Both watch /api/stream for changes.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { ZodError } from "zod";
import {
  AgentDatasetInput,
  AgentProposeInput,
  AgentReplyInput,
  AgentRunInput,
  AgentSynthesizeInput,
  HumanChooseInput,
  HumanExampleInput,
  HumanFollowUpInput,
  HumanIntentInput,
} from "../shared/contracts.ts";
import { HttpError, Store, type ChangeEvent } from "./store.ts";

const root = resolve(import.meta.dirname, "..");
const dev = process.argv.includes("--dev");
const port = Number(process.env.PORT ?? 5199);
const dataPath = resolve(process.env.WORLDS_DATA ?? join(root, "data", "worlds.json"));

const store = new Store(dataPath);

const agentStreams = new Set<ServerResponse>();
const streams = new Set<ServerResponse>();

function broadcast(e: ChangeEvent) {
  const chunk = `data: ${JSON.stringify({ ...e, agentConnected: agentStreams.size > 0 })}\n\n`;
  for (const res of streams) res.write(chunk);
  for (const res of agentStreams) res.write(chunk);
}
store.subscribe(broadcast);

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON として読めません");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

type Route = { method: string; pattern: RegExp; handle: (m: RegExpMatchArray, body: () => Promise<unknown>) => unknown };

const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/state$/, handle: () => ({ state: store.state, agentConnected: agentStreams.size > 0, dataPath }) },
  { method: "POST", pattern: /^\/api\/human\/example$/, handle: async (_, b) => store.startExample(HumanExampleInput.parse(await b()).exampleId) },
  { method: "POST", pattern: /^\/api\/human\/intents$/, handle: async (_, b) => store.createIntent(HumanIntentInput.parse(await b())) },
  {
    method: "POST",
    pattern: /^\/api\/human\/intents\/([\w-]+)\/follow-up$/,
    handle: async (m, b) => store.followUp(m[1], HumanFollowUpInput.parse(await b())),
  },
  {
    method: "POST",
    pattern: /^\/api\/human\/intents\/([\w-]+)\/choose$/,
    handle: async (m, b) => store.choose(m[1], HumanChooseInput.parse(await b())),
  },
  { method: "POST", pattern: /^\/api\/human\/intents\/([\w-]+)\/dismiss$/, handle: (m) => store.setIntentDismissed(m[1], true) },
  { method: "POST", pattern: /^\/api\/human\/intents\/([\w-]+)\/restore$/, handle: (m) => store.setIntentDismissed(m[1], false) },
  { method: "POST", pattern: /^\/api\/human\/knowledge\/([\w-]+)\/withdraw$/, handle: (m) => store.setKnowledgeWithdrawn(m[1], true) },
  { method: "POST", pattern: /^\/api\/human\/knowledge\/([\w-]+)\/restore$/, handle: (m) => store.setKnowledgeWithdrawn(m[1], false) },
  { method: "POST", pattern: /^\/api\/human\/proposals\/([\w-]+)\/adopt$/, handle: (m) => store.adopt(m[1]) },
  { method: "POST", pattern: /^\/api\/human\/proposals\/([\w-]+)\/reject$/, handle: (m) => store.reject(m[1]) },
  { method: "POST", pattern: /^\/api\/human\/versions\/([\w-]+)\/revert$/, handle: (m) => store.revert(m[1]) },
  { method: "GET", pattern: /^\/api\/agent\/overview$/, handle: () => store.overview() },
  { method: "GET", pattern: /^\/api\/agent\/intents$/, handle: () => store.pendingIntents() },
  {
    method: "POST",
    pattern: /^\/api\/agent\/worlds$/,
    handle: async (_, b) => store.worlds((await b()) as Parameters<Store["worlds"]>[0]),
  },
  { method: "POST", pattern: /^\/api\/agent\/reply$/, handle: async (_, b) => store.reply(AgentReplyInput.parse(await b())) },
  { method: "POST", pattern: /^\/api\/agent\/proposals$/, handle: async (_, b) => store.propose(AgentProposeInput.parse(await b())) },
  { method: "POST", pattern: /^\/api\/agent\/datasets$/, handle: async (_, b) => store.attachDataset(AgentDatasetInput.parse(await b())) },
  { method: "POST", pattern: /^\/api\/agent\/datasets\/synthesize$/, handle: async (_, b) => store.synthesize(AgentSynthesizeInput.parse(await b())) },
  {
    method: "POST",
    pattern: /^\/api\/agent\/inference-bundle$/,
    handle: async (_, b) => {
      const { versionId, datasetId, backend } = (await b()) as { versionId: string; datasetId: string; backend?: "stan" | "numpyro" };
      return store.inferenceBundle(versionId, datasetId, backend === "numpyro" ? "numpyro" : "stan");
    },
  },
  { method: "POST", pattern: /^\/api\/agent\/runs$/, handle: async (_, b) => store.attachRun(AgentRunInput.parse(await b())) },
];

function openStream(req: IncomingMessage, res: ServerResponse, agent: boolean) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(": connected\n\n");
  const set = agent ? agentStreams : streams;
  set.add(res);
  if (agent) broadcast({ kind: "agent" });
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    set.delete(res);
    if (agent) broadcast({ kind: "agent" });
  });
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === "/api/stream") return openStream(req, res, url.searchParams.get("role") === "agent");
  if (url.pathname === "/api/export") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="possible-worlds-${new Date().toISOString().slice(0, 10)}.json"`,
    });
    return res.end(JSON.stringify(store.state, null, 2));
  }
  for (const r of routes) {
    const m = url.pathname.match(r.pattern);
    if (!m || r.method !== req.method) continue;
    try {
      return send(res, 200, await r.handle(m, () => readJson(req)));
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, problems: err.problems });
      if (err instanceof ZodError) {
        return send(res, 400, {
          error: "入力の形が契約と合いません",
          problems: err.issues.map((i) => `${i.path.join(".") || "(全体)"}: ${i.message}`),
        });
      }
      console.error(err);
      return send(res, 500, { error: "サーバー内部で失敗しました。ターミナルのログを確認してください" });
    }
  }
  send(res, 404, { error: `${req.method} ${url.pathname} はありません` });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};

async function serveStatic(res: ServerResponse, url: URL) {
  const dist = join(root, "dist");
  const file = resolve(dist, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
  try {
    if (!file.startsWith(dist)) throw new Error("outside");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    const body = await readFile(join(dist, "index.html")).catch(() => null);
    if (!body) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("dist がありません。npm run build を先に実行してください。");
    }
    res.writeHead(200, { "Content-Type": MIME[".html"] });
    res.end(body);
  }
}

const vite = dev
  ? await (await import("vite")).createServer({ root, server: { middlewareMode: true }, appType: "spa" })
  : null;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname.startsWith("/api/")) return void handleApi(req, res, url);
  if (vite) return vite.middlewares(req, res);
  void serveStatic(res, url);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Possible Worlds: http://127.0.0.1:${port}/`);
  console.log(`data: ${dataPath}`);
});
