import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CandidateSchema, HumanIntentInput, HumanFollowUpInput, AgentReplyInput } from "../../shared/contracts.ts";
import { Store } from "../../server/store.ts";

const dialogue = z.array(z.object({
  expert: z.string().trim().min(1).max(4000),
  assistant: z.object({ message: z.string(), candidates: z.array(CandidateSchema.omit({ id: true, edit: true }).strict()).max(4) }).strict(),
}).strict()).min(1).max(8);

/** Protocol replay only: it does not score whether a reply understood the expert. */
export function replayExpertConversation(raw: unknown) {
  const turns = dialogue.parse(raw);
  const directory = mkdtempSync(join(tmpdir(), "possible-worlds-persona-"));
  const path = join(directory, "synthetic.json");
  try {
    const store = new Store(path);
    const model = store.startExample("curve");
    const before = structuredClone(store.state);
    const intent = store.createIntent(HumanIntentInput.parse({
      scene: { modelVersionId: model.currentVersionId, seed: 1, runId: null }, marks: [], utterance: turns[0].expert,
    }));
    turns.forEach((turn, i) => {
      if (i) store.followUp(intent.id, HumanFollowUpInput.parse({ text: turn.expert }));
      store.reply(AgentReplyInput.parse({ intentId: intent.id, ...turn.assistant }));
    });
    const after = structuredClone(store.state);
    after.intents = before.intents;
    assert.deepEqual(after, before, "意図への返信以外の状態が変わりました");
    const reloaded = new Store(path);
    assert.deepEqual(reloaded.state, store.state);
    const saved = store.state.intents.find(i => i.id === intent.id)!;
    return { turns: turns.length, threadMessages: saved.thread.length, candidates: saved.candidates.length,
      status: saved.status, stateUnchangedOutsideIntent: true, persisted: true,
      scope: "合成一時Storeの再生。対話品質の判定、MCP/GUI/推論実行の検証ではありません。" };
  } finally {
    // Fixed files in the newly created directory; no recursive cleanup or existing data.
    for (const file of [path, path + ".bak", path + ".tmp"]) if (existsSync(file)) unlinkSync(file);
    rmdirSync(directory);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const transcript = JSON.parse(readFileSync(new URL("./transcripts/smoke.json", import.meta.url), "utf8"));
  console.log(JSON.stringify(replayExpertConversation(transcript.turns), null, 2));
}
