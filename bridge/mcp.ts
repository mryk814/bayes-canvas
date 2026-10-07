// MCP bridge that Claude Code spawns over stdio. It holds no state: every tool
// call goes to the app server, which validates it. When the person sends an
// intent, the bridge pushes it into the session as a channel event (if the
// session loaded this server as a channel; otherwise the tools still work).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AgentProposeInput, AgentReplyInput } from "../shared/contracts.ts";
import { EXPRESSION_HELP } from "../shared/expr.ts";

const base = process.env.WORLDS_URL ?? `http://127.0.0.1:${process.env.PORT ?? 5199}`;

const INSTRUCTIONS = `Possible Worlds is a local app where a person explores the prior of a Bayesian model by looking at simulated "worlds" (one prior draw each, with its mean curve and noisy observations) and says what feels wrong or right. Your job is to translate what they point at and say into candidate meanings, and to propose model changes. You never change the model yourself: the person adopts or rejects proposals in the app.

Workflow:
1. Call worlds_pending_intents. Each intent carries the person's words (thread), marks (verdicts on world indices, sketches, x-ranges in model units), the model version they were looking at, and numeric summaries of the referenced worlds.
2. Read the referenced worlds' parameter values. Work out which prior or formula produced what they object to. Call worlds_sample if you need to see more worlds from the same seed or a candidate spec.
3. Call worlds_reply with 2–4 candidates that are genuinely different readings (for example: a hard constraint vs. a softer prior belief vs. a hypothesis about the mechanism). Each candidate has a kind, a one-sentence statement written as the person's knowledge, and optionally an edit: a full new spec plus a summary. If the intent is too ambiguous, reply with only a short question in message and no candidates.
4. Write in Japanese, concise and calm.

Rules: a sketch is a gesture, never an observation; do not add it as data. Do not silently change things the person did not talk about; keep every untouched part of the spec identical. Prefer edits that keep parameter names stable. Expressions: ${EXPRESSION_HELP}

Intents may also arrive as <channel source="worlds" intent_id="..."> events; handle them with the same workflow.`;

async function api(method: "GET" | "POST", path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => {
    throw new Error(`Possible Worlds のサーバー (${base}) に接続できません。プロジェクトで npm run dev を起動してください。`);
  });
  const json = (await res.json()) as { error?: string; problems?: string[] };
  if (!res.ok) {
    throw new Error([json.error ?? `HTTP ${res.status}`, ...(json.problems ?? []).map((p) => `- ${p}`)].join("\n"));
  }
  return json;
}

const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "input" }) as { type: "object"; [k: string]: unknown };

const tools = [
  {
    name: "worlds_overview",
    description: "Current model version (full spec), version history, confirmed knowledge, pending intent ids and open proposals.",
    inputSchema: { type: "object" as const, properties: {} },
    run: () => api("GET", "/api/agent/overview"),
  },
  {
    name: "worlds_pending_intents",
    description: "Intents the person sent that are waiting for you, with the referenced worlds summarised numerically.",
    inputSchema: { type: "object" as const, properties: {} },
    run: () => api("GET", "/api/agent/intents"),
  },
  {
    name: "worlds_sample",
    description:
      "Numeric summaries of simulated worlds. Same (spec, seed, index) always gives the same world as the person sees. " +
      "Use versionId (defaults to current) or proposalId. count ≤ 48.",
    inputSchema: schema(
      z.object({
        versionId: z.string().optional(),
        proposalId: z.string().optional(),
        seed: z.number().int(),
        from: z.number().int().min(0).optional(),
        count: z.number().int().min(1).max(48).optional(),
      }),
    ),
    run: (args: unknown) => api("POST", "/api/agent/worlds", args),
  },
  {
    name: "worlds_reply",
    description:
      "Answer a pending intent with candidate meanings (and optional spec edits) for the person to choose from, " +
      "or with only a message to ask a clarifying question.",
    inputSchema: schema(AgentReplyInput),
    run: (args: unknown) => api("POST", "/api/agent/reply", args),
  },
  {
    name: "worlds_propose_model",
    description:
      "Propose a full model spec (for a new model, or a change not tied to one intent). It is shown to the person, who adopts or rejects it. " +
      "Link the knowledge ids it is based on.",
    inputSchema: schema(AgentProposeInput),
    run: (args: unknown) => api("POST", "/api/agent/proposals", args),
  },
];

const mcp = new Server(
  { name: "worlds", version: "0.1.0" },
  { capabilities: { tools: {}, experimental: { "claude/channel": {} } }, instructions: INSTRUCTIONS },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) return { isError: true, content: [{ type: "text", text: `unknown tool ${req.params.name}` }] };
  try {
    const result = await tool.run(req.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
  }
});

await mcp.connect(new StdioServerTransport());

// Watch the app and forward new intents. Reconnects quietly while the app is down.
async function watch() {
  for (;;) {
    try {
      const res = await fetch(`${base}/api/stream?role=agent`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const line = block.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as { kind: string; id?: string };
          if (event.kind === "intent.pending" && event.id) {
            await mcp.notification({
              method: "notifications/claude/channel",
              params: {
                content: "Possible Worlds で新しい意図が届きました。worlds_pending_intents で内容を読み、worlds_reply で候補を返してください。",
                meta: { intent_id: event.id },
              },
            });
          }
        }
      }
    } catch {
      // app not running yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
void watch();
